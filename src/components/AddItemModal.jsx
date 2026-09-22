import { useState, useEffect } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, AnimatedPressable } from './UI';
import { FormField } from './FormField';
import { useWarehouse } from '../context/WarehouseContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { stripsToUnits, unitsToStrips } from '../lib/units';

const BLANK = { name: '', batch: '', expiry: '', netRate: '', mrp: '', gst: '12', stock: '', unitsPerPack: '10', category: '', hsnCode: '', stockist: '', correctionReason: '' };

// A quantity change is "significant" (asks for confirmation) if it crosses zero
// or moves by 5+ units — small nudges from the +/- buttons stay frictionless.
function isSignificantStockChange(oldQty, newQty) {
  const o = Number(oldQty) || 0;
  const n = Number(newQty) || 0;
  if (o === n) return false;
  return Math.abs(n - o) >= 5 || o === 0 || n === 0;
}

// target: 'main' (default) writes to Main Stock; 'pharmacy' writes to the
// Pharmacy's own stock location. The two are never mixed — each target uses
// its own dedicated add/update/delete functions from WarehouseContext.
export default function AddItemModal({ visible, item, onClose, target = 'main' }) {
  const {
    addMainItem, updateMainItem, deleteMainItem,
    addPharmacyItem, updatePharmacyItem, deletePharmacyItem,
  } = useWarehouse();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState(() => (item ? { ...BLANK, ...item, correctionReason: '' } : { ...BLANK }));
  const [saving, setSaving] = useState(false);

  // Re-sync the form to the selected record every time the modal opens (or
  // the target record changes) — the modal itself stays mounted between
  // opens (only `visible` toggles), so without this the form would keep
  // showing whatever it last had instead of the newly-selected item.
  useEffect(() => {
    if (visible) {
      setForm(item ? { ...BLANK, ...item, correctionReason: '' } : { ...BLANK });
    }
  }, [visible, item]);

  const addFn = target === 'pharmacy' ? addPharmacyItem : addMainItem;
  const updateFn = target === 'pharmacy' ? updatePharmacyItem : updateMainItem;
  const deleteFn = target === 'pharmacy' ? deletePharmacyItem : deleteMainItem;

  function patch(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    if (!form.name?.trim()) {
      Alert.alert('Missing name', 'Enter a medicine/product name.');
      return;
    }
    // Pharmacy stock is always whole individual units (unchanged model).
    // Warehouse (Main Stock) is strip-based and fractional strips are allowed
    // (e.g. 26.5, entered via Total Stock (Units/Nos)) — stock_batches.qty is
    // numeric in the DB, so this must not be floored/truncated.
    const stockNum = target === 'pharmacy' ? (parseInt(form.stock, 10) || 0) : (parseFloat(form.stock) || 0);
    if (stockNum < 0) {
      Alert.alert('Invalid stock', 'Stock quantity cannot be negative.');
      return;
    }
    const payload = {
      ...form,
      netRate: Math.max(0, parseFloat(form.netRate) || 0),
      mrp: Math.max(0, parseFloat(form.mrp) || 0),
      gst: Math.max(0, parseFloat(form.gst) || 12),
      stock: stockNum,
      unitsPerPack: Math.max(1, parseInt(form.unitsPerPack, 10) || 10),
      correctionReason: (form.correctionReason || '').trim(),
    };

    const doSave = async () => {
      setSaving(true);
      try {
        // Update-vs-add branches on the record we were opened with (`item`),
        // and updateFn always targets that same record's id — it can never
        // create a duplicate or drift onto a different row.
        if (item) {
          await updateFn(item.id, payload);
        } else {
          await addFn(payload);
        }
        onClose();
      } catch {
        // error already surfaced via Alert in context
      } finally {
        setSaving(false);
      }
    };

    // Confirm a meaningful stock correction on an existing item (#10).
    if (item && isSignificantStockChange(item.stock, stockNum)) {
      Alert.alert(
        'Confirm stock correction',
        `"${item.name}"\n\nStock ${item.stock ?? 0} → ${stockNum} ${target === 'pharmacy' ? 'units' : 'strips'}` +
          (payload.correctionReason ? `\nReason: ${payload.correctionReason}` : '') +
          '\n\nThis writes directly to the shared warehouse stock. The change is guarded against a concurrent update and recorded in the stock movement history.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Apply correction', style: 'destructive', onPress: doSave },
        ],
      );
      return;
    }
    await doSave();
  }

  function confirmDelete() {
    Alert.alert('Delete Item?', `"${item.name}" will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteFn(item.id); onClose(); } },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{item ? 'Edit Item' : 'Add Stock Item'}</Text>

          <FormField label="Medicine / Product Name *" placeholder="e.g. Paracetamol 500mg" value={form.name} onChangeText={(v) => patch('name', v)} />
          <View style={styles.row}>
            <FormField containerStyle={styles.half} label="Batch Number" value={form.batch} onChangeText={(v) => patch('batch', v)} />
            <FormField containerStyle={styles.half} label="Expiry (YYYY-MM-DD)" placeholder="2027-01-31" value={form.expiry} onChangeText={(v) => patch('expiry', v)} />
          </View>
          <View style={styles.row}>
            <FormField containerStyle={styles.half} label="Net Rate (₹)" keyboardType="decimal-pad" value={String(form.netRate)} onChangeText={(v) => patch('netRate', v)} />
            <FormField containerStyle={styles.half} label="MRP (₹)" keyboardType="decimal-pad" value={String(form.mrp)} onChangeText={(v) => patch('mrp', v)} />
          </View>
          <View style={styles.row}>
            <FormField containerStyle={styles.half} label="GST %" keyboardType="numeric" value={String(form.gst)} onChangeText={(v) => patch('gst', v)} />
            <FormField
              containerStyle={styles.half}
              label={target === 'pharmacy' ? 'Stock (Units)' : 'Stock (Strips)'}
              keyboardType={target === 'pharmacy' ? 'numeric' : 'decimal-pad'}
              value={String(form.stock)}
              onChangeText={(v) => patch('stock', v)}
            />
          </View>
          <View style={styles.row}>
            <FormField
              containerStyle={styles.half}
              label={target === 'pharmacy' ? 'Units Per Pack' : 'Units Per Strip'}
              keyboardType="numeric"
              value={String(form.unitsPerPack)}
              onChangeText={(v) => patch('unitsPerPack', v)}
            />
            <FormField containerStyle={styles.half} label="Stockist / Supplier" value={form.stockist} onChangeText={(v) => patch('stockist', v)} />
          </View>
          {target !== 'pharmacy' && (
            <View style={styles.row}>
              <FormField
                containerStyle={styles.half}
                label="Total Stock (Units/Nos)"
                keyboardType="numeric"
                value={String(stripsToUnits(form.stock, form.unitsPerPack))}
                onChangeText={(v) => {
                  // Bidirectional entry, mirroring the Pharmacy Billing app's own
                  // "Total Tablet Stock (Units/Nos)" field: typing a unit count
                  // back-derives Stock (Strips) via Units Per Strip. Fractional
                  // strips (e.g. 26.5) are allowed and not rounded away — only the
                  // displayed precision is capped at 1 decimal, matching
                  // formatStrips() used everywhere else in the transfer flow.
                  const strips = unitsToStrips(v, form.unitsPerPack);
                  patch('stock', String(Math.round(strips * 10) / 10));
                }}
              />
            </View>
          )}
          <View style={styles.row}>
            <FormField containerStyle={styles.half} label="Category" value={form.category} onChangeText={(v) => patch('category', v)} />
            <FormField containerStyle={styles.half} label="HSN Code" value={form.hsnCode} onChangeText={(v) => patch('hsnCode', v)} />
          </View>

          {item && (
            <FormField
              label="Correction reason (optional)"
              placeholder="e.g. physical count, damaged, data entry fix"
              value={form.correctionReason}
              onChangeText={(v) => patch('correctionReason', v)}
            />
          )}

          {item && (
            <AnimatedPressable style={styles.deleteBtn} onPress={confirmDelete}>
              <Text style={styles.deleteBtnText}>Delete Item</Text>
            </AnimatedPressable>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          <AnimatedPressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </AnimatedPressable>
          <AnimatedPressable style={styles.saveBtn} onPress={save} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : item ? 'Save' : 'Add Item'}</Text>
          </AnimatedPressable>
        </View>
      </Screen>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  title: { color: t.text, fontSize: 22, fontWeight: '800', marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  deleteBtn: { marginTop: 8, alignItems: 'center', padding: 12 },
  deleteBtnText: { color: t.danger, fontWeight: '600' },
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
  saveBtn: {
    flex: 1, minHeight: 54, backgroundColor: t.accent,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  saveBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 16 },
});
