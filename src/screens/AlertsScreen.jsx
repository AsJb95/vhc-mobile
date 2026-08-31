import { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Badge, EmptyState, ScreenLoading, StatCard, AnimatedPressable, Screen } from '../components/UI';
import { ChipTabs } from '../components/Bits';
import { formatCurrency, formatDate, daysUntil } from '../lib/format';
import { classifyPharmacyStock, PHARMACY_LOW_UNITS, PHARMACY_LOW_STRIPS } from '../lib/pharmacyStock';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'expired', label: 'Expired' },
  { key: 'out', label: 'Out' },
  { key: 'critical', label: 'Critical' },
  { key: 'low', label: 'Low' },
  { key: 'expiring', label: 'Expiring' },
];

const typeMeta = (t) => ({
  expired: { label: 'Expired', color: t.danger },
  out: { label: 'Out of Stock', color: t.danger },
  critical: { label: 'Critical', color: t.danger },
  low: { label: 'Low Stock', color: t.warning },
  expiring: { label: 'Expiring Soon', color: t.accent },
});

export default function AlertsScreen() {
  const { getAlerts, mainStock, pharmacyStock, settings, loading, refreshing, refresh } = useWarehouse();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const TYPE_META = useMemo(() => typeMeta(theme), [theme]);
  const [domain, setDomain] = useState('warehouse');
  const [filter, setFilter] = useState('all');

  // Warehouse alerts use the warehouse alerts_config threshold; pharmacy alerts
  // use the pharmacy thresholds. These two are deliberately NOT the same number.
  const whAlerts = useMemo(
    () => getAlerts(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainStock, settings.lowStockThreshold, settings.expiryAlertDays],
  );
  const phAlerts = useMemo(
    () => classifyPharmacyStock(pharmacyStock, settings.expiryAlertDays),
    [pharmacyStock, settings.expiryAlertDays],
  );

  const buckets = useMemo(() => (domain === 'warehouse'
    ? { expired: whAlerts.expired, out: whAlerts.outOfStock, critical: [], low: whAlerts.lowStock, expiring: whAlerts.expiring }
    : { expired: phAlerts.expired, out: phAlerts.outOfStock, critical: phAlerts.critical, low: phAlerts.low, expiring: phAlerts.expiring }),
  [domain, whAlerts, phAlerts]);

  const rows = useMemo(() => {
    const order = ['expired', 'out', 'critical', 'low', 'expiring'];
    const all = order.flatMap((t) => (buckets[t] || []).map((item) => ({ type: t, item })));
    return filter === 'all' ? all : all.filter((r) => r.type === filter);
  }, [buckets, filter]);

  if (loading) return <ScreenLoading />;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Alerts</Text>
        <View style={styles.segmented}>
          <AnimatedPressable style={[styles.seg, domain === 'warehouse' && styles.segActive]} onPress={() => setDomain('warehouse')}>
            <Text style={[styles.segText, domain === 'warehouse' && styles.segTextActive]}>Warehouse</Text>
          </AnimatedPressable>
          <AnimatedPressable style={[styles.seg, domain === 'pharmacy' && styles.segActive]} onPress={() => setDomain('pharmacy')}>
            <Text style={[styles.segText, domain === 'pharmacy' && styles.segTextActive]}>Pharmacy</Text>
          </AnimatedPressable>
        </View>
        <Text style={styles.subtitle}>
          {domain === 'warehouse'
            ? `Low stock: <${settings.lowStockThreshold} units · Expiry: ${settings.expiryAlertDays} days`
            : `Low: ≤${PHARMACY_LOW_UNITS} units / ≤${PHARMACY_LOW_STRIPS} strips · Critical: half that · Expiry: ${settings.expiryAlertDays} days`}
        </Text>
        <View style={styles.statGrid}>
          <StatCard index={0} label="Expired" value={buckets.expired.length} color={theme.danger} />
          <StatCard index={1} label="Out of Stock" value={buckets.out.length} color={theme.danger} />
          {domain === 'pharmacy'
            ? <StatCard index={2} label="Critical" value={buckets.critical.length} color={theme.danger} />
            : <StatCard index={2} label="Low Stock" value={buckets.low.length} color={theme.warning} />}
          <StatCard index={3} label="Expiring Soon" value={buckets.expiring.length} color={theme.accent} />
        </View>
        <ChipTabs
          options={domain === 'warehouse' ? FILTERS.filter((f) => f.key !== 'critical') : FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row, idx) => `${domain}-${row.type}-${row.item.id}-${idx}`}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
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

const makeStyles = (t) => StyleSheet.create({
  header: { padding: 16, paddingBottom: 8 },
  title: { color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginBottom: 10 },
  segmented: { flexDirection: 'row', backgroundColor: t.chip, borderRadius: 12, borderWidth: 1, borderColor: t.panelBorder, padding: 4, marginBottom: 8 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segActive: { backgroundColor: t.accent },
  segText: { color: t.muted, fontSize: 13 },
  segTextActive: { color: t.onAccent, fontWeight: '700' },
  subtitle: { color: t.muted, fontSize: 11, marginBottom: 12 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  itemName: { color: t.text, fontWeight: '600', fontSize: 15, flex: 1, marginRight: 8 },
  itemMeta: { color: t.muted, fontSize: 12, marginTop: 2 },
});
