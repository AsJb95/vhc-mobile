import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../lib/supabaseClient';
import { findPharmacyLocation } from '../lib/locations';

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
    toLocationId: to.to_location_id,
    toLocationName: (locs || []).find((l) => l.id === to.to_location_id)?.name || '',
    transferDate: to.transfer_date,
    notes: to.notes,
    status: to.status,
    createdAt: to.created_at,
    items: (to.transfer_order_items || []).map((i) => ({
      mainStockId: i.item_id, name: i.name, batch: i.batch_no, expiry: i.expiry_date, mrp: i.mrp, netRate: i.net_rate, qty: i.qty,
    })),
  };
}

function appendDedupById(prev, next) {
  const seen = new Set(prev.map((r) => r.id));
  return [...prev, ...next.filter((r) => !seen.has(r.id))];
}

// Pharmacy stock location resolution lives in ../lib/locations (pure, tested).
// If no pharmacy_counter row exists, pharmacy add/update simply have nothing to
// write to (and say so) rather than touching any other location.

const WarehouseContext = createContext(null);

export function WarehouseProvider({ children }) {
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
  const loadingMoreRef = useRef(false);

  function mainLocationId(locs) {
    return (locs || locations).find((l) => l.type === 'warehouse_main')?.id;
  }

  function pharmacyLocationId(locs) {
    return findPharmacyLocation(locs || locations)?.id;
  }

  const fetchAll = useCallback(async () => {
    const { data: locs, error: locErr } = await supabase.from('locations').select('*').order('created_at');
    if (locErr) throw locErr;
    setLocations(locs || []);

    const main = (locs || []).find((l) => l.type === 'warehouse_main');
    const subs = (locs || []).filter((l) => l.type === 'warehouse_sub');

    // Non-main stock locations we pull batches for: every warehouse_sub plus the
    // pharmacy_counter location (so Pharmacy Stock is populated). Deduped in case
    // the pharmacy is ever modelled as a sub-location too.
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
      supabase.from('purchase_orders').select('*, purchase_order_items(*)').order('created_at', { ascending: false }).range(0, HISTORY_PAGE_SIZE - 1),
      supabase.from('transfer_orders').select('*, transfer_order_items(*)').order('created_at', { ascending: false }).range(0, HISTORY_PAGE_SIZE - 1),
      main
        ? supabase.from('alerts_config').select('*').eq('location_id', main.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (mainRes.error) throw mainRes.error;
    if (subRes.error) throw subRes.error;
    if (poRes.error) throw poRes.error;
    if (toRes.error) throw toRes.error;

    setMainStock((mainRes.data || []).map(rowToMainItem));

    const grouped = {};
    for (const s of stockSubLocs) grouped[s.id] = [];
    for (const row of subRes.data || []) {
      grouped[row.location_id] = grouped[row.location_id] || [];
      grouped[row.location_id].push({
        id: row.id,
        itemId: row.item_id,
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
    setPoHasMore(poRows.length === HISTORY_PAGE_SIZE);
    setToHasMore(toRows.length === HISTORY_PAGE_SIZE);

    if (alertsRes.data) {
      setAlertsConfig({ lowStockThreshold: alertsRes.data.low_stock_threshold, expiryAlertDays: alertsRes.data.expiry_alert_days });
    }

    return locs || [];
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      setPurchaseOrders((prev) => appendDedupById(prev, rows));
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
      setTransferOrders((prev) => appendDedupById(prev, rows));
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

    const channel = supabase
      .channel('warehouse-stock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_batches' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [fetchAll]);

  // Compare-and-set a single batch's qty: the UPDATE only lands if the row's
  // qty on the server still equals what we last read (expectedQty). If it
  // doesn't, another client (desktop Warehouse / Pharmacy POS) changed it
  // first — we refetch and raise a clear conflict error instead of blindly
  // overwriting their change. A true DB transaction is drafted separately in
  // supabase/migrations/_DRAFT_*_atomic_stock_ops.sql.
  async function setBatchQtyGuarded(id, expectedQty, newQty) {
    const { data, error } = await supabase
      .from('stock_batches')
      .update({ qty: newQty })
      .eq('id', id)
      .eq('qty', expectedQty ?? 0)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      await fetchAll().catch(() => {});
      throw new Error('This item’s stock just changed on the server. Latest values loaded — please try again.');
    }
  }

  async function adjustStock(id, delta) {
    const current = mainStock.find((i) => i.id === id);
    if (current) {
      const expected = current.stock || 0;
      const newQty = Math.max(0, expected + delta);
      await setBatchQtyGuarded(id, expected, newQty);
      setMainStock((prev) => prev.map((i) => (i.id === id ? { ...i, stock: newQty } : i)));
      return;
    }

    // Not in main stock — search sub-stock locations (e.g. Pharmacy Stock).
    for (const locId of Object.keys(subStocks)) {
      const row = subStocks[locId].find((i) => i.id === id);
      if (!row) continue;
      const expected = row.stock || 0;
      const newQty = Math.max(0, expected + delta);
      await setBatchQtyGuarded(id, expected, newQty);
      setSubStocks((prev) => ({
        ...prev,
        [locId]: prev[locId].map((i) => (i.id === id ? { ...i, stock: newQty } : i)),
      }));
      return;
    }
  }

  async function receivePurchaseOrder(orderId) {
    const order = purchaseOrders.find((o) => o.id === orderId);
    if (!order) return;
    const mainId = mainLocationId();

    for (const line of order.items) {
      const trimmed = (line.name || '').trim();
      let itemId;
      const { data: existingItem } = await supabase.from('items').select('id').ilike('name', trimmed).limit(1).maybeSingle();
      if (existingItem) {
        itemId = existingItem.id;
      } else {
        const { data: created, error } = await supabase.from('items')
          .insert({ name: trimmed, category: line.category || null, hsn_code: line.hsnCode || null, units_per_pack: line.unitsPerPack || null })
          .select('id').single();
        if (error) throw error;
        itemId = created.id;
      }

      const { data: existingBatch } = await batchEq(
        supabase.from('stock_batches').select('id, qty').eq('item_id', itemId).eq('location_id', mainId),
        line.batch
      ).maybeSingle();
      if (existingBatch) {
        await supabase.from('stock_batches').update({ qty: (existingBatch.qty || 0) + (line.qty || 0) }).eq('id', existingBatch.id);
      } else {
        await supabase.from('stock_batches').insert({
          item_id: itemId, location_id: mainId, batch_no: line.batch || null, expiry_date: line.expiry || null,
          net_rate: line.netRate, mrp: line.mrp, gst: line.gst, stockist: order.supplier || null, qty: line.qty || 0,
        });
      }
    }

    const receivedAt = new Date().toISOString();
    await supabase.from('purchase_orders').update({ status: 'Received', received_at: receivedAt }).eq('id', orderId);
    setPurchaseOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: 'Received', receivedAt } : o)));
    await fetchAll();
  }

  async function cancelPurchaseOrder(orderId) {
    const { error } = await supabase.from('purchase_orders').update({ status: 'Cancelled' }).eq('id', orderId);
    if (error) throw error;
    setPurchaseOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: 'Cancelled' } : o)));
  }

  async function resolveItemId({ name, category, hsnCode, unitsPerPack }) {
    const trimmed = (name || '').trim();
    const { data: existing } = await supabase.from('items').select('id').ilike('name', trimmed).limit(1).maybeSingle();
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
      mrp: item.mrp, net_rate: item.netRate, gst: item.gst, stockist: item.stockist || null, qty: item.stock || 0,
    });
    if (error) throw error;
    await fetchAll();
  }

  async function updateMainItem(id, patch) {
    const current = mainStock.find((i) => i.id === id);
    if (!current) return;

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
    if (patch.stock !== undefined) batchPatch.qty = patch.stock;
    if (patch.stockist !== undefined) batchPatch.stockist = patch.stockist;
    if (Object.keys(batchPatch).length > 0) {
      const { error } = await supabase.from('stock_batches').update(batchPatch).eq('id', id);
      if (error) throw error;
    }

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
      mrp: item.mrp, net_rate: item.netRate, gst: item.gst, stockist: item.stockist || null, qty: item.stock || 0,
    });
    if (error) throw error;
    await fetchAll();
  }

  async function updatePharmacyItem(id, patch) {
    const locId = requirePharmacyLocationId();
    const current = (subStocks[locId] || []).find((i) => i.id === id);
    if (!current) return;

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
    if (patch.stock !== undefined) batchPatch.qty = patch.stock;
    if (patch.stockist !== undefined) batchPatch.stockist = patch.stockist;
    if (Object.keys(batchPatch).length > 0) {
      const { error } = await supabase.from('stock_batches').update(batchPatch).eq('id', id);
      if (error) throw error;
    }

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

      await supabase.from('transfer_order_items').insert({
        transfer_order_id: toRow.id, item_id: sourceRow.itemId, name: line.name,
        batch_no: line.batch || null, expiry_date: line.expiry || null, mrp: line.mrp, net_rate: line.netRate, qty: line.qty,
      });

      // Compare-and-set the source batch so a concurrent change to Main Stock
      // isn't silently overwritten. On conflict the transfer is left partially
      // applied (header + line rows exist) — the caller is told to refresh.
      // The DRAFT atomic RPC removes this partial-write window entirely.
      const expectedSourceQty = sourceRow.stock || 0;
      const newSourceQty = expectedSourceQty - (line.qty || 0);
      const { data: srcUpd, error: srcErr } = await supabase
        .from('stock_batches')
        .update({ qty: newSourceQty })
        .eq('id', line.mainStockId)
        .eq('qty', expectedSourceQty)
        .select('id');
      if (srcErr) throw srcErr;
      if (!srcUpd || srcUpd.length === 0) {
        await fetchAll().catch(() => {});
        throw new Error(`"${line.name}" stock changed while transferring. The transfer may be partially applied — please refresh and verify.`);
      }

      const { data: destRow } = await batchEq(
        supabase.from('stock_batches').select('id, qty').eq('item_id', sourceRow.itemId).eq('location_id', order.toLocationId),
        line.batch
      ).maybeSingle();
      if (destRow) {
        await supabase.from('stock_batches').update({ qty: (destRow.qty || 0) + (line.qty || 0) }).eq('id', destRow.id);
      } else {
        await supabase.from('stock_batches').insert({
          item_id: sourceRow.itemId, location_id: order.toLocationId, batch_no: line.batch || null,
          expiry_date: line.expiry || null, mrp: line.mrp, net_rate: line.netRate, gst: sourceRow.gst,
          stockist: sourceRow.stockist, qty: line.qty || 0,
        });
      }
    }

    await fetchAll();
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
  const pharmacyLocation = findPharmacyLocation(locations);
  const pharmacyStock = pharmacyLocation ? (subStocks[pharmacyLocation.id] || []) : [];

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
    subStockLocations: locations.filter((l) => l.type === 'warehouse_sub').map((l) => ({ id: l.id, name: l.name, color: l.color })),
  }), [alertsConfig.lowStockThreshold, alertsConfig.expiryAlertDays, locations]);

  const value = {
    locations, mainStock, subStocks, purchaseOrders, transferOrders, settings,
    pharmacyLocation, pharmacyStock, getPharmacyAlerts,
    loading, refreshing, loadError, refresh,
    poHasMore, toHasMore, loadMorePurchaseOrders, loadMoreTransferOrders,
    adjustStock: withErrorAlert(adjustStock),
    receivePurchaseOrder: withErrorAlert(receivePurchaseOrder),
    cancelPurchaseOrder: withErrorAlert(cancelPurchaseOrder),
    addMainItem: withErrorAlert(addMainItem),
    updateMainItem: withErrorAlert(updateMainItem),
    deleteMainItem: withErrorAlert(deleteMainItem),
    addPharmacyItem: withErrorAlert(addPharmacyItem),
    updatePharmacyItem: withErrorAlert(updatePharmacyItem),
    deletePharmacyItem: withErrorAlert(deletePharmacyItem),
    createPurchaseOrder: withErrorAlert(createPurchaseOrder),
    createTransferOrder: withErrorAlert(createTransferOrder),
    getAlerts, getTotalValue, getSubStockValue,
  };

  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>;
}

export function useWarehouse() {
  const ctx = useContext(WarehouseContext);
  if (!ctx) throw new Error('useWarehouse must be used within WarehouseProvider');
  return ctx;
}
