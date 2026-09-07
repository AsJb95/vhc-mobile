import { useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Screen, ScreenLoading, EmptyState, AnimatedPressable, Badge } from '../components/UI';
import { KeyVal } from '../components/Bits';
import { formatCurrency, formatDate, expiryStatus, stockStatus } from '../lib/format';
import { classifyPharmacyStock, pharmacyStockStatus } from '../lib/pharmacyStock';

// Read-only view of stock at non-main locations:
//   * the Pharmacy (locations.type = 'pharmacy_counter') — the SAME live
//     inventory as Pharmacy → Pharmacy Stock (same rows, batches, expiry,
//     quantities), shown here so warehouse staff see it alongside sub-stock.
//   * the warehouse's user-created sub-stock locations (type = 'warehouse_sub').
// Retired locations are filtered out upstream in WarehouseContext.
export default function SubStockScreen() {
  const {
    settings, subStocks, pharmacyLocation, pharmacyStock,
    loading, refreshing, refresh, loadError,
  } = useWarehouse();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [openId, setOpenId] = useState(null);

  const locs = useMemo(() => {
    const now = Date.now();
    const horizonMs = now + (settings.expiryAlertDays || 90) * 86400000;
    const lowT = settings.lowStockThreshold;

    const sumQtyValue = (items) => {
      let qty = 0, value = 0;
      for (const i of items) { const s = i.stock || 0; qty += s; value += s * (i.netRate || 0); }
      return { qty, value };
    };

    const out = [];

    // The Pharmacy — same array Pharmacy Stock reads, classified with the
    // pharmacy thresholds so every number matches that screen.
    if (pharmacyLocation) {
      const items = pharmacyStock;
      const c = classifyPharmacyStock(items, settings.expiryAlertDays);
      out.push({
        id: pharmacyLocation.id,
        name: pharmacyLocation.name,
        color: theme.purple,
        isPharmacy: true,
        items,
        ...sumQtyValue(items),
        low: c.low.length,
        critical: c.critical.length,
        out: c.outOfStock.length,
        expiring: c.expiring.length,
      });
    }

    // Real warehouse sub-stock locations — warehouse bulk threshold.
    for (const l of settings.subStockLocations || []) {
      const items = subStocks[l.id] || [];
      let low = 0, outCount = 0, expiring = 0;
      for (const i of items) {
        const s = i.stock || 0;
        if (s === 0) outCount += 1;
        else if (s < lowT) low += 1;
        if (i.expiry) {
          const e = new Date(i.expiry).getTime();
          if (e >= now && e <= horizonMs) expiring += 1;
        }
      }
      out.push({ id: l.id, name: l.name, color: l.color, isPharmacy: false, items, ...sumQtyValue(items), low, critical: 0, out: outCount, expiring });
    }
    return out;
  }, [settings.subStockLocations, settings.expiryAlertDays, settings.lowStockThreshold, subStocks, pharmacyLocation, pharmacyStock, theme.purple]);

  if (loading) return <ScreenLoading />;

  return (
    <Screen edges={[]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
      >
        <Text style={styles.subtitle}>{locs.length} location(s)</Text>
        <Text style={styles.note}>
          &ldquo;{pharmacyLocation ? pharmacyLocation.name : 'VHC Pharmacy'}&rdquo; is the same live inventory shown
          in Pharmacy → Pharmacy Stock. The rest are warehouse sub-stock pools.
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
                    {l.isPharmacy ? <Text style={styles.tag}>Pharmacy</Text> : null}
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
                {l.critical > 0 ? <Badge label={`${l.critical} critical`} color={theme.danger} /> : null}
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
                    const st = l.isPharmacy ? pharmacyStockStatus(i, theme) : stockStatus(i.stock, settings.lowStockThreshold);
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
  locName: { color: t.text, fontSize: 16, fontWeight: '800', flexShrink: 1 },
  tag: {
    color: t.purple, fontSize: 10, fontWeight: '800', letterSpacing: 0.4,
    borderWidth: 1, borderColor: `${t.purple}66`, backgroundColor: `${t.purple}1f`,
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden',
  },
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
