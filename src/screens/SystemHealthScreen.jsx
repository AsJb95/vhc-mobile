import { useCallback, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabaseClient';
import { useWarehouse } from '../context/WarehouseContext';
import { usePharmacy } from '../context/PharmacyContext';
import { Card, Screen, AnimatedPressable } from '../components/UI';
import { SectionTitle } from '../components/Bits';
import { formatDateTime, colors } from '../lib/format';

// Operational status only. NEVER shows keys / tokens / credentials.
function Line({ label, ok, detail }) {
  const color = ok == null ? colors.muted : ok ? colors.success : colors.danger;
  const dot = ok == null ? '•' : ok ? '●' : '●';
  return (
    <View style={styles.line}>
      <Text style={[styles.dot, { color }]}>{dot}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.lineLabel}>{label}</Text>
        {detail ? <Text style={styles.lineDetail}>{detail}</Text> : null}
      </View>
      <Text style={[styles.lineState, { color }]}>{ok == null ? 'checking…' : ok ? 'OK' : 'FAIL'}</Text>
    </View>
  );
}

export default function SystemHealthScreen() {
  const warehouse = useWarehouse();
  const pharmacy = usePharmacy();
  const [db, setDb] = useState(null); // { ok, ms, error }
  const [rt, setRt] = useState(null); // realtime channel status string
  const [refreshing, setRefreshing] = useState(false);

  const runChecks = useCallback(async () => {
    // DB reachability — a tiny RLS-safe read.
    const t0 = Date.now();
    const { error } = await supabase.from('locations').select('id').limit(1);
    setDb({ ok: !error, ms: Date.now() - t0, error: error?.message || null });

    // Realtime — subscribe a throwaway channel and record the status.
    setRt('connecting');
    const ch = supabase
      .channel(`healthcheck-${Date.now()}`)
      .subscribe((status) => {
        setRt(status);
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setTimeout(() => supabase.removeChannel(ch), 500);
        }
      });
  }, []);

  useFocusEffect(useCallback(() => { runChecks(); }, [runChecks]));

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([runChecks(), warehouse.refresh(), pharmacy.refresh()]);
    setRefreshing(false);
  };

  const rtOk = rt === 'SUBSCRIBED' ? true : (rt === 'CHANNEL_ERROR' || rt === 'TIMED_OUT') ? false : null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <Card style={styles.card}>
          <SectionTitle>Connectivity</SectionTitle>
          <Line label="Supabase database" ok={db?.ok ?? null} detail={db ? (db.ok ? `Round-trip ${db.ms} ms` : db.error) : null} />
          <Line label="Realtime channel" ok={rtOk} detail={rt ? `status: ${rt}` : null} />
        </Card>

        <Card style={styles.card}>
          <SectionTitle>Pharmacy data sync</SectionTitle>
          <Line
            label="Sales / bills / patients"
            ok={pharmacy.loadError ? false : pharmacy.asOf ? true : null}
            detail={pharmacy.asOf ? `Last successful fetch: ${formatDateTime(pharmacy.asOf)}` : pharmacy.loadError || 'not yet loaded'}
          />
          {pharmacy.salesTruncated ? <Text style={styles.warn}>Live sales window truncated (most-recent bills only).</Text> : null}
        </Card>

        <Card style={styles.card}>
          <SectionTitle>Warehouse data sync</SectionTitle>
          <Line
            label="Stock / orders / transfers"
            ok={warehouse.loadError ? false : warehouse.lastLoadedAt ? true : null}
            detail={warehouse.lastLoadedAt ? `Last successful fetch: ${formatDateTime(warehouse.lastLoadedAt)}` : warehouse.loadError || 'not yet loaded'}
          />
          {warehouse.stockTruncated ? <Text style={styles.warn}>Stock list capped — some older items not loaded.</Text> : null}
        </Card>

        {(pharmacy.loadError || warehouse.loadError) && (
          <Card style={styles.card}>
            <SectionTitle>Current errors</SectionTitle>
            {pharmacy.loadError ? <Text style={styles.errText}>Pharmacy: {pharmacy.loadError}</Text> : null}
            {warehouse.loadError ? <Text style={styles.errText}>Warehouse: {warehouse.loadError}</Text> : null}
          </Card>
        )}

        <AnimatedPressable style={styles.btn} onPress={onRefresh}>
          <Text style={styles.btnText}>Re-run checks</Text>
        </AnimatedPressable>
        <Text style={styles.note}>No credentials, keys or tokens are shown on this screen.</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  card: { marginBottom: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.panelBorder },
  dot: { fontSize: 14 },
  lineLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  lineDetail: { color: colors.muted, fontSize: 11, marginTop: 2 },
  lineState: { fontSize: 12, fontWeight: '800' },
  warn: { color: colors.warning, fontSize: 11, marginTop: 8 },
  errText: { color: colors.danger, fontSize: 12, marginTop: 4 },
  btn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  btnText: { color: '#fff', fontWeight: '700' },
  note: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 12, fontStyle: 'italic' },
});
