import { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, ScreenLoading, AnimatedPressable, Screen } from '../components/UI';
import { SectionTitle } from '../components/Bits';
import {
  isPharmacyLow, isPharmacyOutOfStock, PHARMACY_LOW_UNITS, PHARMACY_LOW_STRIPS,
} from '../lib/pharmacyStock';

// Alerts, split by inventory. Each row is a live count from the current stock
// arrays (no hardcoding); tapping opens that inventory screen pre-filtered.
export default function AlertsScreen({ navigation }) {
  const { getAlerts, mainStock, pharmacyStock, settings, loading, refreshing, refresh } = useWarehouse();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Pharmacy — pharmacy thresholds, counts computed exactly as the Pharmacy
  // Stock tabs do so the numbers here and there always agree.
  const ph = useMemo(() => {
    const now = Date.now();
    const horizon = now + (settings.expiryAlertDays || 90) * 24 * 60 * 60 * 1000;
    let expired = 0, expiring = 0, low = 0, out = 0;
    for (const i of pharmacyStock) {
      if (isPharmacyOutOfStock(i)) out += 1;
      else if (isPharmacyLow(i)) low += 1;
      if (i.expiry) {
        const e = new Date(i.expiry).getTime();
        if (Number.isFinite(e)) {
          if (e < now) expired += 1;
          else if (e <= horizon) expiring += 1;
        }
      }
    }
    return { expired, expiring, low, out };
  }, [pharmacyStock, settings.expiryAlertDays]);

  // Warehouse — warehouse bulk threshold. getAlerts() already buckets exactly
  // as the Main Stock tabs do.
  const wh = useMemo(() => {
    const a = getAlerts();
    return { expired: a.expired.length, expiring: a.expiring.length, low: a.lowStock.length, out: a.outOfStock.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainStock, settings.lowStockThreshold, settings.expiryAlertDays]);

  const goPharmacy = (filter) => navigation.navigate('Pharmacy', { screen: 'Pharmacy Stock', params: { filter } });
  const goWarehouse = (filter) => navigation.navigate('Warehouse', { screen: 'Main Stock', params: { filter } });

  if (loading) return <ScreenLoading />;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
      >
        <Text style={styles.title}>Alerts</Text>

        <Card style={styles.card}>
          <SectionTitle>Pharmacy Inventory</SectionTitle>
          <Text style={styles.note}>Low ≤ {PHARMACY_LOW_UNITS} units / ≤ {PHARMACY_LOW_STRIPS} strips · Expiry within {settings.expiryAlertDays} days</Text>
          <View style={styles.grid}>
            <AlertRow styles={styles} label="Expired" value={ph.expired} color={theme.danger} mutedColor={theme.muted} onPress={() => goPharmacy('expired')} />
            <AlertRow styles={styles} label="Expiring Soon" value={ph.expiring} color={theme.accent} mutedColor={theme.muted} onPress={() => goPharmacy('expiring')} />
            <AlertRow styles={styles} label="Low Stock" value={ph.low} color={theme.warning} mutedColor={theme.muted} onPress={() => goPharmacy('low')} />
            <AlertRow styles={styles} label="Out of Stock" value={ph.out} color={theme.danger} mutedColor={theme.muted} onPress={() => goPharmacy('out')} />
          </View>
        </Card>

        <Card style={styles.card}>
          <SectionTitle>Warehouse Inventory</SectionTitle>
          <Text style={styles.note}>Low &lt; {settings.lowStockThreshold} units · Expiry within {settings.expiryAlertDays} days</Text>
          <View style={styles.grid}>
            <AlertRow styles={styles} label="Expired" value={wh.expired} color={theme.danger} mutedColor={theme.muted} onPress={() => goWarehouse('expired')} />
            <AlertRow styles={styles} label="Expiring Soon" value={wh.expiring} color={theme.accent} mutedColor={theme.muted} onPress={() => goWarehouse('expiring')} />
            <AlertRow styles={styles} label="Low Stock" value={wh.low} color={theme.warning} mutedColor={theme.muted} onPress={() => goWarehouse('low')} />
            <AlertRow styles={styles} label="Out of Stock" value={wh.out} color={theme.danger} mutedColor={theme.muted} onPress={() => goWarehouse('out')} />
          </View>
        </Card>

        <Text style={styles.hint}>Tap a row to open that inventory filtered to the alert.</Text>
      </ScrollView>
    </Screen>
  );
}

function AlertRow({ styles, label, value, color, mutedColor, onPress }) {
  return (
    <AnimatedPressable style={styles.row} onPress={onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={[styles.rowValue, { color: value > 0 ? color : mutedColor }]}>{value}</Text>
        <Text style={styles.rowChev}>›</Text>
      </View>
    </AnimatedPressable>
  );
}

const makeStyles = (t) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  title: { color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginBottom: 12 },
  card: { marginBottom: 12 },
  note: { color: t.muted, fontSize: 11, fontStyle: 'italic', marginTop: -4, marginBottom: 6 },
  grid: { marginTop: 4 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.panelBorder,
  },
  rowLabel: { color: t.text, fontSize: 15, fontWeight: '600' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowValue: { fontSize: 20, fontWeight: '800', minWidth: 28, textAlign: 'right' },
  rowChev: { color: t.muted, fontSize: 18, fontWeight: '700' },
  hint: { color: t.muted, fontSize: 11, fontStyle: 'italic', marginTop: 4 },
});
