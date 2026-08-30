import { Modal, View, Text, FlatList, StyleSheet } from 'react-native';
import { Screen, AnimatedPressable, EmptyState } from './UI';
import { colors } from '../lib/format';

export default function SelectModal({ visible, title, options, onSelect, onClose, renderLabel, renderSub }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <Screen>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
        </View>
        <FlatList
          data={options}
          keyExtractor={(item, idx) => item.id || item.key || String(idx)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState text="No options available" />}
          renderItem={({ item }) => (
            <AnimatedPressable style={styles.row} onPress={() => onSelect(item)}>
              <Text style={styles.rowLabel}>{renderLabel(item)}</Text>
              {renderSub ? <Text style={styles.rowSub}>{renderSub(item)}</Text> : null}
            </AnimatedPressable>
          )}
        />
        <AnimatedPressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Cancel</Text>
        </AnimatedPressable>
      </Screen>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { padding: 16, paddingBottom: 8 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  row: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.panelBorder,
    borderRadius: 12, padding: 14, marginBottom: 8,
  },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowSub: { color: colors.muted, fontSize: 12, marginTop: 3 },
  closeBtn: { padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.panelBorder },
  closeBtnText: { color: colors.accent, fontWeight: '600' },
});
