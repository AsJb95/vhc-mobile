import { Text, View, ScrollView, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import appConfig from '../../app.json';
import { useWarehouse } from '../context/WarehouseContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Card, AnimatedPressable, Screen } from '../components/UI';

export default function SettingsScreen() {
  const { user, role, isPlatformAdmin, clinicName, signOut } = useAuth();
  const { settings, locations } = useWarehouse();
  const { theme, scheme, setScheme, themeList } = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Server-verified account type (profiles.is_platform_admin) — never email,
  // never a local flag. Updates automatically when the signed-in user changes.
  const accountType = isPlatformAdmin ? 'Platform Admin' : ({ admin: 'Clinic Admin', pharmacist: 'Pharmacy Staff', warehouse_manager: 'Warehouse Staff', viewer: 'Viewer' }[role] || 'No assigned role');

  function confirmSignOut() {
    Alert.alert('Sign out', 'Sign out of this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { signOut(); } },
    ]);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        <Card index={0} style={styles.card}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Text style={styles.row}>App version {appConfig.expo.version} ({appConfig.expo.android.versionCode})</Text>
          <Text style={styles.row}>{user?.email}</Text>
          <Text style={styles.roleBadge}>{accountType}</Text>
          {clinicName ? <Text style={styles.row}>{clinicName}</Text> : null}
        </Card>

        <Card index={1} style={styles.card}>
          <View style={styles.themeHeaderRow}>
            <Text style={styles.sectionTitle}>Appearance & Themes</Text>
            <View style={styles.currentThemeBadge}>
              <Text style={styles.currentThemeBadgeText}>
                {themeList.find((t) => t.key === scheme)?.name || 'Custom'}
              </Text>
            </View>
          </View>
          <Text style={styles.row}>Select a visual style tailored to your environment.</Text>

          <View style={styles.themeGrid}>
            {themeList.map((opt) => {
              const active = scheme === opt.key;
              return (
                <AnimatedPressable
                  key={opt.key}
                  style={[
                    styles.themeCard,
                    active && styles.themeCardActive,
                  ]}
                  onPress={() => setScheme(opt.key)}
                >
                  <View style={styles.themeCardTop}>
                    <View style={styles.themeCardHeader}>
                      <View style={[styles.iconCircle, active && styles.iconCircleActive]}>
                        <Ionicons
                          name={opt.icon}
                          size={18}
                          color={active ? theme.onAccent : theme.accent}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.themeNameRow}>
                          <Text style={[styles.themeCardTitle, active && styles.themeCardTitleActive]}>
                            {opt.name}
                          </Text>
                          <View style={styles.categoryPill}>
                            <Text style={styles.categoryPillText}>{opt.category}</Text>
                          </View>
                        </View>
                        <Text style={styles.themeCardDesc} numberOfLines={2}>
                          {opt.description}
                        </Text>
                      </View>
                    </View>

                    <View style={[styles.checkCircle, active && styles.checkCircleActive]}>
                      {active ? (
                        <Ionicons name="checkmark" size={14} color={theme.onAccent} />
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.paletteRow}>
                    <Text style={styles.paletteLabel}>Palette:</Text>
                    <View style={styles.swatchGroup}>
                      {opt.previewColors.map((hex, i) => (
                        <View
                          key={i}
                          style={[
                            styles.swatchCircle,
                            { backgroundColor: hex },
                            i === 0 && { borderWidth: 1, borderColor: '#ffffff22' },
                          ]}
                        />
                      ))}
                    </View>
                  </View>
                </AnimatedPressable>
              );
            })}
          </View>
          <Text style={styles.hint}>
            {scheme === 'system'
              ? 'Currently adapting to your Android system appearance.'
              : 'Theme preference is saved offline and persists across restarts.'}
          </Text>
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

        <AnimatedPressable style={styles.signOutBtn} onPress={confirmSignOut}>
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
  sectionTitle: { color: t.text, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  themeHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  currentThemeBadge: {
    backgroundColor: `${t.accent}22`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${t.accent}44`,
  },
  currentThemeBadgeText: { color: t.accent, fontSize: 11, fontWeight: '700' },
  row: { color: t.muted, fontSize: 13, marginBottom: 8 },
  roleBadge: { color: t.accent, fontWeight: '600', marginTop: 4 },
  hint: { color: t.muted, fontSize: 11, marginTop: 10, fontStyle: 'italic' },

  themeGrid: { marginTop: 6, gap: 8 },
  themeCard: {
    backgroundColor: t.chip,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.panelBorder,
    padding: 12,
  },
  themeCardActive: {
    borderColor: t.accent,
    backgroundColor: `${t.accent}14`,
  },
  themeCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  themeCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${t.accent}18`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleActive: {
    backgroundColor: t.accent,
  },
  themeNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  themeCardTitle: { color: t.text, fontSize: 14, fontWeight: '700' },
  themeCardTitleActive: { color: t.accent },
  categoryPill: {
    backgroundColor: `${t.muted}1a`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryPillText: { color: t.muted, fontSize: 10, fontWeight: '600' },
  themeCardDesc: { color: t.muted, fontSize: 11, marginTop: 2 },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: t.panelBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  checkCircleActive: {
    backgroundColor: t.accent,
    borderColor: t.accent,
  },

  paletteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: `${t.panelBorder}88`,
  },
  paletteLabel: { color: t.muted, fontSize: 10, fontWeight: '600' },
  swatchGroup: { flexDirection: 'row', gap: 6 },
  swatchCircle: { width: 14, height: 14, borderRadius: 7 },

  signOutBtn: { marginTop: 8, backgroundColor: t.danger, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  signOutText: { color: t.onAccent, fontWeight: '700' },
});
