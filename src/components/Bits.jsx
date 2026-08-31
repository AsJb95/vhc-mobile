import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AnimatedPressable } from './UI';
import { colors } from '../lib/format';

// A tappable menu tile for the domain "hub" landing screens (Pharmacy / Warehouse / More).
export function HubTile({ icon, label, sub, badge, color = colors.accent, onPress }) {
  return (
    <AnimatedPressable style={styles.tile} onPress={onPress}>
      <View style={[styles.tileIcon, { backgroundColor: `${color}22`, borderColor: `${color}55` }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.tileLabel}>{label}</Text>
        {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
      </View>
      {badge != null && String(badge) !== '0' ? (
        <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </AnimatedPressable>
  );
}

// A label / value line (used in report + detail screens).
export function KeyVal({ label, value, strong, color }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, strong && styles.kvStrong, color && { color }]}>{value}</Text>
    </View>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

// Horizontal chip picker (report periods, filters).
export function ChipTabs({ options, value, onChange }) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const key = o.key ?? o;
        const label = o.label ?? o;
        const active = key === value;
        return (
          <AnimatedPressable
            key={key}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(key)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

// Small "As of HH:MM:SS" line so the reader can tell live data from stale.
export function AsOf({ at }) {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  const t = Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return <Text style={styles.asOf}>As of {t}</Text>;
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder,
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  tileIcon: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  tileSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  kvLabel: { color: colors.muted, fontSize: 13 },
  kvValue: { color: colors.text, fontSize: 14, fontWeight: '600' },
  kvStrong: { fontSize: 16, fontWeight: '800' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 4 },
  sectionTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  asOf: { color: colors.muted, fontSize: 11, marginBottom: 10 },
});
