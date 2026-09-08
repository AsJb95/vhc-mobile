import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../lib/supabaseClient';
import { findPharmacyLocation, isRetiredLocation } from '../lib/locations';
import { planPharmacyTransferLines } from '../lib/transfers';
import { useAuth } from './AuthContext';

// Whether transfer_orders.created_by / approved_by / cancelled_by(+_at) exist on
// the live database (migration 20260904000100_transfer_created_by.sql). Probed
// once so every insert/update can adapt — the app works fully before the
// migration has been applied (those audit fields are simply omitted).
let transferAuditColsSupported = false;
let transferAuditColsChecked = false;
async function ensureTransferAuditColsChecked() {
  if (transferAuditColsChecked) return;
  transferAuditColsChecked = true;
  try {
    const { error } = await supabase.from('transfer_orders').select('created_by').limit(1);
    transferAuditColsSupported = !error;
  } catch {
    transferAuditColsSupported = false;
  }
}

function withErrorAlert(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error('Warehouse action failed:', e);
      Alert.alert('Action failed', e.message || String(e));
      throw e;
    }
  };
}

function rowToMainItem(row) {
  return {
    id: row.id,
    itemId: row.item_id,
    locationId: row.location_id,
    name: row.items?.name || '',
    batch: row.batch_no || '',
    expiry: row.expiry_date || '',
    netRate: row.net_rate,
    mrp: row.mrp,
    gst: row.gst,
    stockist: row.stockist,
    stock: row.qty,
    unitsPerPack: row.items?.units_per_pack,
    category: row.items?.category,
    hsnCode: row.items?.hsn_code,
  };
}

function batchEq(query, batch) {
  return batch ? query.eq('batch_no', batch) : query.is('batch_no', null);
}

// Query bounds — nothing is ever fetched unbounded. Order history is paged
// (newest first) with "load more"; stock is capped high enough to hold the full
// catalog at one location while still refusing a runaway result set.
const HISTORY_PAGE_SIZE = 200;
const STOCK_FETCH_CAP = 5000;

function mapPurchaseOrderRow(po) {
  return {
    id: po.id,
    poNumber: po.po_number,
    supplier: po.supplier,
    status: po.status,
    createdAt: po.created_at,
    receivedAt: po.received_at,
    poDate: po.po_date,
    expectedDelivery: po.expected_delivery,
    notes: po.notes,
    totals: { subtotal: po.subtotal, gstTotal: po.gst_total, total: po.total_amount },
    items: (po.purchase_order_items || []).map((i) => ({
      name: i.name, batch: i.batch_no, expiry: i.expiry_date, netRate: i.net_rate, mrp: i.mrp,
      gst: i.gst, qty: i.qty, unitsPerPack: i.units_per_pack, category: i.category, hsnCode: i.hsn_code,
    })),
  };
}

function mapTransferOrderRow(to, locs) {
  return {
    id: to.id,
    transferNumber: to.transfer_number,
    fromLocationId: to.from_location_id,
    fromLocationName: (locs || []).find((l) => l.id === to.from_location_id)?.name || '',
    toLocationId: to.to_location_id,
    toLocationName: (locs || []).find((l) => l.id === to.to_location_id)?.name || '',
    transferDate: to.transfer_date,
    notes: to.notes,
    status: to.status,
    createdAt: to.created_at,
    createdBy: to.created_by || null,
    approvedBy: to.approved_by || null,
    approvedAt: to.approved_at || null,
    cancelledBy: to.cancelled_by || null,
    cancelledAt: to.cancelled_at || null,
    items: (to.transfer_order_items || []).map((i) => ({
      mainStockId: i.item_id, name: i.name, batch: i.batch_no, expiry: i.expiry_date, mrp: i.mrp, netRate: i.net_rate, qty: i.qty,
    })),
  };
}

export function appendDedupById(prev, next) {
  const seen = new Set(prev.map((r) => r.id));
  return [...prev, ...next.filter((r) => !seen.has(r.id))];
}

// Pharmacy stock location resolution lives in ../lib/locations (pure, tested).
// If no pharmacy_counter row exists, pharmacy add/update simply have nothing to
// write to (and say so) rather than touching any other location.

const WarehouseContext = createContext(null);

