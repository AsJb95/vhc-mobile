import { useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Badge, EmptyState, ScreenLoading, AnimatedPressable, Screen } from '../components/UI';
import { formatDateTime, formatDate } from '../lib/format';

// Pharmacy-side inbox for Warehouse -> Pharmacy stock requests. A "Move" in
// Warehouse creates a Pending row and changes NO stock; here the Pharmacy
// Accepts (deduct Main Stock, add Pharmacy Inventory, mark Completed) or Rejects
// (mark Rejected, no stock change). Nothing happens on its own.
export default function PendingTransfersScreen() {
  const {
    pendingPharmacyTransfers, approvePharmacyTransfer, cancelPharmacyTransfer,
    loading, refreshing, refresh,
  } = useWarehouse();
  const { canWriteWarehouse } = useAuth();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [busyId, setBusyId] = useState(null);

  async function runAction(kind, req) {
    setBusyId(req.id);
    try {
      if (kind === 'accept') {
        const res = await approvePharmacyTransfer(req.id);
        if (res && res.ok) Alert.alert('Request accepted', `${req.transferNumber} is Completed — Main Stock was reduced and Pharmacy Inventory updated.`);
      } else {
        const res = await cancelPharmacyTransfer(req.id);
        if (res && res.ok) Alert.alert('Request rejected', `${req.transferNumber} is marked Rejected. No stock was changed.`);
      }
    } catch {
      // context already surfaced the exact error
    } finally {
      setBusyId(null);
    }
  }

  function confirmAccept(req) {
    const lines = req.items.map((i) => `• ${i.name} ×${i.qty}${i.batch ? ` (batch ${i.batch})` : ''}`).join('\n');
    Alert.alert(
      'Accept this request?',
      `${req.transferNumber}\n\n${lines}\n\nThis deducts the above from Main Stock and adds it to Pharmacy Inventory. It cannot be undone.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Accept', onPress: () => runAction('accept', req) },
      ],
    );
  }

  function confirmReject(req) {
    Alert.alert(
      'Reject this request?',
      `${req.transferNumber} will be marked Rejected. No stock changes. The record stays in Transfer History.`,
      [
        { text: 'Keep pending', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => runAction('reject', req) },
      ],
    );
  }

  function acceptAll() {
    Alert.alert(
      `Accept all ${pendingPharmacyTransfers.length}?`,
      'Each request is accepted one after another — Main Stock reduced, Pharmacy Inventory updated. Review the list first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept all',
          onPress: async () => {
            const list = [...pendingPharmacyTransfers]; // snapshot; the list shrinks as we go
            for (const req of list) {
              setBusyId(req.id);
              try { await approvePharmacyTransfer(req.id); } catch { /* keep going; error already shown */ }
            }
            setBusyId(null);
          },
        },
      ],
    );
  }

  if (loading) return <ScreenLoading />;

  return (
    <Screen edges={[]}>
      <View style={styles.header}>
        <Text style={styles.subtitle}>
          {pendingPharmacyTransfers.length
            ? `${pendingPharmacyTransfers.length} awaiting your decision · Pharmacy Inventory changes only when you Accept`
            : 'Nothing pending'}
        </Text>
        {canWriteWarehouse && pendingPharmacyTransfers.length > 1 ? (
          <AnimatedPressable style={styles.acceptAllBtn} onPress={acceptAll} disabled={!!busyId}>
            <Text style={styles.acceptAllText}>Accept All ({pendingPharmacyTransfers.length})</Text>
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
            text="No pending requests. When Warehouse moves stock to the Pharmacy it appears here for you to Accept or Reject."
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
              <Text style={styles.meta}>From: {t.fromLocationName || 'Warehouse'}  →  To: {t.toLocationName || 'VHC Pharmacy'}</Text>
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
                  <AnimatedPressable style={[styles.rejectBtn, busy && styles.btnDisabled]} onPress={() => confirmReject(t)} disabled={busy}>
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </AnimatedPressable>
                  <AnimatedPressable style={[styles.acceptBtn, busy && styles.btnDisabled]} onPress={() => confirmAccept(t)} disabled={busy}>
                    <Text style={styles.acceptBtnText}>{busy ? 'Working…' : 'Accept — update Pharmacy'}</Text>
                  </AnimatedPressable>
                </View>
              ) : (
                <Text style={styles.readOnlyNote}>Accepting or rejecting a request needs warehouse write access.</Text>
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
  subtitle: { color: t.muted, fontSize: 12 },
  acceptAllBtn: {
    marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 14, height: 40,
    borderRadius: 12, borderWidth: 1, borderColor: `${t.accent}66`, backgroundColor: `${t.accent}1f`,
    alignItems: 'center', justifyContent: 'center',
  },
  acceptAllText: { color: t.accent, fontWeight: '800', fontSize: 13 },
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
  rejectBtn: {
    flex: 1, minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: t.panelBorder,
    backgroundColor: t.panel, alignItems: 'center', justifyContent: 'center',
  },
  rejectBtnText: { color: t.danger, fontWeight: '700', fontSize: 15 },
  acceptBtn: {
    flex: 2, minHeight: 50, borderRadius: 12, backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8,
  },
  acceptBtnText: { color: t.onAccent, fontWeight: '800', fontSize: 14, textAlign: 'center' },
  btnDisabled: { opacity: 0.5 },
  readOnlyNote: { color: t.muted, fontSize: 12, fontStyle: 'italic', marginTop: 12 },
});
