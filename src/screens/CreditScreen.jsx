import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { usePharmacy } from '../context/PharmacyContext';
import { Card, Screen, EmptyState, ScreenLoading } from '../components/UI';
import { KeyVal } from '../components/Bits';
import { formatCurrency, formatDate, colors } from '../lib/format';
import { creditBills } from '../lib/pharmacyReports';

export default function CreditScreen() {
  const { role } = useAuth();
  const { fetchCreditBills } = usePharmacy();
  const [state, setState] = useState({ loading: true, error: null, bills: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const authorized = role === 'admin' || role === 'pharmacist';

  const load = useCallback(async () => {
    const res = await fetchCreditBills();
    setState({ loading: false, error: res.error, bills: res.sales || [] });
  }, [fetchCreditBills]);

  // Always re-load on focus so an old list is never shown as current.
  useFocusEffect(useCallback(() => {
    if (!authorized) { setState({ loading: false, error: null, bills: [] }); return; }
    setState((s) => ({ ...s, loading: true }));
    load();
  }, [authorized, load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const summary = useMemo(() => creditBills(state.bills), [state.bills]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? summary.bills.filter((b) => (b.patientName || '').toLowerCase().includes(s) || (b.billId || '').toLowerCase().includes(s)) : summary.bills;
  }, [summary.bills, search]);

  if (!authorized) {
    return <Screen><View style={styles.header}><EmptyState text="Credit information is restricted to pharmacist and admin roles." icon="🔒" /></View></Screen>;
  }
  if (state.loading) return <ScreenLoading />;

  return (
    <Screen>
      <View style={styles.header}>
        <Card style={styles.summaryCard}>
          <KeyVal label="Total billed as Credit" value={formatCurrency(summary.total)} strong color={colors.warning} />
          <KeyVal label="Credit bills" value={summary.count} />
          <Text style={styles.caveat}>
            This is <Text style={styles.bold}>outstanding credit billed</Text>, not a repayment ledger. The
            Pharmacy POS does not currently track part-payments or settlements, so every Credit-mode bill
            ever recorded is listed here.
          </Text>
        </Card>
        {state.error ? <Text style={styles.err}>Could not load — {state.error}</Text> : null}
        <TextInput
          style={styles.search}
          placeholder="Search patient or bill #…"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={<EmptyState text="No Credit-mode bills" icon="💳" />}
        renderItem={({ item, index }) => (
          <Card index={index} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.patient}>{item.patientName}</Text>
              <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
            </View>
            <Text style={styles.meta}>Bill {item.billId || '—'} · {formatDate(item.date)} · {item.paymentMode}</Text>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, paddingBottom: 6 },
  summaryCard: { marginBottom: 12 },
  caveat: { color: colors.muted, fontSize: 11, marginTop: 10, lineHeight: 16 },
  bold: { fontWeight: '800', color: colors.text },
  err: { color: colors.danger, fontSize: 12, marginBottom: 8 },
  search: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10,
    color: colors.text, paddingHorizontal: 14, paddingVertical: 10,
  },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  card: { marginBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  patient: { color: colors.text, fontWeight: '700', fontSize: 15, flex: 1, marginRight: 8 },
  amount: { color: colors.warning, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 12 },
});
