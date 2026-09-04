import { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { usePharmacy } from '../context/PharmacyContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, StatCard, Screen, ScreenLoading, AnimatedPressable } from '../components/UI';
import { KeyVal, SectionTitle, AsOf } from '../components/Bits';
import { formatCurrency } from '../lib/format';
import { periodRange, filterSalesByRange, summarizeSales, buildCostLookup, PAYMENT_BUCKETS } from '../lib/pharmacyReports';
import { classifyPharmacyStock } from '../lib/pharmacyStock';

export default function PharmacyDashboardScreen({ navigation }) {
  const { pharmacyStock, pharmacyLocation, pendingPharmacyTransfers, settings, loading: whLoading } = useWarehouse();
  const {
    recentSales, creditOutstanding, asOf, loading: phLoading, refreshing, refresh, loadError, salesTruncated,
  } = usePharmacy();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const today = useMemo(() => {
    const { from, to } = periodRange('today');
    const sales = filterSalesByRange(recentSales, from, to);
    const cost = buildCostLookup(pharmacyStock);
    return summarizeSales(sales, cost);
  }, [recentSales, pharmacyStock]);

  const stockAlerts = useMemo(
    () => classifyPharmacyStock(pharmacyStock, settings.expiryAlertDays),
    [pharmacyStock, settings.expiryAlertDays],
  );

  if (whLoading || phLoading) return <ScreenLoading />;

  const go = (screen) => () => navigation?.navigate?.(screen);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
      >
        <Text style={styles.title}>Pharmacy</Text>
        <AsOf at={asOf} />
        {loadError ? <Text style={styles.errorBanner}>Live pharmacy data unavailable — {loadError}</Text> : null}
        {!pharmacyLocation ? (
          <Text style={styles.errorBanner}>No pharmacy_counter location configured — stock figures will be empty.</Text>
        ) : null}

        {pendingPharmacyTransfers.length > 0 ? (
          <AnimatedPressable onPress={go('Pending Transfers')}>
            <Card index={0} style={[styles.card, styles.pendingCard]}>
              <View style={styles.rowBetween}>
                <Text style={styles.pendingTitle}>🔔  Pending Stock Transfers ({pendingPharmacyTransfers.length})</Text>
                <Text style={styles.link}>Review ›</Text>
              </View>
              <Text style={styles.hint}>
                Stock moved from Main Stock to the Pharmacy. Pharmacy Inventory updates only after you approve each one.
              </Text>
            </Card>
          </AnimatedPressable>
        ) : (
          <AnimatedPressable onPress={go('Pending Transfers')}>
            <Card index={0} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardLink}>Pending Stock Transfers</Text>
                <Text style={styles.link}>Open ›</Text>
              </View>
              <Text style={styles.hint}>None waiting. Transfers from Main Stock to the Pharmacy appear here for approval.</Text>
            </Card>
          </AnimatedPressable>
        )}

        <View style={styles.statGrid}>
          <StatCard index={0} label="Today's Sales" value={formatCurrency(today.totalSales)} color={theme.success} />
          <StatCard index={1} label="Today's Bills" value={today.billCount} sub={`Avg ${formatCurrency(today.avgBill)}`} color={theme.accent} />
        </View>

        <AnimatedPressable onPress={go('Sales & Reports')}>
          <Card index={2} style={styles.card}>
            <SectionTitle right={<Text style={styles.link}>Reports ›</Text>}>Today — Payment Breakdown</SectionTitle>
            {PAYMENT_BUCKETS.map((b) => (
              <KeyVal key={b} label={b} value={formatCurrency(today.payments[b] || 0)} />
            ))}
            {today.payments.Other > 0 ? <KeyVal label="Other" value={formatCurrency(today.payments.Other)} /> : null}
            <View style={styles.divider} />
            <KeyVal label="Total" value={formatCurrency(today.totalSales)} strong />
          </Card>
        </AnimatedPressable>

        <AnimatedPressable onPress={go('Pharmacy Stock')}>
          <Card index={3} style={styles.card}>
            <SectionTitle right={<Text style={styles.link}>Stock ›</Text>}>Stock Alerts</SectionTitle>
            <View style={styles.miniGrid}>
              <Mini label="Low" value={stockAlerts.low.length} color={theme.warning} />
              <Mini label="Critical" value={stockAlerts.critical.length} color={theme.danger} />
              <Mini label="Out of Stock" value={stockAlerts.outOfStock.length} color={theme.danger} />
              <Mini label="Expiring Soon" value={stockAlerts.expiring.length} color={theme.accent} />
            </View>
            <Text style={styles.hint}>Pharmacy thresholds: ≤20 units / ≤2 strips (low), half that (critical).</Text>
          </Card>
        </AnimatedPressable>

        <AnimatedPressable onPress={go('Credit / Outstanding')}>
          <Card index={4} style={styles.card}>
            <SectionTitle right={<Text style={styles.link}>Details ›</Text>}>Outstanding Credit</SectionTitle>
            <KeyVal label="Total billed as Credit" value={formatCurrency(creditOutstanding.total)} strong color={theme.warning} />
            <KeyVal label="Credit bills" value={creditOutstanding.count} />
            <Text style={styles.hint}>All-time Credit-mode bills. The POS does not track repayments.</Text>
          </Card>
        </AnimatedPressable>

        <AnimatedPressable onPress={go('Inventory Intelligence')}>
          <Card index={5} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardLink}>Inventory Intelligence</Text>
              <Text style={styles.link}>Open ›</Text>
            </View>
            <Text style={styles.hint}>Top selling · slow moving · dead stock · low / critical / out / expiring</Text>
          </Card>
        </AnimatedPressable>

        {salesTruncated ? (
          <Text style={styles.hint}>Showing the most recent bills only — older bills are excluded from the live window.</Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Mini({ label, value, color }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.mini}>
      <Text style={[styles.miniValue, { color }]}>{value}</Text>
      <Text style={styles.miniLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  title: { color: t.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 4 },
  errorBanner: { color: t.warning, fontSize: 12, marginBottom: 10 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { marginBottom: 12 },
  pendingCard: { borderColor: `${t.warning}88`, backgroundColor: `${t.warning}14` },
  pendingTitle: { color: t.text, fontSize: 15, fontWeight: '800', flex: 1, marginRight: 8 },
  divider: { height: 1, backgroundColor: t.panelBorder, marginVertical: 8 },
  link: { color: t.accent, fontSize: 12, fontWeight: '700' },
  cardLink: { color: t.text, fontSize: 15, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hint: { color: t.muted, fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mini: { flexBasis: '47%', backgroundColor: t.chip, borderRadius: 14, borderWidth: 1, borderColor: t.panelBorder, padding: 12 },
  miniValue: { fontSize: 22, fontWeight: '800' },
  miniLabel: { color: t.muted, fontSize: 11, marginTop: 2 },
});
