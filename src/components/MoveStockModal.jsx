import { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, AnimatedPressable, Card } from './UI';
import { FormField } from './FormField';
import SelectModal from './SelectModal';
import { useWarehouse } from '../context/WarehouseContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { formatDate } from '../lib/format';

// Quick "Move Stock" for ONE Main Stock batch row: pick a destination
// sub-stock / clinic location + a quantity, then hand off to the existing
// createTransferOrder() — same transfer_orders / transfer_order_items records,
// same compare-and-set stock writes, same batch/expiry/item identity. No new
// inventory path is introduced here.
export default function MoveStockModal({ visible, item, onClose }) {
  const { settings, createTransferOrder } = useWarehouse();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const locations = settings.subStockLocations || [];

  const [destId, setDestId] = useState('');
  const [qty, setQty] = useState('');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Reset every time the sheet opens for a (possibly different) item.
  useEffect(() => {
    if (visible) {
      setDestId(locations.length === 1 ? locations[0].id : '');
      setQty('');
      setSaving(false);
      setPickerOpen(false);
    }
    // locations intentionally excluded — only re-init on open / item change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item?.id]);

  const available = Math.max(0, Number(item?.stock) || 0);
  const dest = locations.find((l) => l.id === destId) || null;
  const qNum = parseInt(qty, 10) || 0;
  const exceeds = qNum > available;
  const canMove = !!destId && qNum > 0 && !exceeds && !saving;

  async function submit() {
    if (!destId) { Alert.alert('Choose a destination', 'Select where the stock should go.'); return; }
    if (qNum <= 0) { Alert.alert('Enter a quantity', 'Quantity to move must be at least 1.'); return; }
    if (qNum > available) {
      Alert.alert('Not enough stock', `Only ${available} unit(s) of "${item.name}" are available in Main Stock.`);
      return;
    }
    setSaving(true);
    try {
      const res = await createTransferOrder({
        toLocationId: destId,
        toLocationName: dest?.name || '',
        transferDate: new Date().toISOString().slice(0, 10),
        notes: `Move Stock (mobile): ${qNum} × ${item.name}${item.batch ? ` [batch ${item.batch}]` : ''} → ${dest?.name || ''}`,
        items: [{
          mainStockId: item.id,
          name: item.name || '',
          batch: item.batch || '',
          expiry: item.expiry || '',
          mrp: item.mrp || 0,
          netRate: item.netRate || 0,
          qty: qNum,
        }],
      });
      if (res && res.ok) {
        Alert.alert(
          'Stock moved',
          `${qNum} unit(s) of "${item.name}" moved to ${dest?.name || 'the selected location'}.\n\n` +
            `Main Stock: ${available} → ${available - qNum} unit(s).`,
        );
        onClose();
      }
    } catch {
      // createTransferOrder already surfaced the exact error via an alert
      // (e.g. "no longer has N in stock"). Leave the sheet open to retry.
    } finally {
      setSaving(false);
    }
  }

  if (!item) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Move Stock</Text>

          <Card style={styles.itemCard}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemMeta}>
              Batch {item.batch || '—'}
              {item.expiry ? ` · Exp ${formatDate(item.expiry)}` : ''}
            </Text>
            <Text style={styles.available}>Available in Main Stock: <Text style={styles.availableNum}>{available}</Text> unit(s)</Text>
          </Card>

          <Text style={styles.label}>Destination *</Text>
          <AnimatedPressable style={styles.picker} onPress={() => setPickerOpen(true)}>
            <Text style={dest ? styles.pickerText : styles.pickerPlaceholder}>
              {dest ? dest.name : locations.length ? 'Select a clinic / sub-stock location…' : 'No sub-stock locations configured'}
            </Text>
          </AnimatedPressable>

          <FormField
            label="Quantity to move *"
            keyboardType="numeric"
            placeholder={`1 – ${available}`}
            value={qty}
            onChangeText={setQty}
          />
          {exceeds ? <Text style={styles.errorText}>Cannot move more than the {available} available.</Text> : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          <AnimatedPressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </AnimatedPressable>
          <AnimatedPressable style={[styles.moveBtn, !canMove && styles.moveBtnDisabled]} onPress={submit} disabled={!canMove}>
            <Text style={styles.moveBtnText}>{saving ? 'Moving…' : 'Move Stock'}</Text>
          </AnimatedPressable>
        </View>
      </Screen>

      <SelectModal
        visible={pickerOpen}
        title="Select Destination"
        options={locations}
        renderLabel={(l) => l.name}
        onSelect={(l) => { setDestId(l.id); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
      />
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
  label: { color: t.muted, fontSize: 12, marginBottom: 6, fontWeight: '600' },
  picker: {
    backgroundColor: t.panel, borderWidth: 1, borderColor: t.panelBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 14,
  },
  pickerText: { color: t.text, fontSize: 15 },
  pickerPlaceholder: { color: t.muted, fontSize: 15 },
  errorText: { color: t.danger, fontSize: 12, marginTop: -4 },
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
  moveBtn: {
    flex: 1, minHeight: 54, backgroundColor: t.accent,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  moveBtnDisabled: { opacity: 0.45 },
  moveBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 16 },
});
