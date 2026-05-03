import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native'
import { Link } from 'expo-router'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { resetPasswordSchema } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

const REDIRECT_TO = 'esite://reset-password-confirm'

export default function ResetPasswordScreen() {
  const supabase = useSupabase()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleRequest() {
    setErrorMessage(null)
    const result = resetPasswordSchema.safeParse({ email })
    if (!result.success) {
      setErrorMessage(result.error.errors[0].message)
      return
    }
    setIsLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_TO })
      if (error) {
        setErrorMessage(error.message)
        return
      }
      setSent(true)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not send reset link')
    } finally {
      setIsLoading(false)
    }
  }

  if (sent) {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.title}>Check your inbox</Text>
          <Text style={styles.subtitle}>
            If an account exists for that email, we sent a sign-in link. The link expires in 1 hour.
          </Text>
          <Text style={styles.subtitle}>
            Open the link on this device to land back here and set a new password.
          </Text>
          <Link href="/(auth)/login" style={styles.link}>← Back to sign in</Link>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.subtitle}>Enter your email and we&apos;ll send you a reset link</Text>

        <TextInput
          testID="reset-email-input"
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textDim}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {errorMessage && (
          <Text testID="reset-error-message" style={styles.errorText}>{errorMessage}</Text>
        )}

        <TouchableOpacity testID="reset-submit-button" style={styles.button} onPress={handleRequest} disabled={isLoading}>
          <Text style={styles.buttonText}>{isLoading ? 'Sending…' : 'Send reset link'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/login" style={styles.link}>← Back to sign in</Link>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  inner:     { flex: 1, justifyContent: 'center', padding: spacing.xxl },
  title:     { fontSize: fontSize.display, fontWeight: fontWeight.bold, color: colors.text, marginBottom: spacing.xs },
  subtitle:  { fontSize: fontSize.md, color: colors.textMid, marginBottom: spacing.xxxl, lineHeight: 22 },
  errorText: { color: colors.red, fontSize: fontSize.body, marginBottom: spacing.sm, textAlign: 'center' },
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
  link:       { color: colors.textMid, textAlign: 'center', marginTop: spacing.sm },
})
