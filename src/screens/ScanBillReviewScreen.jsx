import { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useWarehouse } from '../context/WarehouseContext';
import { Card, Badge, AnimatedPressable, Screen } from '../components/UI';
import { SectionTitle } from '../components/Bits';
import { formatCurrency } from '../lib/format';
import {
  calculateItemStock,
  calculateBillTotals,
  validateScannedItem,
} from '../services/stockConverter';

export default function ScanBillReviewScreen({ route, navigation }) {
  const { header: initialHeader, items: initialItems } = route?.params || {};
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { importPurchaseBill, mainStock } = useWarehouse();

  const [header, setHeader] = useState(() => ({
    supplierName: initialHeader?.supplierName || '',
    invoiceNumber: initialHeader?.invoiceNumber || '',
    invoiceDate: initialHeader?.invoiceDate || new Date().toISOString().split('T')[0],
  }));

  const [items, setItems] = useState(() => initialItems || []);
  const [editingItem, setEditingItem] = useState(null);
  const [editingHeader, setEditingHeader] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reconciled financial & quantity totals
  const billTotals = useMemo(() => calculateBillTotals(items), [items]);

  // Status badge bucketing
  const statusCounts = useMemo(() => {
    let verified = 0;
    let review = 0;
    let unmatched = 0;

    for (const item of items) {
      const errs = validateScannedItem(item);
      if (errs.length > 0) {
        unmatched++;
      } else if (item.matchStatus === 'exact' || item.matchStatus === 'high') {
        verified++;
      } else if (item.matchStatus === 'partial') {
        review++;
      } else {
        unmatched++;
      }
    }

    return { verified, review, unmatched };
  }, [items]);

  // Edit item handler
  const handleSaveItemEdit = (updatedItem) => {
    setItems((prev) =>
      prev.map((i) => (i.id === updatedItem.id ? updatedItem : i)),
    );
    setEditingItem(null);
  };

  const handleRemoveItem = (id) => {
    Alert.alert('Remove Item', 'Are you sure you want to remove this medicine from the bill?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setItems((prev) => prev.filter((i) => i.id !== id)),
      },
    ]);
  };

  const handleAddNewItem = () => {
    const newItem = {
      id: `manual-row-${Date.now()}`,
      name: '',
      batch: '',
      expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      qty: 10,
      freeQty: 0,
      unitsPerPack: 10,
      mrp: 100,
      ptr: 80,
      gst: 12,
      matchStatus: 'unmatched',
    };
    setEditingItem(newItem);
  };

  const handleConfirmAndAddStock = async () => {
    if (!header.supplierName.trim()) {
      Alert.alert('Missing Supplier', 'Please enter a valid distributor or supplier name.');
      return;
    }
    if (!header.invoiceNumber.trim()) {
      Alert.alert('Missing Invoice Number', 'Please enter a valid invoice number.');
      return;
    }
    if (items.length === 0) {
      Alert.alert('No Items', 'The bill contains no items to add.');
      return;
    }

    // Validate all items
    const invalidItems = items.filter((i) => validateScannedItem(i).length > 0);
    if (invalidItems.length > 0) {
      Alert.alert(
        'Incomplete Medicine Rows',
        `There are ${invalidItems.length} items with validation issues (e.g. missing batch or quantity). Please review marked cards before adding.`,
      );
      return;
    }

    Alert.alert(
      'Confirm Warehouse Stock Addition',
      `Add ${billTotals.totalWarehouseStrips} total strips across ${items.length} medicines to Warehouse Main Stock?\n\nSupplier: ${header.supplierName}\nInvoice: ${header.invoiceNumber}\nTotal Value: ${formatCurrency(billTotals.grandTotal)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add to Warehouse',
          onPress: async () => {
            setSaving(true);
            try {
              const res = await importPurchaseBill({
                header,
                items,
              });

              const stripsAdded = res?.totalStripsAdded ?? res?.total_strips_added ?? billTotals.totalWarehouseStrips;
              Alert.alert(
                'Stock Successfully Added! 🎉',
                `Added ${stripsAdded} strips to Warehouse Main.\nPurchase Order: ${header.invoiceNumber}`,
                [
                  {
                    text: 'Done',
                    onPress: () => navigation.goBack(),
                  },
                ],
              );
            } catch (err) {
              Alert.alert('Stock Import Error', err?.message || 'Failed to import stock to warehouse.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header Summary Card */}
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.supplierName}>{header.supplierName || 'Unknown Supplier'}</Text>
              <Text style={styles.invoiceMeta}>
                Invoice: <Text style={styles.bold}>{header.invoiceNumber}</Text>  ·  Date: {header.invoiceDate}
              </Text>
            </View>
            <AnimatedPressable
              style={styles.editHeaderBtn}
              onPress={() => setEditingHeader(true)}
            >
              <Ionicons name="pencil" size={16} color={theme.accent} />
              <Text style={styles.editHeaderBtnText}>Edit</Text>
            </AnimatedPressable>
          </View>

          {/* Quick Stats Grid */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Items</Text>
              <Text style={styles.statVal}>{items.length}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Billed Strips</Text>
              <Text style={styles.statVal}>{billTotals.totalBilledStrips}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Free Strips</Text>
              <Text style={[styles.statVal, { color: theme.success }]}>+{billTotals.totalFreeStrips}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Total Strips</Text>
              <Text style={[styles.statVal, { color: theme.accent }]}>{billTotals.totalWarehouseStrips}</Text>
            </View>
          </View>

          {/* Verification Status Overview */}
          <View style={styles.verificationRow}>
            <View style={styles.badgeGroup}>
              <Badge label={`${statusCounts.verified} Verified`} color={theme.success} />
              {statusCounts.review > 0 && (
                <Badge label={`${statusCounts.review} Needs Review`} color={theme.warning} />
              )}
              {statusCounts.unmatched > 0 && (
                <Badge label={`${statusCounts.unmatched} Unmatched`} color={theme.danger} />
              )}
            </View>
            <Text style={styles.grandTotalText}>
              Total: {formatCurrency(billTotals.grandTotal)}
            </Text>
          </View>
        </Card>

        {/* Medicines Section Header */}
        <View style={styles.sectionHeaderRow}>
          <SectionTitle>Extracted Medicine Rows ({items.length})</SectionTitle>
          <AnimatedPressable style={styles.addItemBtn} onPress={handleAddNewItem}>
            <Ionicons name="add-circle-outline" size={18} color={theme.accent} />
            <Text style={styles.addItemBtnText}>Add Item</Text>
          </AnimatedPressable>
        </View>

        {/* Medicines Items List */}
        {items.map((item, index) => {
          const calc = calculateItemStock(item);
          const errors = validateScannedItem(item);
          const isError = errors.length > 0;

          let badgeColor = theme.success;
          let badgeLabel = 'Verified';
          if (isError) {
            badgeColor = theme.danger;
            badgeLabel = 'Incomplete';
          } else if (item.matchStatus === 'partial') {
            badgeColor = theme.warning;
            badgeLabel = `Review (${Math.round((item.matchConfidence || 0.6) * 100)}%)`;
          } else if (item.matchStatus === 'unmatched') {
            badgeColor = theme.danger;
            badgeLabel = 'New Product';
          }

          return (
            <Card key={item.id || index} style={[styles.itemCard, isError && styles.errorItemCard]}>
              <View style={styles.itemHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemName}>
                    {index + 1}. {item.name || '(Nameless Item)'}
                  </Text>
                  {item.matchedItemName && item.matchedItemName !== item.name ? (
                    <Text style={styles.matchedNote}>
                      Catalog: {item.matchedItemName}
                    </Text>
                  ) : null}
                </View>
                <Badge label={badgeLabel} color={badgeColor} />
              </View>

              {/* Error warning if any */}
              {isError && (
                <View style={styles.errorNotice}>
                  <Ionicons name="alert-circle" size={14} color={theme.danger} />
                  <Text style={styles.errorText}>{errors.join(' · ')}</Text>
                </View>
              )}

              {/* Details grid */}
              <View style={styles.itemGrid}>
                <View style={styles.gridCell}>
                  <Text style={styles.gridLabel}>Batch</Text>
                  <Text style={styles.gridValue}>{item.batch || '—'}</Text>
                </View>
                <View style={styles.gridCell}>
                  <Text style={styles.gridLabel}>Expiry</Text>
                  <Text style={styles.gridValue}>{item.expiry || '—'}</Text>
                </View>
                <View style={styles.gridCell}>
                  <Text style={styles.gridLabel}>Qty (Strips)</Text>
                  <Text style={styles.gridValue}>
                    {item.qty} {item.freeQty > 0 ? `+ ${item.freeQty}F` : ''}
                  </Text>
                </View>
                <View style={styles.gridCell}>
                  <Text style={styles.gridLabel}>UPP</Text>
                  <Text style={styles.gridValue}>{item.unitsPerPack || 10}</Text>
                </View>
              </View>

              <View style={styles.itemFinancialRow}>
                <Text style={styles.financialMeta}>
                  Rate: {formatCurrency(item.ptr || 0)}  ·  MRP: {formatCurrency(item.mrp || 0)}  ·  GST: {item.gst || 12}%
                </Text>
                <Text style={styles.lineTotal}>
                  {formatCurrency(calc.netLineTotal)}
                </Text>
              </View>

              {/* Row actions */}
              <View style={styles.itemActionsRow}>
                <Text style={styles.effectiveCost}>
                  Total to add: <Text style={styles.bold}>{calc.totalStrips} strips</Text> ({calc.totalUnits} units)
                </Text>
                <View style={styles.btnRow}>
                  <AnimatedPressable
                    style={styles.actionIconBtn}
                    onPress={() => setEditingItem(item)}
                  >
                    <Ionicons name="create-outline" size={17} color={theme.accent} />
                    <Text style={styles.actionIconText}>Edit</Text>
                  </AnimatedPressable>
                  <AnimatedPressable
                    style={styles.actionIconBtn}
                    onPress={() => handleRemoveItem(item.id)}
                  >
                    <Ionicons name="trash-outline" size={17} color={theme.danger} />
                    <Text style={[styles.actionIconText, { color: theme.danger }]}>Delete</Text>
                  </AnimatedPressable>
                </View>
              </View>
            </Card>
          );
        })}
      </ScrollView>

      {/* Sticky Bottom Confirmation Bar */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomSummary}>
          <Text style={styles.bottomLabel}>Warehouse Strips</Text>
          <Text style={styles.bottomStripsVal}>{billTotals.totalWarehouseStrips} strips</Text>
          <Text style={styles.bottomUnitsVal}>({billTotals.totalUnits} total units)</Text>
        </View>

        <AnimatedPressable
          style={[styles.confirmBtn, saving && { opacity: 0.7 }]}
          disabled={saving}
          onPress={handleConfirmAndAddStock}
        >
          {saving ? (
            <ActivityIndicator size="small" color={theme.onAccent} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={theme.onAccent} />
              <Text style={styles.confirmBtnText}>Add to Warehouse</Text>
            </>
          )}
        </AnimatedPressable>
      </View>

      {/* Edit Header Modal */}
      <EditHeaderModal
        visible={editingHeader}
        header={header}
        theme={theme}
        onClose={() => setEditingHeader(false)}
        onSave={(updated) => {
          setHeader(updated);
          setEditingHeader(false);
        }}
      />

      {/* Edit Item Modal */}
      <EditItemModal
        visible={!!editingItem}
        item={editingItem}
        theme={theme}
        catalog={mainStock}
        onClose={() => setEditingItem(null)}
        onSave={handleSaveItemEdit}
      />
    </Screen>
  );
}

// Edit Header Modal Component
function EditHeaderModal({ visible, header, theme, onClose, onSave }) {
  const [supplier, setSupplier] = useState(header?.supplierName || '');
  const [invoiceNo, setInvoiceNo] = useState(header?.invoiceNumber || '');
  const [invoiceDate, setInvoiceDate] = useState(header?.invoiceDate || '');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.scrim}>
        <View style={[modalStyles.card, { backgroundColor: theme.panel, borderColor: theme.panelBorder }]}>
          <Text style={[modalStyles.title, { color: theme.text }]}>Edit Invoice Header</Text>

          <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>Distributor / Supplier Name</Text>
          <TextInput
            style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
            value={supplier}
            onChangeText={setSupplier}
          />

          <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>Invoice Number</Text>
          <TextInput
            style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
            value={invoiceNo}
            onChangeText={setInvoiceNo}
          />

          <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>Invoice Date (YYYY-MM-DD)</Text>
          <TextInput
            style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
            value={invoiceDate}
            onChangeText={setInvoiceDate}
          />

          <View style={modalStyles.btnRow}>
            <AnimatedPressable style={[modalStyles.btn, { backgroundColor: theme.chip }]} onPress={onClose}>
              <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={[modalStyles.btn, { backgroundColor: theme.accent }]}
              onPress={() => onSave({ supplierName: supplier, invoiceNumber: invoiceNo, invoiceDate })}
            >
              <Text style={{ color: theme.onAccent, fontWeight: '700' }}>Save</Text>
            </AnimatedPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Edit Item Modal Component
function EditItemModal({ visible, item, theme, catalog: _catalog, onClose, onSave }) {
  const [name, setName] = useState(item?.name || '');
  const [batch, setBatch] = useState(item?.batch || '');
  const [expiry, setExpiry] = useState(item?.expiry || '');
  const [qty, setQty] = useState(String(item?.qty || 10));
  const [freeQty, setFreeQty] = useState(String(item?.freeQty || 0));
  const [upp, setUpp] = useState(String(item?.unitsPerPack || 10));
  const [mrp, setMrp] = useState(String(item?.mrp || 100));
  const [ptr, setPtr] = useState(String(item?.ptr || 80));
  const [gst, setGst] = useState(String(item?.gst || 12));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={modalStyles.scrim}>
        <View style={[modalStyles.sheet, { backgroundColor: theme.panel, borderColor: theme.panelBorder }]}>
          <ScrollView>
            <Text style={[modalStyles.title, { color: theme.text }]}>Edit Medicine Details</Text>

            <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>Medicine Name</Text>
            <TextInput
              style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
              value={name}
              onChangeText={setName}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>Batch</Text>
                <TextInput
                  style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
                  value={batch}
                  onChangeText={setBatch}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>Expiry (YYYY-MM-DD)</Text>
                <TextInput
                  style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
                  value={expiry}
                  onChangeText={setExpiry}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>Billed Strips</Text>
                <TextInput
                  style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  value={qty}
                  onChangeText={setQty}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>Free Strips</Text>
                <TextInput
                  style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  value={freeQty}
                  onChangeText={setFreeQty}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>UPP (Strip size)</Text>
                <TextInput
                  style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  value={upp}
                  onChangeText={setUpp}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>Purchase Rate (PTR)</Text>
                <TextInput
                  style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  value={ptr}
                  onChangeText={setPtr}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>MRP</Text>
                <TextInput
                  style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  value={mrp}
                  onChangeText={setMrp}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[modalStyles.inputLabel, { color: theme.muted }]}>GST %</Text>
                <TextInput
                  style={[modalStyles.input, { color: theme.text, borderColor: theme.panelBorder, backgroundColor: theme.card }]}
                  keyboardType="numeric"
                  value={gst}
                  onChangeText={setGst}
                />
              </View>
            </View>

            <View style={modalStyles.btnRow}>
              <AnimatedPressable style={[modalStyles.btn, { backgroundColor: theme.chip }]} onPress={onClose}>
                <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={[modalStyles.btn, { backgroundColor: theme.accent }]}
                onPress={() => {
                  onSave({
                    ...item,
                    name,
                    batch,
                    expiry,
                    qty: parseFloat(qty) || 0,
                    freeQty: parseFloat(freeQty) || 0,
                    unitsPerPack: parseFloat(upp) || 10,
                    ptr: parseFloat(ptr) || 0,
                    mrp: parseFloat(mrp) || 0,
                    gst: parseFloat(gst) || 12,
                  });
                }}
              >
                <Text style={{ color: theme.onAccent, fontWeight: '700' }}>Update Item</Text>
              </AnimatedPressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
  },
  sheet: {
    borderRadius: 20,
    padding: 20,
    maxHeight: '90%',
    borderWidth: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
});

function makeStyles(theme) {
  return StyleSheet.create({
    container: {
      padding: 16,
      paddingBottom: 110,
    },
    headerCard: {
      padding: 16,
      marginBottom: 16,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
    },
    supplierName: {
      color: theme.text,
      fontSize: 17,
      fontWeight: '700',
    },
    invoiceMeta: {
      color: theme.muted,
      fontSize: 12,
      marginTop: 2,
    },
    bold: {
      fontWeight: '700',
      color: theme.text,
    },
    editHeaderBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: theme.chip,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
    },
    editHeaderBtnText: {
      color: theme.accent,
      fontSize: 12,
      fontWeight: '600',
    },
    statsRow: {
      flexDirection: 'row',
      backgroundColor: theme.card,
      borderRadius: 12,
      padding: 10,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.panelBorder,
    },
    statBox: {
      flex: 1,
      alignItems: 'center',
    },
    statLabel: {
      color: theme.muted,
      fontSize: 10,
      textTransform: 'uppercase',
      fontWeight: '600',
    },
    statVal: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '700',
      marginTop: 2,
    },
    verificationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    badgeGroup: {
      flexDirection: 'row',
      gap: 6,
      flexWrap: 'wrap',
    },
    grandTotalText: {
      color: theme.success,
      fontSize: 15,
      fontWeight: '700',
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    addItemBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: theme.chip,
    },
    addItemBtnText: {
      color: theme.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    itemCard: {
      padding: 14,
      marginBottom: 12,
    },
    errorItemCard: {
      borderColor: theme.danger,
    },
    itemHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      marginBottom: 8,
    },
    itemName: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '700',
    },
    matchedNote: {
      color: theme.accent,
      fontSize: 11,
      marginTop: 2,
    },
    errorNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(239,68,68,0.12)',
      padding: 8,
      borderRadius: 8,
      marginBottom: 8,
    },
    errorText: {
      color: theme.danger,
      fontSize: 12,
      fontWeight: '500',
      flex: 1,
    },
    itemGrid: {
      flexDirection: 'row',
      backgroundColor: theme.chip,
      borderRadius: 8,
      padding: 8,
      marginBottom: 8,
    },
    gridCell: {
      flex: 1,
    },
    gridLabel: {
      color: theme.muted,
      fontSize: 10,
      textTransform: 'uppercase',
    },
    gridValue: {
      color: theme.text,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 2,
    },
    itemFinancialRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    financialMeta: {
      color: theme.muted,
      fontSize: 12,
    },
    lineTotal: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '700',
    },
    itemActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: theme.panelBorder,
      paddingTop: 8,
    },
    effectiveCost: {
      color: theme.muted,
      fontSize: 11,
    },
    btnRow: {
      flexDirection: 'row',
      gap: 12,
    },
    actionIconBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    actionIconText: {
      color: theme.accent,
      fontSize: 12,
      fontWeight: '600',
    },
    bottomBar: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: theme.panel,
      borderTopWidth: 1,
      borderTopColor: theme.panelBorder,
      padding: 16,
      paddingBottom: 24,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    bottomSummary: {
      flex: 1,
    },
    bottomLabel: {
      color: theme.muted,
      fontSize: 11,
      textTransform: 'uppercase',
    },
    bottomStripsVal: {
      color: theme.accent,
      fontSize: 16,
      fontWeight: '700',
    },
    bottomUnitsVal: {
      color: theme.muted,
      fontSize: 11,
    },
    confirmBtn: {
      backgroundColor: theme.accent,
      paddingHorizontal: 20,
      paddingVertical: 13,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    confirmBtnText: {
      color: theme.onAccent,
      fontSize: 14,
      fontWeight: '700',
    },
  });
}