export function WarehouseProvider({ children }) {
  // Current signed-in user — stamped onto transfer audit columns (created_by /
  // approved_by / cancelled_by). AuthProvider wraps WarehouseProvider in App.js.
  const { user } = useAuth();
  const [locations, setLocations] = useState([]);
  const [mainStock, setMainStock] = useState([]);
  const [subStocks, setSubStocks] = useState({});
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [transferOrders, setTransferOrders] = useState([]);
  const [alertsConfig, setAlertsConfig] = useState({ lowStockThreshold: 200, expiryAlertDays: 90 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [poHasMore, setPoHasMore] = useState(false);
  const [toHasMore, setToHasMore] = useState(false);
  const [stockTruncated, setStockTruncated] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const loadingMoreRef = useRef(false);
  // How many history rows are currently loaded per list, so a background refetch
  // (realtime / post-mutation) re-fetches the SAME span instead of collapsing
  // the user's scrolled-in pages back to one page (M1).
  const poLoadedRef = useRef(HISTORY_PAGE_SIZE);
  const toLoadedRef = useRef(HISTORY_PAGE_SIZE);
  // Serializes fetchAll(): at most one request in flight plus one queued
  // follow-up, so overlapping triggers (initial load / realtime / post-mutation
  // refresh) never stampede, and every caller still gets data at least as fresh
  // as its call time (M2).
  const fetchInFlightRef = useRef(null);
  const fetchQueuedRef = useRef(null);

  function mainLocationId(locs) {
    return (locs || locations).find((l) => l.type === 'warehouse_main')?.id;
  }

  function pharmacyLocationId(locs) {
    return findPharmacyLocation(locs || locations)?.id;
  }

  const fetchAllImpl = useCallback(async () => {
    const poLimit = Math.max(HISTORY_PAGE_SIZE, poLoadedRef.current);
    const toLimit = Math.max(HISTORY_PAGE_SIZE, toLoadedRef.current);

    const { data: locs, error: locErr } = await supabase.from('locations').select('*').order('created_at');
    if (locErr) throw locErr;
    setLocations(locs || []);

    const main = (locs || []).find((l) => l.type === 'warehouse_main');
    // Retired locations (e.g. the stale duplicate "VHC Pharmacy" warehouse_sub)
    // are excluded everywhere active — their rows stay in the DB for audit only.
    const subs = (locs || []).filter((l) => l.type === 'warehouse_sub' && !isRetiredLocation(l));

    // Non-main stock locations we pull batches for: every active warehouse_sub
    // plus the pharmacy_counter location (so Pharmacy Stock — and the Sub-Stock
    // screen's "VHC Pharmacy" entry — read the one live pharmacy inventory).
    const pharmacyLoc = findPharmacyLocation(locs);
    const stockSubLocs = pharmacyLoc && !subs.some((s) => s.id === pharmacyLoc.id)
      ? [...subs, pharmacyLoc]
      : subs;

    const [mainRes, subRes, poRes, toRes, alertsRes] = await Promise.all([
      main
        ? supabase.from('stock_batches').select('*, items(name, category, hsn_code, units_per_pack)').eq('location_id', main.id).order('updated_at', { ascending: false }).limit(STOCK_FETCH_CAP)
        : Promise.resolve({ data: [] }),
      stockSubLocs.length > 0
        ? supabase.from('stock_batches').select('*, items(name, category, hsn_code, units_per_pack)').in('location_id', stockSubLocs.map((s) => s.id)).order('updated_at', { ascending: false }).limit(STOCK_FETCH_CAP)
        : Promise.resolve({ data: [] }),
      supabase.from('purchase_orders').select('*, purchase_order_items(*)').order('created_at', { ascending: false }).range(0, poLimit - 1),
      supabase.from('transfer_orders').select('*, transfer_order_items(*)').order('created_at', { ascending: false }).range(0, toLimit - 1),
      main
        ? supabase.from('alerts_config').select('*').eq('location_id', main.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (mainRes.error) throw mainRes.error;
    if (subRes.error) throw subRes.error;
    if (poRes.error) throw poRes.error;
    if (toRes.error) throw toRes.error;

    const mainRows = mainRes.data || [];
    const subRows = subRes.data || [];
    setMainStock(mainRows.map(rowToMainItem));
    setStockTruncated(mainRows.length >= STOCK_FETCH_CAP || subRows.length >= STOCK_FETCH_CAP);

    const grouped = {};
    for (const s of stockSubLocs) grouped[s.id] = [];
    for (const row of subRows) {
      grouped[row.location_id] = grouped[row.location_id] || [];
      grouped[row.location_id].push({
        id: row.id,
        itemId: row.item_id,
        locationId: row.location_id,
        mainStockId: row.item_id,
        name: row.items?.name || '',
        batch: row.batch_no || '',
        expiry: row.expiry_date || '',
        mrp: row.mrp,
        netRate: row.net_rate,
        gst: row.gst,
        stockist: row.stockist,
        stock: row.qty,
        unitsPerPack: row.items?.units_per_pack,
        category: row.items?.category,
        hsnCode: row.items?.hsn_code,
      });
    }
    setSubStocks(grouped);

    const poRows = (poRes.data || []).map(mapPurchaseOrderRow);
    const toRows = (toRes.data || []).map((to) => mapTransferOrderRow(to, locs));
    setPurchaseOrders(poRows);
    setTransferOrders(toRows);
    poLoadedRef.current = poRows.length;
    toLoadedRef.current = toRows.length;
    setPoHasMore(poRows.length === poLimit);
    setToHasMore(toRows.length === toLimit);

    if (alertsRes.data) {
      setAlertsConfig({ lowStockThreshold: alertsRes.data.low_stock_threshold, expiryAlertDays: alertsRes.data.expiry_alert_days });
    }

    setLastLoadedAt(new Date());
    return locs || [];
  }, []);

  // Public entry point (M2). If a fetch is running, callers get a single shared
  // follow-up that starts after it completes — so a post-mutation refresh always
  // reflects the mutation, without piling up requests.
  const fetchAll = useCallback(() => {
    const start = () => {
      const p = fetchAllImpl().finally(() => { fetchInFlightRef.current = null; });
      fetchInFlightRef.current = p;
      return p;
    };
    if (!fetchInFlightRef.current) return start();
    if (!fetchQueuedRef.current) {
      fetchQueuedRef.current = fetchInFlightRef.current
        .catch(() => {})
        .then(() => { fetchQueuedRef.current = null; return start(); });
    }
    return fetchQueuedRef.current;
  }, [fetchAllImpl]);

  // Append the next page of purchase-order / transfer-order history. Safe to
  // call repeatedly; a re-entrancy guard stops overlapping fetches and rows are
  // de-duped by id so a concurrent refresh() can't double-insert.
  const loadMorePurchaseOrders = useCallback(async () => {
    if (loadingMoreRef.current || !poHasMore) return;
    loadingMoreRef.current = true;
    try {
      const from = purchaseOrders.length;
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, purchase_order_items(*)')
        .order('created_at', { ascending: false })
        .range(from, from + HISTORY_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data || []).map(mapPurchaseOrderRow);
      setPurchaseOrders((prev) => {
        const merged = appendDedupById(prev, rows);
        poLoadedRef.current = merged.length;
        return merged;
      });
      setPoHasMore(rows.length === HISTORY_PAGE_SIZE);
    } catch (e) {
      console.error('loadMorePurchaseOrders failed:', e);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [poHasMore, purchaseOrders.length]);

  const loadMoreTransferOrders = useCallback(async () => {
    if (loadingMoreRef.current || !toHasMore) return;
    loadingMoreRef.current = true;
    try {
      const from = transferOrders.length;
      const { data, error } = await supabase
        .from('transfer_orders')
        .select('*, transfer_order_items(*)')
        .order('created_at', { ascending: false })
        .range(from, from + HISTORY_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data || []).map((to) => mapTransferOrderRow(to, locations));
      setTransferOrders((prev) => {
        const merged = appendDedupById(prev, rows);
        toLoadedRef.current = merged.length;
        return merged;
      });
      setToHasMore(rows.length === HISTORY_PAGE_SIZE);
    } catch (e) {
      console.error('loadMoreTransferOrders failed:', e);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [toHasMore, transferOrders.length, locations]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        await ensureTransferAuditColsChecked();
        await fetchAll();
      } catch (e) {
        console.error('Warehouse data load failed:', e);
        if (!cancelled) setLoadError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchAll]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchAll();
      setLoadError(null);
    } catch (e) {
      console.error('Warehouse refresh failed:', e);
      setLoadError(e.message || String(e));
    } finally {
      setRefreshing(false);
    }
  }, [fetchAll]);

  // Live updates: the Warehouse desktop app and Pharmacy POS write to the same
  // tables. Subscribe to stock + catalog changes and pull a fresh snapshot
  // (debounced) so screens don't rely on manual pull-to-refresh. Falls back
  // silently to refresh-only if the realtime channel can't connect.
  useEffect(() => {
    let debounce = null;
    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        fetchAll()
          .then(() => setLoadError(null))
          .catch((e) => console.error('Realtime-triggered refresh failed:', e));
      }, 1200);
    };

    // Unique channel name per provider instance so a fast sign-out/sign-in
    // (unmount + remount) can't collide with a not-yet-torn-down channel.
    const channel = supabase
      .channel(`warehouse-stock-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_batches' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

  // ---- Concurrent-write safety for stock_batches.qty ----
  // The desktop Warehouse app and the Pharmacy POS write to the same rows.
  // PostgREST has no "qty = qty + n", so every quantity mutation here is a
  // read + compare-and-set: the UPDATE carries `.eq('qty', <value we read>)`
  // and only lands if nobody changed the row in between. A true multi-row
  // transaction is in supabase/migrations/_DRAFT_*_atomic_stock_ops.sql.

  // Best-effort append to the stock_movements ledger for MANUAL corrections made
  // from mobile (edit-form quantity change, +/- adjust). The table already
  // exists with an EDIT/ADJUST type and an insert policy for warehouse/pharmacy
  // writers; the Pharmacy POS writes EDIT rows the same way. Never fails the
  // underlying edit — a missing ledger row must not block a stock correction.
  async function logStockMovement({ itemId, locationId, batchNo, type, opening, closing, reason, createdBy }) {
    if (!itemId || opening == null || closing == null) return;
    try {
      await supabase.from('stock_movements').insert({
        item_id: itemId,
        location_id: locationId || null,
        batch_no: batchNo || null,
        type,
        qty: closing - opening,
        opening,
        closing,
        reason: reason || 'Mobile stock correction',
        ...(createdBy ? { created_by: createdBy } : {}),
      });
    } catch (e) {
      console.warn('stock_movements ledger write skipped:', e?.message || e);
    }
  }

  async function readBatchQty(id) {
    const { data, error } = await supabase
      .from('stock_batches')
      .select('qty')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? { found: true, qty: data.qty ?? 0 } : { found: false, qty: 0 };
  }

  // Absolute set, guarded on the value the caller last saw. On a lost CAS we
  // distinguish the three real causes so the message isn't misleading (M6).
  async function setBatchQtyGuarded(id, expectedQty, newQty) {
    const { data, error } = await supabase
      .from('stock_batches')
      .update({ qty: newQty })
      .eq('id', id)
      .eq('qty', expectedQty ?? 0)
      .select('id');
    if (error) throw error;
    if (data && data.length > 0) return;

    // CAS matched nothing — find out why before telling the user.
    const cur = await readBatchQty(id).catch(() => null);
    await fetchAll().catch(() => {});
    if (cur && !cur.found) {
      throw new Error('This item was removed on the server. The list has been refreshed.');
    }
    if (cur && cur.qty === (expectedQty ?? 0)) {
      throw new Error('That change was rejected (insufficient permissions for this location).');
    }
    throw new Error('This item’s stock just changed on the server. Latest values loaded — please try again.');
  }

  // Relative change (+/-), CAS with bounded retries — for the "+= received qty"
  // and "+= transferred qty" merges where the correct outcome is simply
  // last-known + delta, whoever else also wrote. Clamped at 0.
  async function bumpBatchQty(id, delta, { retries = 5 } = {}) {
    let last = await readBatchQty(id);
    if (!last.found) throw new Error('Target stock batch no longer exists.');
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const next = Math.max(0, last.qty + delta);
      const { data, error } = await supabase
        .from('stock_batches')
        .update({ qty: next })
        .eq('id', id)
        .eq('qty', last.qty)
        .select('id');
      if (error) throw error;
      if (data && data.length > 0) return next;
      last = await readBatchQty(id);
      if (!last.found) throw new Error('Target stock batch was removed mid-update.');
    }
    await fetchAll().catch(() => {});
    throw new Error('Could not apply the stock change after several attempts (the item is being updated elsewhere). Please retry.');
  }

  async function adjustStock(id, delta) {
    const current = mainStock.find((i) => i.id === id);
    if (current) {
      const expected = current.stock || 0;
      const newQty = Math.max(0, expected + delta);
      await setBatchQtyGuarded(id, expected, newQty);
      setMainStock((prev) => prev.map((i) => (i.id === id ? { ...i, stock: newQty } : i)));
      logStockMovement({ itemId: current.itemId, locationId: current.locationId, batchNo: current.batch, type: 'ADJUST', opening: expected, closing: newQty, reason: 'Mobile ± adjust' });
      return;
    }

    // Not in main stock — search sub-stock locations (e.g. Pharmacy Stock).
    // The pharmacy counter is written by the POS on every sale, so its qty on
    // this device goes stale fast. A single absolute compare-and-set would then
    // fail ("stock changed on the server") and the +/- would appear to do
    // nothing. bumpBatchQty re-reads the live qty and applies the delta with
    // bounded retries — the correct semantic for a manual ± nudge ("+1 unit,
    // whatever the current count").
    for (const locId of Object.keys(subStocks)) {
      const row = subStocks[locId].find((i) => i.id === id);
      if (!row) continue;
      const expected = row.stock || 0;
      const newQty = await bumpBatchQty(id, delta);
      setSubStocks((prev) => ({
        ...prev,
        [locId]: prev[locId].map((i) => (i.id === id ? { ...i, stock: newQty } : i)),
      }));
      logStockMovement({ itemId: row.itemId, locationId: row.locationId || locId, batchNo: row.batch, type: 'ADJUST', opening: expected, closing: newQty, reason: 'Mobile ± adjust' });
      return;
    }
  }

  async function receivePurchaseOrder(orderId) {
    const order = purchaseOrders.find((o) => o.id === orderId);
    if (!order) return;
    // Idempotency guard: never add a PO's stock twice (double-tap, stale view).
    if (order.status !== 'Pending') {
      throw new Error(`This purchase order is already "${order.status}".`);
    }
    const mainId = mainLocationId();

    // Claim the PO first with a Pending -> Received compare-and-set. Only the
    // client that wins this flip goes on to add stock, so a concurrent receive
    // (or a double-tap) can never double-count. If adding stock then fails, the
    // PO is Received with the additions incomplete — recoverable by editing the
    // affected batches; the DRAFT atomic RPC removes this window entirely.
    const receivedAt = new Date().toISOString();
    const { data: claim, error: claimErr } = await supabase
      .from('purchase_orders')
      .update({ status: 'Received', received_at: receivedAt })
      .eq('id', orderId)
      .eq('status', 'Pending')
      .select('id');
    if (claimErr) throw claimErr;
    if (!claim || claim.length === 0) {
      await fetchAll().catch(() => {});
      throw new Error('This purchase order was just received elsewhere. The list has been refreshed.');
    }

    for (const line of order.items) {
      const trimmed = (line.name || '').trim();
      if (!trimmed) continue; // skip a blank line rather than create a nameless item
      let itemId;
      const { data: existingItem, error: itemReadErr } = await supabase.from('items').select('id').ilike('name', trimmed).limit(1).maybeSingle();
      if (itemReadErr) throw itemReadErr;
      if (existingItem) {
        itemId = existingItem.id;
      } else {
        const { data: created, error } = await supabase.from('items')
          .insert({ name: trimmed, category: line.category || null, hsn_code: line.hsnCode || null, units_per_pack: line.unitsPerPack || null })
          .select('id').single();
        if (error) throw error;
        itemId = created.id;
      }

      const addQty = Math.max(0, line.qty || 0);
      const { data: existingBatch, error: batchReadErr } = await batchEq(
        supabase.from('stock_batches').select('id, qty').eq('item_id', itemId).eq('location_id', mainId),
        line.batch
      ).maybeSingle();
      if (batchReadErr) throw batchReadErr;
      if (existingBatch) {
        await bumpBatchQty(existingBatch.id, addQty);
      } else {
        const { error: insErr } = await supabase.from('stock_batches').insert({
          item_id: itemId, location_id: mainId, batch_no: line.batch || null, expiry_date: line.expiry || null,
          net_rate: line.netRate, mrp: line.mrp, gst: line.gst, stockist: order.supplier || null, qty: addQty,
        });
        if (insErr) throw insErr;
      }
    }

    setPurchaseOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: 'Received', receivedAt } : o)));
    await fetchAll();
  }

  async function cancelPurchaseOrder(orderId) {
    // Only a still-Pending PO can be cancelled — never a Received one (that would
    // orphan the stock its receipt already added).
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ status: 'Cancelled' })
      .eq('id', orderId)
      .eq('status', 'Pending')
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      await fetchAll().catch(() => {});
      throw new Error('This purchase order can no longer be cancelled (it was already received or cancelled).');
    }
    setPurchaseOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: 'Cancelled' } : o)));
  }

  async function resolveItemId({ name, category, hsnCode, unitsPerPack }) {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('An item name is required.');
    const { data: existing, error: readErr } = await supabase.from('items').select('id').ilike('name', trimmed).limit(1).maybeSingle();
    if (readErr) throw readErr;
    if (existing) return existing.id;
    const { data: created, error } = await supabase
      .from('items')
      .insert({ name: trimmed, category: category || null, hsn_code: hsnCode || null, units_per_pack: unitsPerPack || null })
      .select('id').single();
    if (error) throw error;
    return created.id;
  }

  // ---- Main stock CRUD ----
  async function addMainItem(item) {
    const itemId = await resolveItemId(item);
    const { error } = await supabase.from('stock_batches').insert({
      item_id: itemId, location_id: mainLocationId(),
      batch_no: item.batch || null, expiry_date: item.expiry || null,
      mrp: item.mrp, net_rate: item.netRate, gst: item.gst, stockist: item.stockist || null,
      qty: Math.max(0, item.stock || 0),
    });
    if (error) throw error;
    await fetchAll();
  }

  // Shared item + batch patch writer for main / pharmacy edit forms.
  // Metadata columns (name, rates, batch no, expiry) are last-write-wins — fine,
  // that matches the desktop app. The absolute quantity is applied through the
  // compare-and-set guard so an edit can't stomp a concurrent sale / adjustment.
  async function applyItemAndBatchPatch(batchId, patch, current) {
    const itemPatch = {};
    if (patch.category !== undefined) itemPatch.category = patch.category;
    if (patch.hsnCode !== undefined) itemPatch.hsn_code = patch.hsnCode;
    if (patch.unitsPerPack !== undefined) itemPatch.units_per_pack = patch.unitsPerPack;
    if (patch.name !== undefined && patch.name !== current.name) itemPatch.name = patch.name;
    if (Object.keys(itemPatch).length > 0 && current.itemId) {
      const { error } = await supabase.from('items').update(itemPatch).eq('id', current.itemId);
      if (error) throw error;
    }

    const batchPatch = {};
    if (patch.batch !== undefined) batchPatch.batch_no = patch.batch || null;
    if (patch.expiry !== undefined) batchPatch.expiry_date = patch.expiry || null;
    if (patch.netRate !== undefined) batchPatch.net_rate = patch.netRate;
    if (patch.mrp !== undefined) batchPatch.mrp = patch.mrp;
    if (patch.gst !== undefined) batchPatch.gst = patch.gst;
    if (patch.stockist !== undefined) batchPatch.stockist = patch.stockist;
    if (Object.keys(batchPatch).length > 0) {
      const { error } = await supabase.from('stock_batches').update(batchPatch).eq('id', batchId);
      if (error) throw error;
    }

    if (patch.stock !== undefined) {
      const opening = current.stock || 0;
      const nextStock = Math.max(0, patch.stock);
      if (nextStock !== opening) {
        await setBatchQtyGuarded(batchId, opening, nextStock);
        logStockMovement({
          itemId: current.itemId, locationId: current.locationId, batchNo: current.batch,
          type: 'EDIT', opening, closing: nextStock,
          reason: patch.correctionReason || 'Mobile stock correction',
        });
      }
    }
  }

  async function updateMainItem(id, patch) {
    const current = mainStock.find((i) => i.id === id);
    if (!current) return;
    await applyItemAndBatchPatch(id, patch, current);
    await fetchAll();
  }

  async function deleteMainItem(id) {
    const { error } = await supabase.from('stock_batches').delete().eq('id', id);
    if (error) throw error;
    setMainStock((prev) => prev.filter((i) => i.id !== id));
  }

  // ---- Pharmacy stock CRUD (fully isolated from Main Stock: separate
  // location_id, separate state bucket, never reads/writes mainStock) ----
  function requirePharmacyLocationId() {
    const id = pharmacyLocationId();
    if (!id) throw new Error('No Pharmacy location is configured yet');
    return id;
  }

  async function addPharmacyItem(item) {
    const locId = requirePharmacyLocationId();
    const itemId = await resolveItemId(item);
    const { error } = await supabase.from('stock_batches').insert({
      item_id: itemId, location_id: locId,
      batch_no: item.batch || null, expiry_date: item.expiry || null,
      mrp: item.mrp, net_rate: item.netRate, gst: item.gst, stockist: item.stockist || null,
      qty: Math.max(0, item.stock || 0),
    });
    if (error) throw error;
    await fetchAll();
  }

  async function updatePharmacyItem(id, patch) {
    const locId = requirePharmacyLocationId();
    const current = (subStocks[locId] || []).find((i) => i.id === id);
    if (!current) return;
    await applyItemAndBatchPatch(id, patch, current);
    await fetchAll();
  }

  async function deletePharmacyItem(id) {
    const { error } = await supabase.from('stock_batches').delete().eq('id', id);
    if (error) throw error;
    const locId = pharmacyLocationId();
    if (locId) {
      setSubStocks((prev) => ({ ...prev, [locId]: (prev[locId] || []).filter((i) => i.id !== id) }));
    }
  }

  // ---- Purchase orders ----
  async function generatePoNumber() {
    const year = new Date().getFullYear();
    const { count } = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true });
    return `PO-${year}-${String((count || 0) + 1).padStart(4, '0')}`;
  }

  async function createPurchaseOrder(order) {
    let poNumber = await generatePoNumber();
    const insertPO = (num) => supabase.from('purchase_orders').insert({
      po_number: num, supplier: order.supplier, status: 'Pending',
      po_date: order.poDate || null, expected_delivery: order.expectedDelivery || null, notes: order.notes || null,
      subtotal: order.totals?.subtotal ?? null, gst_total: order.totals?.gstTotal ?? null, total_amount: order.totals?.total ?? null,
    }).select().single();

    let { data: poRow, error } = await insertPO(poNumber);
    if (error && error.code === '23505') {
      poNumber = `${poNumber}-${Date.now().toString().slice(-4)}`;
      ({ data: poRow, error } = await insertPO(poNumber));
    }
    if (error) throw error;

    const itemRows = [];
    for (const line of order.items) {
      const itemId = await resolveItemId(line);
      itemRows.push({
        purchase_order_id: poRow.id, item_id: itemId, name: line.name, batch_no: line.batch || null,
        expiry_date: line.expiry || null, net_rate: line.netRate, mrp: line.mrp, gst: line.gst, qty: line.qty,
        units_per_pack: line.unitsPerPack, category: line.category || null, hsn_code: line.hsnCode || null,
      });
    }
    const { error: itemsErr } = await supabase.from('purchase_order_items').insert(itemRows);
    if (itemsErr) throw itemsErr;

    await fetchAll();
  }

  // ---- Transfer orders ----
  async function generateTransferNumber() {
    const year = new Date().getFullYear();
    const { count } = await supabase.from('transfer_orders').select('id', { count: 'exact', head: true });
    return `TR-${year}-${String((count || 0) + 1).padStart(4, '0')}`;
  }

  async function createTransferOrder(order) {
    const mainId = mainLocationId();
    let transferNumber = await generateTransferNumber();
    const insertTO = (num) => supabase.from('transfer_orders').insert({
      transfer_number: num, from_location_id: mainId, to_location_id: order.toLocationId,
      transfer_date: order.transferDate || null, notes: order.notes || null, status: 'Completed',
    }).select().single();

    let { data: toRow, error } = await insertTO(transferNumber);
    if (error && error.code === '23505') {
      transferNumber = `${transferNumber}-${Date.now().toString().slice(-4)}`;
      ({ data: toRow, error } = await insertTO(transferNumber));
    }
    if (error) throw error;

    for (const line of order.items) {
      const sourceRow = mainStock.find((i) => i.id === line.mainStockId);
      if (!sourceRow) continue;
      const qty = Math.max(0, line.qty || 0);
      if (qty === 0) continue;

      const { error: lineErr } = await supabase.from('transfer_order_items').insert({
        transfer_order_id: toRow.id, item_id: sourceRow.itemId, name: line.name,
        batch_no: line.batch || null, expiry_date: line.expiry || null, mrp: line.mrp, net_rate: line.netRate, qty,
      });
      if (lineErr) throw lineErr;

      // Compare-and-set the source batch so a concurrent change to Main Stock
      // isn't silently overwritten, and never let it go negative. On conflict the
      // transfer is left partially applied (header + line rows exist) — the caller
      // is told to refresh. The DRAFT atomic RPC removes this window entirely.
      const expectedSourceQty = sourceRow.stock || 0;
      if (expectedSourceQty < qty) {
        await fetchAll().catch(() => {});
        throw new Error(`"${line.name}" no longer has ${qty} in stock (only ${expectedSourceQty}). The transfer is partially applied — refresh and verify.`);
      }
      const { data: srcUpd, error: srcErr } = await supabase
        .from('stock_batches')
        .update({ qty: Math.max(0, expectedSourceQty - qty) })
        .eq('id', line.mainStockId)
        .eq('qty', expectedSourceQty)
        .select('id');
      if (srcErr) throw srcErr;
      if (!srcUpd || srcUpd.length === 0) {
        await fetchAll().catch(() => {});
        throw new Error(`"${line.name}" stock changed while transferring. The transfer is partially applied — please refresh and verify.`);
      }

      const { data: destRow, error: destReadErr } = await batchEq(
        supabase.from('stock_batches').select('id, qty').eq('item_id', sourceRow.itemId).eq('location_id', order.toLocationId),
        line.batch
      ).maybeSingle();
      if (destReadErr) throw destReadErr;
      if (destRow) {
        await bumpBatchQty(destRow.id, qty);
      } else {
        const { error: destInsErr } = await supabase.from('stock_batches').insert({
          item_id: sourceRow.itemId, location_id: order.toLocationId, batch_no: line.batch || null,
          expiry_date: line.expiry || null, mrp: line.mrp, net_rate: line.netRate, gst: sourceRow.gst,
          stockist: sourceRow.stockist, qty,
        });
        if (destInsErr) throw destInsErr;
      }
    }

    await fetchAll();
    // Truthy result so a caller (e.g. the Move Stock dialog) can show a
    // success message; a failure throws before reaching here.
    return { ok: true, transferNumber, toLocationId: order.toLocationId };
  }

  // ---- Warehouse -> Pharmacy: manual-approval stock requests ----
  // WAREHOUSE STOCK != PHARMACY INVENTORY. Moving stock to the pharmacy_counter
  // records a 'Pending' transfer_orders row and changes NO stock. The Pharmacy
  // then Accepts (Pending -> Completed: deduct Main, add Pharmacy) or Rejects
  // (Pending -> Rejected: no stock change). transfer_number is the unique
  // tracking id; transfer_orders/_items rows are the audit trail and are never
  // deleted — accept / reject only change status.

  // Add `qty` to the item's batch at `locationId` (compare-and-set bump, or a
  // fresh batch row if none exists). Used by Accept to add into Pharmacy.
  async function addQtyToBatch({ itemId, locationId, batch, qty, expiry, mrp, netRate, gst, stockist }) {
    const { data: row, error: readErr } = await batchEq(
      supabase.from('stock_batches').select('id, qty').eq('item_id', itemId).eq('location_id', locationId),
      batch,
    ).maybeSingle();
    if (readErr) throw readErr;
    if (row) {
      const before = row.qty || 0;
      await bumpBatchQty(row.id, qty);
      return { before, after: before + qty };
    }
    const { error: insErr } = await supabase.from('stock_batches').insert({
      item_id: itemId, location_id: locationId, batch_no: batch || null,
      expiry_date: expiry || null, mrp: mrp ?? null, net_rate: netRate ?? null,
      gst: gst ?? null, stockist: stockist ?? null, qty,
    });
    if (insErr) throw insErr;
    return { before: 0, after: qty };
  }

  // Create a Pending request. Changes NO stock. The Main Stock snapshot is only
  // validated up front (friendly error); the real deduction happens, against a
  // fresh live check, when the Pharmacy Accepts.
  async function createPharmacyTransferRequest(order) {
    const mainId = mainLocationId();
    const pharmId = pharmacyLocationId();
    if (!pharmId) throw new Error('No pharmacy_counter location is configured.');

    const { lines, error: planErr } = planPharmacyTransferLines(mainStock, order.items);
    if (planErr) throw new Error(planErr);

    let transferNumber = await generateTransferNumber();
    const insertReq = (num) => supabase.from('transfer_orders').insert({
      transfer_number: num, from_location_id: mainId, to_location_id: pharmId,
      transfer_date: order.transferDate || null, notes: order.notes || null, status: 'Pending',
      ...(transferAuditColsSupported && user?.id ? { created_by: user.id } : {}),
    }).select().single();

    let { data: reqRow, error } = await insertReq(transferNumber);
    if (error && error.code === '23505') {
      transferNumber = `${transferNumber}-${Date.now().toString().slice(-4)}`;
      ({ data: reqRow, error } = await insertReq(transferNumber));
    }
    if (error) throw error;

    const itemRows = lines.map((line) => ({
      transfer_order_id: reqRow.id, item_id: line.itemId, name: line.name,
      batch_no: line.batch, expiry_date: line.expiry, mrp: line.mrp, net_rate: line.netRate, qty: line.qty,
    }));
    const { error: lineErr } = await supabase.from('transfer_order_items').insert(itemRows);
    if (lineErr) {
      // No stock was touched — drop the empty header so it can't sit in the list.
      await supabase.from('transfer_orders').delete().eq('id', reqRow.id).catch(() => {});
      throw lineErr;
    }

    await fetchAll();
    return { ok: true, pending: true, transferNumber };
  }

  // Accept: live-check that Main Stock still has enough for EVERY line, then
  // claim the row (Pending -> Completed via compare-and-set), then deduct Main
  // and add Pharmacy, batch-matched. The claim is the single guard against a
  // double accept or accepting a rejected row. Nothing moves until this runs.
  async function approvePharmacyTransfer(transferId) {
    const t = transferOrders.find((x) => x.id === transferId);
    if (!t) throw new Error('Request not found — refresh and try again.');
    if (t.status !== 'Pending') throw new Error(`This request is already "${t.status}".`);

    const mainId = mainLocationId();
    const pharmId = t.toLocationId || pharmacyLocationId();
    if (!pharmId) throw new Error('No pharmacy_counter location is configured.');

    const plan = [];
    for (const line of t.items) {
      const qty = Math.max(0, line.qty || 0);
      if (qty === 0) continue;
      const { data: src, error: srcErr } = await batchEq(
        supabase.from('stock_batches').select('id, qty, gst, stockist').eq('item_id', line.mainStockId).eq('location_id', mainId),
        line.batch,
      ).maybeSingle();
      if (srcErr) throw srcErr;
      if (!src || (src.qty || 0) < qty) {
        await fetchAll().catch(() => {});
        throw new Error(`Main Stock for "${line.name}" changed — only ${src?.qty || 0} available (need ${qty}). Accept blocked; refresh and verify.`);
      }
      plan.push({ line, qty, src });
    }

    const { data: claimed, error: claimErr } = await supabase
      .from('transfer_orders')
      .update({
        status: 'Completed',
        ...(transferAuditColsSupported ? { approved_by: user?.id || null, approved_at: new Date().toISOString() } : {}),
      })
      .eq('id', transferId).eq('status', 'Pending').select('id');
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) {
      await fetchAll().catch(() => {});
      throw new Error('This request was already accepted or rejected.');
    }

    const problems = [];
    for (const { line, qty, src } of plan) {
      try {
        const { data: srcUpd, error: srcErr } = await supabase
          .from('stock_batches')
          .update({ qty: Math.max(0, (src.qty || 0) - qty) })
          .eq('id', src.id).eq('qty', src.qty).select('id');
        if (srcErr) throw srcErr;
        if (!srcUpd || srcUpd.length === 0) throw new Error('Main Stock changed during accept');
        logStockMovement({
          itemId: line.mainStockId, locationId: mainId, batchNo: line.batch, type: 'TRANSFER',
          opening: src.qty, closing: Math.max(0, (src.qty || 0) - qty),
          reason: `Pharmacy transfer ${t.transferNumber} accepted (out of Main Stock)`, createdBy: user?.id,
        });

        const { before, after } = await addQtyToBatch({
          itemId: line.mainStockId, locationId: pharmId, batch: line.batch, qty,
          expiry: line.expiry, mrp: line.mrp, netRate: line.netRate, gst: src.gst, stockist: src.stockist,
        });
        logStockMovement({
          itemId: line.mainStockId, locationId: pharmId, batchNo: line.batch, type: 'TRANSFER',
          opening: before, closing: after,
          reason: `Pharmacy transfer ${t.transferNumber} accepted (into Pharmacy)`, createdBy: user?.id,
        });
      } catch (e) {
        problems.push(`${line.name}: ${e.message || e}`);
      }
    }

    await fetchAll();
    if (problems.length) {
      throw new Error(`Request marked Completed, but some lines need checking:\n${problems.join('\n')}`);
    }
    return { ok: true, transferNumber: t.transferNumber };
  }

  // Reject: claim the row (Pending -> Rejected). No stock is touched — nothing
  // was reserved. The row is kept as an audit record (never deleted).
  async function cancelPharmacyTransfer(transferId) {
    const t = transferOrders.find((x) => x.id === transferId);
    if (t && t.status !== 'Pending') throw new Error(`This request is already "${t.status}".`);

    const { data, error } = await supabase
      .from('transfer_orders')
      .update({
        status: 'Rejected',
        ...(transferAuditColsSupported ? { cancelled_by: user?.id || null, cancelled_at: new Date().toISOString() } : {}),
      })
      .eq('id', transferId).eq('status', 'Pending').select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      await fetchAll().catch(() => {});
      throw new Error('This request can no longer be rejected (it was already accepted or rejected).');
    }

    await fetchAll();
    return { ok: true };
  }

  function getAlerts() {
    const now = new Date();
    const expiryHorizon = new Date(now.getTime() + (alertsConfig.expiryAlertDays || 90) * 24 * 60 * 60 * 1000);
    return {
      lowStock: mainStock.filter((i) => (i.stock || 0) < (alertsConfig.lowStockThreshold || 200) && (i.stock || 0) > 0),
      outOfStock: mainStock.filter((i) => (i.stock || 0) === 0),
      expiring: mainStock.filter((i) => {
        if (!i.expiry) return false;
        const d = new Date(i.expiry);
        return d <= expiryHorizon && d >= now;
      }),
      expired: mainStock.filter((i) => (i.expiry ? new Date(i.expiry) < now : false)),
    };
  }

  function getTotalValue() {
    return mainStock.reduce((sum, i) => sum + (i.stock || 0) * (i.netRate || 0), 0);
  }

  function getSubStockValue(locationId) {
    return (subStocks[locationId] || []).reduce((sum, i) => sum + (i.stock || 0) * (i.netRate || 0), 0);
  }

  // The Pharmacy's own stock location (type 'pharmacy_counter'), kept fully
  // separate from mainStock — never read/written by main-stock screens or
  // actions. If no such location exists, pharmacyStock is simply empty rather
  // than crashing or falling through to another location.
  const pharmacyLocation = useMemo(() => findPharmacyLocation(locations), [locations]);
  const pharmacyStock = useMemo(
    () => (pharmacyLocation ? (subStocks[pharmacyLocation.id] || []) : []),
    [pharmacyLocation, subStocks],
  );

  // Warehouse -> Pharmacy transfers awaiting manual approval. Derived from the
  // already-loaded transfer_orders (status 'Pending', destination = pharmacy) —
  // no extra fetch, and NOT realtime, so nothing lands in Pharmacy Inventory
  // on its own. Newest first.
  const pendingPharmacyTransfers = useMemo(() => {
    const pharmId = pharmacyLocation?.id;
    if (!pharmId) return [];
    return transferOrders
      .filter((t) => t.status === 'Pending' && t.toLocationId === pharmId)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [transferOrders, pharmacyLocation]);

  function getPharmacyAlerts() {
    const now = new Date();
    const expiryHorizon = new Date(now.getTime() + (alertsConfig.expiryAlertDays || 90) * 24 * 60 * 60 * 1000);
    return {
      lowStock: pharmacyStock.filter((i) => (i.stock || 0) < (alertsConfig.lowStockThreshold || 200) && (i.stock || 0) > 0),
      outOfStock: pharmacyStock.filter((i) => (i.stock || 0) === 0),
      expiring: pharmacyStock.filter((i) => {
        if (!i.expiry) return false;
        const d = new Date(i.expiry);
        return d <= expiryHorizon && d >= now;
      }),
      expired: pharmacyStock.filter((i) => (i.expiry ? new Date(i.expiry) < now : false)),
    };
  }

  const settings = useMemo(() => ({
    lowStockThreshold: alertsConfig.lowStockThreshold,
    expiryAlertDays: alertsConfig.expiryAlertDays,
    subStockLocations: locations
      .filter((l) => l.type === 'warehouse_sub' && !isRetiredLocation(l))
      .map((l) => ({ id: l.id, name: l.name, color: l.color })),
  }), [alertsConfig.lowStockThreshold, alertsConfig.expiryAlertDays, locations]);

  // ---- Stable public API (L1) ----
  // The handler/selector functions above are re-created every render (they close
  // over current state). Rather than useCallback-ing ~15 of them with hand-kept
  // dep lists (stale-closure risk), we keep one ref that always points at this
  // render's latest closures, and expose permanently-stable wrappers that
  // delegate through it. `value` is then memoized on real state only, so
  // consumers re-render on data changes — not on every provider render.
  const apiRef = useRef(null);
  apiRef.current = {
    adjustStock, receivePurchaseOrder, cancelPurchaseOrder,
    addMainItem, updateMainItem, deleteMainItem,
    addPharmacyItem, updatePharmacyItem, deletePharmacyItem,
    createPurchaseOrder, createTransferOrder,
    createPharmacyTransferRequest, approvePharmacyTransfer, cancelPharmacyTransfer,
    getAlerts, getTotalValue, getSubStockValue, getPharmacyAlerts,
  };

  const api = useMemo(() => {
    const delegate = (name) => (...args) => apiRef.current[name](...args);
    const guarded = (name) => withErrorAlert(delegate(name));
    return {
      adjustStock: guarded('adjustStock'),
      receivePurchaseOrder: guarded('receivePurchaseOrder'),
      cancelPurchaseOrder: guarded('cancelPurchaseOrder'),
      addMainItem: guarded('addMainItem'),
      updateMainItem: guarded('updateMainItem'),
      deleteMainItem: guarded('deleteMainItem'),
      addPharmacyItem: guarded('addPharmacyItem'),
      updatePharmacyItem: guarded('updatePharmacyItem'),
      deletePharmacyItem: guarded('deletePharmacyItem'),
      createPurchaseOrder: guarded('createPurchaseOrder'),
      createTransferOrder: guarded('createTransferOrder'),
      createPharmacyTransferRequest: guarded('createPharmacyTransferRequest'),
      approvePharmacyTransfer: guarded('approvePharmacyTransfer'),
      cancelPharmacyTransfer: guarded('cancelPharmacyTransfer'),
      getAlerts: delegate('getAlerts'),
      getTotalValue: delegate('getTotalValue'),
      getSubStockValue: delegate('getSubStockValue'),
      getPharmacyAlerts: delegate('getPharmacyAlerts'),
    };
  }, []);

  const value = useMemo(() => ({
    locations, mainStock, subStocks, purchaseOrders, transferOrders, settings,
    pharmacyLocation, pharmacyStock, pendingPharmacyTransfers,
    loading, refreshing, loadError, stockTruncated, lastLoadedAt,
    poHasMore, toHasMore,
    refresh, loadMorePurchaseOrders, loadMoreTransferOrders,
    ...api,
  }), [
    locations, mainStock, subStocks, purchaseOrders, transferOrders, settings,
    pharmacyLocation, pharmacyStock, pendingPharmacyTransfers,
    loading, refreshing, loadError, stockTruncated, lastLoadedAt,
    poHasMore, toHasMore,
    refresh, loadMorePurchaseOrders, loadMoreTransferOrders, api,
  ]);

  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>;
}

export function useWarehouse() {
  const ctx = useContext(WarehouseContext);
  if (!ctx) throw new Error('useWarehouse must be used within WarehouseProvider');
  return ctx;
}
