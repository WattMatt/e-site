import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useAuth } from '../../src/providers/AuthProvider'
import { orgService } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

const PROVINCES = [
  'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
  'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
]

// Onboarding is reached only by an organisation founder. Every other member is
// created by an admin (Settings -> Users on the web) and already has a
// membership, so they land straight on the dashboard. Team invites were
// removed, so this screen only creates a new organisation.
export default function OnboardingScreen() {
  const router = useRouter()
  const client = useSupabase()
  const { profile } = useAuth()
  const [name, setName] = useState('')
  const [province, setProvince] = useState('')
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.logo}>E-Site</Text>
      <Text style={styles.title}>Set up your organisation</Text>

      <View style={styles.form}>
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
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  content: { padding: spacing.xxl, paddingTop: 80, minHeight: '100%' },
  logo: { fontSize: fontSize.display, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  title: { fontSize: fontSize.lg, color: colors.textMid, marginBottom: 40 },
  form: { gap: spacing.xs },
  fieldLabel: { fontSize: fontSize.small, color: colors.textMid, marginBottom: 6, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: fontWeight.semibold },
  input: { backgroundColor: colors.panel, borderRadius: radius.md, padding: spacing.lg - 2, fontSize: fontSize.md, color: colors.text, borderWidth: 1, borderColor: colors.border },
  pillRow: { marginVertical: spacing.sm },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm },
  pillActive: { backgroundColor: colors.amberDim, borderColor: colors.amber },
  pillText: { color: colors.textMid, fontSize: fontSize.body },
  pillTextActive: { color: colors.amber, fontWeight: fontWeight.semibold },
  button: { backgroundColor: colors.amber, borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginTop: spacing.xxl },
  buttonText: { color: colors.base, fontSize: fontSize.md, fontWeight: fontWeight.bold },
})
