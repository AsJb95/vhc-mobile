import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, View, Text, TextInput, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useWarehouse } from '../context/WarehouseContext';
import { usePharmacy } from '../context/PharmacyContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Screen, ScreenLoading, AnimatedPressable } from '../components/UI';
import { KeyVal, SectionTitle, AsOf, ChipTabs } from '../components/Bits';
import { formatCurrency } from '../lib/format';
import { periodRange, filterSalesByRange, summarizeSales, PAYMENT_BUCKETS } from '../lib/pharmacyReports';
import { classifyPharmacyStock } from '../lib/pharmacyStock';
import { expiryExposure, stockValuation, validBusinessDate } from '../lib/management';

const PERIODS = [{ key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: 'thismonth', label: 'This Month' }, { key: 'customday', label: 'Custom Date' }];
export default function HomeScreen({ navigation }) {
  const { mainStock, pharmacyStock, transferOrders, toHasMore, stockTruncated, pharmacyLocation,
    loading: whLoading, refreshing: whRefreshing, refresh: whRefresh, loadError: whError } = useWarehouse();
  const { recentSales, creditLedger, creditError, refreshCredit, asOf, fetchSalesRange,
    loading: phLoading, refreshing: phRefreshing, refresh: phRefresh, loadError: phError } = usePharmacy();
  const { canManageCredit, canViewInventory } = useAuth();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [period, setPeriod] = useState('today');
  const [day, setDay] = useState('');
  const [days, setDays] = useState(90);
  const [custom, setCustom] = useState(null);
  const [clock, setClock] = useState(Date.now());
  useFocusEffect(useCallback(() => { setClock(Date.now()); }, []));
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const range = useMemo(() => period === 'customday' && !validBusinessDate(day) ? null : periodRange(period, { day, now: clock }), [period, day, clock]);
  useEffect(() => {
    let active = true;
    if (period !== 'customday' || !validBusinessDate(day)) return;
    setCustom(null);
    const bounds = periodRange('customday', { day });
    fetchSalesRange(bounds.from, bounds.to).then((res) => { if (active) setCustom({ ...res, day }); });
    return () => { active = false; };
  }, [period, day, fetchSalesRange, asOf]);
  const selectedSales = period === 'customday' ? (custom?.day === day ? custom.sales : null) : recentSales;
  const summary = range && selectedSales ? summarizeSales(filterSalesByRange(selectedSales, range.from, range.to)) : null;
  const comparisons = PERIODS.slice(0, 3).map((p) => {
    const r = periodRange(p.key, { now: clock });
    return { ...p, ...summarizeSales(filterSalesByRange(recentSales, r.from, r.to)) };
  });
  const phValue = stockValuation(pharmacyStock, true);
  const whValue = stockValuation(mainStock);
  const phExpiry = expiryExposure(pharmacyStock, days, true);
  const whExpiry = expiryExposure(mainStock, days);
  const phAlerts = classifyPharmacyStock(pharmacyStock, days);
  const collections = creditLedger && range ? creditLedger.payments.filter((p) => new Date(p.created_at) >= range.from && new Date(p.created_at) <= range.to) : null;
  const collected = collections?.reduce((sum, p) => sum + Number(p.amount), 0);
  const report = (key = period) => navigation.navigate('Pharmacy', { screen: 'Sales & Reports', params: { period: key, day, request: Date.now() } });
  const stock = () => navigation.navigate('Pharmacy', { screen: 'Pharmacy Stock' });
  const transfers = () => navigation.navigate('Warehouse', { screen: 'Orders', params: { mode: 'transfer', request: Date.now() } });
  const refresh = () => { setClock(Date.now()); whRefresh(); phRefresh(); refreshCredit(); };
  if (whLoading || phLoading) return <ScreenLoading />;
  return <Screen><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={whRefreshing || phRefreshing} onRefresh={refresh} tintColor={theme.accent} />}>
    <Text style={styles.title}>VHC Management</Text>
    <Text style={styles.meta}>{new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long' }).format(clock)} · India time</Text>
    <AsOf at={asOf} />
    {phError || whError ? <Text style={styles.error}>Refresh failed. Figures may be stale: {phError || whError}</Text> : null}
    <View style={styles.grid}>{comparisons.map((p) => <AnimatedPressable key={p.key} style={styles.tile} onPress={() => report(p.key)}><Text style={styles.meta}>{p.label} Revenue</Text><Text style={styles.number}>{asOf ? formatCurrency(p.totalSales) : 'Unavailable'}</Text><Text style={styles.link}>View bills ›</Text></AnimatedPressable>)}</View>
    <ChipTabs options={PERIODS} value={period} onChange={setPeriod} />
    {period === 'customday' ? <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={theme.muted} value={day} onChangeText={setDay} /> : null}
    {!range ? <Text style={styles.error}>Enter a valid date as YYYY-MM-DD.</Text> : null}
    {custom?.error && period === 'customday' ? <Text style={styles.error}>{custom.error}</Text> : null}
    <AnimatedPressable onPress={() => range && report()}><Card style={styles.card}>
      <SectionTitle right={<Text style={styles.link}>Details ›</Text>}>{range?.label || 'Choose date'} — Owner Summary</SectionTitle>
      <KeyVal label="Sales" value={summary && asOf ? formatCurrency(summary.totalSales) : 'Unavailable'} strong />
      <KeyVal label="Bills" value={summary?.billCount ?? '—'} /><KeyVal label="Average bill" value={summary ? formatCurrency(summary.avgBill) : '—'} />
      {[...PAYMENT_BUCKETS, 'Other'].map((b) => <KeyVal key={b} label={b === 'Credit' ? 'Credit sales' : b} value={summary ? formatCurrency(summary.payments[b]) : '—'} />)}
      {canManageCredit ? <><KeyVal label="Credit collected" value={collections ? formatCurrency(collected) : 'Unavailable'} />
        {['Cash', 'UPI', 'Card'].map((m) => <KeyVal key={m} label={`Collections · ${m}`} value={collections ? formatCurrency(collections.filter((p) => p.payment_mode === m).reduce((sum, p) => sum + Number(p.amount), 0)) : '—'} />)}</> : null}
      <Text style={styles.meta}>Collections are repayments, separate from sales. Expenses and historical purchase cost are not connected.</Text>
    </Card></AnimatedPressable>
    {canManageCredit ? <AnimatedPressable onPress={() => navigation.navigate('Pharmacy', { screen: 'Credit / Outstanding' })}><Card style={styles.card}><KeyVal label="Pending credit · all time" value={creditLedger ? formatCurrency(creditLedger.total) : 'Unavailable'} strong /><Text style={styles.link}>Collect payment / repayment history ›</Text>{creditError ? <Text style={styles.error}>Credit ledger needs connection.</Text> : null}</Card></AnimatedPressable> : null}
    {canViewInventory ? <>
      <AnimatedPressable onPress={stock}><Card style={styles.card}>
        <SectionTitle>Current Stock · Purchase Value</SectionTitle>
        {!pharmacyLocation ? <Text style={styles.error}>Pharmacy location not configured.</Text> : null}
        <KeyVal label="Pharmacy" value={formatCurrency(phValue.value)} /><KeyVal label="Main warehouse" value={formatCurrency(whValue.value)} />
        <KeyVal label="Low / critical pharmacy batches" value={phAlerts.low.length + phAlerts.critical.length} />
        <KeyVal label="Out-of-stock pharmacy batches" value={phAlerts.outOfStock.length} />
        {phValue.missingCost + whValue.missingCost > 0 ? <Text style={styles.error}>{phValue.missingCost + whValue.missingCost} batches have no cost; values are partial.</Text> : null}
        {stockTruncated ? <Text style={styles.error}>Stock list is incomplete; totals are partial.</Text> : null}
      </Card></AnimatedPressable>
      <Card style={styles.card}><SectionTitle>Expiry · Stock Value at Risk</SectionTitle>
        <ChipTabs options={[30, 60, 90, 180].map((n) => ({ key: n, label: `${n} days` }))} value={days} onChange={setDays} />
        <KeyVal label={`Pharmacy · ${phExpiry.batches.length} batches`} value={formatCurrency(phExpiry.value)} />
        <KeyVal label={`Warehouse · ${whExpiry.batches.length} batches`} value={formatCurrency(whExpiry.value)} />
        <Text style={styles.meta}>In-stock batches expiring today through {days} days. Already expired stock is excluded. Missing costs are excluded from values.</Text>
      </Card>
      <AnimatedPressable onPress={transfers}><Card style={styles.card}><SectionTitle>Transfers & Returns</SectionTitle><KeyVal label="Pending in loaded history" value={transferOrders.filter((t) => t.status === 'Pending').length} /><Text style={styles.link}>Pending · Accepted · Rejected · Returns ›</Text><Text style={styles.meta}>{transferOrders.length} records loaded{toHasMore ? ' · Older records available in history' : ''}</Text></Card></AnimatedPressable>
    </> : null}
  </ScrollView></Screen>;
}
const makeStyles = (t) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 }, title: { color: t.text, fontWeight: '800', fontSize: 28 },
  meta: { color: t.muted, fontSize: 12, marginVertical: 6 }, error: { color: t.warning, fontSize: 12, marginVertical: 8 },
  card: { marginVertical: 10 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 12 },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: t.panel, borderRadius: 16, borderWidth: 1, borderColor: t.panelBorder, padding: 14 },
  number: { color: t.text, fontWeight: '800', fontSize: 22, marginVertical: 6 }, link: { color: t.accent, fontWeight: '700', fontSize: 12 },
  input: { color: t.text, padding: 14, borderWidth: 1, borderColor: t.panelBorder, borderRadius: 12, marginTop: 12 },
});
