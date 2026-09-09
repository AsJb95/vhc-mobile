import { useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Alert } from 'react-native';
import { useWarehouse } from '../context/WarehouseContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Badge, EmptyState, ScreenLoading, AnimatedPressable, Screen } from '../components/UI';
import { formatDateTime, formatDate } from '../lib/format';

// Warehouse-side inbox for Pharmacy -> Warehouse stock returns. The Pharmacy
// user creates a Pending row (from their Pharmacy Stock) and changes NO stock;
// here the Warehouse Accepts (deduct Pharmacy Stock, add Main Stock, mark
// Completed) or Rejects (mark Rejected, no stock change). Mirror of
// PendingTransfersScreen, opposite direction.
export default function PendingReturnsScreen() {
  const {
    pendingStockReturns, approveStockReturn, rejectStockReturn,
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
        const res = await approveStockReturn(req.id);
        if (res && res.ok) Alert.alert('Return accepted', `${req.transferNumber} is Completed — Pharmacy Stock was reduced and Main Stock updated.`);
      } else {
        const res = await rejectStockReturn(req.id);
        if (res && res.ok) Alert.alert('Return rejected', `${req.transferNumber} is marked Rejected. No stock was changed.`);
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
      'Accept this return?',
      `${req.transferNumber}\n\n${lines}\n\nThis deducts the above from Pharmacy Stock and adds it back to Main Stock. It cannot be undone.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Accept', onPress: () => runAction('accept', req) },
      ],
    );
  }

  function confirmReject(req) {
    Alert.alert(
      'Reject this return?',
      `${req.transferNumber} will be marked Rejected. No stock changes. The record stays in Transfer History.`,
      [
        { text: 'Keep pending', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => runAction('reject', req) },
      ],
    );
  }

  if (loading) return <ScreenLoading />;

  return (
    <Screen edges={[]}>
      <View style={styles.header}>
        <Text style={styles.subtitle}>
          {pendingStockReturns.length
            ? `${pendingStockReturns.length} return request(s) awaiting your decision · Main Stock changes only when you Accept`
            : 'Nothing pending'}
        </Text>
      </View>

      <FlatList
        data={pendingStockReturns}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
        ListEmptyComponent={
          <EmptyState
            text="No pending returns. When the Pharmacy sends stock back it appears here for you to Accept or Reject."
            icon="↩️"
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
              <Text style={styles.meta}>From: {t.fromLocationName || 'VHC Pharmacy'}  →  To: {t.toLocationName || 'Main Warehouse'}</Text>
              <Text style={styles.meta}>{formatDateTime(t.createdAt)}</Text>
              {t.notes ? <Text style={styles.reason}>{t.notes}</Text> : null}

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
                    <Text style={styles.acceptBtnText}>{busy ? 'Working…' : 'Accept — return to Main Stock'}</Text>
                  </AnimatedPressable>
                </View>
              ) : (
                <Text style={styles.readOnlyNote}>Accepting or rejecting a return needs warehouse write access.</Text>
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
  list: { padding: 16, paddingTop: 8, paddingBottom: 40 },
  card: { marginBottom: 12 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  trNo: { color: t.text, fontSize: 15, fontWeight: '800' },
  meta: { color: t.muted, fontSize: 12, marginTop: 2 },
  reason: { color: t.text, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
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
