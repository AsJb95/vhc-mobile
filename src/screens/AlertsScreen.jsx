import { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { Card, Badge, EmptyState, ScreenLoading, StatCard, AnimatedPressable, Screen } from '../components/UI';
import { formatCurrency, formatDate, daysUntil, colors } from '../lib/format';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'expired', label: 'Expired' },
  { key: 'out', label: 'Out of Stock' },
  { key: 'low', label: 'Low Stock' },
  { key: 'expiring', label: 'Expiring' },
];

const TYPE_META = {
  expired: { label: 'Expired', color: colors.danger },
  out: { label: 'Out of Stock', color: colors.danger },
  low: { label: 'Low Stock', color: colors.warning },
  expiring: { label: 'Expiring Soon', color: colors.accent },
};

export default function AlertsScreen() {
  const { getAlerts, mainStock, settings, loading, refreshing, refresh } = useWarehouse();
  const [tab, setTab] = useState('all');

  // getAlerts() rebuilds its arrays on every call, so memoize the whole result
  // off the underlying stock snapshot — mainStock's identity only changes when
  // the warehouse data is (re)loaded or mutated.
  const alerts = useMemo(
    () => getAlerts(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainStock, settings.lowStockThreshold, settings.expiryAlertDays],
  );

  const rows = useMemo(() => {
    const list = [
      ...alerts.expired.map((i) => ({ type: 'expired', item: i })),
      ...alerts.outOfStock.map((i) => ({ type: 'out', item: i })),
      ...alerts.lowStock.map((i) => ({ type: 'low', item: i })),
      ...alerts.expiring.map((i) => ({ type: 'expiring', item: i })),
    ];
    return tab === 'all' ? list : list.filter((r) => r.type === tab);
  }, [tab, alerts]);

  // NOTE: every hook above runs unconditionally — the loading short-circuit
  // must stay below them to keep hook order stable across renders.
  if (loading) return <ScreenLoading />;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
        <Text style={styles.subtitle}>Low stock: &lt;{settings.lowStockThreshold} units · Expiry: {settings.expiryAlertDays} days</Text>
        <View style={styles.statGrid}>
          <StatCard index={0} label="Expired" value={alerts.expired.length} color={colors.danger} />
          <StatCard index={1} label="Out of Stock" value={alerts.outOfStock.length} color={colors.danger} />
          <StatCard index={2} label="Low Stock" value={alerts.lowStock.length} color={colors.warning} />
          <StatCard index={3} label="Expiring Soon" value={alerts.expiring.length} color={colors.accent} />
        </View>
        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <AnimatedPressable key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row, idx) => `${row.type}-${row.item.id}-${idx}`}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        ListEmptyComponent={<EmptyState text="No alerts in this category" icon="🔔" />}
        renderItem={({ item: row, index }) => {
          const meta = TYPE_META[row.type];
          const days = row.item.expiry ? daysUntil(row.item.expiry) : null;
          return (
            <Card index={index} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <Text style={styles.itemName}>{row.item.name}</Text>
                <Badge label={meta.label} color={meta.color} />
              </View>
              <Text style={styles.itemMeta}>
                Batch {row.item.batch || '—'} · Stock {row.item.stock} · {formatCurrency(row.item.netRate)}
              </Text>
              {row.item.expiry ? (
                <Text style={styles.itemMeta}>
                  Expiry {formatDate(row.item.expiry)} {days !== null ? `(${days >= 0 ? `${days}d left` : `${Math.abs(days)}d ago`})` : ''}
                </Text>
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { padding: 16, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: colors.muted, fontSize: 12, marginBottom: 12 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  tabBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, marginRight: 6, marginBottom: 6 },
  tabBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 12 },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  itemName: { color: colors.text, fontWeight: '600', fontSize: 15, flex: 1, marginRight: 8 },
  itemMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
