import { useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Badge, EmptyState, ScreenLoading, AnimatedPressable, Screen } from '../components/UI';
import { formatDateTime, formatDate } from '../lib/format';

// Warehouse -> Pharmacy transfers that are waiting for the user to physically
// receive the stock and approve it. Approving applies the quantity to Pharmacy
// Inventory; cancelling does nothing to stock. Neither ever happens on its own.
export default function PendingTransfersScreen() {
  const {
    pendingPharmacyTransfers, approvePharmacyTransfer, cancelPharmacyTransfer,
    loading, refreshing, refresh,
  } = useWarehouse();
  const { canWriteWarehouse } = useAuth();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [busyId, setBusyId] = useState(null); // transfer id currently approving/cancelling

  async function runAction(kind, transfer) {
    setBusyId(transfer.id);
    try {
      if (kind === 'approve') {
        const res = await approvePharmacyTransfer(transfer.id);
        if (res && res.ok) {
          Alert.alert('Transfer approved', `${transfer.transferNumber} is now Completed — Pharmacy Inventory has been updated.`);
        }
      } else {
        const res = await cancelPharmacyTransfer(transfer.id);
        if (res && res.ok) {
          Alert.alert('Transfer cancelled', `${transfer.transferNumber} is marked Cancelled. Nothing was added to Pharmacy Inventory.`);
        }
      }
    } catch {
      // context already surfaced the exact error
    } finally {
      setBusyId(null);
    }
  }

  function confirmApprove(transfer) {
    const lines = transfer.items.map((i) => `• ${i.name} ×${i.qty}${i.batch ? ` (batch ${i.batch})` : ''}`).join('\n');
    Alert.alert(
      'Approve transfer?',
      `${transfer.transferNumber}\n\n${lines}\n\nThis adds the above to Pharmacy Inventory and cannot be undone.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Approve', style: 'default', onPress: () => runAction('approve', transfer) },
      ],
    );
  }

  function confirmCancel(transfer) {
    Alert.alert(
      'Cancel transfer?',
      `${transfer.transferNumber} will be marked Cancelled. Pharmacy Inventory will not be changed. The record is kept in Transfer History.`,
      [
        { text: 'Keep pending', style: 'cancel' },
        { text: 'Cancel transfer', style: 'destructive', onPress: () => runAction('cancel', transfer) },
      ],
    );
  }

  function approveAll() {
    Alert.alert(
      `Approve all ${pendingPharmacyTransfers.length}?`,
      'Every pending transfer will be applied to Pharmacy Inventory, one after another. Review the list first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve all',
          onPress: async () => {
            // snapshot so the shrinking list doesn't skip entries
            const list = [...pendingPharmacyTransfers];
            for (const t of list) {
              setBusyId(t.id);
              try { await approvePharmacyTransfer(t.id); } catch { /* keep going; error already shown */ }
            }
            setBusyId(null);
          },
        },
      ],
    );
  }

  if (loading) return <ScreenLoading />;

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Pending Stock Transfers</Text>
        <Text style={styles.subtitle}>
          {pendingPharmacyTransfers.length
            ? `${pendingPharmacyTransfers.length} awaiting your approval · Pharmacy Inventory updates only when you approve`
            : 'Nothing pending'}
        </Text>
        {canWriteWarehouse && pendingPharmacyTransfers.length > 1 ? (
          <AnimatedPressable style={styles.approveAllBtn} onPress={approveAll} disabled={!!busyId}>
            <Text style={styles.approveAllText}>Approve All ({pendingPharmacyTransfers.length})</Text>
          </AnimatedPressable>
        ) : null}
      </View>

      <FlatList
        data={pendingPharmacyTransfers}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
        ListEmptyComponent={
          <EmptyState
            text="No pending transfers. Stock moved to the Pharmacy from Main Stock appears here for you to receive and approve."
            icon="🔔"
          />
        }
        renderItem={({ item: t, index }) => {
          const busy = busyId === t.id;
          return (
            <Card index={index} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.trNo}>{t.transferNumber}</Text>
                <Badge label="Pending" color={theme.warning} />
              </View>
              <Text style={styles.meta}>
                From: {t.fromLocationName || 'Warehouse'}  →  To: {t.toLocationName || 'VHC Pharmacy'}
              </Text>
              <Text style={styles.meta}>{formatDateTime(t.createdAt)}</Text>

              <View style={styles.itemsBox}>
                {t.items.map((i, k) => (
                  <View key={k} style={styles.itemLine}>
                    <Text style={styles.itemName}>{i.name}</Text>
                    <Text style={styles.itemDetail}>
                      Qty {i.qty} · Batch {i.batch || '—'}{i.expiry ? ` · Exp ${formatDate(i.expiry)}` : ''}
                    </Text>
                  </View>
                ))}
              </View>

              {canWriteWarehouse ? (
                <View style={styles.actions}>
                  <AnimatedPressable style={[styles.cancelBtn, busy && styles.btnDisabled]} onPress={() => confirmCancel(t)} disabled={busy}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </AnimatedPressable>
                  <AnimatedPressable style={[styles.approveBtn, busy && styles.btnDisabled]} onPress={() => confirmApprove(t)} disabled={busy}>
                    <Text style={styles.approveBtnText}>{busy ? 'Working…' : 'Approve / Update Pharmacy'}</Text>
                  </AnimatedPressable>
                </View>
              ) : (
                <Text style={styles.readOnlyNote}>Approving transfers needs warehouse write access.</Text>
              )}
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { padding: 16, paddingBottom: 8 },
  title: { color: t.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: t.muted, fontSize: 12, marginTop: 4 },
  approveAllBtn: {
    marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 14, height: 40,
    borderRadius: 12, borderWidth: 1, borderColor: `${t.accent}66`, backgroundColor: `${t.accent}1f`,
    alignItems: 'center', justifyContent: 'center',
  },
  approveAllText: { color: t.accent, fontWeight: '800', fontSize: 13 },
  list: { padding: 16, paddingTop: 8, paddingBottom: 40 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  trNo: { color: t.text, fontSize: 15, fontWeight: '800' },
  meta: { color: t.muted, fontSize: 12, marginTop: 2 },
  itemsBox: { marginTop: 10, borderTopWidth: 1, borderTopColor: t.panelBorder, paddingTop: 8 },
  itemLine: { paddingVertical: 5 },
  itemName: { color: t.text, fontSize: 14, fontWeight: '700' },
  itemDetail: { color: t.muted, fontSize: 12, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 14 },
  cancelBtn: {
    flex: 1, minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: t.panelBorder,
    backgroundColor: t.panel, alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { color: t.danger, fontWeight: '700', fontSize: 15 },
  approveBtn: {
    flex: 2, minHeight: 50, borderRadius: 12, backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
  approveBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 14, textAlign: 'center' },
  btnDisabled: { opacity: 0.5 },
  readOnlyNote: { color: t.muted, fontSize: 12, fontStyle: 'italic', marginTop: 12 },
});
