import { Modal, View, Text, FlatList, StyleSheet } from 'react-native';
import { Screen, AnimatedPressable, EmptyState } from './UI';
import { useThemedStyles } from '../theme/useThemedStyles';

export default function SelectModal({ visible, title, options, onSelect, onClose, renderLabel, renderSub }) {
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (t) => StyleSheet.create({
  header: { padding: 16, paddingBottom: 8 },
  title: { color: t.text, fontSize: 20, fontWeight: '800' },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  row: {
    backgroundColor: t.card, borderWidth: 1, borderColor: t.panelBorder,
    borderRadius: 14, padding: 14, marginBottom: 8,
  },
  rowLabel: { color: t.text, fontSize: 15, fontWeight: '600' },
  rowSub: { color: t.muted, fontSize: 12, marginTop: 3 },
  closeBtn: { padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: t.panelBorder },
  closeBtnText: { color: t.accent, fontWeight: '600' },
});
