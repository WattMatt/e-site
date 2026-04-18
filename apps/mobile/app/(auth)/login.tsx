import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { Link } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { signInSchema } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

export default function LoginScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSignIn() {
    setErrorMessage(null)
    const result = signInSchema.safeParse({ email, password })
    if (!result.success) {
      setErrorMessage(result.error.errors[0].message)
      return
    }
    setIsLoading(true)
    try {
      await signIn(email, password)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign in failed'
      setErrorMessage(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>E-Site</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <TextInput
          testID="login-email-input"
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textDim}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          testID="login-password-input"
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textDim}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {errorMessage && (
          <Text testID="login-error-message" style={styles.errorText}>{errorMessage}</Text>
        )}

        <TouchableOpacity testID="login-submit-button" style={styles.button} onPress={handleSignIn} disabled={isLoading}>
          <Text style={styles.buttonText}>{isLoading ? 'Signing in…' : 'Sign In'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/reset-password" style={styles.link}>
          Forgot password?
        </Link>
        <Link href="/(auth)/signup" style={styles.link}>
          Don&apos;t have an account? Sign up
        </Link>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  inner: { flex: 1, justifyContent: 'center', padding: spacing.xxl },
  title: { fontSize: fontSize.display, fontWeight: fontWeight.bold, color: colors.text, marginBottom: spacing.xs },
  subtitle: { fontSize: fontSize.md, color: colors.textMid, marginBottom: spacing.xxxl },
  errorText: {
    color: colors.red,
    fontSize: fontSize.body,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.amber,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  buttonText: { color: colors.base, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  link: { color: colors.textMid, textAlign: 'center', marginTop: spacing.sm },
})
