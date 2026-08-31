import { Component, Fragment } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AnimatedPressable } from './UI';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';

function ErrorFallback({ error, onReset }) {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.emoji}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          {error?.message || 'An unexpected error occurred.'}
        </Text>
        <AnimatedPressable style={styles.button} onPress={onReset}>
          <Text style={[styles.buttonText, { color: theme.onAccent }]}>Try again</Text>
        </AnimatedPressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// App-level error boundary: a render/lifecycle throw anywhere below this point
// (e.g. a hook-order mismatch, a bad server payload) is caught here and shown
// as a recoverable screen instead of a white-screen crash. "Try again" clears
// the error state and re-mounts the subtree.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    // `resetKey` is bumped on retry and used as the child subtree's `key`, so
    // "Try again" fully remounts everything below (fresh provider/component
    // state) instead of re-rendering the same broken tree.
    this.state = { error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Hook point for a real crash reporter (Sentry/Bugsnag) later.
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  handleReset = () => {
    this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    const { error, resetKey } = this.state;
    if (!error) {
      return <Fragment key={resetKey}>{this.props.children}</Fragment>;
    }
    return <ErrorFallback error={error} onReset={this.handleReset} />;
  }
}

const makeStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emoji: { fontSize: 40, marginBottom: 16 },
  title: { color: t.text, fontSize: 20, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  message: { color: t.muted, fontSize: 13, textAlign: 'center', marginBottom: 24 },
  button: {
    backgroundColor: t.accent, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center',
  },
  buttonText: { fontWeight: '700', fontSize: 15 },
});
