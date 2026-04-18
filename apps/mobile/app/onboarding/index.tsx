import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useAuth } from '../../src/providers/AuthProvider'
import { orgService } from '@esite/shared'
import { colors, fontFamily, fontSize, fontWeight, radius, spacing } from '../../src/theme'

const PROVINCES = [
  'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
  'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
]

export default function OnboardingScreen() {
  const router = useRouter()
  const client = useSupabase()
  const { profile } = useAuth()
  const [step, setStep] = useState<'choice' | 'create' | 'join'>('choice')
  const [name, setName] = useState('')
  const [province, setProvince] = useState('')
  const [joinToken, setJoinToken] = useState('')
  const [loading, setLoading] = useState(false)

  async function createOrg() {
    if (!name.trim()) { Alert.alert('Required', 'Enter your company name'); return }
    if (!profile) return
    setLoading(true)
    try {
      await orgService.create(client, profile.id, { name: name.trim(), province: province as any || undefined })
      router.replace('/(tabs)/dashboard')
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not create organisation')
    } finally {
      setLoading(false)
    }
  }

  async function joinOrg() {
    if (!joinToken.trim()) { Alert.alert('Required', 'Paste your invite token'); return }
    if (!profile) return
    setLoading(true)
    try {
      await orgService.acceptInvite(client, joinToken.trim(), profile.id)
      router.replace('/(tabs)/dashboard')
    } catch {
      Alert.alert('Invalid invite', 'This invite link is invalid or has expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.logo}>E-Site</Text>
      <Text style={styles.title}>Set up your organisation</Text>

      {step === 'choice' && (
        <View style={styles.choices}>
          <TouchableOpacity style={styles.choiceCard} onPress={() => setStep('create')} activeOpacity={0.7}>
            <Text style={styles.choiceIcon}>🏢</Text>
            <View style={styles.choiceFlex}>
              <Text style={styles.choiceTitle}>Create organisation</Text>
              <Text style={styles.choiceDesc}>Set up your company and invite your team</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.choiceCard} onPress={() => setStep('join')} activeOpacity={0.7}>
            <Text style={styles.choiceIcon}>🔗</Text>
            <View style={styles.choiceFlex}>
              <Text style={styles.choiceTitle}>Join with invite</Text>
              <Text style={styles.choiceDesc}>Enter an invite code from your team admin</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {step === 'create' && (
        <View style={styles.form}>
          <TouchableOpacity onPress={() => setStep('choice')} style={styles.back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.fieldLabel}>Company name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Watson Mattheus Consulting"
            placeholderTextColor={colors.textDim}
            autoFocus
          />
          <Text style={styles.fieldLabel}>Province</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
            {PROVINCES.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.pill, province === p && styles.pillActive]}
                onPress={() => setProvince(p === province ? '' : p)}
              >
                <Text style={[styles.pillText, province === p && styles.pillTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.button} onPress={createOrg} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Creating…' : 'Create Organisation'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'join' && (
        <View style={styles.form}>
          <TouchableOpacity onPress={() => setStep('choice')} style={styles.back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.fieldLabel}>Invite token</Text>
          <TextInput
            style={[styles.input, styles.mono]}
            value={joinToken}
            onChangeText={setJoinToken}
            placeholder="Paste invite token or link…"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <TouchableOpacity style={styles.button} onPress={joinOrg} disabled={loading}>
            <Text style={styles.buttonText}>{loading ? 'Joining…' : 'Join Organisation'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.xxl, paddingTop: 80, minHeight: '100%' },
  logo: { fontSize: fontSize.display, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  title: { fontSize: fontSize.lg, color: colors.textMid, marginBottom: 40 },
  choices: { gap: spacing.md },
  choiceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.panel, borderRadius: radius.xl, padding: spacing.lg + 2,
    borderWidth: 1, borderColor: colors.border,
  },
  choiceIcon: { fontSize: 30 },
  choiceFlex: { flex: 1 },
  choiceTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  choiceDesc: { fontSize: fontSize.small, color: colors.textMid, marginTop: 2 },
  form: { gap: spacing.xs },
  back: { marginBottom: spacing.xl },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  fieldLabel: { fontSize: fontSize.small, color: colors.textMid, marginBottom: 6, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: fontWeight.semibold },
  input: { backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.lg - 2, fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border },
  mono: { fontFamily: fontFamily.mono ?? (Platform.OS === 'ios' ? 'Courier' : 'monospace'), fontSize: fontSize.body },
  pillRow: { marginVertical: spacing.sm },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm },
  pillActive: { backgroundColor: colors.amberDim, borderColor: colors.amber },
  pillText: { color: colors.textMid, fontSize: fontSize.body },
  pillTextActive: { color: colors.amber, fontWeight: fontWeight.semibold },
  button: { backgroundColor: colors.amber, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginTop: spacing.xxl },
  buttonText: { color: colors.base, fontSize: fontSize.md, fontWeight: fontWeight.bold },
})
