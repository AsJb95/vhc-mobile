import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Screen, Card } from '../components/UI';
import { HubTile } from '../components/Bits';
import { colors } from '../lib/format';

const ROLE_LABELS = {
  admin: 'Admin', warehouse_manager: 'Warehouse Manager', pharmacist: 'Pharmacist', viewer: 'Viewer',
};

export default function MoreScreen({ navigation }) {
  const { user, role } = useAuth();
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>More</Text>

        <Card style={styles.card}>
          <Text style={styles.email}>{user?.email}</Text>
          <Text style={styles.role}>{ROLE_LABELS[role] || 'No role assigned'}</Text>
        </Card>

        <View style={{ marginTop: 8 }}>
          <HubTile icon="pulse-outline" label="System Health" sub="Connection, sync, realtime status" color={colors.success} onPress={() => navigation.navigate('System Health')} />
          <HubTile icon="settings-outline" label="Settings" sub="Account, thresholds, locations" onPress={() => navigation.navigate('Settings')} />
          {role === 'admin' && (
            <HubTile icon="shield-checkmark-outline" label="Admin" sub="Backups & restore" color={colors.purple} onPress={() => navigation.navigate('Admin')} />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5, marginBottom: 16 },
  card: { marginBottom: 8 },
  email: { color: colors.text, fontSize: 15, fontWeight: '700' },
  role: { color: colors.accent, fontSize: 13, fontWeight: '700', marginTop: 4 },
});
