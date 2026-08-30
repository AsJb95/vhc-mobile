import { Component } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { AnimatedPressable } from './UI';
import { colors } from '../lib/format';

// App-level error boundary: a render/lifecycle throw anywhere below this point
// (e.g. a hook-order mismatch, a bad server payload) is caught here and shown
// as a recoverable screen instead of a white-screen crash. "Try again" clears
// the error state and re-mounts the subtree.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Hook point for a real crash reporter (Sentry/Bugsnag) later.
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {error?.message || 'An unexpected error occurred.'}
          </Text>
          <AnimatedPressable style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Try again</Text>
          </AnimatedPressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emoji: { fontSize: 40, marginBottom: 16 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  message: { color: colors.muted, fontSize: 13, textAlign: 'center', marginBottom: 24 },
  button: {
    backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
