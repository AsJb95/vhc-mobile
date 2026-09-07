import { useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';

// `edges` defaults to ['top'] (status-bar clearance for screens that hide the
// native stack header). Screens rendered UNDER a native stack header must pass
// edges={[]} — the header already clears the status bar, so applying the top
// inset again leaves a status-bar-height gap above the content.
export function Screen({ children, style, edges = ['top'] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Card({ children, style, index = 0 }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <MotiView
      from={{ opacity: 0, translateY: 12 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 320, delay: Math.min(index, 8) * 40 }}
      style={[styles.card, style]}
    >
      {children}
    </MotiView>
  );
}

export function Badge({ label, color }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const c = color || theme.muted;
  return (
    <View style={[styles.badge, { backgroundColor: `${c}22`, borderColor: `${c}55` }]}>
      <View style={[styles.badgeDot, { backgroundColor: c }]} />
      <Text style={[styles.badgeText, { color: c }]}>{label}</Text>
    </View>
  );
}

export function StatCard({ label, value, sub, color, index = 0 }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const c = color || theme.accent;
  return (
    <MotiView
      from={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'timing', duration: 320, delay: Math.min(index, 8) * 50 }}
      style={styles.statCard}
    >
      <LinearGradient
        colors={[`${c}29`, `${c}0a`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.statGradient, { borderColor: `${c}40` }]}
      >
        <View style={[styles.statDot, { backgroundColor: c }]} />
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
        {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
      </LinearGradient>
    </MotiView>
  );
}

export function AnimatedPressable({ onPress, style, children, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;

  function pressIn() {
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  }
  function pressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  }

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} disabled={disabled}>
      <Animated.View style={[style, { transform: [{ scale }] }, disabled && { opacity: 0.5 }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export function EmptyState({ text, icon }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ type: 'timing', duration: 300 }} style={styles.empty}>
      {icon ? <Text style={styles.emptyIcon}>{icon}</Text> : null}
      <Text style={styles.emptyText}>{text}</Text>
    </MotiView>
  );
}

export function ScreenLoading() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.accent} size="large" />
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: t.bg,
  },
  card: {
    backgroundColor: t.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.panelBorder,
    padding: 16,
    shadowColor: t.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    gap: 6,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  statCard: {
    flexBasis: '48%',
    marginBottom: 12,
  },
  statGradient: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  statDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 10 },
  statLabel: {
    color: t.muted,
    fontSize: 12,
    marginBottom: 6,
    fontWeight: '500',
  },
  statValue: {
    color: t.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  statSub: {
    color: t.muted,
    fontSize: 11,
    marginTop: 5,
  },
  empty: {
    padding: 40,
    alignItems: 'center',
  },
  emptyIcon: { fontSize: 32, marginBottom: 10 },
  emptyText: {
    color: t.muted,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.bg,
  },
});
