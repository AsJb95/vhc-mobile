import { useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { usePharmacy } from '../context/PharmacyContext';
import { Card, Badge, Screen, ScreenLoading, EmptyState } from '../components/UI';
import { ChipTabs, AsOf } from '../components/Bits';
import { formatCurrency, formatDate, daysUntil, colors } from '../lib/format';
import { topSelling, slowMoving, deadStock } from '../lib/pharmacyReports';
import { classifyPharmacyStock, pharmacyStockStatus } from '../lib/pharmacyStock';

const TABS = [
  { key: 'top', label: 'Top Selling' },
  { key: 'slow', label: 'Slow Moving' },
  { key: 'dead', label: 'Dead Stock' },
  { key: 'low', label: 'Low' },
  { key: 'critical', label: 'Critical' },
  { key: 'out', label: 'Out' },
  { key: 'expiring', label: 'Expiring' },
];

function windowSales(sales, days) {
  const cutoff = Date.now() - days * 86400000;
  return (sales || []).filter((s) => new Date(s.sale_date).getTime() >= cutoff);
}

export default function InventoryIntelligenceScreen() {
  const { pharmacyStock, settings, loading: whLoading } = useWarehouse();
  const { recentSales, asOf, loading: phLoading, refreshing, refresh, loadError } = usePharmacy();
  const [tab, setTab] = useState('top');
  const [search, setSearch] = useState('');

  const alerts = useMemo(
    () => classifyPharmacyStock(pharmacyStock, settings.expiryAlertDays),
    [pharmacyStock, settings.expiryAlertDays],
  );

  const rows = useMemo(() => {
    let list;
    switch (tab) {
      case 'top': list = topSelling(windowSales(recentSales, 30)).map((d) => ({ kind: 'sold', name: d.name, units: d.units, revenue: d.revenue })); break;
      case 'slow': list = slowMoving(windowSales(recentSales, 30), pharmacyStock).map((i) => ({ kind: 'item', ...i, note: `${i.unitsSold} sold / 30d` })); break;
      case 'dead': list = deadStock(windowSales(recentSales, 60), pharmacyStock).map((i) => ({ kind: 'item', ...i, note: 'no sales / 60d' })); break;
      case 'low': list = alerts.low.map((i) => ({ kind: 'item', ...i })); break;
      case 'critical': list = alerts.critical.map((i) => ({ kind: 'item', ...i })); break;
      case 'out': list = alerts.outOfStock.map((i) => ({ kind: 'item', ...i })); break;
      case 'expiring': list = alerts.expiring.map((i) => ({ kind: 'item', ...i })); break;
      default: list = [];
    }
    const s = search.trim().toLowerCase();
    return s ? list.filter((r) => (r.name || '').toLowerCase().includes(s) || (r.batch || '').toLowerCase().includes(s)) : list;
  }, [tab, recentSales, pharmacyStock, alerts, search]);

  if (whLoading || phLoading) return <ScreenLoading />;

  return (
    <Screen>
      <View style={styles.header}>
        <AsOf at={asOf} />
        {loadError ? <Text style={styles.error}>Sales data unavailable — {loadError}</Text> : null}
        <TextInput
          style={styles.search}
          placeholder="Search within this list..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
        <ChipTabs options={TABS} value={tab} onChange={setTab} />
        <Text style={styles.count}>{rows.length} item(s){tab === 'top' || tab === 'slow' ? ' · window: last 30 days' : tab === 'dead' ? ' · window: last 60 days' : ''}</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r, i) => `${tab}-${r.id || r.name}-${i}`}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
        ListEmptyComponent={<EmptyState text="Nothing in this category" icon="📊" />}
        renderItem={({ item, index }) => {
          if (item.kind === 'sold') {
            return (
              <Card index={index} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.units}>{item.units} units</Text>
                </View>
                <Text style={styles.meta}>Revenue {formatCurrency(item.revenue)}</Text>
              </Card>
            );
          }
          const status = pharmacyStockStatus(item, colors);
          const d = item.expiry ? daysUntil(item.expiry) : null;
          return (
            <Card index={index} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.name}>{item.name}</Text>
                <Badge label={status.label} color={status.color} />
              </View>
              <Text style={styles.meta}>
                Stock {item.stock} · Batch {item.batch || '—'}{item.note ? ` · ${item.note}` : ''}
              </Text>
              {item.expiry ? (
                <Text style={styles.meta}>Expiry {formatDate(item.expiry)}{d != null ? ` (${d >= 0 ? `${d}d left` : `${Math.abs(d)}d ago`})` : ''}</Text>
              ) : null}
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, paddingBottom: 6 },
  error: { color: colors.danger, fontSize: 12, marginBottom: 8 },
  search: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10,
    color: colors.text, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  count: { color: colors.muted, fontSize: 11, marginTop: 8 },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  card: { marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  name: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1, marginRight: 8 },
  units: { color: colors.accent, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
