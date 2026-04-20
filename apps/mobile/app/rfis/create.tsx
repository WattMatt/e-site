import { useState, useEffect } from 'react'
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { rfiService } from '@esite/shared'
import { useQueryClient } from '@tanstack/react-query'
import { colors, fontSize, fontWeight, priorityColor, radius, spacing } from '../../src/theme'

const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
const CATEGORIES = ['design', 'materials', 'site-condition', 'specification', 'health-safety', 'general']

export default function CreateRfiScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ projectId?: string }>()
  const { profile } = useAuth()
  const client = useSupabase()
  const queryClient = useQueryClient()

  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [projectId, setProjectId] = useState(params.projectId ?? '')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('medium')
  const [category, setCategory] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!orgId) return
    client.schema('projects').from('projects')
      .select('id, name').eq('organisation_id', orgId).eq('status', 'active').order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [orgId])

  async function submit() {
    if (!subject.trim()) { Alert.alert('Required', 'Please enter a subject.'); return }
    if (!projectId) { Alert.alert('Required', 'Please select a project.'); return }
    setSaving(true)
    try {
      const rfi = await rfiService.create(client, orgId, profile!.id, {
        projectId,
        subject: subject.trim(),
        description: description.trim() || '',
        priority,
        category: category || '',
        dueDate: dueDate || '',
      })
      queryClient.invalidateQueries({ queryKey: ['rfis-org', orgId] })
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] })
      router.replace(`/rfis/${rfi.id}` as any)
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to create RFI')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ScrollView testID="rfi-create-screen" style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New RFI</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>Project <Text style={styles.req}>*</Text></Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.pills}>
              {projects.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.pill, projectId === p.id && styles.pillActive]}
                  onPress={() => setProjectId(p.id)}
                >
                  <Text style={[styles.pillText, projectId === p.id && styles.pillActiveText]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Subject <Text style={styles.req}>*</Text></Text>
          <TextInput
            testID="rfi-subject-input"
            style={styles.input}
            value={subject}
            onChangeText={setSubject}
            placeholder="Describe the query…"
            placeholderTextColor={colors.textDim}
            autoFocus
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Provide full context, reference drawings, standards…"
            placeholderTextColor={colors.textDim}
            multiline
            numberOfLines={4}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.pills}>
            {PRIORITIES.map(p => {
              const accent = priorityColor(p)
              const active = priority === p
              return (
                <TouchableOpacity
                  key={p}
                  style={[styles.pill, active && { backgroundColor: colors.elevated, borderColor: accent }]}
                  onPress={() => setPriority(p)}
                >
                  <Text style={[styles.pillText, active && { color: accent }]}>{p}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Category</Text>
          <View style={styles.pills}>
            {CATEGORIES.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.pill, category === c && styles.pillActive]}
                onPress={() => setCategory(c === category ? '' : c)}
              >
                <Text style={[styles.pillText, category === c && styles.pillActiveText]}>{c.replace(/-/g, ' ')}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Due date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="2026-05-01"
            placeholderTextColor={colors.textDim}
            keyboardType="numeric"
          />
        </View>

        <TouchableOpacity style={[styles.submitBtn, saving && styles.submitDisabled]} onPress={submit} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.base} /> : <Text style={styles.submitText}>Submit RFI</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.lg,
    borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  backBtn: { padding: spacing.xs },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  headerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  form: { padding: spacing.lg, gap: spacing.xl },
  field: { gap: spacing.sm },
  label: { fontSize: fontSize.small, fontWeight: fontWeight.semibold, color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6 },
  req: { color: colors.red },
  input: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg - 2, paddingVertical: spacing.md,
    fontSize: fontSize.bodyLg, color: colors.text,
  },
  textarea: { height: 100, textAlignVertical: 'top' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  pillText: { fontSize: fontSize.small, color: colors.textMid, fontWeight: fontWeight.medium, textTransform: 'capitalize' },
  pillActive: { backgroundColor: colors.amberDim, borderColor: colors.amberMid },
  pillActiveText: { color: colors.amber },
  submitBtn: { backgroundColor: colors.amber, borderRadius: radius.lg, paddingVertical: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: colors.base, fontSize: fontSize.base, fontWeight: fontWeight.bold },
})
