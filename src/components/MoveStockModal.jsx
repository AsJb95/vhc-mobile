import { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, AnimatedPressable, Card } from './UI';
import { FormField } from './FormField';
import SelectModal from './SelectModal';
import { useWarehouse } from '../context/WarehouseContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { formatDate } from '../lib/format';
import { stripsToUnits, resolveTransferQuantity, formatStrips } from '../lib/units';

// Quick "Move Stock" for ONE Main Stock batch row.
//   * Destination = a warehouse sub-stock location  -> immediate transfer
//     (existing createTransferOrder: same records, compare-and-set writes).
//   * Destination = the Pharmacy (pharmacy_counter)  -> creates a PENDING
//     request and changes NO stock. The Pharmacy then Accepts (deduct Main,
//     add Pharmacy) or Rejects (no change) in Pharmacy -> Pending Stock
//     Requests. No new inventory path or table is introduced either way.
export default function MoveStockModal({ visible, item, onClose }) {
  const { settings, pharmacyLocation, createTransferOrder, createPharmacyTransferRequest } = useWarehouse();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const destinations = useMemo(() => {
    const subs = (settings.subStockLocations || []).map((l) => ({ id: l.id, name: l.name, isPharmacy: false }));
    return pharmacyLocation
      ? [{ id: pharmacyLocation.id, name: `${pharmacyLocation.name} (needs approval)`, isPharmacy: true }, ...subs]
      : subs;
  }, [settings.subStockLocations, pharmacyLocation]);

  const [destId, setDestId] = useState('');
  const [qty, setQty] = useState('');
  const [transferUnit, setTransferUnit] = useState('strips');
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setDestId(destinations.length === 1 ? destinations[0].id : '');
      setQty('');
      setTransferUnit('strips');
      setSaving(false);
      setPickerOpen(false);
    }
    // destinations intentionally excluded — only re-init on open / item change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, item?.id]);

  const available = Math.max(0, Number(item?.stock) || 0);
  const dest = destinations.find((l) => l.id === destId) || null;
  const toPharmacy = !!dest?.isPharmacy;
  const qNum = parseInt(qty, 10) || 0;
  // Only Pharmacy transfers can be entered in either unit — Main Stock's own
  // sub-stock locations are strip-based on both ends, nothing to convert.
  const resolved = toPharmacy ? resolveTransferQuantity(qNum, transferUnit, item?.unitsPerPack) : { strips: qNum, units: qNum };
  const stripsNeeded = resolved.strips;
  const exceeds = stripsNeeded > available;
  const canMove = !!destId && qNum > 0 && !exceeds && !saving;

  async function submit() {
    if (!destId) { Alert.alert('Choose a destination', 'Select where the stock should go.'); return; }
    if (qNum <= 0) { Alert.alert('Enter a quantity', 'Quantity to move must be at least 1.'); return; }
    if (stripsNeeded > available) {
      Alert.alert('Not enough stock', `Only ${available} strip(s) of "${item.name}" are available in Main Stock (${stripsToUnits(available, item?.unitsPerPack)} units).`);
      return;
    }
    setSaving(true);
    try {
      const line = {
        mainStockId: item.id,
        name: item.name || '',
        batch: item.batch || '',
        expiry: item.expiry || '',
        mrp: item.mrp || 0,
        netRate: item.netRate || 0,
        qty: qNum,
      };
      if (toPharmacy) {
        const res = await createPharmacyTransferRequest({
          transferDate: new Date().toISOString().slice(0, 10),
          notes: `Move Stock (mobile): ${qNum} ${transferUnit === 'units' ? 'unit(s)' : 'strip(s)'} × ${item.name}${item.batch ? ` [batch ${item.batch}]` : ''} → ${pharmacyLocation?.name || 'Pharmacy'}`,
          items: [line],
          transferUnit,
        });
        if (res && res.ok) {
          Alert.alert(
            'Request sent to Pharmacy',
            `${res.transferNumber}\n\n` +
              `Requested: ${formatStrips(resolved.strips)} strip(s) of Main Stock (${resolved.units} units) of "${item.name}" for ${pharmacyLocation?.name || 'the Pharmacy'}.\n\n` +
              'No stock has changed. The Pharmacy accepts it in Pharmacy → Pending Stock Requests — only then ' +
              `is Main Stock reduced and Pharmacy Inventory increased. Rejecting it changes nothing.`,
          );
          onClose();
        }
      } else {
        const res = await createTransferOrder({
          toLocationId: destId,
          toLocationName: dest?.name || '',
          transferDate: new Date().toISOString().slice(0, 10),
          notes: `Move Stock (mobile): ${qNum} × ${item.name}${item.batch ? ` [batch ${item.batch}]` : ''} → ${dest?.name || ''}`,
          items: [line],
        });
        if (res && res.ok) {
          Alert.alert(
            'Stock moved',
            `${qNum} unit(s) of "${item.name}" moved to ${dest?.name || 'the selected location'}.\n\n` +
              `Main Stock: ${available} → ${available - qNum} unit(s).`,
          );
          onClose();
        }
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
          <Text style={styles.title}>Move Stock</Text>

          <Card style={styles.itemCard}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemMeta}>
              Batch {item.batch || '—'}
              {item.expiry ? ` · Exp ${formatDate(item.expiry)}` : ''}
            </Text>
            <Text style={styles.available}>
              Available in Main Stock: <Text style={styles.availableNum}>{available}</Text> strip(s)
              {' '}({stripsToUnits(available, item?.unitsPerPack)} units)
            </Text>
          </Card>

          <Text style={styles.label}>Destination *</Text>
          <AnimatedPressable style={styles.picker} onPress={() => setPickerOpen(true)}>
            <Text style={dest ? styles.pickerText : styles.pickerPlaceholder}>
              {dest ? dest.name : destinations.length ? 'Select a clinic / sub-stock location…' : 'No destinations configured'}
            </Text>
          </AnimatedPressable>
          {toPharmacy ? (
            <>
              <Text style={styles.pendingHint}>
                This creates a <Text style={styles.pendingHintStrong}>pending request</Text> and changes no stock. The
                Pharmacy must Accept it (in Pharmacy → Pending Stock Requests) before Main Stock is reduced and Pharmacy
                Inventory is increased.
              </Text>
              <Text style={styles.label}>Transfer As</Text>
              <View style={styles.toggleRow}>
                <AnimatedPressable
                  style={[styles.toggleBtn, transferUnit === 'strips' && styles.toggleBtnActive]}
                  onPress={() => setTransferUnit('strips')}
                >
                  <Text style={[styles.toggleText, transferUnit === 'strips' && styles.toggleTextActive]}>Strips</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={[styles.toggleBtn, transferUnit === 'units' && styles.toggleBtnActive]}
                  onPress={() => setTransferUnit('units')}
                >
                  <Text style={[styles.toggleText, transferUnit === 'units' && styles.toggleTextActive]}>Units (Nos)</Text>
                </AnimatedPressable>
              </View>
            </>
          ) : null}

          <FormField
            label={`Quantity to move (${toPharmacy ? (transferUnit === 'units' ? 'Units' : 'Strips') : 'Strips'}) *`}
            keyboardType="numeric"
            placeholder={toPharmacy && transferUnit === 'units' ? `1 – ${stripsToUnits(available, item?.unitsPerPack)}` : `1 – ${available}`}
            value={qty}
            onChangeText={setQty}
          />
          {exceeds ? (
            <Text style={styles.errorText}>
              Exceeds available stock ({available} strips = {stripsToUnits(available, item?.unitsPerPack)} units).
            </Text>
          ) : null}
          {toPharmacy && qNum > 0 && !exceeds ? (
            <Text style={styles.previewText}>
              Warehouse: {available} → {formatStrips(available - resolved.strips)} strips{'\n'}
              Pharmacy: +{resolved.units} units
            </Text>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          <AnimatedPressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </AnimatedPressable>
          <AnimatedPressable style={[styles.moveBtn, !canMove && styles.moveBtnDisabled]} onPress={submit} disabled={!canMove}>
            <Text style={styles.moveBtnText}>
              {saving ? 'Working…' : toPharmacy ? 'Request Transfer' : 'Move Stock'}
            </Text>
          </AnimatedPressable>
        </View>
      </Screen>

      <SelectModal
        visible={pickerOpen}
        title="Select Destination"
        options={destinations}
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
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 12,
  },
  pickerText: { color: t.text, fontSize: 15 },
  pickerPlaceholder: { color: t.muted, fontSize: 15 },
  pendingHint: { color: t.muted, fontSize: 12, lineHeight: 17, marginBottom: 14 },
  pendingHintStrong: { color: t.warning, fontWeight: '800' },
  errorText: { color: t.danger, fontSize: 12, marginTop: -4 },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  toggleBtn: {
    flex: 1, borderWidth: 1, borderColor: t.panelBorder, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center', backgroundColor: t.panel,
  },
  toggleBtnActive: { backgroundColor: t.accent, borderColor: t.accent },
  toggleText: { color: t.muted, fontWeight: '700', fontSize: 13 },
  toggleTextActive: { color: t.onAccent },
  previewText: { color: t.muted, fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 8 },
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
