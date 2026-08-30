import { useState } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { Screen, AnimatedPressable, Card } from './UI';
import { FormField } from './FormField';
import SelectModal from './SelectModal';
import { useWarehouse } from '../context/WarehouseContext';
import { colors } from '../lib/format';

let rowSeq = 0;
const newRow = () => ({ mainStockId: '', qty: '', _uid: `r${++rowSeq}` });

export default function CreateTransferModal({ visible, onClose }) {
  const { mainStock, settings, createTransferOrder } = useWarehouse();
  const [toLocationId, setToLocationId] = useState('');
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([newRow()]);
  const [saving, setSaving] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [itemPickerRowIdx, setItemPickerRowIdx] = useState(null);

  const availableStock = mainStock.filter((i) => (i.stock || 0) > 0);
  const selectedLocation = settings.subStockLocations.find((l) => l.id === toLocationId);

  function updateRow(idx, patch) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removeRow(idx) { setRows((prev) => prev.filter((_, i) => i !== idx)); }
  function addRow() { setRows((prev) => [...prev, newRow()]); }

  function reset() {
    setToLocationId(''); setTransferDate(new Date().toISOString().slice(0, 10)); setNotes(''); setRows([newRow()]);
  }

  async function submit() {
    if (!toLocationId) { Alert.alert('Missing location', 'Choose a destination location.'); return; }
    const valid = rows.filter((r) => r.mainStockId && (parseInt(r.qty, 10) || 0) > 0);
    if (valid.length === 0) { Alert.alert('No items', 'Add at least one item with a quantity.'); return; }

    for (const row of valid) {
      const item = mainStock.find((i) => i.id === row.mainStockId);
      const qty = parseInt(row.qty, 10);
      if (!item || qty > (item.stock || 0)) {
        Alert.alert('Insufficient stock', `"${item?.name}" — available ${item?.stock || 0}, requested ${qty}`);
        return;
      }
    }

    setSaving(true);
    try {
      await createTransferOrder({
        toLocationId,
        toLocationName: selectedLocation?.name || toLocationId,
        transferDate,
        notes,
        items: valid.map((r) => {
          const item = mainStock.find((i) => i.id === r.mainStockId);
          return { mainStockId: r.mainStockId, name: item?.name || '', batch: item?.batch || '', expiry: item?.expiry || '', mrp: item?.mrp || 0, netRate: item?.netRate || 0, qty: parseInt(r.qty, 10) };
        }),
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
          <Text style={styles.title}>Create Transfer Order</Text>

          <Text style={styles.label}>Transfer To Location *</Text>
          <AnimatedPressable style={styles.picker} onPress={() => setLocationPickerOpen(true)}>
            <Text style={selectedLocation ? styles.pickerText : styles.pickerPlaceholder}>
              {selectedLocation ? selectedLocation.name : 'Select location...'}
            </Text>
          </AnimatedPressable>

          <FormField label="Transfer Date" value={transferDate} onChangeText={setTransferDate} />
          <FormField label="Notes / Remarks" value={notes} onChangeText={setNotes} />

          <Text style={styles.sectionTitle}>Items to Transfer</Text>
          {rows.map((row, idx) => {
            const selected = mainStock.find((i) => i.id === row.mainStockId);
            const qty = parseInt(row.qty, 10) || 0;
            const exceeds = selected && qty > (selected.stock || 0);
            return (
              <Card key={row._uid} style={styles.rowCard}>
                <Text style={styles.label}>Item</Text>
                <AnimatedPressable style={styles.picker} onPress={() => setItemPickerRowIdx(idx)}>
                  <Text style={selected ? styles.pickerText : styles.pickerPlaceholder}>
                    {selected ? `${selected.name} [${selected.batch || '—'}]` : 'Select item...'}
                  </Text>
                </AnimatedPressable>
                <Text style={styles.availableText}>Available: {selected ? selected.stock : '—'}</Text>
                <FormField label="Transfer Qty *" keyboardType="numeric" value={row.qty} onChangeText={(v) => updateRow(idx, { qty: v })} />
                {exceeds && <Text style={styles.errorText}>Exceeds available stock</Text>}
                {rows.length > 1 && (
                  <AnimatedPressable onPress={() => removeRow(idx)}>
                    <Text style={styles.removeText}>Remove</Text>
                  </AnimatedPressable>
                )}
              </Card>
            );
          })}
          <AnimatedPressable style={styles.addRowBtn} onPress={addRow}>
            <Text style={styles.addRowText}>+ Add Item</Text>
          </AnimatedPressable>
        </ScrollView>

        <View style={styles.footer}>
          <AnimatedPressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.saveBtn} onPress={submit} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? 'Creating...' : 'Create Transfer'}</Text>
          </AnimatedPressable>
        </View>
      </Screen>

      <SelectModal
        visible={locationPickerOpen}
        title="Select Location"
        options={settings.subStockLocations}
        renderLabel={(l) => l.name}
        onSelect={(l) => { setToLocationId(l.id); setLocationPickerOpen(false); }}
        onClose={() => setLocationPickerOpen(false)}
      />

      <SelectModal
        visible={itemPickerRowIdx !== null}
        title="Select Item from Main Stock"
        options={availableStock}
        renderLabel={(i) => i.name}
        renderSub={(i) => `Batch ${i.batch || '—'} · Stock ${i.stock}`}
        onSelect={(i) => { updateRow(itemPickerRowIdx, { mainStockId: i.id }); setItemPickerRowIdx(null); }}
        onClose={() => setItemPickerRowIdx(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: 16 },
  label: { color: colors.muted, fontSize: 12, marginBottom: 6, fontWeight: '600' },
  picker: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
  },
  pickerText: { color: colors.text },
  pickerPlaceholder: { color: colors.muted },
  sectionTitle: { color: colors.text, fontWeight: '700', fontSize: 15, marginTop: 8, marginBottom: 10 },
  rowCard: { marginBottom: 10 },
  availableText: { color: colors.muted, fontSize: 12, marginBottom: 10 },
  errorText: { color: colors.danger, fontSize: 12, marginTop: -6, marginBottom: 8 },
  removeText: { color: colors.danger, fontSize: 13, fontWeight: '600', marginTop: 4 },
  addRowBtn: { alignItems: 'center', padding: 12, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10, borderStyle: 'dashed', marginBottom: 8 },
  addRowText: { color: colors.accent, fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.panelBorder },
  cancelBtn: { flex: 1, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: colors.text, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});
