import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useAuth } from '../../src/providers/AuthProvider'
import { orgService } from '@esite/shared'

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
            placeholderTextColor="#475569"
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
            placeholderTextColor="#475569"
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
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 24, paddingTop: 80, minHeight: '100%' },
  logo: { fontSize: 36, fontWeight: '800', color: '#fff', marginBottom: 4 },
  title: { fontSize: 18, color: '#94A3B8', marginBottom: 40 },
  choices: { gap: 12 },
  choiceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#1E293B', borderRadius: 14, padding: 18,
    borderWidth: 1, borderColor: '#334155',
  },
  choiceIcon: { fontSize: 30 },
  choiceFlex: { flex: 1 },
  choiceTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  choiceDesc: { fontSize: 12, color: '#64748B', marginTop: 2 },
  form: { gap: 4 },
  back: { marginBottom: 20 },
  backText: { color: '#64748B', fontSize: 14 },
  fieldLabel: { fontSize: 12, color: '#64748B', marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: '#1E293B', borderRadius: 10, padding: 14, fontSize: 16, color: '#fff', borderWidth: 1, borderColor: '#334155' },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 13 },
  pillRow: { marginVertical: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', marginRight: 8 },
  pillActive: { backgroundColor: '#1d4ed8', borderColor: '#3B82F6' },
  pillText: { color: '#64748B', fontSize: 13 },
  pillTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: '#3B82F6', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
})
