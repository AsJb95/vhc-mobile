import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useWarehouse } from '../context/WarehouseContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { Card, Badge, EmptyState, ScreenLoading, StatCard, AnimatedPressable, Screen } from '../components/UI';
import { SectionTitle, AlphabetFilter } from '../components/Bits';
import AddItemModal from '../components/AddItemModal';
import MoveStockModal from '../components/MoveStockModal';
import { formatCurrency, expiryStatus, stockStatus, computeStockValue } from '../lib/format';
import { stripsToUnits } from '../lib/units';

// Display-only formatting for the Total Stock (Units/Nos) figure — Indian
// digit grouping (2,390 / 12,500) plus a small guard against floating-point
// noise (e.g. 26.499999999999996 from a strips*unitsPerPack multiply). Never
// used before a value is stored; the underlying stripsToUnits() result and
// Stock (Strips) itself are never rounded or truncated by this.
function formatUnitsDisplay(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString('en-IN');
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low' },
  { key: 'out', label: 'Out' },
  { key: 'expiring', label: 'Expiring' },
  { key: 'expired', label: 'Expired' },
];

// memo'd so a +/-, a search keystroke, or a scroll only re-renders the row that
// actually changed. Plain View (no per-row mount animation) keeps long lists
// scrolling smoothly.
const StockRow = memo(function StockRow({ item, styles, theme, lowThreshold, canWrite, pending, onEdit, onMove, onAdjust }) {
  const exp = expiryStatus(item.expiry);
  const status = stockStatus(item.stock, lowThreshold);
  return (
    <AnimatedPressable onPress={() => canWrite && onEdit(item)} disabled={!canWrite}>
      <View style={styles.itemCard}>
        <View style={styles.itemRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName}>{item.name}</Text>
            {item.batch ? <Text style={styles.itemMeta}>Batch {item.batch}</Text> : null}
          </View>
          <Badge label={status.label} color={status.color} />
        </View>
        <View style={styles.itemRow}>
          <Text style={styles.itemMeta}>Expiry: <Text style={{ color: exp.color }}>{exp.label}</Text></Text>
          <Text style={styles.itemMeta}>{formatCurrency(computeStockValue(item.netRate, item.mrp, item.stock))}</Text>
        </View>
        <View style={styles.itemRow}>
          <View style={styles.stockGroup}>
            <Text style={styles.stockStripsValue}>
              {item.stock} <Text style={styles.stockStripsUnit}>strips</Text>
            </Text>
            <Text style={styles.stockSubLine}>
              × {item.unitsPerPack || '—'}/strip = <Text style={styles.stockTotalValue}>{formatUnitsDisplay(stripsToUnits(item.stock, item.unitsPerPack))} units</Text>
            </Text>
          </View>
          {canWrite && (
            <View style={styles.adjustRow}>
              <AnimatedPressable style={styles.moveBtn} onPress={() => onMove(item)}>
                <Ionicons name="swap-horizontal" size={15} color={theme.accent} />
                <Text style={styles.moveBtnText}>Move</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.adjustBtn} disabled={pending} onPress={() => onAdjust(item.id, -1)}>
                <Text style={styles.adjustBtnText}>−</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.adjustBtn} disabled={pending} onPress={() => onAdjust(item.id, 1)}>
                <Text style={styles.adjustBtnText}>+</Text>
              </AnimatedPressable>
            </View>
          )}
        </View>
      </View>
    </AnimatedPressable>
  );
});

const ALERT_TO_TAB = { expired: 'expired', expiring: 'expiring', low: 'low', out: 'out' };

