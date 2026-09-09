import { useMemo } from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { MotiView } from 'moti';

import HomeScreen from '../screens/HomeScreen';
import PharmacyDashboardScreen from '../screens/PharmacyDashboardScreen';
import SalesReportsScreen from '../screens/SalesReportsScreen';
import InventoryIntelligenceScreen from '../screens/InventoryIntelligenceScreen';
import PharmacyStockScreen from '../screens/PharmacyStockScreen';
import PendingTransfersScreen from '../screens/PendingTransfersScreen';
import PatientLookupScreen from '../screens/PatientLookupScreen';
import CreditScreen from '../screens/CreditScreen';
import StockScreen from '../screens/StockScreen';
import SubStockScreen from '../screens/SubStockScreen';
import OrdersScreen from '../screens/OrdersScreen';
import PendingReturnsScreen from '../screens/PendingReturnsScreen';
import AlertsScreen from '../screens/AlertsScreen';
import MoreScreen from '../screens/MoreScreen';
import SystemHealthScreen from '../screens/SystemHealthScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AdminScreen from '../screens/AdminScreen';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useWarehouse } from '../context/WarehouseContext';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ICONS = {
  Home: 'home-outline',
  Pharmacy: 'medkit-outline',
  Warehouse: 'cube-outline',
  Alerts: 'notifications-outline',
  More: 'ellipsis-horizontal',
};

function useStackScreenOptions() {
  const { theme } = useTheme();
  return useMemo(() => ({
    headerStyle: { backgroundColor: theme.panel },
    headerTintColor: theme.text,
    headerTitleStyle: { fontWeight: '700' },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: theme.bg },
  }), [theme]);
}

function PharmacyStack() {
  const { role } = useAuth();
  const screenOptions = useStackScreenOptions();
  const canSeePatients = role === 'admin' || role === 'pharmacist';
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Pharmacy Home" component={PharmacyDashboardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Sales & Reports" component={SalesReportsScreen} />
      <Stack.Screen name="Inventory Intelligence" component={InventoryIntelligenceScreen} />
      <Stack.Screen name="Pharmacy Stock" component={PharmacyStockScreen} />
      <Stack.Screen name="Pending Stock Requests" component={PendingTransfersScreen} />
      {canSeePatients && <Stack.Screen name="Patient Lookup" component={PatientLookupScreen} />}
      {canSeePatients && <Stack.Screen name="Credit / Outstanding" component={CreditScreen} />}
    </Stack.Navigator>
  );
}

function WarehouseStack() {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Main Stock" component={StockScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Sub-Stock Locations" component={SubStockScreen} />
      <Stack.Screen name="Orders" component={OrdersScreen} />
      <Stack.Screen name="Pending Returns" component={PendingReturnsScreen} />
    </Stack.Navigator>
  );
}

function MoreStack() {
  const { isPlatformAdmin } = useAuth();
  const screenOptions = useStackScreenOptions();
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="More" component={MoreScreen} options={{ headerShown: false }} />
      <Stack.Screen name="System Health" component={SystemHealthScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      {isPlatformAdmin && <Stack.Screen name="Admin" component={AdminScreen} />}
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  // Tab-badge nudges for stock requests awaiting a decision:
  //  • Pharmacy tab — Warehouse→Pharmacy transfers (Accept/Reject in Pharmacy →
  //    Pending Stock Requests).
  //  • Warehouse tab — Pharmacy→Warehouse returns (Accept/Reject in Warehouse →
  //    Pending Returns). Orders → Transfers keeps the same actions for either.
  const { pendingPharmacyTransfers, pendingStockReturns } = useWarehouse();
  const pendingCount = pendingPharmacyTransfers?.length || 0;
  const returnCount = pendingStockReturns?.length || 0;

  const navTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: theme.bg,
        card: theme.panel,
        border: theme.panelBorder,
        primary: theme.accent,
        text: theme.text,
      },
    };
  }, [theme, isDark]);

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.muted,
          tabBarStyle: {
            backgroundColor: theme.panel,
            borderTopColor: theme.panelBorder,
            height: 56 + insets.bottom,
            paddingBottom: 8 + insets.bottom,
            paddingTop: 8,
          },
          tabBarLabelStyle: { fontSize: 10 },
          tabBarIcon: ({ color, size, focused }) => (
            <MotiView
              animate={{ scale: focused ? 1.15 : 1, translateY: focused ? -2 : 0 }}
              transition={{ type: 'spring', damping: 10 }}
            >
              <Ionicons name={TAB_ICONS[route.name]} size={size} color={color} />
            </MotiView>
          ),
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen
          name="Pharmacy"
          component={PharmacyStack}
          options={{
            tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
            tabBarBadgeStyle: { backgroundColor: theme.warning, color: theme.onAccent, fontSize: 10 },
          }}
        />
        <Tab.Screen
          name="Warehouse"
          component={WarehouseStack}
          options={{
            tabBarBadge: returnCount > 0 ? returnCount : undefined,
            tabBarBadgeStyle: { backgroundColor: theme.warning, color: theme.onAccent, fontSize: 10 },
          }}
        />
        <Tab.Screen name="Alerts" component={AlertsScreen} />
        <Tab.Screen name="More" component={MoreStack} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
