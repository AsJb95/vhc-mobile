import { useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { Card, Screen, ScreenLoading, EmptyState, AnimatedPressable, Badge } from '../components/UI';
import { KeyVal } from '../components/Bits';
import { formatCurrency, formatDate, expiryStatus, stockStatus, colors } from '../lib/format';

// Read-only view of the warehouse's user-created sub-stock locations
// (locations.type = 'warehouse_sub'). No location create/rename/delete here —
// that stays in the desktop Warehouse Management app.
export default function SubStockScreen() {
  const { settings, subStocks, getSubStockValue, loading, refreshing, refresh, loadError } = useWarehouse();
  const [openId, setOpenId] = useState(null);

  const locs = useMemo(() => (settings.subStockLocations || []).map((l) => {
    const items = subStocks[l.id] || [];
    const now = new Date();
    const horizon = new Date(now.getTime() + (settings.expiryAlertDays || 90) * 86400000);
    return {
      ...l,
      items,
      qty: items.reduce((s, i) => s + (i.stock || 0), 0),
      value: getSubStockValue(l.id),
      low: items.filter((i) => (i.stock || 0) > 0 && (i.stock || 0) < settings.lowStockThreshold).length,
      out: items.filter((i) => (i.stock || 0) === 0).length,
      expiring: items.filter((i) => i.expiry && new Date(i.expiry) <= horizon && new Date(i.expiry) >= now).length,
    };
  }), [settings.subStockLocations, subStocks, getSubStockValue, settings.expiryAlertDays, settings.lowStockThreshold]);

  if (loading) return <ScreenLoading />;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}
      >
        <Text style={styles.subtitle}>{locs.length} sub-stock location(s)</Text>
        {loadError ? <Text style={styles.err}>Showing cached data — {loadError}</Text> : null}

        {locs.length === 0 ? (
          <EmptyState text="No sub-stock locations configured (add them in the desktop Warehouse app)" icon="🏪" />
        ) : locs.map((l, idx) => {
          const open = openId === l.id;
          return (
            <Card key={l.id} index={idx} style={styles.card}>
              <AnimatedPressable onPress={() => setOpenId(open ? null : l.id)}>
                <View style={styles.rowBetween}>
                  <View style={styles.rowLeft}>
                    <View style={[styles.dot, { backgroundColor: l.color || colors.accent }]} />
                    <Text style={styles.locName}>{l.name}</Text>
                  </View>
                  <Text style={styles.chev}>{open ? '▾' : '▸'}</Text>
                </View>
              </AnimatedPressable>

              <View style={styles.statsRow}>
                <KeyVal label="Items" value={l.items.length} />
                <KeyVal label="Total qty" value={l.qty} />
                <KeyVal label="Value" value={formatCurrency(l.value)} />
              </View>
              <View style={styles.badgeRow}>
                {l.low > 0 ? <Badge label={`${l.low} low`} color={colors.warning} /> : null}
                {l.out > 0 ? <Badge label={`${l.out} out`} color={colors.danger} /> : null}
                {l.expiring > 0 ? <Badge label={`${l.expiring} expiring`} color={colors.accent} /> : null}
              </View>

              {open && (
                <View style={styles.itemList}>
                  {l.items.length === 0 ? (
                    <Text style={styles.muted}>No stock at this location.</Text>
                  ) : l.items.slice(0, 200).map((i) => {
                    const exp = expiryStatus(i.expiry);
                    const st = stockStatus(i.stock, settings.lowStockThreshold);
                    return (
                      <View key={i.id} style={styles.itemRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemName}>{i.name}</Text>
                          <Text style={styles.itemMeta}>
                            Batch {i.batch || '—'} · Exp <Text style={{ color: exp.color }}>{i.expiry ? formatDate(i.expiry) : '—'}</Text>
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.itemQty}>{i.stock}</Text>
                          <Text style={[styles.itemMeta, { color: st.color }]}>{st.label}</Text>
                        </View>
                      </View>
                    );
                  })}
                  {l.items.length > 200 ? <Text style={styles.muted}>+ {l.items.length - 200} more…</Text> : null}
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  subtitle: { color: colors.muted, fontSize: 12, marginBottom: 10 },
  err: { color: colors.warning, fontSize: 12, marginBottom: 10 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  locName: { color: colors.text, fontSize: 16, fontWeight: '800' },
  chev: { color: colors.muted, fontSize: 14 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, gap: 12 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  itemList: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.panelBorder, paddingTop: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.panelBorder },
  itemName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  itemMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  itemQty: { color: colors.text, fontSize: 15, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 12, paddingVertical: 6 },
});
