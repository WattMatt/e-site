import { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSupabase } from '../../../src/providers/SupabaseProvider'
import { colors, fontSize, fontWeight, radius, spacing } from '../../../src/theme'

type Step = 'loading' | 'form' | 'error' | 'done'

export default function InviteJoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const supabase = useSupabase()
  const router = useRouter()

  const [step, setStep] = useState<Step>('loading')
  const [inviteData, setInviteData] = useState<{
    email: string
    orgName: string
    orgId: string
    role: string
  } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadInvite() {
      if (!token) { setErrorMsg('No invite token found.'); setStep('error'); return }

      const { data, error } = await (supabase as any).auth.verifyOtp({
        token_hash: token,
        type: 'invite',
      })

      if (error || !data?.user) {
        setErrorMsg(error?.message ?? 'Invalid or expired invite link.')
        setStep('error')
        return
      }

      const user = data.user
      const meta = user.user_metadata ?? {}
      const orgId = meta.invited_to_org

      let orgName = 'your organisation'
      if (orgId) {
        const { data: org } = await supabase
          .from('organisations')
          .select('name')
          .eq('id', orgId)
          .single()
        if (org) orgName = (org as any).name
      }

      setInviteData({
        email: user.email ?? '',
        orgName,
        orgId: orgId ?? '',
        role: meta.invited_role ?? 'member',
      })
      setStep('form')
    }
    loadInvite()
  }, [token])

  async function handleSubmit() {
    if (!fullName.trim()) { setErrorMsg('Full name is required'); return }
    if (password.length < 8) { setErrorMsg('Password must be at least 8 characters'); return }
    if (password !== confirmPassword) { setErrorMsg('Passwords do not match'); return }

    setErrorMsg('')
    setSaving(true)
    try {
      const { error: pwErr } = await (supabase as any).auth.updateUser({
        password,
        data: { full_name: fullName.trim() },
      })
      if (pwErr) { setErrorMsg(pwErr.message); setSaving(false); return }

      if (inviteData?.orgId) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase
            .from('user_organisations')
            .upsert({
              user_id: user.id,
              organisation_id: inviteData.orgId,
              role: inviteData.role,
              is_active: true,
            }, { onConflict: 'user_id,organisation_id' } as any)
            .catch(() => {})
        }
      }

      setStep('done')
      setTimeout(() => {
        const role = inviteData?.role ?? ''
        const isField = ['field_worker', 'supervisor'].includes(role)
        router.replace(isField ? '/(tabs)/snags' : '/(tabs)/dashboard')
      }, 1500)
    } catch (e: any) {
      setErrorMsg(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (step === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.amber} />
        <Text style={styles.loadingText}>Verifying your invite…</Text>
      </View>
    )
  }

  if (step === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>❌</Text>
        <Text style={styles.title}>Invalid invite</Text>
        <Text style={styles.subtitle}>{errorMsg}</Text>
        <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.link}>Go to sign in</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (step === 'done') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>✅</Text>
        <Text style={styles.title}>Welcome aboard!</Text>
        <Text style={styles.subtitle}>Setting up your workspace…</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.logo}>E-Site</Text>

      <View style={styles.card}>
        <Text style={styles.title}>Join {inviteData?.orgName}</Text>
        <Text style={styles.subtitle}>
          You&apos;ve been invited as{' '}
          <Text style={{ color: colors.text, textTransform: 'capitalize' }}>
            {inviteData?.role?.replace('_', ' ')}
          </Text>
          . Set up your account to continue.
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          value={inviteData?.email ?? ''}
          editable={false}
          style={[styles.input, styles.inputDisabled]}
        />

        <Text style={styles.label}>Full name *</Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          style={styles.input}
          placeholder="Your full name"
          placeholderTextColor={colors.textDim}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Password *</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          style={styles.input}
          secureTextEntry
          autoCapitalize="none"
        />

        <Text style={styles.label}>Confirm password *</Text>
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          style={styles.input}
          secureTextEntry
          autoCapitalize="none"
        />

        {!!errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.btn, saving && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={styles.btnText}>{saving ? 'Setting up…' : 'Create Account & Join'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.xxl, paddingTop: 60 },
  center: { flex: 1, backgroundColor: colors.base, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  logo: { fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center', marginBottom: spacing.xxxl },
  card: { backgroundColor: colors.panel, borderRadius: radius.xl, padding: spacing.xxl, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: fontSize.lg + 2, fontWeight: fontWeight.bold, color: colors.text, marginBottom: 6 },
  subtitle: { fontSize: fontSize.bodyLg, color: colors.textMid, lineHeight: 20, marginBottom: spacing.xxl },
  label: { fontSize: fontSize.body, color: colors.textMid, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.elevated,
    color: colors.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg - 2,
    fontSize: fontSize.base,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputDisabled: { opacity: 0.5 },
  errorBox: { backgroundColor: colors.redDim, borderWidth: 1, borderColor: colors.redMid, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  errorText: { color: colors.red, fontSize: fontSize.body },
  btn: { backgroundColor: colors.amber, borderRadius: radius.lg, paddingVertical: spacing.lg, alignItems: 'center', marginTop: spacing.xxl },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.base, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  loadingText: { color: colors.textMid, marginTop: spacing.lg, fontSize: fontSize.bodyLg },
  errorIcon: { fontSize: 48, marginBottom: spacing.lg },
  link: { color: colors.amber, marginTop: spacing.lg, fontSize: fontSize.base },
})
