import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native'
import { Link } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { signInSchema } from '@esite/shared'

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
  container: { flex: 1, backgroundColor: '#1E293B' },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 36, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#94A3B8', marginBottom: 32 },
  errorText: {
    color: '#F87171',
    fontSize: 13,
    marginBottom: 10,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#334155',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: '#94A3B8', textAlign: 'center', marginTop: 8 },
})
