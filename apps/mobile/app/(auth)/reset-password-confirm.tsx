import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native'
import { Link, useLocalSearchParams, useRouter } from 'expo-router'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { updatePasswordSchema } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

type Status = 'checking' | 'ready' | 'invalid' | 'updated'

/**
 * Mobile reset-password confirmation screen.
 *
 * Reached via deep link after the user taps the password-reset email
 * link on their device:
 *   esite://reset-password-confirm#access_token=...&refresh_token=...
 *
 * Supabase's email link contains a fragment with the recovery tokens.
 * On mobile, expo-router's deep-link handler reaches this screen with
 * the fragment converted to query params (depending on Linking config),
 * OR the supabase client picks up the session from the URL via
 * detectSessionInUrl. We rely on getSession() returning the recovery
 * session that the SDK established during the deep-link parse.
 */
export default function ResetPasswordConfirmScreen() {
  const supabase = useSupabase()
  const router = useRouter()
  const params = useLocalSearchParams<{ access_token?: string; refresh_token?: string }>()
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      // If the SDK didn't auto-pick up the deep-link tokens, do it
      // manually — happens on some Android configurations.
      if (params.access_token && params.refresh_token) {
        await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        })
      }
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      setStatus(data.session ? 'ready' : 'invalid')
    }
    void check()
    return () => { cancelled = true }
  }, [supabase, params.access_token, params.refresh_token])

  async function handleUpdate() {
    setErrorMessage(null)
    const parsed = updatePasswordSchema.safeParse({ password, confirmPassword: confirm })
    if (!parsed.success) {
      setErrorMessage(parsed.error.errors[0].message)
      return
    }
    setIsLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setErrorMessage(error.message)
        return
      }
      await supabase.auth.signOut()
      setStatus('updated')
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not update password')
    } finally {
      setIsLoading(false)
    }
  }

  if (status === 'checking') {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.title}>Verifying link…</Text>
          <Text style={styles.subtitle}>One moment while we check your reset link.</Text>
        </View>
      </View>
    )
  }

  if (status === 'invalid') {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.title}>Link invalid or expired</Text>
          <Text style={styles.subtitle}>This reset link can no longer be used. Request a new one to continue.</Text>
          <Link href="/(auth)/reset-password" style={styles.linkAccent}>Request a new link</Link>
          <Link href="/(auth)/login" style={styles.link}>← Back to sign in</Link>
        </View>
      </View>
    )
  }

  if (status === 'updated') {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.title}>Password updated</Text>
          <Text style={styles.subtitle}>You can now sign in with your new password.</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.buttonText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>Set new password</Text>
        <Text style={styles.subtitle}>Choose a strong password you haven&apos;t used before</Text>

        <TextInput
          testID="reset-confirm-password-input"
          style={styles.input}
          placeholder="New password"
          placeholderTextColor={colors.textDim}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TextInput
          testID="reset-confirm-confirm-input"
          style={styles.input}
          placeholder="Confirm new password"
          placeholderTextColor={colors.textDim}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
        />

        {errorMessage && (
          <Text testID="reset-confirm-error-message" style={styles.errorText}>{errorMessage}</Text>
        )}

        <TouchableOpacity testID="reset-confirm-submit-button" style={styles.button} onPress={handleUpdate} disabled={isLoading}>
          <Text style={styles.buttonText}>{isLoading ? 'Updating…' : 'Update password'}</Text>
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
  linkAccent: { color: colors.amber, textAlign: 'center', marginTop: spacing.sm, fontWeight: fontWeight.semibold },
})
