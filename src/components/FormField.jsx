import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';

export function FormField({ label, style, containerStyle, ...inputProps }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.group, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={theme.muted}
        {...inputProps}
      />
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  group: { marginBottom: 12 },
  label: { color: t.muted, fontSize: 12, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: t.panel,
    borderWidth: 1,
    borderColor: t.panelBorder,
    borderRadius: 12,
    color: t.text,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});
