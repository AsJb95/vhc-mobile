import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usePharmacy } from '../context/PharmacyContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { Card, Screen, ScreenLoading } from '../components/UI';
import { FormField } from '../components/FormField';
import { KeyVal, SectionTitle, ChipTabs, AsOf } from '../components/Bits';
import { formatCurrency, formatDate } from '../lib/format';
import { validBusinessDate } from '../lib/management';
import {
  REPORT_PERIODS, periodRange, filterSalesByRange, summarizeSales, compareSummaries, PAYMENT_BUCKETS, paymentBucket,
} from '../lib/pharmacyReports';


const BILL_TYPES = ['All', ...PAYMENT_BUCKETS]; // All / Cash / UPI / Card / Credit

// Applies the patient-name and bill-type filters to a set of sales — both are
// plain in-memory predicates over data already fetched for the period, so no
// extra query runs.
function applyReportFilters(sales, patientTerm, billType) {
  let out = sales || [];
  const p = (patientTerm || '').trim().toLowerCase();
  if (p) {
    out = out.filter((s) => (s.patient_name || s.patientName || '').toLowerCase().includes(p)
      || (s.bill_id || s.billId || '').toLowerCase().includes(p));
  }
  if (billType && billType !== 'All') {
    out = out.filter((s) => paymentBucket(s.payment_mode ?? s.paymentMode) === billType);
  }
  return out;
}

