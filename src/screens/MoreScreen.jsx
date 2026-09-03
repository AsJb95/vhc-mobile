import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { Screen, Card } from '../components/UI';
import { HubTile } from '../components/Bits';

export default function MoreScreen({ navigation }) {
  const { user, isPlatformAdmin, clinicName } = useAuth();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Server-verified account type (profiles.is_platform_admin), not the email.
  const accountType = isPlatformAdmin ? 'Platform Admin' : 'Clinic Admin';
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>More</Text>

        <Card style={styles.card}>
          <Text style={styles.email}>{user?.email}</Text>
          <Text style={styles.role}>
            {accountType}{clinicName ? ` · ${clinicName}` : ''}
          </Text>
        </Card>

        <View style={{ marginTop: 8 }}>
          <HubTile icon="pulse-outline" label="System Health" sub="Connection, sync, realtime status" color={theme.success} onPress={() => navigation.navigate('System Health')} />
          <HubTile icon="settings-outline" label="Settings" sub="Account, appearance, thresholds, locations" onPress={() => navigation.navigate('Settings')} />
          {isPlatformAdmin && (
            <HubTile icon="shield-checkmark-outline" label="Admin" sub="Backups & restore" color={theme.purple} onPress={() => navigation.navigate('Admin')} />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (t) => StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  title: { color: t.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 16 },
  card: { marginBottom: 8 },
  email: { color: t.text, fontSize: 15, fontWeight: '700' },
  role: { color: t.accent, fontSize: 13, fontWeight: '700', marginTop: 4 },
});
