import { Text, ScrollView, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useWarehouse } from '../context/WarehouseContext';
import { Card, AnimatedPressable, Screen } from '../components/UI';
import { colors } from '../lib/format';

const ROLE_LABELS = {
  admin: 'Admin',
  warehouse_manager: 'Warehouse Manager',
  pharmacist: 'Pharmacist',
  viewer: 'Viewer',
};

export default function SettingsScreen() {
  const { user, role, signOut } = useAuth();
  const { settings, locations } = useWarehouse();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        <Card index={0} style={styles.card}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Text style={styles.row}>{user?.email}</Text>
          <Text style={styles.roleBadge}>{ROLE_LABELS[role] || 'No role assigned'}</Text>
        </Card>

        <Card index={1} style={styles.card}>
          <Text style={styles.sectionTitle}>Alert Thresholds</Text>
          <Text style={styles.row}>Low stock below {settings.lowStockThreshold} units</Text>
          <Text style={styles.row}>Expiry alert within {settings.expiryAlertDays} days</Text>
          <Text style={styles.hint}>Change these from the Warehouse desktop app's Settings page.</Text>
        </Card>

        <Card index={2} style={styles.card}>
          <Text style={styles.sectionTitle}>Locations</Text>
          {locations.map((l) => (
            <Text key={l.id} style={styles.row}>{l.name} ({l.type.replace(/_/g, ' ')})</Text>
          ))}
        </Card>

        <AnimatedPressable style={styles.signOutBtn} onPress={signOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </AnimatedPressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginBottom: 16 },
  card: { marginBottom: 12 },
  sectionTitle: { color: colors.text, fontWeight: '600', fontSize: 14, marginBottom: 8 },
  row: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  roleBadge: { color: colors.accent, fontWeight: '600', marginTop: 4 },
  hint: { color: colors.muted, fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  signOutBtn: { marginTop: 8, backgroundColor: colors.danger, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  signOutText: { color: '#fff', fontWeight: '700' },
});
