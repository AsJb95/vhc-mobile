import { Text, View, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useWarehouse } from '../context/WarehouseContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, AnimatedPressable, Screen } from '../components/UI';

const ROLE_LABELS = {
  admin: 'Admin',
  warehouse_manager: 'Warehouse Manager',
  pharmacist: 'Pharmacist',
  viewer: 'Viewer',
};

const THEME_OPTIONS = [
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export default function SettingsScreen() {
  const { user, role, signOut } = useAuth();
  const { settings, locations } = useWarehouse();
  const { theme, scheme, setScheme } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
          <Text style={styles.sectionTitle}>Theme</Text>
          <Text style={styles.row}>Choose how VHC looks on this device.</Text>
          <View style={styles.segmented}>
            {THEME_OPTIONS.map((opt) => {
              const active = scheme === opt.key;
              return (
                <AnimatedPressable
                  key={opt.key}
                  style={[styles.seg, active && styles.segActive]}
                  onPress={() => setScheme(opt.key)}
                >
                  <Ionicons
                    name={opt.icon}
                    size={16}
                    color={active ? theme.onAccent : theme.muted}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.segText, active && styles.segTextActive]}>{opt.label}</Text>
                </AnimatedPressable>
              );
            })}
          </View>
          <Text style={styles.hint}>Your choice is saved and restored the next time you open the app.</Text>
        </Card>

        <Card index={2} style={styles.card}>
          <Text style={styles.sectionTitle}>Alert Thresholds</Text>
          <Text style={styles.row}>Low stock below {settings.lowStockThreshold} units</Text>
          <Text style={styles.row}>Expiry alert within {settings.expiryAlertDays} days</Text>
          <Text style={styles.hint}>Change these from the Warehouse desktop app&apos;s Settings page.</Text>
        </Card>

        <Card index={3} style={styles.card}>
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

const makeStyles = (t) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  title: { color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginBottom: 16 },
  card: { marginBottom: 12 },
  sectionTitle: { color: t.text, fontWeight: '600', fontSize: 14, marginBottom: 8 },
  row: { color: t.muted, fontSize: 13, marginBottom: 4 },
  roleBadge: { color: t.accent, fontWeight: '600', marginTop: 4 },
  hint: { color: t.muted, fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  segmented: {
    flexDirection: 'row', backgroundColor: t.chip, borderRadius: 12,
    borderWidth: 1, borderColor: t.panelBorder, padding: 4, marginTop: 10,
  },
  seg: { flex: 1, flexDirection: 'row', paddingVertical: 9, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segActive: { backgroundColor: t.accent },
  segText: { color: t.muted, fontSize: 13, fontWeight: '600' },
  segTextActive: { color: t.onAccent, fontWeight: '700' },
  signOutBtn: { marginTop: 8, backgroundColor: t.danger, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  signOutText: { color: t.onAccent, fontWeight: '700' },
});
