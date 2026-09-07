import { useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Screen, ScreenLoading, EmptyState, AnimatedPressable, Badge } from '../components/UI';
import { KeyVal } from '../components/Bits';
import { formatCurrency, formatDate, expiryStatus, stockStatus } from '../lib/format';

// Read-only view of the warehouse's user-created sub-stock locations
// (locations.type = 'warehouse_sub'). No location create/rename/delete here —
// that stays in the desktop Warehouse Management app.
export default function SubStockScreen() {
  const { settings, subStocks, loading, refreshing, refresh, loadError } = useWarehouse();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [openId, setOpenId] = useState(null);

  // One pass per location instead of five array walks — computes qty, value, and
  // the low/out/expiring counts together. Recomputes only when the underlying
  // sub-stock data or the thresholds change.
  const locs = useMemo(() => {
    const now = Date.now();
    const horizonMs = now + (settings.expiryAlertDays || 90) * 86400000;
    const lowT = settings.lowStockThreshold;
    return (settings.subStockLocations || []).map((l) => {
      const items = subStocks[l.id] || [];
      let qty = 0, value = 0, low = 0, out = 0, expiring = 0;
      for (const i of items) {
        const s = i.stock || 0;
        qty += s;
        value += s * (i.netRate || 0);
        if (s === 0) out += 1;
        else if (s < lowT) low += 1;
        if (i.expiry) {
          const e = new Date(i.expiry).getTime();
          if (e >= now && e <= horizonMs) expiring += 1;
        }
      }
      return { ...l, items, qty, value, low, out, expiring };
    });
  }, [settings.subStockLocations, subStocks, settings.expiryAlertDays, settings.lowStockThreshold]);

  if (loading) return <ScreenLoading />;

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
      >
        <Text style={styles.subtitle}>{locs.length} warehouse sub-stock location(s)</Text>
        <Text style={styles.note}>
          These are warehouse sub-stock pools. The pharmacy&apos;s live billing stock is separate —
          see Pharmacy → Pharmacy Stock.
        </Text>
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
                    <View style={[styles.dot, { backgroundColor: l.color || theme.accent }]} />
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
                {l.low > 0 ? <Badge label={`${l.low} low`} color={theme.warning} /> : null}
                {l.out > 0 ? <Badge label={`${l.out} out`} color={theme.danger} /> : null}
                {l.expiring > 0 ? <Badge label={`${l.expiring} expiring`} color={theme.accent} /> : null}
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

const makeStyles = (t) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  subtitle: { color: t.muted, fontSize: 12, marginBottom: 4 },
  note: { color: t.muted, fontSize: 11, fontStyle: 'italic', marginBottom: 12, lineHeight: 15 },
  err: { color: t.warning, fontSize: 12, marginBottom: 10 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  locName: { color: t.text, fontSize: 16, fontWeight: '800' },
  chev: { color: t.muted, fontSize: 14 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, gap: 12 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  itemList: { marginTop: 12, borderTopWidth: 1, borderTopColor: t.panelBorder, paddingTop: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.panelBorder },
  itemName: { color: t.text, fontSize: 14, fontWeight: '600' },
  itemMeta: { color: t.muted, fontSize: 11, marginTop: 2 },
  itemQty: { color: t.text, fontSize: 15, fontWeight: '800' },
  muted: { color: t.muted, fontSize: 12, paddingVertical: 6 },
});
