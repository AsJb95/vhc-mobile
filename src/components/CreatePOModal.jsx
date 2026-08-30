import { useState } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { Screen, AnimatedPressable, Card } from './UI';
import { FormField } from './FormField';
import { useWarehouse } from '../context/WarehouseContext';
import { formatCurrency, colors } from '../lib/format';

const ROW_FIELDS = { name: '', batch: '', expiry: '', qty: '', netRate: '', mrp: '', gst: '12', unitsPerPack: '10', hsnCode: '', stockist: '' };
let rowSeq = 0;
const newRow = () => ({ ...ROW_FIELDS, _uid: `r${++rowSeq}` });

export default function CreatePOModal({ visible, onClose }) {
  const { createPurchaseOrder } = useWarehouse();
  const [supplier, setSupplier] = useState('');
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([newRow()]);
  const [saving, setSaving] = useState(false);

  function updateRow(idx, patch) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeRow(idx) { setRows((prev) => prev.filter((_, i) => i !== idx)); }
  function addRow() { setRows((prev) => [...prev, newRow()]); }

  const lineAmount = (r) => (parseFloat(r.qty) || 0) * (parseFloat(r.netRate) || 0);
  const subtotal = rows.reduce((sum, r) => sum + lineAmount(r), 0);
  const gstTotal = rows.reduce((sum, r) => sum + lineAmount(r) * ((parseFloat(r.gst) || 0) / 100), 0);
  const total = subtotal + gstTotal;

  function reset() {
    setSupplier(''); setPoDate(new Date().toISOString().slice(0, 10)); setExpectedDelivery(''); setNotes(''); setRows([newRow()]);
  }

  async function submit() {
    if (!supplier.trim()) { Alert.alert('Missing supplier', 'Supplier / Stockist is required.'); return; }
    const items = rows.filter((r) => r.name.trim() && (parseFloat(r.qty) || 0) > 0);
    if (items.length === 0) { Alert.alert('No items', 'Add at least one item with a name and quantity.'); return; }

    setSaving(true);
    try {
      await createPurchaseOrder({
        supplier: supplier.trim(), poDate, expectedDelivery, notes,
        items: items.map((r) => ({
          ...r, qty: parseFloat(r.qty) || 0, netRate: parseFloat(r.netRate) || 0, mrp: parseFloat(r.mrp) || 0,
          gst: parseFloat(r.gst) || 12, unitsPerPack: parseInt(r.unitsPerPack, 10) || 10,
        })),
        totals: { subtotal, gstTotal, total },
      });
      reset();
      onClose();
    } catch {
      // error already surfaced
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Create Purchase Order</Text>

          <FormField label="Supplier / Stockist *" value={supplier} onChangeText={setSupplier} />
          <View style={styles.row}>
            <FormField containerStyle={styles.half} label="PO Date" value={poDate} onChangeText={setPoDate} />
            <FormField containerStyle={styles.half} label="Expected Delivery" placeholder="YYYY-MM-DD" value={expectedDelivery} onChangeText={setExpectedDelivery} />
          </View>
          <FormField label="Notes / Terms" value={notes} onChangeText={setNotes} />

          <Text style={styles.sectionTitle}>Order Items</Text>
          {rows.map((row, idx) => (
            <Card key={row._uid} style={styles.rowCard}>
              <FormField label="Medicine / Product" value={row.name} onChangeText={(v) => updateRow(idx, { name: v })} />
              <View style={styles.row}>
                <FormField containerStyle={styles.half} label="Batch" value={row.batch} onChangeText={(v) => updateRow(idx, { batch: v })} />
                <FormField containerStyle={styles.half} label="Expiry" placeholder="YYYY-MM-DD" value={row.expiry} onChangeText={(v) => updateRow(idx, { expiry: v })} />
              </View>
              <View style={styles.row}>
                <FormField containerStyle={styles.half} label="Qty" keyboardType="numeric" value={row.qty} onChangeText={(v) => updateRow(idx, { qty: v })} />
                <FormField containerStyle={styles.half} label="Net Rate" keyboardType="decimal-pad" value={row.netRate} onChangeText={(v) => updateRow(idx, { netRate: v })} />
              </View>
              <View style={styles.row}>
                <FormField containerStyle={styles.half} label="MRP" keyboardType="decimal-pad" value={row.mrp} onChangeText={(v) => updateRow(idx, { mrp: v })} />
                <FormField containerStyle={styles.half} label="GST %" keyboardType="numeric" value={row.gst} onChangeText={(v) => updateRow(idx, { gst: v })} />
              </View>
              <View style={styles.rowFooter}>
                <Text style={styles.amount}>{formatCurrency(lineAmount(row))}</Text>
                {rows.length > 1 && (
                  <AnimatedPressable onPress={() => removeRow(idx)}>
                    <Text style={styles.removeText}>Remove</Text>
                  </AnimatedPressable>
                )}
              </View>
            </Card>
          ))}
          <AnimatedPressable style={styles.addRowBtn} onPress={addRow}>
            <Text style={styles.addRowText}>+ Add Item</Text>
          </AnimatedPressable>

          <Card style={{ marginTop: 12 }}>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalValue}>{formatCurrency(subtotal)}</Text></View>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>GST</Text><Text style={styles.totalValue}>{formatCurrency(gstTotal)}</Text></View>
            <View style={styles.totalRow}><Text style={styles.grandLabel}>Total</Text><Text style={styles.grandValue}>{formatCurrency(total)}</Text></View>
          </Card>
        </ScrollView>

        <View style={styles.footer}>
          <AnimatedPressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.saveBtn} onPress={submit} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? 'Creating...' : 'Create PO'}</Text>
          </AnimatedPressable>
        </View>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  sectionTitle: { color: colors.text, fontWeight: '700', fontSize: 15, marginTop: 8, marginBottom: 10 },
  rowCard: { marginBottom: 10 },
  rowFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  amount: { color: colors.text, fontWeight: '700' },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  addRowBtn: { alignItems: 'center', padding: 12, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10, borderStyle: 'dashed', marginBottom: 8 },
  addRowText: { color: colors.accent, fontWeight: '600' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  totalLabel: { color: colors.muted, fontSize: 13 },
  totalValue: { color: colors.text, fontSize: 13 },
  grandLabel: { color: colors.text, fontWeight: '700' },
  grandValue: { color: colors.text, fontWeight: '700' },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.panelBorder },
  cancelBtn: { flex: 1, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: colors.text, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});
