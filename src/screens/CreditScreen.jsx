import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl, Modal } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { usePharmacy } from '../context/PharmacyContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Screen, EmptyState, AnimatedPressable } from '../components/UI';
import { KeyVal, ChipTabs } from '../components/Bits';
import { formatCurrency as currency, formatDateTime } from '../lib/format';
import { paymentAmount } from '../lib/management';

const formatCurrency = (amount) => currency(amount, 2);

export default function CreditScreen() {
  const { canManageCredit } = useAuth();
  const { creditLedger, creditError, refreshCredit, collectPayment } = usePharmacy();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('Pending');
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('Cash');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef(null);
  const submitting = useRef(false);
  useFocusEffect(useCallback(() => { if (canManageCredit) refreshCredit(); }, [canManageCredit, refreshCredit]));
  const bill = creditLedger?.bills.find((b) => b.id === selected);
  const filtered = useMemo(() => (creditLedger?.bills || []).filter((b) => {
    const match = `${b.patient_name || ''} ${b.bill_id || ''}`.toLowerCase().includes(search.trim().toLowerCase());
    return match && (filter === 'All' || (filter === 'Pending' ? b.balance > 0 : b.balance === 0));
  }).sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date)), [creditLedger, search, filter]);
  const refresh = async () => { setRefreshing(true); await refreshCredit(); setRefreshing(false); };
  const close = () => { if (!submitting.current) { setSelected(null); setMessage(''); request.current = null; } };
  const save = async () => {
    if (submitting.current) return;
    const parsed = paymentAmount(amount);
    if (!parsed || parsed > bill.balance) { setMessage('Enter a valid amount up to the current balance.'); return; }
    submitting.current = true;
    setSaving(true); setMessage('');
    const signature = `${bill.id}|${parsed}|${mode}`;
    if (request.current?.signature !== signature) request.current = { signature, id: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}` };
    try {
      await collectPayment({ saleId: bill.id, amount, mode, requestId: request.current.id });
      request.current = null; setAmount(''); setMessage('Payment recorded.');
    } catch (e) { setMessage(`${e.message || 'Payment failed'}. Retry the same payment if the connection was interrupted.`); }
    finally { submitting.current = false; setSaving(false); }
  };
  if (!canManageCredit) return <Screen><EmptyState text="Credit management requires an admin." /></Screen>;
  return <Screen>
    <View style={styles.header}>
      <Card>
        <KeyVal label="Pending credit" value={creditLedger ? formatCurrency(creditLedger.total) : 'Unavailable'} strong />
        <KeyVal label="Unpaid bills" value={creditLedger?.count ?? '—'} />
        <Text style={styles.meta}>Original credit bills less recorded repayments. Historical collections must be reconciled before use.</Text>
      </Card>
      {creditError ? <Text style={styles.error}>Credit ledger unavailable. {creditError}</Text> : null}
      <TextInput style={styles.input} placeholder="Search patient or bill number" placeholderTextColor={theme.muted} value={search} onChangeText={setSearch} />
      <ChipTabs options={['Pending', 'Paid', 'All']} value={filter} onChange={setFilter} />
    </View>
    <FlatList data={filtered} keyExtractor={(b) => b.id} contentContainerStyle={styles.header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
      ListEmptyComponent={<EmptyState text={creditLedger ? 'No matching credit bills' : 'Pull to refresh credit ledger'} />}
      renderItem={({ item }) => <AnimatedPressable onPress={() => { setSelected(item.id); setAmount(''); setMessage(''); request.current = null; }}>
        <Card style={styles.card}>
          <Text style={styles.title}>{item.patient_name || 'Walk-in'}</Text>
          <Text style={styles.meta}>Bill {item.bill_id} · {formatDateTime(item.sale_date)}</Text>
          <KeyVal label="Bill amount" value={formatCurrency(item.amount)} />
          <KeyVal label="Paid" value={formatCurrency(item.paid)} />
          <KeyVal label="Balance" value={formatCurrency(item.balance)} strong />
          <Text style={styles.link}>{item.balance > 0 ? 'Collect payment / history ›' : 'Repayment history ›'}</Text>
        </Card>
      </AnimatedPressable>} />
    <Modal visible={!!selected} onRequestClose={close} animationType="slide">
      <Screen><FlatList data={bill?.history || []} keyExtractor={(p) => p.id} contentContainerStyle={styles.header}
        ListHeaderComponent={<>
          <Text style={styles.title}>{bill?.patient_name || 'Credit payment'}</Text>
          <Text style={styles.meta}>Bill {bill?.bill_id}</Text>
          <KeyVal label="Current balance" value={bill ? formatCurrency(bill.balance) : 'Unavailable'} />
          {bill?.balance > 0 ? <>
            <TextInput editable={!saving} style={styles.input} keyboardType="decimal-pad" placeholder="Payment amount" placeholderTextColor={theme.muted} value={amount} onChangeText={setAmount} />
            {!saving && <ChipTabs options={['Cash', 'UPI', 'Card']} value={mode} onChange={setMode} />}
            <AnimatedPressable disabled={saving} style={styles.button} onPress={() => setAmount(bill.balance.toFixed(2))}><Text style={styles.link}>Use full balance (Mark paid)</Text></AnimatedPressable>
            <AnimatedPressable disabled={saving} style={styles.button} onPress={save}><Text style={styles.link}>{saving ? 'Recording…' : 'Confirm collection'}</Text></AnimatedPressable>
          </> : null}
          {message ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{message}</Text> : null}
          <Text style={styles.title}>Repayment history</Text>
        </>}
        ListEmptyComponent={<Text style={styles.meta}>No repayments recorded.</Text>}
        renderItem={({ item }) => <Card style={styles.card}><KeyVal label={item.payment_mode} value={formatCurrency(item.amount)} /><Text style={styles.meta}>{formatDateTime(item.created_at)}</Text></Card>} />
        <AnimatedPressable disabled={saving} style={styles.button} onPress={close}><Text style={styles.link}>Close</Text></AnimatedPressable>
      </Screen>
    </Modal>
  </Screen>;
}
const makeStyles = (t) => StyleSheet.create({
  header: { padding: 16 }, card: { marginBottom: 12 }, title: { color: t.text, fontWeight: '800', fontSize: 18, marginVertical: 10 },
  meta: { color: t.muted, fontSize: 12, marginVertical: 6 }, error: { color: t.danger, marginVertical: 8 },
  input: { color: t.text, borderWidth: 1, borderColor: t.panelBorder, borderRadius: 12, padding: 14, marginVertical: 12 },
  link: { color: t.accent, fontWeight: '700' }, button: { padding: 18, alignItems: 'center' },
});
