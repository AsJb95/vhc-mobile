import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useWarehouse } from '../context/WarehouseContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { Badge, EmptyState, ScreenLoading, AnimatedPressable, Screen } from '../components/UI';
import { AlphabetFilter } from '../components/Bits';
import AddItemModal from '../components/AddItemModal';
import ReturnStockModal from '../components/ReturnStockModal';
import { formatCurrency, expiryStatus } from '../lib/format';
import {
  pharmacyStockStatus, isPharmacyLow, isPharmacyCritical, isPharmacyOutOfStock,
  PHARMACY_LOW_UNITS, PHARMACY_LOW_STRIPS,
} from '../lib/pharmacyStock';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low' },
  { key: 'critical', label: 'Critical' },
  { key: 'out', label: 'Out' },
  { key: 'expiring', label: 'Expiring' },
  { key: 'expired', label: 'Expired' },
];

// One stock card. memo'd so a +/- on a different row, a search keystroke, or a
// scroll never re-renders it — it only re-renders when its own item / pending /
// theme actually change. Plain View (no mount animation) so long lists scroll
// without per-row reanimated work.
const PharmacyStockRow = memo(function PharmacyStockRow({ item, styles, theme, canWrite, canReturn, pending, onEdit, onAdjust, onReturn }) {
  const exp = expiryStatus(item.expiry);
  const status = pharmacyStockStatus(item, theme);
  return (
    <AnimatedPressable onPress={() => canWrite && onEdit(item)} disabled={!canWrite}>
      <View style={styles.itemCard}>
        <View style={styles.itemRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName}>{item.name}</Text>
            {item.category ? <Text style={styles.itemMeta}>{item.category}</Text> : null}
            {item.batch ? <Text style={styles.itemMeta}>Batch {item.batch}</Text> : null}
          </View>
          <Badge label={status.label} color={status.color} />
        </View>
        <View style={styles.itemRow}>
          <Text style={styles.itemMeta}>Expiry: <Text style={{ color: exp.color }}>{exp.label}</Text></Text>
          <Text style={styles.itemMeta}>MRP {formatCurrency(item.mrp)} · {item.gst ?? 0}% GST</Text>
        </View>
        <View style={styles.itemRow}>
          <Text style={styles.itemMeta}>{item.stockist || 'No stockist'} {item.hsnCode ? `· HSN ${item.hsnCode}` : ''}</Text>
          <Text style={styles.itemMeta}>{formatCurrency((item.stock || 0) * (item.netRate || 0))}</Text>
        </View>
        <View style={styles.itemRow}>
          <Text style={styles.stockValue}>{item.stock} units</Text>
          {(canWrite || canReturn) && (
            <View style={styles.adjustRow}>
              {canReturn && (item.stock || 0) > 0 && (
                <AnimatedPressable style={styles.returnBtn} onPress={() => onReturn(item)}>
                  <Ionicons name="arrow-undo" size={14} color={theme.accent} />
                  <Text style={styles.returnBtnText}>Return</Text>
                </AnimatedPressable>
              )}
              {canWrite && (
                <>
                  <AnimatedPressable style={styles.adjustBtn} disabled={pending} onPress={() => onAdjust(item.id, -1)}>
                    <Text style={styles.adjustBtnText}>−</Text>
                  </AnimatedPressable>
                  <AnimatedPressable style={styles.adjustBtn} disabled={pending} onPress={() => onAdjust(item.id, 1)}>
                    <Text style={styles.adjustBtnText}>+</Text>
                  </AnimatedPressable>
                </>
              )}
            </View>
          )}
        </View>
      </View>
    </AnimatedPressable>
  );
});

const ALERT_TO_TAB = { expired: 'expired', expiring: 'expiring', low: 'low', critical: 'critical', out: 'out' };

