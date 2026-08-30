import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { MotiView } from 'moti';
import DashboardScreen from '../screens/DashboardScreen';
import StockScreen from '../screens/StockScreen';
import PharmacyStockScreen from '../screens/PharmacyStockScreen';
import AlertsScreen from '../screens/AlertsScreen';
import OrdersScreen from '../screens/OrdersScreen';
import AdminScreen from '../screens/AdminScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useAuth } from '../context/AuthContext';
import { colors } from '../lib/format';

const Tab = createBottomTabNavigator();

const ICONS = {
  Dashboard: 'grid-outline',
  Stock: 'cube-outline',
  'Pharmacy Stock': 'medkit-outline',
  Alerts: 'notifications-outline',
  Orders: 'cart-outline',
  Admin: 'shield-checkmark-outline',
  Settings: 'settings-outline',
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

export default function RootNavigator() {
  const { role } = useAuth();
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
              <Ionicons name={ICONS[route.name]} size={size} color={color} />
            </MotiView>
          ),
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} />
        <Tab.Screen name="Stock" component={StockScreen} />
        <Tab.Screen name="Pharmacy Stock" component={PharmacyStockScreen} />
        <Tab.Screen name="Alerts" component={AlertsScreen} />
        <Tab.Screen name="Orders" component={OrdersScreen} />
        {role === 'admin' && <Tab.Screen name="Admin" component={AdminScreen} />}
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
