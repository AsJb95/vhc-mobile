import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Modal, ActivityIndicator, TextInput, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useWarehouse } from '../context/WarehouseContext';
import { Card, Badge, EmptyState, Screen, AnimatedPressable } from '../components/UI';
import { listDriveBackups, restorePharmacyBackup, previewWarehouseRestore } from '../lib/adminApi';
import { formatBytes, formatDateTime, colors } from '../lib/format';

const APP_META = {
  warehouse: { label: 'Warehouse', color: colors.accent },
  pharmacy: { label: 'Pharmacy', color: colors.purple },
  other: { label: 'Other', color: colors.muted },
};

// Encrypted (password-protected) Warehouse backup restore is not implemented
// end to end yet — the edge function currently ignores the supplied password.
// Keep the entry point hidden until decryption lands so no one relies on a
// no-op "restore". Flip to true once previewWarehouseRestore actually decrypts.
const ENCRYPTED_RESTORE_ENABLED = false;

export default function BackupManagerScreen({ visible, onClose }) {
  const { session } = useAuth();
  const { refresh: refreshWarehouseData } = useWarehouse();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [passwordPromptFor, setPasswordPromptFor] = useState(null);
  const [password, setPassword] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await listDriveBackups(session.access_token);
      setBackups(list);
    } catch (e) {
      setError(e.message || String(e));
    }
  }, [session]);

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
      const result = await restorePharmacyBackup(session.access_token, backup.id);
      await refreshWarehouseData(); // auto-refresh so Pharmacy Stock shows the new data immediately
      Alert.alert('Restored', `Pharmacy Stock now has ${result.imported} item(s) from this backup${result.skipped ? ` (${result.skipped} skipped — missing a name)` : ''}.`);
    } catch (e) {
      Alert.alert('Restore failed', e.message || String(e));
    } finally {
      setRestoringId(null);
    }
  }

  async function doWarehouseRestore(backup) {
    if (!password) {
      Alert.alert('Password required', 'Enter the backup password to continue.');
      return;
    }
    setRestoringId(backup.id);
    try {
      const result = await previewWarehouseRestore(session.access_token, backup.id, password);
      Alert.alert('Warehouse backup', result.note || 'Decrypted successfully.');
    } catch (e) {
      Alert.alert('Restore failed', e.message || String(e));
    } finally {
      setRestoringId(null);
      setPasswordPromptFor(null);
      setPassword('');
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <View style={styles.header}>
          <Text style={styles.title}>Backup Manager</Text>
          <Text style={styles.subtitle}>Restore Warehouse or Pharmacy data from a Google Drive backup</Text>
        </View>

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View>
        ) : error ? (
          <EmptyState text={`Failed to load: ${error}`} icon="⚠️" />
        ) : (
          <FlatList
            data={backups}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
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

                  {item.encrypted && !ENCRYPTED_RESTORE_ENABLED && (
                    <Text style={styles.itemMeta}>
                      🔒 Encrypted — restore from the desktop Warehouse app for now.
                    </Text>
                  )}

                  {item.encrypted && ENCRYPTED_RESTORE_ENABLED && (
                    <>
                      {passwordPromptFor === item.id ? (
                        <View style={{ marginTop: 10 }}>
                          <TextInput
                            style={styles.passwordInput}
                            placeholder="Backup password"
                            placeholderTextColor={colors.muted}
                            secureTextEntry
                            value={password}
                            onChangeText={setPassword}
                          />
                          <View style={styles.row}>
                            <AnimatedPressable style={[styles.restoreBtn, { flex: 1 }]} onPress={() => doWarehouseRestore(item)} disabled={isRestoring}>
                              <Text style={styles.restoreBtnText}>{isRestoring ? 'Checking...' : 'Confirm'}</Text>
                            </AnimatedPressable>
                            <AnimatedPressable style={[styles.cancelSmallBtn, { flex: 1 }]} onPress={() => { setPasswordPromptFor(null); setPassword(''); }}>
                              <Text style={styles.cancelSmallBtnText}>Cancel</Text>
                            </AnimatedPressable>
                          </View>
                        </View>
                      ) : (
                        <AnimatedPressable style={styles.restoreBtnMuted} onPress={() => setPasswordPromptFor(item.id)}>
                          <Text style={styles.restoreBtnMutedText}>Restore Warehouse Backup (🔒 needs password)</Text>
                        </AnimatedPressable>
                      )}
                    </>
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

const styles = StyleSheet.create({
  header: { padding: 16, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 4 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  itemName: { color: colors.text, fontWeight: '600', fontSize: 14, flex: 1 },
  itemMeta: { color: colors.muted, fontSize: 12 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  restoreBtn: { marginTop: 10, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  restoreBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  restoreBtnMuted: { marginTop: 10, backgroundColor: colors.panelBorder, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  restoreBtnMutedText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  cancelSmallBtn: { marginTop: 10, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  cancelSmallBtnText: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  passwordInput: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder, borderRadius: 10,
    color: colors.text, paddingHorizontal: 12, paddingVertical: 10,
  },
  closeBtn: { padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.panelBorder },
  closeBtnText: { color: colors.accent, fontWeight: '600' },
});
