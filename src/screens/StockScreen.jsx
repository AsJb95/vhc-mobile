import { useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useWarehouse } from '../context/WarehouseContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Badge, EmptyState, ScreenLoading, StatCard, AnimatedPressable, Screen } from '../components/UI';
import { SectionTitle } from '../components/Bits';
import AddItemModal from '../components/AddItemModal';
import MoveStockModal from '../components/MoveStockModal';
import { formatCurrency, expiryStatus, stockStatus } from '../lib/format';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low' },
  { key: 'out', label: 'Out' },
  { key: 'expiring', label: 'Expiring' },
  { key: 'expired', label: 'Expired' },
];

export default function StockScreen() {
  const {
    mainStock, settings, adjustStock, loading, refreshing, refresh, stockTruncated,
    getAlerts, getTotalValue, subStocks,
  } = useWarehouse();
  const { canWriteWarehouse } = useAuth();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [movingItem, setMovingItem] = useState(null);

  function openAdd() { setEditingItem(null); setModalOpen(true); }
  function openEdit(item) { setEditingItem(item); setModalOpen(true); }

  // Headline numbers for the dashboard. getAlerts() is the same bucketing the
  // Alerts screen uses, so the counts always agree.
  const summary = useMemo(() => {
    const a = getAlerts();
    const subStockUnits = Object.values(subStocks || {}).reduce(
      (sum, list) => sum + (list || []).reduce((s, i) => s + (i.stock || 0), 0),
      0,
    );
    return {
      totalProducts: mainStock.length,
      totalValue: getTotalValue(),
      low: a.lowStock.length,
      out: a.outOfStock.length,
      expiring: a.expiring.length,
      expired: a.expired.length,
      subStockUnits,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainStock, subStocks, settings.lowStockThreshold, settings.expiryAlertDays]);

  const filtered = useMemo(() => {
    const now = new Date();
    const horizon = new Date(now.getTime() + (settings.expiryAlertDays || 90) * 24 * 60 * 60 * 1000);
    let list = mainStock;
    switch (tab) {
      case 'low': list = list.filter((i) => (i.stock || 0) > 0 && (i.stock || 0) < settings.lowStockThreshold); break;
      case 'out': list = list.filter((i) => (i.stock || 0) === 0); break;
      case 'expiring': list = list.filter((i) => i.expiry && new Date(i.expiry) <= horizon && new Date(i.expiry) >= now); break;
      case 'expired': list = list.filter((i) => i.expiry && new Date(i.expiry) < now); break;
      default: break;
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((i) => (i.name || '').toLowerCase().includes(s) || (i.batch || '').toLowerCase().includes(s) || (i.stockist || '').toLowerCase().includes(s));
    }
    return list;
  }, [mainStock, tab, search, settings.lowStockThreshold, settings.expiryAlertDays]);

  if (loading) return <ScreenLoading />;

  // Interactive dashboard — tapping an alert tile filters the list below to that
  // category (and clears any active search so the result is never hidden).
  const focusTab = (key) => { setTab(key); setSearch(''); };
  const dashboard = (
    <View style={styles.dashboard}>
      <View style={styles.statGrid}>
        <StatCard index={0} label="Total Products" value={summary.totalProducts} color={theme.accent} />
        <StatCard index={1} label="Main Stock Value" value={formatCurrency(summary.totalValue)} color={theme.success} />
      </View>

      <Card style={styles.alertsCard}>
        <SectionTitle>Stock Health</SectionTitle>
        <View style={styles.tileGrid}>
          <AlertTile styles={styles} label="Low" value={summary.low} color={theme.warning} active={tab === 'low'} onPress={() => focusTab('low')} />
          <AlertTile styles={styles} label="Out of Stock" value={summary.out} color={theme.danger} active={tab === 'out'} onPress={() => focusTab('out')} />
          <AlertTile styles={styles} label="Expiring Soon" value={summary.expiring} color={theme.accent} active={tab === 'expiring'} onPress={() => focusTab('expiring')} />
          <AlertTile styles={styles} label="Expired" value={summary.expired} color={theme.danger} active={tab === 'expired'} onPress={() => focusTab('expired')} />
        </View>
        {tab !== 'all' ? (
          <AnimatedPressable style={styles.clearBtn} onPress={() => focusTab('all')}>
            <Text style={styles.clearBtnText}>Showing “{TABS.find((t) => t.key === tab)?.label}” · tap to show all</Text>
          </AnimatedPressable>
        ) : (
          <Text style={styles.hint}>Tap a tile to filter the list below. Sub-stock locations hold {summary.subStockUnits} unit(s).</Text>
        )}
      </Card>
    </View>
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Main Stock</Text>
        <Text style={styles.subtitle}>{mainStock.length} products</Text>
        {stockTruncated ? (
          <Text style={styles.truncatedNote}>
            Showing the {mainStock.length} most-recently-updated items — some older items are not loaded. Use search on the desktop app for the full catalogue.
          </Text>
        ) : null}
        <TextInput
          style={styles.search}
          placeholder="Search medicine, batch, stockist..."
          placeholderTextColor={theme.muted}
          value={search}
          onChangeText={setSearch}
        />
        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <AnimatedPressable key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={dashboard}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
        ListEmptyComponent={<EmptyState text="No items match this filter" icon="📦" />}
        renderItem={({ item, index }) => {
          const exp = expiryStatus(item.expiry);
          const status = stockStatus(item.stock, settings.lowStockThreshold);
          return (
            <AnimatedPressable onPress={() => canWriteWarehouse && openEdit(item)} disabled={!canWriteWarehouse}>
              <Card index={index} style={styles.itemCard}>
                <View style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    {item.batch ? <Text style={styles.itemMeta}>Batch {item.batch}</Text> : null}
                  </View>
                  <Badge label={status.label} color={status.color} />
                </View>
                <View style={styles.itemRow}>
                  <Text style={styles.itemMeta}>Expiry: <Text style={{ color: exp.color }}>{exp.label}</Text></Text>
                  <Text style={styles.itemMeta}>{formatCurrency((item.stock || 0) * (item.netRate || 0))}</Text>
                </View>
                <View style={styles.itemRow}>
                  <Text style={styles.stockValue}>{item.stock} units</Text>
                  {canWriteWarehouse && (
                    <View style={styles.adjustRow}>
                      <AnimatedPressable style={styles.moveBtn} onPress={() => setMovingItem(item)}>
                        <Ionicons name="swap-horizontal" size={15} color={theme.accent} />
                        <Text style={styles.moveBtnText}>Move</Text>
                      </AnimatedPressable>
                      <AnimatedPressable style={styles.adjustBtn} onPress={() => adjustStock(item.id, -1)}>
                        <Text style={styles.adjustBtnText}>−</Text>
                      </AnimatedPressable>
                      <AnimatedPressable style={styles.adjustBtn} onPress={() => adjustStock(item.id, 1)}>
                        <Text style={styles.adjustBtnText}>+</Text>
                      </AnimatedPressable>
                    </View>
                  )}
                </View>
              </Card>
            </AnimatedPressable>
          );
        }}
      />

      {canWriteWarehouse && (
        <AnimatedPressable style={styles.fab} onPress={openAdd}>
          <Ionicons name="add" size={28} color={theme.onAccent} />
        </AnimatedPressable>
      )}

      <AddItemModal visible={modalOpen} item={editingItem} onClose={() => setModalOpen(false)} />
      <MoveStockModal visible={!!movingItem} item={movingItem} onClose={() => setMovingItem(null)} />
    </Screen>
  );
}

function AlertTile({ styles, label, value, color, active, onPress }) {
  return (
    <AnimatedPressable style={[styles.tile, active && { borderColor: color }]} onPress={onPress}>
      <Text style={[styles.tileValue, { color }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </AnimatedPressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { padding: 16, paddingBottom: 8 },
  title: { color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: t.muted, fontSize: 12, marginBottom: 12 },
  truncatedNote: { color: t.warning, fontSize: 11, marginBottom: 10 },
  search: {
    backgroundColor: t.panel, borderWidth: 1, borderColor: t.panelBorder, borderRadius: 12,
    color: t.text, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tabBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: t.chip, borderWidth: 1, borderColor: t.panelBorder, marginRight: 6, marginBottom: 6 },
  tabBtnActive: { backgroundColor: t.accent, borderColor: t.accent },
  tabText: { color: t.muted, fontSize: 12 },
  tabTextActive: { color: t.onAccent, fontWeight: '600' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  dashboard: { marginBottom: 4 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  alertsCard: { marginBottom: 12 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: t.chip, borderRadius: 14,
    borderWidth: 1, borderColor: t.panelBorder, paddingVertical: 12, paddingHorizontal: 14,
  },
  tileValue: { fontSize: 22, fontWeight: '800' },
  tileLabel: { color: t.muted, fontSize: 11, marginTop: 2 },
  clearBtn: { marginTop: 12, alignSelf: 'flex-start' },
  clearBtnText: { color: t.accent, fontSize: 12, fontWeight: '700' },
  hint: { color: t.muted, fontSize: 11, marginTop: 12, fontStyle: 'italic' },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  itemName: { color: t.text, fontWeight: '600', fontSize: 15 },
  itemMeta: { color: t.muted, fontSize: 12 },
  stockValue: { color: t.text, fontWeight: '700' },
  adjustRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 34,
    paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: `${t.accent}1f`, borderWidth: 1, borderColor: `${t.accent}55`,
  },
  moveBtnText: { color: t.accent, fontSize: 13, fontWeight: '700' },
  adjustBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: t.chip, borderWidth: 1, borderColor: t.panelBorder, alignItems: 'center', justifyContent: 'center' },
  adjustBtnText: { color: t.text, fontSize: 18, fontWeight: '700' },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: t.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
});
