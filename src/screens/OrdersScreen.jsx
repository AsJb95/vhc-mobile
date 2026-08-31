import { useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Modal, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { MotiView } from 'moti';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useWarehouse } from '../context/WarehouseContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Badge, EmptyState, ScreenLoading, AnimatedPressable, Screen } from '../components/UI';
import CreatePOModal from '../components/CreatePOModal';
import CreateTransferModal from '../components/CreateTransferModal';
import { formatCurrency, formatDate } from '../lib/format';

function poStatusColor(status, t) {
  if (status === 'Received') return t.success;
  if (status === 'Cancelled') return t.danger;
  return t.warning;
}

export default function OrdersScreen() {
  const {
    purchaseOrders, transferOrders, receivePurchaseOrder, cancelPurchaseOrder,
    loading, refreshing, refresh,
    poHasMore, toHasMore, loadMorePurchaseOrders, loadMoreTransferOrders,
  } = useWarehouse();
  const { canWriteWarehouse } = useAuth();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [mode, setMode] = useState('po');
  const [viewOrder, setViewOrder] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  if (loading) return <ScreenLoading />;

  function confirmReceive(order) {
    Alert.alert('Mark as Received?', `This will add ${order.items.length} item(s) from "${order.poNumber}" into main stock.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => { receivePurchaseOrder(order.id); setViewOrder(null); } },
    ]);
  }

  function confirmCancel(order) {
    Alert.alert('Cancel Purchase Order?', `"${order.poNumber}" will be marked as cancelled.`, [
      { text: 'No', style: 'cancel' },
      { text: 'Yes, Cancel', style: 'destructive', onPress: () => { cancelPurchaseOrder(order.id); setViewOrder(null); } },
    ]);
  }

  const data = mode === 'po' ? purchaseOrders : transferOrders;
  const hasMore = mode === 'po' ? poHasMore : toHasMore;
  const onEndReached = mode === 'po' ? loadMorePurchaseOrders : loadMoreTransferOrders;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
        <View style={styles.segmented}>
          <AnimatedPressable style={[styles.segBtn, mode === 'po' && styles.segBtnActive]} onPress={() => setMode('po')}>
            <Text style={[styles.segText, mode === 'po' && styles.segTextActive]}>Purchase Orders</Text>
          </AnimatedPressable>
          <AnimatedPressable style={[styles.segBtn, mode === 'transfer' && styles.segBtnActive]} onPress={() => setMode('transfer')}>
            <Text style={[styles.segText, mode === 'transfer' && styles.segTextActive]}>Transfers</Text>
          </AnimatedPressable>
        </View>
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={hasMore ? <ActivityIndicator color={theme.accent} style={styles.footerLoader} /> : null}
        ListEmptyComponent={<EmptyState text={mode === 'po' ? 'No purchase orders' : 'No transfer orders'} icon="🛒" />}
        renderItem={({ item, index }) => (
          <AnimatedPressable onPress={() => setViewOrder({ ...item, mode })}>
            <Card index={index} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <Text style={styles.itemName}>{mode === 'po' ? item.poNumber : item.transferNumber}</Text>
                {mode === 'po' ? <Badge label={item.status} color={poStatusColor(item.status, theme)} /> : <Badge label={item.toLocationName} color={theme.accent} />}
              </View>
              <Text style={styles.itemMeta}>
                {mode === 'po' ? item.supplier : formatDate(item.transferDate)} · {item.items.length} item(s)
              </Text>
              {mode === 'po' && <Text style={styles.itemMeta}>{formatCurrency(item.totals?.total)}</Text>}
            </Card>
          </AnimatedPressable>
        )}
      />

      {canWriteWarehouse && (
        <AnimatedPressable style={styles.fab} onPress={() => setCreateOpen(true)}>
          <Ionicons name="add" size={28} color={theme.onAccent} />
        </AnimatedPressable>
      )}

      <Modal visible={!!viewOrder} animationType="slide" onRequestClose={() => setViewOrder(null)}>
        <Screen style={styles.modalContainer}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
            {viewOrder && (
              <MotiView from={{ opacity: 0, translateY: 16 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 280 }}>
                <Text style={styles.modalTitle}>{viewOrder.mode === 'po' ? viewOrder.poNumber : viewOrder.transferNumber}</Text>
                <Text style={styles.itemMeta}>
                  {viewOrder.mode === 'po' ? `Supplier: ${viewOrder.supplier}` : `To: ${viewOrder.toLocationName}`}
                </Text>
                {viewOrder.notes ? <Text style={styles.itemMeta}>Notes: {viewOrder.notes}</Text> : null}

                <View style={{ marginTop: 16 }}>
                  {viewOrder.items.map((line, idx) => (
                    <Card key={idx} index={idx} style={{ marginBottom: 8 }}>
                      <Text style={styles.itemName}>{line.name}</Text>
                      <Text style={styles.itemMeta}>Batch {line.batch || '—'} · Qty {line.qty} · {formatCurrency(line.netRate)}</Text>
                    </Card>
                  ))}
                </View>

                {viewOrder.mode === 'po' && (
                  <Card style={{ marginTop: 8 }}>
                    <View style={styles.itemRow}><Text style={styles.itemMeta}>Subtotal</Text><Text style={styles.itemMeta}>{formatCurrency(viewOrder.totals?.subtotal)}</Text></View>
                    <View style={styles.itemRow}><Text style={styles.itemMeta}>GST</Text><Text style={styles.itemMeta}>{formatCurrency(viewOrder.totals?.gstTotal)}</Text></View>
                    <View style={styles.itemRow}><Text style={styles.itemName}>Total</Text><Text style={styles.itemName}>{formatCurrency(viewOrder.totals?.total)}</Text></View>
                  </Card>
                )}

                {viewOrder.mode === 'po' && viewOrder.status === 'Pending' && canWriteWarehouse && (
                  <View style={styles.actionRow}>
                    <AnimatedPressable style={styles.receiveBtn} onPress={() => confirmReceive(viewOrder)}>
                      <Text style={styles.actionBtnText}>Receive</Text>
                    </AnimatedPressable>
                    <AnimatedPressable style={styles.cancelBtn} onPress={() => confirmCancel(viewOrder)}>
                      <Text style={styles.actionBtnText}>Cancel PO</Text>
                    </AnimatedPressable>
                  </View>
                )}
              </MotiView>
            )}
          </ScrollView>
          <AnimatedPressable style={styles.closeBtn} onPress={() => setViewOrder(null)}>
            <Text style={styles.closeBtnText}>Close</Text>
          </AnimatedPressable>
        </Screen>
      </Modal>

      <CreatePOModal visible={createOpen && mode === 'po'} onClose={() => setCreateOpen(false)} />
      <CreateTransferModal visible={createOpen && mode === 'transfer'} onClose={() => setCreateOpen(false)} />
    </Screen>
  );
}

const makeStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { padding: 16, paddingBottom: 8 },
  title: { color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginBottom: 12 },
  segmented: { flexDirection: 'row', backgroundColor: t.chip, borderRadius: 12, borderWidth: 1, borderColor: t.panelBorder, padding: 4 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segBtnActive: { backgroundColor: t.accent },
  segText: { color: t.muted, fontSize: 13 },
  segTextActive: { color: t.onAccent, fontWeight: '600' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  footerLoader: { paddingVertical: 20 },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  itemName: { color: t.text, fontWeight: '600', fontSize: 15 },
  itemMeta: { color: t.muted, fontSize: 12, marginTop: 2 },
  modalContainer: { flex: 1, backgroundColor: t.bg },
  modalTitle: { color: t.text, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  receiveBtn: { flex: 1, backgroundColor: t.success, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginRight: 10 },
  cancelBtn: { flex: 1, backgroundColor: t.danger, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  actionBtnText: { color: t.onAccent, fontWeight: '700' },
  closeBtn: { padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: t.panelBorder },
  closeBtnText: { color: t.accent, fontWeight: '600' },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: t.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
});