export default function SalesReportsScreen({ route }) {
  const { recentSales, asOf, loading, refreshing, refresh, fetchSalesRange, loadError } = usePharmacy();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [period, setPeriod] = useState('today');
  const [customDay, setCustomDay] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [rangeResult, setRangeResult] = useState(null); // { sales } | { error } for custom / older
  const [rangeLoading, setRangeLoading] = useState(false);
  const [patientQuery, setPatientQuery] = useState('');
  const debouncedPatient = useDebouncedValue(patientQuery, 250);
  const [billType, setBillType] = useState('All');

  // Reset to Today (and clear the report filters) every time this screen gains
  // focus — see the long note in the previous version: Tab Navigator keeps the
  // screen mounted, so useState defaults only apply on first ever open.
  useFocusEffect(
    useCallback(() => {
      setPeriod(route?.params?.period || 'today');
      setCustomDay(route?.params?.day || '');
      setCustomFrom('');
      setCustomTo('');
      setRangeResult(null);
      setPatientQuery('');
      setBillType('All');
    }, [route?.params?.period, route?.params?.day]),
  );

  const oldestCached = useMemo(() => {
    let min = Infinity;
    for (const s of recentSales) {
      const t = new Date(s.sale_date).getTime();
      if (t < min) min = t;
    }
    return Number.isFinite(min) ? min : null;
  }, [recentSales]);

  const range = useMemo(() => {
    if (period === 'customday') return validBusinessDate(customDay) ? periodRange('customday', { day: customDay }) : null;
    if (period === 'customrange') return (validBusinessDate(customFrom) && validBusinessDate(customTo) && customFrom <= customTo) ? periodRange('customrange', { from: customFrom, to: customTo }) : null;
    return periodRange(period);
  }, [period, customDay, customFrom, customTo]);

  const needsDirectQuery = useMemo(() => {
    if (!range) return false;
    if (period === 'customday' || period === 'customrange') return true;
    return oldestCached != null && range.from.getTime() < oldestCached;
  }, [range, period, oldestCached]);

  useEffect(() => {
    let cancelled = false;
    if (!range || !needsDirectQuery) { setRangeResult(null); return; }
    setRangeLoading(true);
    fetchSalesRange(range.from, range.to).then((res) => {
      if (!cancelled) { setRangeResult(res); setRangeLoading(false); }
    });
    return () => { cancelled = true; };
  }, [range, needsDirectQuery, fetchSalesRange, asOf]);

  const salesForPeriod = useMemo(() => {
    if (!range) return null;
    if (needsDirectQuery) return rangeResult?.sales ?? null;
    return filterSalesByRange(recentSales, range.from, range.to);
  }, [range, needsDirectQuery, rangeResult, recentSales]);

  // Period sales narrowed by the on-screen patient / bill-type filters.
  const filteredSales = useMemo(
    () => (salesForPeriod ? applyReportFilters(salesForPeriod, debouncedPatient, billType) : null),
    [salesForPeriod, debouncedPatient, billType],
  );
  const filtersActive = debouncedPatient.trim() !== '' || billType !== 'All';

  const summary = useMemo(
    () => (filteredSales ? summarizeSales(filteredSales, null) : null),
    [filteredSales],
  );

  // Month-over-month: sales vs bills only (no profit). Honours the same filters.
  const monthly = useMemo(() => {
    if (period !== 'thismonth' && period !== 'lastmonth') return null;
    const cur = periodRange('thismonth');
    const prev = periodRange('lastmonth');
    const haveLastMonth = oldestCached != null && oldestCached <= prev.from.getTime();
    if (!haveLastMonth) return { insufficient: true };
    const curSum = summarizeSales(applyReportFilters(filterSalesByRange(recentSales, cur.from, cur.to), debouncedPatient, billType), null);
    const prevSum = summarizeSales(applyReportFilters(filterSalesByRange(recentSales, prev.from, prev.to), debouncedPatient, billType), null);
    if (prevSum.billCount === 0 && curSum.billCount === 0) return { insufficient: true };
    return { cmp: compareSummaries(curSum, prevSum) };
  }, [period, recentSales, oldestCached, debouncedPatient, billType]);

  if (loading) return <ScreenLoading />;

  const busy = rangeLoading && needsDirectQuery;

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
      >
        <AsOf at={asOf} />
        {loadError ? <Text style={styles.error}>Live data unavailable — {loadError}</Text> : null}

        <ChipTabs options={REPORT_PERIODS} value={period} onChange={setPeriod} />

        {period === 'customday' && (
          <View style={{ marginTop: 12 }}>
            <FormField label="Date (YYYY-MM-DD)" placeholder="2026-08-31" value={customDay} onChangeText={setCustomDay} />
          </View>
        )}
        {period === 'customrange' && (
          <View style={styles.row}>
            <FormField containerStyle={styles.half} label="From (YYYY-MM-DD)" placeholder="2026-08-01" value={customFrom} onChangeText={setCustomFrom} />
            <FormField containerStyle={styles.half} label="To (YYYY-MM-DD)" placeholder="2026-08-31" value={customTo} onChangeText={setCustomTo} />
          </View>
        )}

        <TextInput
          style={styles.search}
          placeholder="Filter by patient name or bill #…"
          placeholderTextColor={theme.muted}
          value={patientQuery}
          onChangeText={setPatientQuery}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        <Text style={styles.filterLabel}>Bill type</Text>
        <ChipTabs options={BILL_TYPES} value={billType} onChange={setBillType} />

        {!range ? (
          <Card style={styles.card}><Text style={styles.muted}>Enter a valid date to run the report.</Text></Card>
        ) : busy ? (
          <View style={{ paddingVertical: 40 }}><ActivityIndicator color={theme.accent} /></View>
        ) : rangeResult?.error ? (
          <Card style={styles.card}><Text style={styles.error}>Could not load this range — {rangeResult.error}</Text></Card>
        ) : summary == null ? (
          <View style={{ paddingVertical: 40 }}><ActivityIndicator color={theme.accent} /></View>
        ) : (
          <>
            <Text style={styles.periodLabel}>
              {range.label} · {formatDate(range.from)}{range.from.toDateString() !== range.to.toDateString() ? ` – ${formatDate(range.to)}` : ''}
              {filtersActive ? ' · filtered' : ''}
            </Text>

            <Card style={styles.card}>
              <KeyVal label="Total Sales" value={formatCurrency(summary.totalSales)} strong />
              <KeyVal label="Bill Count" value={summary.billCount} />
              <KeyVal label="Average Bill" value={formatCurrency(summary.avgBill)} />
              <KeyVal label="Units Sold" value={summary.totalUnits} />
            </Card>

            <Card style={styles.card}>
              <SectionTitle>Payment Breakdown</SectionTitle>
              {PAYMENT_BUCKETS.map((b) => (
                <KeyVal key={b} label={b} value={formatCurrency(summary.payments[b] || 0)} />
              ))}
              {summary.payments.Other > 0 ? <KeyVal label="Other" value={formatCurrency(summary.payments.Other)} /> : null}
            </Card>

            {summary.billCount === 0 && filtersActive ? (
              <Card style={styles.card}><Text style={styles.muted}>No bills match the current filters for this period.</Text></Card>
            ) : null}

            {monthly?.insufficient && (
              <Card style={styles.card}>
                <SectionTitle>Month-over-Month</SectionTitle>
                <Text style={styles.muted}>Not enough sales history yet — comparison needs a full previous month of data.</Text>
              </Card>
            )}
            {monthly?.cmp && (
              <Card style={styles.card}>
                <SectionTitle>This Month vs Last Month</SectionTitle>
                <CmpRow label="Sales" c={monthly.cmp.sales} fmt={formatCurrency} />
                <CmpRow label="Bills" c={monthly.cmp.bills} fmt={(n) => String(n)} />
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function CmpRow({ label, c, fmt }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const up = c.delta > 0;
  const flat = c.delta === 0;
  const color = flat ? theme.muted : up ? theme.success : theme.danger;
  const arrow = flat ? '→' : up ? '▲' : '▼';
  const pct = c.pct == null ? '' : ` (${up ? '+' : ''}${c.pct.toFixed(1)}%)`;
  return (
    <View style={styles.cmpRow}>
      <Text style={styles.cmpLabel}>{label}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.cmpNow}>{fmt(c.current)}</Text>
        <Text style={[styles.cmpDelta, { color }]}>{arrow} {fmt(Math.abs(c.delta))}{pct}</Text>
        <Text style={styles.cmpPrev}>was {fmt(c.previous)}</Text>
      </View>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  error: { color: t.danger, fontSize: 12, marginBottom: 10 },
  muted: { color: t.muted, fontSize: 13 },
  card: { marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  half: { flex: 1 },
  search: {
    backgroundColor: t.panel, borderWidth: 1, borderColor: t.panelBorder, borderRadius: 12,
    color: t.text, paddingHorizontal: 14, paddingVertical: 10, marginTop: 12, marginBottom: 10,
  },
  filterLabel: { color: t.muted, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  periodLabel: { color: t.text, fontSize: 13, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  cmpRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.panelBorder },
  cmpLabel: { color: t.text, fontSize: 14, fontWeight: '600' },
  cmpNow: { color: t.text, fontSize: 15, fontWeight: '800' },
  cmpDelta: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  cmpPrev: { color: t.muted, fontSize: 11, marginTop: 2 },
});