export default function PharmacyStockScreen({ route }) {
  const { pharmacyStock, pharmacyLocation, settings, adjustStock, loading, refreshing, refresh, stockTruncated } = useWarehouse();
  const { canWritePharmacy, canWriteWarehouse } = useAuth();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [tab, setTab] = useState('all');
  const [letter, setLetter] = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [returningItem, setReturningItem] = useState(null);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  // Hard block against a rapid double-tap firing adjustStock twice for the same
  // batch before the first write's compare-and-set has landed.
  const inFlightRef = useRef(new Set());

  // Deep-link from the Alerts screen: ?filter=expired|expiring|low|critical|out.
  const alertFilter = route?.params?.filter;
  useEffect(() => {
    if (alertFilter && ALERT_TO_TAB[alertFilter]) setTab(ALERT_TO_TAB[alertFilter]);
  }, [alertFilter]);

  const openAdd = useCallback(() => { setEditingItem(null); setModalOpen(true); }, []);
  const openEdit = useCallback((item) => { setEditingItem(item); setModalOpen(true); }, []);
  const openReturn = useCallback((item) => setReturningItem(item), []);

  const onAdjust = useCallback(async (id, delta) => {
    if (inFlightRef.current.has(id)) return;
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

  const filtered = useMemo(() => {
    const now = new Date();
    const horizon = new Date(now.getTime() + (settings.expiryAlertDays || 90) * 24 * 60 * 60 * 1000);
    let list = pharmacyStock;
    // Pharmacy thresholds (≤20 units / ≤2 strips), NOT the warehouse bulk
    // threshold — see src/lib/pharmacyStock.js.
    switch (tab) {
      case 'low': list = list.filter(isPharmacyLow); break;
      case 'critical': list = list.filter(isPharmacyCritical); break;
      case 'out': list = list.filter(isPharmacyOutOfStock); break;
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
  }, [pharmacyStock, tab, letter, debouncedSearch, settings.expiryAlertDays]);

  const renderItem = useCallback(({ item }) => (
    <PharmacyStockRow
      item={item}
      styles={styles}
      theme={theme}
      canWrite={canWritePharmacy}
      canReturn={canWriteWarehouse}
      pending={pendingIds.has(item.id)}
      onEdit={openEdit}
      onAdjust={onAdjust}
      onReturn={openReturn}
    />
  ), [styles, theme, canWritePharmacy, canWriteWarehouse, pendingIds, openEdit, onAdjust, openReturn]);

  if (loading) return <ScreenLoading />;

  return (
    <Screen edges={[]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Pharmacy Stock</Text>
            <Text style={styles.subtitle}>
              {pharmacyLocation
                ? `${pharmacyStock.length} products · ${pharmacyLocation.name} — the pharmacy's live billing counter`
                : 'No Pharmacy location configured yet'}
            </Text>
          </View>
          {canWritePharmacy && (
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
        <Text style={styles.thresholdNote}>Low ≤ {PHARMACY_LOW_UNITS} units / ≤ {PHARMACY_LOW_STRIPS} strips · Critical at half that</Text>
        {stockTruncated ? (
          <Text style={styles.truncatedNote}>
            Showing the most-recently-updated items — some older items are not loaded.
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
        keyExtractor={(item, idx) => item.id || String(idx)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
        ListEmptyComponent={
          <EmptyState
            text={
              letter !== 'All'
                ? `No items found starting with "${letter}"`
                : pharmacyLocation ? 'No pharmacy stock yet. Add items with the New Entry button, or transfer them in from the desktop Warehouse app.' : 'No Pharmacy location configured yet'
            }
            icon="💊"
          />
        }
        renderItem={renderItem}
      />

      <AddItemModal visible={modalOpen} item={editingItem} onClose={() => setModalOpen(false)} target="pharmacy" />
      <ReturnStockModal visible={!!returningItem} item={returningItem} onClose={() => setReturningItem(null)} />
    </Screen>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { padding: 16, paddingBottom: 8 },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: t.muted, fontSize: 12, marginBottom: 6 },
  newEntryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 40, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: t.accent,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 3,
  },
  newEntryBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 13 },
  thresholdNote: { color: t.muted, fontSize: 11, marginBottom: 10, fontStyle: 'italic' },
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
  // Same look as the shared <Card> — just without the per-row mount animation.
  itemCard: {
    marginBottom: 10, backgroundColor: t.card, borderRadius: 20, borderWidth: 1, borderColor: t.panelBorder,
    padding: 16, shadowColor: t.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 12, elevation: 2,
  },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  itemName: { color: t.text, fontWeight: '600', fontSize: 15 },
  itemMeta: { color: t.muted, fontSize: 12 },
  stockValue: { color: t.text, fontWeight: '700' },
  adjustRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  returnBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 32,
    paddingHorizontal: 11, borderRadius: 10,
    backgroundColor: `${t.accent}1f`, borderWidth: 1, borderColor: `${t.accent}55`,
  },
  returnBtnText: { color: t.accent, fontSize: 12, fontWeight: '700' },
  adjustBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: t.chip, borderWidth: 1, borderColor: t.panelBorder, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  adjustBtnText: { color: t.text, fontSize: 18, fontWeight: '700' },
});
