import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { resetPasswordSchema, updatePasswordSchema } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

type Step = 'email' | 'code' | 'password' | 'done'

export default function ResetPasswordScreen() {
  const supabase = useSupabase()
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function handleSendCode() {
    setErrorMessage(null)
    const r = resetPasswordSchema.safeParse({ email })
    if (!r.success) { setErrorMessage(r.error.errors[0].message); return }
    setIsLoading(true)
    try {
      const trimmed = email.trim().toLowerCase()
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: 'esite://reset-password-confirm',
      })
      if (error) { setErrorMessage(error.message); return }
      setEmail(trimmed)
      setStep('code')
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not send code')
    } finally { setIsLoading(false) }
  }

  async function handleVerifyCode() {
    setErrorMessage(null)
    if (code.length !== 6) { setErrorMessage('Enter the 6-digit code from your email.'); return }
    setIsLoading(true)
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' })
      if (error) { setErrorMessage(error.message); setCode(''); return }
      setStep('password')
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not verify code')
    } finally { setIsLoading(false) }
  }

  async function handleSetPassword() {
    setErrorMessage(null)
    const r = updatePasswordSchema.safeParse({ password, confirmPassword: confirmPw })
    if (!r.success) { setErrorMessage(r.error.errors[0].message); return }
    setIsLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) { setErrorMessage(error.message); return }
      await supabase.auth.signOut()
      setStep('done')
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not update password')
    } finally { setIsLoading(false) }
  }

  if (step === 'done') {
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

  if (step === 'password') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.title}>Set new password</Text>
          <Text style={styles.subtitle}>Choose a strong password you haven&apos;t used before.</Text>
          <TextInput
            style={styles.input}
            placeholder="New password"
            placeholderTextColor={colors.textDim}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TextInput
            style={styles.input}
            placeholder="Confirm new password"
            placeholderTextColor={colors.textDim}
            value={confirmPw}
            onChangeText={setConfirmPw}
            secureTextEntry
          />
          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleSetPassword} disabled={isLoading}>
            <Text style={styles.buttonText}>{isLoading ? 'Updating…' : 'Update password'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    )
  }

  if (step === 'code') {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <View style={styles.inner}>
          <Text style={styles.title}>Enter your code</Text>
          <Text style={styles.subtitle}>
            We sent a 6-digit code to {email}. The code expires in 24 hours.
          </Text>
          <TextInput
            style={[styles.input, { fontSize: 22, letterSpacing: 6, textAlign: 'center' }]}
            placeholder="123456"
            placeholderTextColor={colors.textDim}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
          />
          {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleVerifyCode} disabled={isLoading || code.length !== 6}>
            <Text style={styles.buttonText}>{isLoading ? 'Verifying…' : 'Continue'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setStep('email'); setCode(''); setErrorMessage(null) }}>
            <Text style={styles.link}>← Different email</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>Reset password</Text>
        <Text style={styles.subtitle}>Enter your email and we&apos;ll send you a 6-digit code.</Text>
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
        {errorMessage && <Text testID="reset-error-message" style={styles.errorText}>{errorMessage}</Text>}
        <TouchableOpacity testID="reset-submit-button" style={styles.button} onPress={handleSendCode} disabled={isLoading}>
          <Text style={styles.buttonText}>{isLoading ? 'Sending…' : 'Send code'}</Text>
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
    backgroundColor: colors.panel, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, fontSize: fontSize.md, color: colors.text, marginBottom: spacing.md,
  },
  button: {
    backgroundColor: colors.amber, borderRadius: radius.lg, padding: spacing.lg,
    alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.lg,
  },
  buttonText: { color: colors.base, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  link:       { color: colors.textMid, textAlign: 'center', marginTop: spacing.sm },
})
