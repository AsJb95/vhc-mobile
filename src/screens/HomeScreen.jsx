import { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { MotiView } from 'moti';
import { useWarehouse } from '../context/WarehouseContext';
import { usePharmacy } from '../context/PharmacyContext';
import { Card, StatCard, Screen, ScreenLoading, AnimatedPressable } from '../components/UI';
import { KeyVal, SectionTitle, AsOf } from '../components/Bits';
import { formatCurrency, colors } from '../lib/format';
import { periodRange, filterSalesByRange, summarizeSales, buildCostLookup, PAYMENT_BUCKETS } from '../lib/pharmacyReports';
import { classifyPharmacyStock } from '../lib/pharmacyStock';

// Unified overview of BOTH systems. Compact — the most important number per
// area, each card tappable through to its detail screen.
export default function HomeScreen({ navigation }) {
  const {
    mainStock, purchaseOrders, transferOrders, settings, pharmacyStock,
    getAlerts, getTotalValue, getSubStockValue,
    loading: whLoading, refreshing: whRefreshing, refresh: whRefresh, loadError: whError,
  } = useWarehouse();
  const {
    recentSales, creditOutstanding, asOf, loading: phLoading, refreshing: phRefreshing, refresh: phRefresh, loadError: phError,
  } = usePharmacy();

  const today = useMemo(() => {
    const { from, to } = periodRange('today');
    return summarizeSales(filterSalesByRange(recentSales, from, to), buildCostLookup(pharmacyStock));
  }, [recentSales, pharmacyStock]);

  const phAlerts = useMemo(
    () => classifyPharmacyStock(pharmacyStock, settings.expiryAlertDays),
    [pharmacyStock, settings.expiryAlertDays],
  );

  const wh = useMemo(() => {
    const a = getAlerts();
    return {
      alerts: a,
      activeAlerts: a.lowStock.length + a.outOfStock.length + a.expiring.length + a.expired.length,
      totalValue: getTotalValue(),
      pendingPOs: purchaseOrders.filter((o) => o.status === 'Pending').length,
      subStockValue: settings.subStockLocations.reduce((s, l) => s + getSubStockValue(l.id), 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainStock, purchaseOrders, settings.lowStockThreshold, settings.expiryAlertDays, settings.subStockLocations]);

  if (whLoading || phLoading) return <ScreenLoading />;

  const refreshing = whRefreshing || phRefreshing;
  const onRefresh = () => { whRefresh(); phRefresh(); };
  const toPharmacy = (screen) => () => navigation.navigate('Pharmacy', screen ? { screen } : undefined);
  const toWarehouse = (screen) => () => navigation.navigate('Warehouse', screen ? { screen } : undefined);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <MotiView from={{ opacity: 0, translateY: -8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 300 }}>
          <Text style={styles.title}>VHC Overview</Text>
        </MotiView>
        <AsOf at={asOf} />
        {phError ? <Text style={styles.errorBanner}>Pharmacy data unavailable — {phError}</Text> : null}
        {whError ? <Text style={styles.errorBanner}>Warehouse data unavailable — {whError}</Text> : null}

        {/* ---- Pharmacy ---- */}
        <Text style={styles.sectionHead}>Pharmacy</Text>
        <View style={styles.statGrid}>
          <StatCard index={0} label="Today's Sales" value={formatCurrency(today.totalSales)} color={colors.success} />
          <StatCard index={1} label="Today's Bills" value={today.billCount} color={colors.accent} />
        </View>
        <AnimatedPressable onPress={toPharmacy('Sales & Reports')}>
          <Card index={2} style={styles.card}>
            <SectionTitle right={<Text style={styles.link}>Reports ›</Text>}>Today — Payments</SectionTitle>
            <View style={styles.payRow}>
              {PAYMENT_BUCKETS.map((b) => (
                <View key={b} style={styles.payCell}>
                  <Text style={styles.payVal}>{formatCurrency(today.payments[b] || 0)}</Text>
                  <Text style={styles.payLabel}>{b}</Text>
                </View>
              ))}
            </View>
          </Card>
        </AnimatedPressable>
        <AnimatedPressable onPress={toPharmacy('Pharmacy Stock')}>
          <Card index={3} style={styles.card}>
            <SectionTitle right={<Text style={styles.link}>Stock ›</Text>}>Pharmacy Stock</SectionTitle>
            <KeyVal label="Low stock" value={phAlerts.low.length} color={colors.warning} />
            <KeyVal label="Out of stock" value={phAlerts.outOfStock.length} color={colors.danger} />
            <KeyVal label="Expiring soon" value={phAlerts.expiring.length} color={colors.accent} />
          </Card>
        </AnimatedPressable>
        <AnimatedPressable onPress={toPharmacy('Credit / Outstanding')}>
          <Card index={4} style={styles.card}>
            <KeyVal label="Outstanding credit (all-time)" value={formatCurrency(creditOutstanding.total)} strong color={colors.warning} />
            <Text style={styles.hint}>{creditOutstanding.count} Credit-mode bills · no repayment tracking</Text>
          </Card>
        </AnimatedPressable>

        {/* ---- Warehouse ---- */}
        <Text style={styles.sectionHead}>Warehouse</Text>
        <View style={styles.statGrid}>
          <StatCard index={0} label="Main Stock Items" value={mainStock.length} color={colors.accent} />
          <StatCard index={1} label="Main Stock Value" value={formatCurrency(wh.totalValue)} color={colors.success} />
          <StatCard index={2} label="Active Alerts" value={wh.activeAlerts} sub={`${wh.alerts.expired.length} expired · ${wh.alerts.outOfStock.length} out`} color={colors.danger} />
          <StatCard index={3} label="Pending POs" value={wh.pendingPOs} sub={`${purchaseOrders.length} total`} color={colors.warning} />
        </View>
        <AnimatedPressable onPress={toWarehouse('Orders')}>
          <Card index={4} style={styles.card}>
            <KeyVal label="Transfers recorded" value={transferOrders.length} />
            <KeyVal label="Sub-stock value" value={formatCurrency(wh.subStockValue)} />
            <Text style={styles.hint}>Tap for transfer &amp; purchase-order history.</Text>
          </Card>
        </AnimatedPressable>
        <AnimatedPressable onPress={toWarehouse('Sub-Stock Locations')}>
          <Card index={5} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardLink}>Sub-Stock Locations ({settings.subStockLocations.length})</Text>
              <Text style={styles.link}>Open ›</Text>
            </View>
          </Card>
        </AnimatedPressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 4 },
  errorBanner: { color: colors.warning, fontSize: 12, marginBottom: 8 },
  sectionHead: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 14, marginBottom: 10 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { marginBottom: 12 },
  link: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  cardLink: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hint: { color: colors.muted, fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  payCell: { flex: 1, backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.panelBorder, padding: 8, alignItems: 'center' },
  payVal: { color: colors.text, fontSize: 12, fontWeight: '800' },
  payLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
});
