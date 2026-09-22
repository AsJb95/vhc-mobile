import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';
import { loadCredit, collectCredit } from '../lib/credit';
import { fetchAllPages } from '../lib/management';

// Pharmacy data layer for VHC Mobile — reads the SAME Supabase tables the
// Pharmacy POS writes (sales, sale_items, patients). No local copy, no second
// source of truth. Keeps a bounded rolling window live via Realtime for the
// dashboard + standard report periods, and queries Supabase directly for any
// custom / older date range (never cached, never shown as "current").

const ROLLING_DAYS = 62;      // covers Today .. Last Month with margin

const SALE_SELECT = '*, sale_items(item_id, drug_name, batch_no, category, quantity, rate, total, expiry_date)';

const PharmacyContext = createContext(null);

export function PharmacyProvider({ children }) {
  const { canManageCredit, canViewReports } = useAuth();
  const creditRequest = useRef(0);
  const creditAllowed = useRef(canManageCredit);
  creditAllowed.current = canManageCredit;
  const [creditLedger, setCreditLedger] = useState(null);
  const [creditError, setCreditError] = useState(null);
  const [recentSales, setRecentSales] = useState([]);
  const [salesTruncated, setSalesTruncated] = useState(false);
  const [patientsCount, setPatientsCount] = useState(null);
  const [creditOutstanding, setCreditOutstanding] = useState({ total: 0, count: 0 }); // all-time Credit-mode bills
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [asOf, setAsOf] = useState(null); // Date of the last successful rolling fetch

  const inFlightRef = useRef(null);
  const queuedRef = useRef(null);

  const fetchRollingImpl = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - ROLLING_DAYS);
    since.setHours(0, 0, 0, 0);

    if (!canViewReports) { setRecentSales([]); return []; }
    const [salesRes, patientsRes] = await Promise.all([
      fetchAllPages(() => supabase.from('sales').select(SALE_SELECT).gte('sale_date', since.toISOString()).order('sale_date', { ascending: false }).order('id')).then((data) => ({ data })),
      supabase.from('patients').select('id', { count: 'exact', head: true }),
    ]);
    if (salesRes.error) throw salesRes.error;

    const rows = salesRes.data || [];
    setRecentSales(rows);
    setSalesTruncated(false);
    if (!patientsRes.error) setPatientsCount(patientsRes.count ?? null);

    setAsOf(new Date());
    return rows;
  }, [canViewReports]);

  // one in-flight + one queued follow-up (same pattern as WarehouseContext)
  const refreshRolling = useCallback(() => {
    const start = () => {
      const p = fetchRollingImpl().finally(() => { inFlightRef.current = null; });
      inFlightRef.current = p;
      return p;
    };
    if (!inFlightRef.current) return start();
    if (!queuedRef.current) {
      queuedRef.current = inFlightRef.current.catch(() => {}).then(() => { queuedRef.current = null; return start(); });
    }
    return queuedRef.current;
  }, [fetchRollingImpl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        await refreshRolling();
      } catch (e) {
        console.error('Pharmacy data load failed:', e);
        if (!cancelled) setLoadError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshRolling]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshRolling();
      setLoadError(null);
    } catch (e) {
      console.error('Pharmacy refresh failed:', e);
      setLoadError(e.message || String(e));
    } finally {
      setRefreshing(false);
    }
  }, [refreshRolling]);

  // Realtime: the POS bills continuously — keep the rolling window live.
  useEffect(() => {
    let debounce = null;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        refreshRolling().then(() => setLoadError(null)).catch((e) => setLoadError(e.message || 'Live refresh failed'));
      }, 1500);
    };
    const channel = supabase
      .channel(`pharmacy-sales-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_items' }, schedule)
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [refreshRolling]);

  // On-demand: arbitrary date range (custom day / range / older months).
  // Returns fresh rows every call; never merged into the cache, never treated
  // as the live snapshot.
  const fetchSalesRange = useCallback(async (fromDate, toDate) => {
    try {
      const rows = await fetchAllPages(() => supabase.from('sales').select(SALE_SELECT)
        .gte('sale_date', new Date(fromDate).toISOString()).lte('sale_date', new Date(toDate).toISOString())
        .order('sale_date', { ascending: false }).order('id'));
      return { sales: rows, error: null };
    } catch (e) { return { sales: null, error: e.message || String(e) }; }
  }, []);

  const searchPatients = useCallback(async (query) => {
    const q = (query || '').trim();
    if (q.length < 2) return { patients: [], error: null };
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const { data, error } = await supabase
      .from('patients')
      .select('id, name, contact, age, sex, address, source, created_at, is_manual')
      .is('merged_into_patient_id', null)
      .or(`name.ilike.${like},contact.ilike.${like}`)
      .order('name')
      .limit(40);
    if (error) return { patients: [], error: error.message || String(error) };
    return { patients: data || [], error: null };
  }, []);

  const refreshCredit = useCallback(async () => {
    const request = ++creditRequest.current;
    if (!canManageCredit) { setCreditLedger(null); setCreditOutstanding({ total: 0, count: 0 }); return null; }
    try {
      const ledger = await loadCredit(supabase);
      if (request !== creditRequest.current || !creditAllowed.current) return null;
      setCreditLedger(ledger);
      setCreditOutstanding({ total: ledger.total, count: ledger.count });
      setCreditError(null);
      return ledger;
    } catch (e) {
      if (request !== creditRequest.current || !creditAllowed.current) return null;
      setCreditLedger(null);
      setCreditError(e.message || 'Credit ledger unavailable');
      return null;
    }
  }, [canManageCredit]);

  useEffect(() => {
    refreshCredit();
    if (!canManageCredit) return;
    const channel = supabase.channel('management-credit')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credit_payments' }, refreshCredit)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, refreshCredit).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [canManageCredit, refreshCredit]);

  const collectPayment = useCallback(async (payment) => {
    if (!canManageCredit) throw new Error('Credit collection requires an admin.');
    const result = await collectCredit(supabase, payment);
    await refreshCredit();
    return result;
  }, [canManageCredit, refreshCredit]);

  const fetchPatientHistory = useCallback(async (patientId) => {
    if (!patientId) return { sales: [], error: null };
    const { data, error } = await supabase
      .from('sales')
      .select(SALE_SELECT)
      .eq('patient_id', patientId)
      .order('sale_date', { ascending: false })
      .limit(500);
    if (error) return { sales: [], error: error.message || String(error) };
    return { sales: data || [], error: null };
  }, []);

  const value = useMemo(() => ({
    creditLedger, creditError, collectPayment,
    recentSales, salesTruncated, patientsCount, creditOutstanding,
    loading, refreshing, loadError, asOf,
    refresh, fetchSalesRange, searchPatients, fetchPatientHistory, refreshCredit,
    rollingDays: ROLLING_DAYS,
  }), [creditLedger, creditError, collectPayment, recentSales, salesTruncated, patientsCount, creditOutstanding, loading, refreshing, loadError, asOf, refresh, fetchSalesRange, searchPatients, fetchPatientHistory, refreshCredit]);

  return <PharmacyContext.Provider value={value}>{children}</PharmacyContext.Provider>;
}

export function usePharmacy() {
  const ctx = useContext(PharmacyContext);
  if (!ctx) throw new Error('usePharmacy must be used within PharmacyProvider');
  return ctx;
}
