import { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { usePharmacy } from '../context/PharmacyContext';
import { Card, Screen, EmptyState, AnimatedPressable, Badge } from '../components/UI';
import { KeyVal, SectionTitle } from '../components/Bits';
import { formatCurrency, formatDateTime, formatDate, colors } from '../lib/format';
import { paymentBucket } from '../lib/pharmacyReports';

export default function PatientLookupScreen() {
  const { role } = useAuth();
  const { searchPatients, fetchPatientHistory } = usePharmacy();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState(null);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState(null); // { sales } | { error } | null
  const [historyLoading, setHistoryLoading] = useState(false);
  const debounceRef = useRef(null);

  const authorized = role === 'admin' || role === 'pharmacist';

  useEffect(() => {
    if (!authorized) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearchErr(null); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const res = await searchPatients(q);
      setResults(res.patients);
      setSearchErr(res.error);
      setSearching(false);
    }, 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [query, authorized, searchPatients]);

  async function openPatient(p) {
    setSelected(p);
    setHistory(null);
    setHistoryLoading(true);
    const res = await fetchPatientHistory(p.id);
    setHistory(res);
    setHistoryLoading(false);
  }

  if (!authorized) {
    return (
      <Screen>
        <View style={styles.header}>
          <EmptyState text="Patient information is restricted to pharmacist and admin roles." icon="🔒" />
        </View>
      </Screen>
    );
  }

  if (selected) {
    const sales = history?.sales || [];
    const totalBilled = sales.reduce((s, b) => s + (Number(b.total_amount) || 0), 0);
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <AnimatedPressable onPress={() => { setSelected(null); setHistory(null); }} style={styles.backBtn}>
            <Text style={styles.backTxt}>‹ Back to results</Text>
          </AnimatedPressable>

          <Text style={styles.name}>{selected.name}</Text>
          {selected.is_manual ? <Badge label="Manually added" color={colors.purple} /> : null}

          <Card style={styles.card}>
            <SectionTitle>Patient</SectionTitle>
            <KeyVal label="Contact" value={selected.contact || '—'} />
            <KeyVal label="Age / Sex" value={`${selected.age ?? '—'} / ${selected.sex || '—'}`} />
            {selected.address ? <KeyVal label="Address" value={selected.address} /> : null}
            <KeyVal label="Source" value={selected.source || '—'} />
            <KeyVal label="First seen" value={formatDate(selected.created_at)} />
          </Card>

          <Card style={styles.card}>
            <SectionTitle right={<Text style={styles.muted}>{sales.length} bill(s)</Text>}>Billing History</SectionTitle>
            <KeyVal label="Total billed (recorded)" value={formatCurrency(totalBilled)} strong />
          </Card>

          {historyLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 20 }} />
          ) : history?.error ? (
            <Text style={styles.err}>Could not load history — {history.error}</Text>
          ) : sales.length === 0 ? (
            <EmptyState text="No bills recorded for this patient" icon="🧾" />
          ) : (
            sales.map((b) => (
              <Card key={b.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <Text style={styles.billId}>{b.bill_id || '—'}</Text>
                  <Text style={styles.billTotal}>{formatCurrency(b.total_amount)}</Text>
                </View>
                <Text style={styles.meta}>{formatDateTime(b.sale_date)} · {paymentBucket(b.payment_mode)}</Text>
                {(b.sale_items || []).map((it, i) => (
                  <Text key={i} style={styles.itemLine}>
                    • {it.drug_name} × {it.quantity} — {formatCurrency(it.total)}
                  </Text>
                ))}
              </Card>
            ))
          )}
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder="Search patient by name or contact…"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />
        <Text style={styles.hint}>Read-only. Minimum 2 characters. Merged records are hidden.</Text>
      </View>

      {searching ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : searchErr ? (
        <Text style={styles.err}>Search failed — {searchErr}</Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            query.trim().length >= 2
              ? <EmptyState text="No matching patients" icon="🔍" />
              : <EmptyState text="Type a name or phone number to search" icon="👤" />
          }
          renderItem={({ item, index }) => (
            <AnimatedPressable onPress={() => openPatient(item)}>
              <Card index={index} style={styles.card}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.contact || 'no contact'} · {item.age ?? '—'}/{item.sex || '—'}{item.source ? ` · ${item.source}` : ''}
                </Text>
              </Card>
            </AnimatedPressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, paddingBottom: 6 },
  content: { padding: 16, paddingBottom: 40 },
  search: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10,
    color: colors.text, paddingHorizontal: 14, paddingVertical: 12,
  },
  hint: { color: colors.muted, fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  card: { marginBottom: 10 },
  name: { color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 4 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  muted: { color: colors.muted, fontSize: 12 },
  err: { color: colors.danger, fontSize: 13, padding: 16 },
  backBtn: { marginBottom: 10 },
  backTxt: { color: colors.accent, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  billId: { color: colors.text, fontWeight: '700' },
  billTotal: { color: colors.text, fontWeight: '800' },
  itemLine: { color: colors.muted, fontSize: 12, marginTop: 3 },
});
