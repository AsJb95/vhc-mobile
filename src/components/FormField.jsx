import { View, Text, TextInput, StyleSheet } from 'react-native';
import { colors } from '../lib/format';

export function FormField({ label, style, containerStyle, ...inputProps }) {
  return (
    <View style={[styles.group, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={colors.muted}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: 12 },
  label: { color: colors.muted, fontSize: 12, marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.panelBorder,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});
