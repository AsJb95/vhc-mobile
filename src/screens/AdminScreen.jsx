import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Card, Badge, EmptyState, Screen, AnimatedPressable } from '../components/UI';
import BackupManagerScreen from './BackupManagerScreen';
import { listDriveBackups, getDriveBackupContent } from '../lib/adminApi';
import { formatBytes, formatDateTime, colors } from '../lib/format';

const APP_META = {
  warehouse: { label: 'Warehouse', color: colors.accent },
  pharmacy: { label: 'Pharmacy', color: colors.purple },
  other: { label: 'Other', color: colors.muted },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'pharmacy', label: 'Pharmacy' },
];

function summarize(obj) {
  return Object.entries(obj).map(([key, value]) => {
    if (Array.isArray(value)) return { key, summary: `${value.length} item(s)` };
    if (value && typeof value === 'object') return { key, summary: `${Object.keys(value).length} field(s)` };
    const str = String(value ?? '—');
    return { key, summary: str.length > 60 ? `${str.slice(0, 60)}...` : str };
  });
}

export default function AdminScreen() {
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  const [viewing, setViewing] = useState(null); // backup entry being viewed
  const [content, setContent] = useState(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

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
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function openBackup(item) {
    setViewing(item);
    setContent(null);
    setShowRaw(false);
    setContentLoading(true);
    try {
      const data = await getDriveBackupContent(accessToken, item.id);
      setContent(data);
    } catch (e) {
      setContent({ error: e.message || String(e) });
    } finally {
      setContentLoading(false);
    }
  }

  const filtered = filter === 'all' ? backups : backups.filter((b) => b.app === filter);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Backups</Text>
        <Text style={styles.subtitle}>Read-only viewer for Warehouse + Pharmacy Google Drive backups</Text>
        <AnimatedPressable style={styles.managerBtn} onPress={() => setManagerOpen(true)}>
          <Text style={styles.managerBtnText}>Open Backup Manager (Restore)</Text>
        </AnimatedPressable>
        <View style={styles.tabRow}>
          {FILTERS.map((f) => (
            <AnimatedPressable key={f.key} style={[styles.tabBtn, filter === f.key && styles.tabBtnActive]} onPress={() => setFilter(f.key)}>
              <Text style={[styles.tabText, filter === f.key && styles.tabTextActive]}>{f.label}</Text>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View>
      ) : error ? (
        <EmptyState text={`Failed to load: ${error}`} icon="⚠️" />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListEmptyComponent={<EmptyState text="No backups found" icon="🗄️" />}
          renderItem={({ item, index }) => {
            const meta = APP_META[item.app] || APP_META.other;
            return (
              <AnimatedPressable onPress={() => openBackup(item)}>
                <Card index={index} style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                    <Badge label={meta.label} color={meta.color} />
                  </View>
                  <Text style={styles.itemMeta}>{formatDateTime(item.modifiedAt)} · {formatBytes(item.size)}</Text>
                  {item.encrypted ? <Text style={styles.encryptedNote}>🔒 Encrypted — password-protected viewing coming soon</Text> : null}
                </Card>
              </AnimatedPressable>
            );
          }}
        />
      )}

      <Modal visible={!!viewing} animationType="slide" onRequestClose={() => setViewing(null)}>
        <Screen>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalTitle}>{viewing?.name}</Text>
            {viewing ? <Text style={styles.itemMeta}>{formatDateTime(viewing.modifiedAt)} · {formatBytes(viewing.size)}</Text> : null}

            {contentLoading && <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />}

            {!contentLoading && content?.error && (
              <Text style={styles.errorText}>Failed to load: {content.error}</Text>
            )}

            {!contentLoading && content?.encrypted && (
              <Card style={{ marginTop: 16 }}>
                <Text style={styles.itemMeta}>
                  🔒 This backup is password-encrypted (AES-256-GCM), same as the desktop app's local backups.
                  Decrypted viewing from the Admin App isn't built yet — this is planned for a future update.
                </Text>
              </Card>
            )}

            {!contentLoading && content?.json && !showRaw && (
              <>
                <Text style={styles.sectionTitle}>Summary</Text>
                {summarize(content.json).map(({ key, summary }) => (
                  <Card key={key} style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>{key}</Text>
                    <Text style={styles.summaryValue}>{summary}</Text>
                  </Card>
                ))}
                <AnimatedPressable style={styles.rawBtn} onPress={() => setShowRaw(true)}>
                  <Text style={styles.rawBtnText}>View Raw JSON</Text>
                </AnimatedPressable>
              </>
            )}

            {!contentLoading && content?.json && showRaw && (
              <>
                <AnimatedPressable style={styles.rawBtn} onPress={() => setShowRaw(false)}>
                  <Text style={styles.rawBtnText}>Back to Summary</Text>
                </AnimatedPressable>
                <Card style={{ marginTop: 10 }}>
                  <Text style={styles.rawText}>{JSON.stringify(content.json, null, 2)}</Text>
                </Card>
              </>
            )}

            {!contentLoading && content && !content.error && !content.encrypted && !content.json && (
              <Text style={styles.errorText}>
                This backup could not be read — the server returned no usable content.
              </Text>
            )}
          </ScrollView>
          <AnimatedPressable style={styles.closeBtn} onPress={() => setViewing(null)}>
            <Text style={styles.closeBtnText}>Close</Text>
          </AnimatedPressable>
        </Screen>
      </Modal>

      <BackupManagerScreen visible={managerOpen} onClose={() => setManagerOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: 12 },
  managerBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginBottom: 12 },
  managerBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  tabRow: { flexDirection: 'row', gap: 6 },
  tabBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder },
  tabBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 12 },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  itemName: { color: colors.text, fontWeight: '600', fontSize: 14, flex: 1 },
  itemMeta: { color: colors.muted, fontSize: 12 },
  encryptedNote: { color: colors.warning, fontSize: 11, marginTop: 6 },
  modalContent: { padding: 16, paddingBottom: 32 },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  errorText: { color: colors.danger, marginTop: 16 },
  sectionTitle: { color: colors.text, fontWeight: '700', fontSize: 15, marginTop: 16, marginBottom: 10 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, paddingVertical: 10 },
  summaryKey: { color: colors.muted, fontSize: 13 },
  summaryValue: { color: colors.text, fontSize: 13, fontWeight: '600' },
  rawBtn: { marginTop: 12, alignItems: 'center', padding: 10 },
  rawBtnText: { color: colors.accent, fontWeight: '600' },
  rawText: { color: colors.text, fontSize: 11, fontFamily: 'monospace' },
  closeBtn: { padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.panelBorder },
  closeBtnText: { color: colors.accent, fontWeight: '600' },
});
