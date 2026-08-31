import { useState } from 'react';
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView, MotiText } from 'moti';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useThemedStyles } from '../theme/useThemedStyles';
import { AnimatedPressable } from '../components/UI';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { theme, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError('');
    setSubmitting(true);
    const err = await signIn(email.trim(), password);
    setSubmitting(false);
    if (err) setError(err.message || 'Sign in failed');
  }

  return (
    <LinearGradient colors={[theme.bg, theme.panel, theme.bg]} style={styles.gradient}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <StatusBar style={isDark ? 'light' : 'dark'} />

        <MotiView
          from={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', damping: 12, delay: 100 }}
        >
          <View style={styles.logoCircle}>
            <Text style={styles.emoji}>🏭</Text>
          </View>
        </MotiView>

        <MotiText
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 250 }}
          style={styles.title}
        >
          VHC Warehouse
        </MotiText>
        <MotiText
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 400, delay: 350 }}
          style={styles.subtitle}
        >
          Sign in to continue
        </MotiText>

        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 420 }}
          style={{ width: '100%' }}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={theme.muted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <AnimatedPressable style={styles.button} onPress={handleSubmit} disabled={submitting}>
            <Text style={styles.buttonText}>{submitting ? 'Signing in...' : 'Sign In'}</Text>
          </AnimatedPressable>
        </MotiView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const makeStyles = (t) => StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logoCircle: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: `${t.accent}22`,
    borderWidth: 1, borderColor: `${t.accent}55`,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  emoji: { fontSize: 40 },
  title: { color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: t.muted, fontSize: 13, marginBottom: 28, marginTop: 4 },
  error: { color: t.danger, marginBottom: 12, textAlign: 'center' },
  input: {
    width: '100%',
    backgroundColor: t.panel,
    borderWidth: 1,
    borderColor: t.panelBorder,
    borderRadius: 12,
    color: t.text,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  button: {
    width: '100%',
    backgroundColor: t.accent,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  buttonText: { color: t.onAccent, fontWeight: '700', fontSize: 15 },
});
