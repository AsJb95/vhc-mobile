import { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Modal, ActivityIndicator, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useWarehouse } from '../context/WarehouseContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, Badge, EmptyState, Screen, AnimatedPressable } from '../components/UI';
import { listDriveBackups, restorePharmacyBackup } from '../lib/adminApi';
import { formatBytes, formatDateTime } from '../lib/format';

const appMeta = (t) => ({
  warehouse: { label: 'Warehouse', color: t.accent },
  pharmacy: { label: 'Pharmacy', color: t.purple },
  other: { label: 'Other', color: t.muted },
});

// Only the unencrypted Pharmacy restore is wired end to end. Encrypted
// (password-protected) Warehouse backups are restored from the desktop app —
// decrypting them here is not built yet, so those rows just say so.
export default function BackupManagerScreen({ visible, onClose }) {
  const { session } = useAuth();
  const { refresh: refreshWarehouseData } = useWarehouse();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const APP_META = useMemo(() => appMeta(theme), [theme]);
  const accessToken = session?.access_token;
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await listDriveBackups(accessToken);
      setBackups(list);
    } catch (e) {
      setError(e.message || String(e));
    }
  }, [accessToken]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [visible, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function confirmRestorePharmacy(backup) {
    Alert.alert(
      'Restore Pharmacy Backup?',
      `This replaces ALL current Pharmacy Stock data with the contents of "${backup.name}" (${formatDateTime(backup.modifiedAt)}). Main Stock and every other location are never touched. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', style: 'destructive', onPress: () => doRestorePharmacy(backup) },
      ],
    );
  }

  async function doRestorePharmacy(backup) {
    setRestoringId(backup.id);
    try {
      const result = await restorePharmacyBackup(accessToken, backup.id);
      await refreshWarehouseData(); // so Pharmacy Stock shows the new data immediately
      const imported = result?.imported ?? 0;
      const skipped = result?.skipped ?? 0;
      Alert.alert('Restored', `Pharmacy Stock now has ${imported} item(s) from this backup${skipped ? ` (${skipped} skipped — missing a name)` : ''}.`);
    } catch (e) {
      Alert.alert('Restore failed', e.message || String(e));
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <View style={styles.header}>
          <Text style={styles.title}>Backup Manager</Text>
          <Text style={styles.subtitle}>Restore Pharmacy data from a Google Drive backup</Text>
        </View>

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={theme.accent} size="large" /></View>
        ) : error ? (
          <EmptyState text={`Failed to load: ${error}`} icon="⚠️" />
        ) : (
          <FlatList
            data={backups}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
            ListEmptyComponent={<EmptyState text="No backups found" icon="🗄️" />}
            renderItem={({ item, index }) => {
              const meta = APP_META[item.app] || APP_META.other;
              const isRestoring = restoringId === item.id;
              return (
                <Card index={index} style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                    <Badge label={meta.label} color={meta.color} />
                  </View>
                  <Text style={styles.itemMeta}>{formatDateTime(item.modifiedAt)} · {formatBytes(item.size)}</Text>

                  {item.app === 'pharmacy' && !item.encrypted && (
                    <AnimatedPressable
                      style={styles.restoreBtn}
                      onPress={() => confirmRestorePharmacy(item)}
                      disabled={isRestoring}
                    >
                      <Text style={styles.restoreBtnText}>{isRestoring ? 'Restoring...' : 'Restore Pharmacy Backup'}</Text>
                    </AnimatedPressable>
                  )}

                  {item.encrypted && (
                    <Text style={styles.itemMeta}>
                      🔒 Encrypted — restore this from the desktop Warehouse app.
                    </Text>
                  )}
                </Card>
              );
            }}
          />
        )}

        <AnimatedPressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Close</Text>
        </AnimatedPressable>
      </Screen>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  header: { padding: 16, paddingBottom: 8 },
  title: { color: t.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: t.muted, fontSize: 12, marginTop: 4 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  itemName: { color: t.text, fontWeight: '600', fontSize: 14, flex: 1 },
  itemMeta: { color: t.muted, fontSize: 12 },
  restoreBtn: { marginTop: 10, backgroundColor: t.accent, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  restoreBtnText: { color: t.onAccent, fontWeight: '700', fontSize: 13 },
  closeBtn: { padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: t.panelBorder },
  closeBtnText: { color: t.accent, fontWeight: '600' },
});