export default function StockScreen({ route, navigation }) {
  const {
    mainStock, settings, adjustStock, loading, refreshing, refresh, stockTruncated,
    getAlerts, getTotalValue, subStocks, pendingStockReturns,
  } = useWarehouse();
  const { canWriteWarehouse } = useAuth();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [tab, setTab] = useState('all');

  // Deep-link from the Alerts screen: ?filter=expired|expiring|low|out.
  const alertFilter = route?.params?.filter;
  useEffect(() => {
    if (alertFilter && ALERT_TO_TAB[alertFilter]) setTab(ALERT_TO_TAB[alertFilter]);
  }, [alertFilter]);

  const [letter, setLetter] = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [movingItem, setMovingItem] = useState(null);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const inFlightRef = useRef(new Set());

  const openAdd = useCallback(() => { setEditingItem(null); setModalOpen(true); }, []);
  const openEdit = useCallback((item) => { setEditingItem(item); setModalOpen(true); }, []);
  const openMove = useCallback((item) => setMovingItem(item), []);

  const onAdjust = useCallback(async (id, delta) => {
    if (inFlightRef.current.has(id)) return; // block rapid double-tap re-fire
    inFlightRef.current.add(id);
    setPendingIds((prev) => { const n = new Set(prev); n.add(id); return n; });
    try {
      await adjustStock(id, delta);
    } catch {
      // adjustStock already surfaced the error
    } finally {
      inFlightRef.current.delete(id);
      setPendingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, [adjustStock]);

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
    if (letter !== 'All') {
      list = list.filter((i) => (i.name || '').trim().toUpperCase().startsWith(letter));
    }
    const s = debouncedSearch.trim().toLowerCase();
    if (s) {
      list = list.filter((i) => (i.name || '').toLowerCase().includes(s) || (i.batch || '').toLowerCase().includes(s) || (i.stockist || '').toLowerCase().includes(s));
    }
    return list;
  }, [mainStock, tab, letter, debouncedSearch, settings.lowStockThreshold, settings.expiryAlertDays]);

  const focusTab = useCallback((key) => { setTab(key); setSearch(''); }, []);

  const returnCount = pendingStockReturns?.length || 0;

  const dashboard = useMemo(() => (
    <View style={styles.dashboard}>
      {canWriteWarehouse && returnCount > 0 ? (
        <AnimatedPressable onPress={() => navigation?.navigate?.('Pending Returns')}>
          <Card style={[styles.alertsCard, styles.returnsCard]}>
            <View style={styles.returnsRow}>
              <Text style={styles.returnsTitle}>↩️  Pending Return Requests ({returnCount})</Text>
              <Text style={styles.returnsLink}>Review ›</Text>
            </View>
            <Text style={styles.hint}>Stock the Pharmacy wants to send back. Nothing changes until you Accept.</Text>
          </Card>
        </AnimatedPressable>
      ) : null}

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
  ), [styles, theme, summary, tab, focusTab, canWriteWarehouse, returnCount, navigation]);

  const renderItem = useCallback(({ item }) => (
    <StockRow
      item={item}
      styles={styles}
      theme={theme}
      lowThreshold={settings.lowStockThreshold}
      canWrite={canWriteWarehouse}
      pending={pendingIds.has(item.id)}
      onEdit={openEdit}
      onMove={openMove}
      onAdjust={onAdjust}
    />
  ), [styles, theme, settings.lowStockThreshold, canWriteWarehouse, pendingIds, openEdit, openMove, onAdjust]);

  if (loading) return <ScreenLoading />;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Main Stock</Text>
            <Text style={styles.subtitle}>{mainStock.length} products</Text>
          </View>
          {canWriteWarehouse && (
            <AnimatedPressable
              style={styles.newEntryBtn}
              onPress={openAdd}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="add-circle" size={18} color={theme.onAccent} />
              <Text style={styles.newEntryBtnText}>New Entry</Text>
            </AnimatedPressable>
          )}
        </View>
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
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <AnimatedPressable key={t.key} style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </AnimatedPressable>
          ))}
        </View>
        <AlphabetFilter value={letter} onChange={setLetter} />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={dashboard}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
        ListEmptyComponent={
          <EmptyState
            text={letter !== 'All' ? `No items found starting with "${letter}"` : 'No items match this filter'}
            icon="📦"
          />
        }
        renderItem={renderItem}
      />

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
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: t.muted, fontSize: 12, marginBottom: 12 },
  newEntryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 40, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: t.accent,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 3,
  },
  newEntryBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 13 },
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
  returnsCard: { borderColor: `${t.warning}88`, backgroundColor: `${t.warning}14` },
  returnsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  returnsTitle: { color: t.text, fontSize: 15, fontWeight: '800', flex: 1, marginRight: 8 },
  returnsLink: { color: t.accent, fontSize: 12, fontWeight: '700' },
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
  // Same look as the shared <Card> — without the per-row mount animation.
  itemCard: {
    marginBottom: 10, backgroundColor: t.card, borderRadius: 20, borderWidth: 1, borderColor: t.panelBorder,
    padding: 16, shadowColor: t.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 12, elevation: 2,
  },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  itemName: { color: t.text, fontWeight: '600', fontSize: 15 },
  itemMeta: { color: t.muted, fontSize: 12 },
  // Stock (Strips) = primary (large, bold); Units Per Strip = supporting
  // (folded into the small "× N/strip =" prefix); Total Stock (Units/Nos) =
  // secondary/important (accent-colored, medium weight). Display only — all
  // three values come from item.stock / item.unitsPerPack / stripsToUnits()
  // unchanged.
  stockGroup: { flexShrink: 1 },
  stockStripsValue: { color: t.text, fontWeight: '800', fontSize: 17 },
  stockStripsUnit: { color: t.muted, fontWeight: '600', fontSize: 12 },
  stockSubLine: { color: t.muted, fontSize: 12, marginTop: 2 },
  stockTotalValue: { color: t.accent, fontWeight: '700' },
  adjustRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 34,
    paddingHorizontal: 12, borderRadius: 10,
    backgroundColor: `${t.accent}1f`, borderWidth: 1, borderColor: `${t.accent}55`,
  },
  moveBtnText: { color: t.accent, fontSize: 13, fontWeight: '700' },
  adjustBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: t.chip, borderWidth: 1, borderColor: t.panelBorder, alignItems: 'center', justifyContent: 'center' },
  adjustBtnText: { color: t.text, fontSize: 18, fontWeight: '700' },
});
