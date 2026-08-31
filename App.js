import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { WarehouseProvider } from './src/context/WarehouseContext';
import { PharmacyProvider } from './src/context/PharmacyContext';
import ErrorBoundary from './src/components/ErrorBoundary';
import LoginScreen from './src/screens/LoginScreen';
import RootNavigator from './src/navigation/RootNavigator';
import { colors } from './src/lib/format';

function Gate() {
  const { session, loading, roleResolved } = useAuth();

  // Wait for the session AND (when signed in) the role, so role-gated UI
  // renders in its final shape from the first frame.
  if (loading || (session && !roleResolved)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  if (!session) {
    return <LoginScreen />;
  }

  return (
    <WarehouseProvider>
      <PharmacyProvider>
        <RootNavigator />
      </PharmacyProvider>
    </WarehouseProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ErrorBoundary>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
