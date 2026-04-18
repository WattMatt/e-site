import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, Switch } from 'react-native'
import { Link } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { signUpSchema } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

export default function SignupScreen() {
  const { signUp } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [popiaConsent, setPopiaConsent] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSignUp() {
    const result = signUpSchema.safeParse({ fullName, email, password, confirmPassword, popiaConsent })
    if (!result.success) {
      Alert.alert('Validation error', result.error.errors[0].message)
      return
    }
    setIsLoading(true)
    try {
      await signUp(email, password, fullName)
      setSuccess(true)
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setIsLoading(false)
    }
  }

  if (success) {
    return (
      <View style={styles.container}>
        <View style={styles.successBox}>
          <Text style={styles.successIcon}>📧</Text>
          <Text style={styles.successTitle}>Check your email</Text>
          <Text style={styles.successDesc}>
            We sent a confirmation link to {email}. Click it to activate your account.
          </Text>
          <Link href="/(auth)/login" style={styles.link}>Back to sign in</Link>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create account</Text>
        <Text style={styles.subtitle}>Join E-Site to manage your projects</Text>

        {[
          { label: 'Full name', value: fullName, onChange: setFullName, placeholder: 'Arno Watson' },
          { label: 'Email', value: email, onChange: setEmail, placeholder: 'you@company.co.za', keyboard: 'email-address' as const },
          { label: 'Password', value: password, onChange: setPassword, secure: true },
          { label: 'Confirm password', value: confirmPassword, onChange: setConfirmPassword, secure: true },
        ].map(({ label, value, onChange, placeholder, keyboard, secure }) => (
          <View key={label}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={onChange}
              placeholder={placeholder}
              placeholderTextColor={colors.textDim}
              keyboardType={keyboard}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={secure}
            />
          </View>
        ))}

        <View style={styles.popiaRow}>
          <Switch
            value={popiaConsent}
            onValueChange={setPopiaConsent}
            trackColor={{ false: colors.border, true: colors.amber }}
            thumbColor={colors.text}
            style={styles.popiaSwitch}
          />
          <Text style={styles.popiaText}>
            I consent to E-Site processing my personal information in accordance with POPIA
            (Protection of Personal Information Act). Data may be processed outside South Africa
            subject to adequate safeguards.
          </Text>
        </View>

        <TouchableOpacity style={styles.button} onPress={handleSignUp} disabled={isLoading}>
          <Text style={styles.buttonText}>{isLoading ? 'Creating account…' : 'Create Account'}</Text>
        </TouchableOpacity>

        <Link href="/(auth)/login" style={styles.link}>Already have an account? Sign in</Link>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  inner: { padding: spacing.xxl, paddingTop: 60 },
  successBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl },
  successIcon: { fontSize: 56, marginBottom: spacing.lg },
  successTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, marginBottom: spacing.sm },
  successDesc: { fontSize: fontSize.bodyLg, color: colors.textMid, textAlign: 'center', lineHeight: 22 },
  title: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text, marginBottom: spacing.xs },
  subtitle: { fontSize: fontSize.bodyLg, color: colors.textMid, marginBottom: 28 },
  label: { fontSize: fontSize.small, color: colors.textMid, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    fontSize: fontSize.md,
    color: colors.text,
  },
  button: { backgroundColor: colors.amber, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginTop: spacing.xxl, marginBottom: spacing.lg },
  buttonText: { color: colors.base, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  link: { color: colors.textMid, textAlign: 'center', marginTop: spacing.sm },
  popiaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.xs },
  popiaSwitch: { marginTop: 2 },
  popiaText: { flex: 1, fontSize: fontSize.small, color: colors.textMid, lineHeight: 18 },
})
