import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { WarehouseProvider } from './src/context/WarehouseContext';
import { PharmacyProvider } from './src/context/PharmacyContext';
import ErrorBoundary from './src/components/ErrorBoundary';
import LoginScreen from './src/screens/LoginScreen';
import RootNavigator from './src/navigation/RootNavigator';

function Gate() {
  const { session, loading, roleResolved } = useAuth();
  const { theme } = useTheme();

  // Wait for the session AND (when signed in) the role, so role-gated UI
  // renders in its final shape from the first frame.
  if (loading || (session && !roleResolved)) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} size="large" />
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

function ThemedApp() {
  const { isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ErrorBoundary>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ErrorBoundary>
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
