import { NavigationContainer, DarkTheme } from '@react-navigation/native';
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
import PatientLookupScreen from '../screens/PatientLookupScreen';
import CreditScreen from '../screens/CreditScreen';
import StockScreen from '../screens/StockScreen';
import SubStockScreen from '../screens/SubStockScreen';
import OrdersScreen from '../screens/OrdersScreen';
import AlertsScreen from '../screens/AlertsScreen';
import MoreScreen from '../screens/MoreScreen';
import SystemHealthScreen from '../screens/SystemHealthScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AdminScreen from '../screens/AdminScreen';

import { useAuth } from '../context/AuthContext';
import { colors } from '../lib/format';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ICONS = {
  Home: 'home-outline',
  Pharmacy: 'medkit-outline',
  Warehouse: 'cube-outline',
  Alerts: 'notifications-outline',
  More: 'ellipsis-horizontal',
};

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.panel,
    border: colors.panelBorder,
    primary: colors.accent,
    text: colors.text,
  },
};

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.panel },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '700' },
  contentStyle: { backgroundColor: colors.bg },
};

function PharmacyStack() {
  const { role } = useAuth();
  const canSeePatients = role === 'admin' || role === 'pharmacist';
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="Pharmacy Home" component={PharmacyDashboardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Sales & Reports" component={SalesReportsScreen} />
      <Stack.Screen name="Inventory Intelligence" component={InventoryIntelligenceScreen} />
      <Stack.Screen name="Pharmacy Stock" component={PharmacyStockScreen} />
      {canSeePatients && <Stack.Screen name="Patient Lookup" component={PatientLookupScreen} />}
      {canSeePatients && <Stack.Screen name="Credit / Outstanding" component={CreditScreen} />}
    </Stack.Navigator>
  );
}

function WarehouseStack() {
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="Main Stock" component={StockScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Sub-Stock Locations" component={SubStockScreen} />
      <Stack.Screen name="Orders" component={OrdersScreen} />
    </Stack.Navigator>
  );
}

function MoreStack() {
  const { role } = useAuth();
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      <Stack.Screen name="More" component={MoreScreen} options={{ headerShown: false }} />
      <Stack.Screen name="System Health" component={SystemHealthScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      {role === 'admin' && <Stack.Screen name="Admin" component={AdminScreen} />}
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.panel,
            borderTopColor: colors.panelBorder,
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
        <Tab.Screen name="Pharmacy" component={PharmacyStack} />
        <Tab.Screen name="Warehouse" component={WarehouseStack} />
        <Tab.Screen name="Alerts" component={AlertsScreen} />
        <Tab.Screen name="More" component={MoreStack} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
