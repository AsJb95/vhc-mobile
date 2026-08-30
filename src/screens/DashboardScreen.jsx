import { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { MotiView } from 'moti';
import { useWarehouse } from '../context/WarehouseContext';
import { Card, StatCard, EmptyState, ScreenLoading, Screen } from '../components/UI';
import { formatCurrency, colors } from '../lib/format';

export default function DashboardScreen() {
  const { mainStock, purchaseOrders, transferOrders, settings, getAlerts, getTotalValue, loading, refreshing, refresh, loadError } = useWarehouse();

  // Derived once per data change (getAlerts/getTotalValue rebuild their output
  // on every call). All hooks stay above the loading short-circuit so hook
  // order never changes between renders.
  const { alerts, totalValue, pendingPOs, activeAlertCount, recentAlerts } = useMemo(() => {
    const a = getAlerts();
    const recent = [
      ...a.expired.slice(0, 3).map((i) => ({ label: `${i.name} — expired`, color: colors.danger })),
      ...a.outOfStock.slice(0, 3).map((i) => ({ label: `${i.name} — out of stock`, color: colors.danger })),
      ...a.lowStock.slice(0, 3).map((i) => ({ label: `${i.name} — low stock (${i.stock} left)`, color: colors.warning })),
    ].slice(0, 6);
    return {
      alerts: a,
      totalValue: getTotalValue(),
      pendingPOs: purchaseOrders.filter((o) => o.status === 'Pending').length,
      activeAlertCount: a.lowStock.length + a.outOfStock.length + a.expiring.length + a.expired.length,
      recentAlerts: recent,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainStock, purchaseOrders, settings.lowStockThreshold, settings.expiryAlertDays]);

  if (loading) return <ScreenLoading />;

  return (
    <Screen>
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
    >
      <MotiView from={{ opacity: 0, translateY: -8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 300 }}>
        <Text style={styles.title}>Dashboard</Text>
      </MotiView>
      {loadError ? <Text style={styles.errorBanner}>Showing cached data — {loadError}</Text> : null}

      <View style={styles.statGrid}>
        <StatCard index={0} label="Total Products" value={mainStock.length} color={colors.accent} />
        <StatCard index={1} label="Main Stock Value" value={formatCurrency(totalValue)} color={colors.success} />
        <StatCard index={2} label="Active Alerts" value={activeAlertCount} sub={`${alerts.expired.length} expired · ${alerts.outOfStock.length} out`} color={colors.danger} />
        <StatCard index={3} label="Pending POs" value={pendingPOs} sub={`${purchaseOrders.length} total`} color={colors.warning} />
        <StatCard index={4} label="Transfers" value={transferOrders.length} color={colors.purple} />
        <StatCard index={5} label="Sub-Stock Locations" value={settings.subStockLocations.length} color={colors.accent} />
      </View>

      <Card index={6} style={{ marginBottom: 16 }}>
        <Text style={styles.sectionTitle}>Active Alerts</Text>
        {recentAlerts.length === 0 ? (
          <EmptyState text="No active alerts" icon="✅" />
        ) : (
          recentAlerts.map((a, idx) => (
            <MotiView
              key={idx}
              from={{ opacity: 0, translateX: -8 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{ type: 'timing', duration: 250, delay: idx * 60 }}
              style={[styles.alertRow, { borderLeftColor: a.color }]}
            >
              <Text style={styles.alertText}>{a.label}</Text>
            </MotiView>
          ))
        )}
      </Card>
    </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 16 },
  errorBanner: { color: colors.warning, fontSize: 12, marginBottom: 12 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  sectionTitle: { color: colors.text, fontWeight: '600', fontSize: 15, marginBottom: 10 },
  alertRow: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 6, marginBottom: 6 },
  alertText: { color: colors.text, fontSize: 13 },
});
