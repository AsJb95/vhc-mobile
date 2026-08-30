import { useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useWarehouse } from '../context/WarehouseContext';
import { useAuth } from '../context/AuthContext';
import { Card, Badge, EmptyState, ScreenLoading, AnimatedPressable, Screen } from '../components/UI';
import AddItemModal from '../components/AddItemModal';
import { formatCurrency, expiryStatus, stockStatus, colors } from '../lib/format';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low' },
  { key: 'out', label: 'Out' },
  { key: 'expiring', label: 'Expiring' },
  { key: 'expired', label: 'Expired' },
];

export default function StockScreen() {
  const { mainStock, settings, adjustStock, loading, refreshing, refresh, stockTruncated } = useWarehouse();
  const { canWriteWarehouse } = useAuth();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  function openAdd() { setEditingItem(null); setModalOpen(true); }
  function openEdit(item) { setEditingItem(item); setModalOpen(true); }

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
          placeholderTextColor={colors.muted}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
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
          <Ionicons name="add" size={28} color="#fff" />
        </AnimatedPressable>
      )}

      <AddItemModal visible={modalOpen} item={editingItem} onClose={() => setModalOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { padding: 16, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: colors.muted, fontSize: 12, marginBottom: 12 },
  truncatedNote: { color: colors.warning, fontSize: 11, marginBottom: 10 },
  search: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10,
    color: colors.text, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tabBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, marginRight: 6, marginBottom: 6 },
  tabBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 12 },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  itemName: { color: colors.text, fontWeight: '600', fontSize: 15 },
  itemMeta: { color: colors.muted, fontSize: 12 },
  stockValue: { color: colors.text, fontWeight: '700' },
  adjustRow: { flexDirection: 'row', gap: 8 },
  adjustBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.panelBorder, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  adjustBtnText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
});
