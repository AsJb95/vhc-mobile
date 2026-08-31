import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useWarehouse } from '../context/WarehouseContext';
import { usePharmacy } from '../context/PharmacyContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Screen, ScreenLoading } from '../components/UI';
import { FormField } from '../components/FormField';
import { KeyVal, SectionTitle, ChipTabs, AsOf } from '../components/Bits';
import { formatCurrency, formatDate } from '../lib/format';
import {
  REPORT_PERIODS, periodRange, filterSalesByRange, summarizeSales, buildCostLookup, compareSummaries, PAYMENT_BUCKETS,
} from '../lib/pharmacyReports';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default function SalesReportsScreen() {
  const { pharmacyStock } = useWarehouse();
  const { recentSales, asOf, loading, refreshing, refresh, fetchSalesRange, loadError } = usePharmacy();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [period, setPeriod] = useState('today');
  const [customDay, setCustomDay] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [rangeResult, setRangeResult] = useState(null); // { sales } | { error } for custom / older
  const [rangeLoading, setRangeLoading] = useState(false);

  // Reset to Today every time this screen gains focus — not just on first mount. This
  // screen lives inside a Tab Navigator's stack, which (by design, to preserve scroll
  // position etc.) keeps screens mounted when you switch tabs rather than destroying them,
  // so useState('today') above only ever applies once, the very first time the screen is
  // ever opened. Without this, whatever period was selected on a previous visit silently
  // became the new "default" the moment the user switched tabs and came back — the exact
  // behavior this fix removes. Custom date/range fields are cleared too, so a stale custom
  // selection can't reappear as soon as the picker is reopened.
  useFocusEffect(
    useCallback(() => {
      setPeriod('today');
      setCustomDay('');
      setCustomFrom('');
      setCustomTo('');
      setRangeResult(null);
    }, []),
  );

  const costLookup = useMemo(() => buildCostLookup(pharmacyStock), [pharmacyStock]);

  // The oldest bill we currently hold live — used to decide whether a period
  // is fully covered by the rolling cache or needs a direct query.
  const oldestCached = useMemo(() => {
    let min = Infinity;
    for (const s of recentSales) {
      const t = new Date(s.sale_date).getTime();
      if (t < min) min = t;
    }
    return Number.isFinite(min) ? min : null;
  }, [recentSales]);

  const range = useMemo(() => {
    if (period === 'customday') return ISO.test(customDay) ? periodRange('customday', { day: customDay }) : null;
    if (period === 'customrange') return (ISO.test(customFrom) && ISO.test(customTo)) ? periodRange('customrange', { from: customFrom, to: customTo }) : null;
    return periodRange(period);
  }, [period, customDay, customFrom, customTo]);

  const needsDirectQuery = useMemo(() => {
    if (!range) return false;
    if (period === 'customday' || period === 'customrange') return true;
    return oldestCached != null && range.from.getTime() < oldestCached;
  }, [range, period, oldestCached]);

  // Fetch custom / older ranges on demand — never merged into the live cache.
  useEffect(() => {
    let cancelled = false;
    if (!range || !needsDirectQuery) { setRangeResult(null); return; }
    setRangeLoading(true);
    fetchSalesRange(range.from, range.to).then((res) => {
      if (!cancelled) { setRangeResult(res); setRangeLoading(false); }
    });
    return () => { cancelled = true; };
  }, [range, needsDirectQuery, fetchSalesRange]);

  const salesForPeriod = useMemo(() => {
    if (!range) return null;
    if (needsDirectQuery) return rangeResult?.sales ?? null;
    return filterSalesByRange(recentSales, range.from, range.to);
  }, [range, needsDirectQuery, rangeResult, recentSales]);

  const summary = useMemo(
    () => (salesForPeriod ? summarizeSales(salesForPeriod, costLookup) : null),
    [salesForPeriod, costLookup],
  );

  // Month-over-month: only when both months are backed by real data.
  const monthly = useMemo(() => {
    if (period !== 'thismonth' && period !== 'lastmonth') return null;
    const cur = periodRange('thismonth');
    const prev = periodRange('lastmonth');
    const haveLastMonth = oldestCached != null && oldestCached <= prev.from.getTime();
    if (!haveLastMonth) return { insufficient: true };
    const curSum = summarizeSales(filterSalesByRange(recentSales, cur.from, cur.to), costLookup);
    const prevSum = summarizeSales(filterSalesByRange(recentSales, prev.from, prev.to), costLookup);
    if (prevSum.billCount === 0 && curSum.billCount === 0) return { insufficient: true };
    return { cmp: compareSummaries(curSum, prevSum), curSum, prevSum };
  }, [period, recentSales, costLookup, oldestCached]);

  if (loading) return <ScreenLoading />;

  const busy = rangeLoading && needsDirectQuery;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
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

            <Card style={styles.card}>
              <SectionTitle>Estimated Gross Profit</SectionTitle>
              {summary.costTotal > 0 ? (
                <>
                  <KeyVal
                    label="Est. gross profit"
                    value={formatCurrency(summary.estimatedProfit)}
                    strong
                    color={summary.estimatedProfit >= 0 ? theme.success : theme.danger}
                  />
                  <KeyVal label="Pre-tax revenue (subtotal)" value={formatCurrency(summary.totalSubtotal)} />
                  <KeyVal label="Cost of goods sold" value={formatCurrency(summary.costTotal)} />
                  {summary.costUnknownUnits > 0 ? (
                    <Text style={styles.hint}>
                      Purchase cost is missing for {summary.costUnknownUnits} sold unit(s) — profit may be understated.
                    </Text>
                  ) : (
                    <Text style={styles.hint}>Based on current batch net-rate cost for every sold unit.</Text>
                  )}
                </>
              ) : (
                <Text style={styles.muted}>
                  No reliable cost-price data for this period&apos;s sold items — profit not shown (never estimated).
                </Text>
              )}
            </Card>

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
                {monthly.cmp.profit.reliable ? (
                  <CmpRow label="Est. profit" c={monthly.cmp.profit} fmt={formatCurrency} />
                ) : (
                  <Text style={styles.hint}>Profit comparison hidden — cost data incomplete in one of the months.</Text>
                )}
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
  hint: { color: t.muted, fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  card: { marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  half: { flex: 1 },
  periodLabel: { color: t.text, fontSize: 13, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  cmpRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.panelBorder },
  cmpLabel: { color: t.text, fontSize: 14, fontWeight: '600' },
  cmpNow: { color: t.text, fontSize: 15, fontWeight: '800' },
  cmpDelta: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  cmpPrev: { color: t.muted, fontSize: 11, marginTop: 2 },
});
