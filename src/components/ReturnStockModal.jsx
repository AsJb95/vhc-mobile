import { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, AnimatedPressable, Card } from './UI';
import { FormField } from './FormField';
import { useWarehouse } from '../context/WarehouseContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { formatDate } from '../lib/format';

// "Return Stock to Warehouse" for ONE Pharmacy counter batch row. Mirrors
// MoveStockModal, in reverse: the pharmacy user picks how many units of this
// batch to send back and why. Submitting creates a PENDING transfer_orders row
// (from = pharmacy_counter, to = main warehouse) and changes NO stock — the
// Warehouse then Accepts it in Warehouse -> Pending Returns (deduct Pharmacy
// Stock, add Main Stock) or Rejects it (no change). Same tables, same
// Pending/Completed/Rejected flow as the Warehouse -> Pharmacy transfer.
export default function ReturnStockModal({ visible, item, onClose }) {
  const { createStockReturnRequest } = useWarehouse();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setQty('');
      setReason('');
      setSaving(false);
    }
  }, [visible, item?.id]);

  const available = Math.max(0, Number(item?.stock) || 0);
  const qNum = parseInt(qty, 10) || 0;
  const exceeds = qNum > available;
  const reasonOk = reason.trim().length >= 3;
  const canReturn = qNum > 0 && !exceeds && reasonOk && !saving;

  async function submit() {
    if (qNum <= 0) { Alert.alert('Enter a quantity', 'Quantity to return must be at least 1.'); return; }
    if (qNum > available) {
      Alert.alert('Not enough stock', `Only ${available} unit(s) of "${item.name}" are in Pharmacy Stock.`);
      return;
    }
    if (!reasonOk) { Alert.alert('Add a reason', 'Briefly say why this stock is being returned (mistake, not required, damaged, expiring, …).'); return; }

    setSaving(true);
    try {
      const detail = `${qNum} × ${item.name}${item.batch ? ` [batch ${item.batch}]` : ''}`;
      const res = await createStockReturnRequest({
        transferDate: new Date().toISOString().slice(0, 10),
        notes: `Return (mobile): ${detail} → Main Warehouse — ${reason.trim()}`,
        items: [{ mainStockId: item.id, qty: qNum }],
      });
      if (res && res.ok) {
        Alert.alert(
          'Return request sent',
          `${res.transferNumber}\n\n` +
            `${qNum} unit(s) of "${item.name}" requested for return to Main Warehouse.\n\n` +
            'No stock has changed. The Warehouse accepts it in Warehouse → Pending Returns — only then ' +
            'is Pharmacy Stock reduced and Main Stock increased. Rejecting it changes nothing.',
        );
        onClose();
      }
    } catch {
      // the context already surfaced the exact error via an alert; leave open to retry
    } finally {
      setSaving(false);
    }
  }

  if (!item) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Return Stock to Warehouse</Text>

          <Card style={styles.itemCard}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemMeta}>
              Batch {item.batch || '—'}
              {item.expiry ? ` · Exp ${formatDate(item.expiry)}` : ''}
            </Text>
            <Text style={styles.available}>In Pharmacy Stock: <Text style={styles.availableNum}>{available}</Text> unit(s)</Text>
          </Card>

          <Text style={styles.destLine}>Returning to: <Text style={styles.destStrong}>Main Warehouse</Text></Text>
          <Text style={styles.pendingHint}>
            This creates a <Text style={styles.pendingHintStrong}>pending return request</Text> and changes no stock. The
            Warehouse must Accept it (in Warehouse → Pending Returns) before Pharmacy Stock is reduced and Main Stock is
            increased.
          </Text>

          <FormField
            label="Quantity to return *"
            keyboardType="numeric"
            placeholder={`1 – ${available}`}
            value={qty}
            onChangeText={setQty}
          />
          {exceeds ? <Text style={styles.errorText}>Cannot return more than the {available} available.</Text> : null}

          <FormField
            label="Return reason / notes *"
            placeholder="e.g. transferred by mistake, no longer required, damaged, near expiry"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
            style={styles.reasonInput}
          />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          <AnimatedPressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </AnimatedPressable>
          <AnimatedPressable style={[styles.returnBtn, !canReturn && styles.returnBtnDisabled]} onPress={submit} disabled={!canReturn}>
            <Text style={styles.returnBtnText}>{saving ? 'Working…' : 'Request Return'}</Text>
          </AnimatedPressable>
        </View>
      </Screen>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  title: { color: t.text, fontSize: 22, fontWeight: '800', marginBottom: 16 },
  itemCard: { marginBottom: 16 },
  itemName: { color: t.text, fontSize: 16, fontWeight: '700' },
  itemMeta: { color: t.muted, fontSize: 12, marginTop: 3 },
  available: { color: t.muted, fontSize: 13, marginTop: 10 },
  availableNum: { color: t.text, fontWeight: '800' },
  destLine: { color: t.muted, fontSize: 13, marginBottom: 6 },
  destStrong: { color: t.text, fontWeight: '800' },
  pendingHint: { color: t.muted, fontSize: 12, lineHeight: 17, marginBottom: 14 },
  pendingHintStrong: { color: t.warning, fontWeight: '800' },
  reasonInput: { minHeight: 74, textAlignVertical: 'top' },
  errorText: { color: t.danger, fontSize: 12, marginTop: -4, marginBottom: 8 },
  footer: {
    flexDirection: 'row', gap: 14,
    paddingHorizontal: 16, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: t.panelBorder, backgroundColor: t.bg,
  },
  cancelBtn: {
    flex: 1, minHeight: 54, backgroundColor: t.panel, borderWidth: 1, borderColor: t.panelBorder,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { color: t.text, fontWeight: '700', fontSize: 16 },
  returnBtn: {
    flex: 1, minHeight: 54, backgroundColor: t.accent,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  returnBtnDisabled: { opacity: 0.45 },
  returnBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 16 },
});
