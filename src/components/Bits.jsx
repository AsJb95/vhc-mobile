import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AnimatedPressable } from './UI';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';

// A tappable menu tile for the domain "hub" landing screens (Pharmacy / Warehouse / More).
export function HubTile({ icon, label, sub, badge, color, onPress }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const c = color || theme.accent;
  return (
    <AnimatedPressable style={styles.tile} onPress={onPress}>
      <View style={[styles.tileIcon, { backgroundColor: `${c}22`, borderColor: `${c}55` }]}>
        <Ionicons name={icon} size={20} color={c} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.tileLabel}>{label}</Text>
        {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
      </View>
      {badge != null && String(badge) !== '0' ? (
        <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={theme.muted} />
    </AnimatedPressable>
  );
}

// A label / value line (used in report + detail screens).
export function KeyVal({ label, value, strong, color }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, strong && styles.kvStrong, color && { color }]}>{value}</Text>
    </View>
  );
}

export function SectionTitle({ children, right }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

// Horizontal chip picker (report periods, filters).
export function ChipTabs({ options, value, onChange }) {
  const styles = useThemedStyles(makeStyles);
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

const AZ_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Horizontally-scrollable A–Z index filter (Main Stock / Pharmacy Stock).
// `value` is 'All' or a single letter; the caller does the actual filtering
// (case-insensitive match on the medicine/product name's first letter) so this
// stays a pure, reusable picker — same shape as ChipTabs, just scrollable
// instead of wrapping, since 27 options wrap into several rows on a phone.
export function AlphabetFilter({ value, onChange }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.alphaScroll}
      contentContainerStyle={styles.alphaRow}
    >
      <AnimatedPressable
        style={[styles.alphaChip, value === 'All' && styles.alphaChipActive]}
        onPress={() => onChange('All')}
        hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      >
        <Text style={[styles.alphaChipText, value === 'All' && styles.alphaChipTextActive]}>All</Text>
      </AnimatedPressable>
      {AZ_LETTERS.map((l) => (
        <AnimatedPressable
          key={l}
          style={[styles.alphaChip, value === l && styles.alphaChipActive]}
          onPress={() => onChange(l)}
          hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
        >
          <Text style={[styles.alphaChipText, value === l && styles.alphaChipTextActive]}>{l}</Text>
        </AnimatedPressable>
      ))}
    </ScrollView>
  );
}

// Small "As of HH:MM:SS" line so the reader can tell live data from stale.
const pad2 = (n) => String(n).padStart(2, '0');
export function AsOf({ at }) {
  const styles = useThemedStyles(makeStyles);
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  let t;
  try {
    t = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  return <Text style={styles.asOf}>As of {t}</Text>;
}

const makeStyles = (t) => StyleSheet.create({
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: t.card, borderWidth: 1, borderColor: t.panelBorder,
    borderRadius: 16, padding: 14, marginBottom: 10,
  },
  tileIcon: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { color: t.text, fontSize: 15, fontWeight: '700' },
  tileSub: { color: t.muted, fontSize: 12, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  kvLabel: { color: t.muted, fontSize: 13 },
  kvValue: { color: t.text, fontSize: 14, fontWeight: '600' },
  kvStrong: { fontSize: 16, fontWeight: '800' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 4 },
  sectionTitle: { color: t.text, fontWeight: '700', fontSize: 15 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: t.chip, borderWidth: 1, borderColor: t.panelBorder },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { color: t.muted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: t.onAccent },
  alphaScroll: { marginTop: 4, marginBottom: 2 },
  alphaRow: { flexDirection: 'row', gap: 6, paddingRight: 8, paddingVertical: 2 },
  alphaChip: {
    minWidth: 32, height: 32, paddingHorizontal: 7, borderRadius: 10,
    backgroundColor: t.chip, borderWidth: 1, borderColor: t.panelBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  alphaChipActive: { backgroundColor: t.accent, borderColor: t.accent },
  alphaChipText: { color: t.muted, fontSize: 12, fontWeight: '700' },
  alphaChipTextActive: { color: t.onAccent },
  asOf: { color: t.muted, fontSize: 11, marginBottom: 10 },
});
