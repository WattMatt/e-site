import { useState, useEffect } from 'react'
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { rfiService } from '@esite/shared'
import { useQueryClient } from '@tanstack/react-query'

const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
const CATEGORIES = ['design', 'materials', 'site-condition', 'specification', 'health-safety', 'general']

const PRIORITY_COLORS: Record<string, string> = {
  low: '#6B7280', medium: '#EAB308', high: '#F97316', critical: '#EF4444',
}

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
        description: description.trim() || undefined,
        priority,
        category: category || undefined,
        dueDate: dueDate || undefined,
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

  const inp = { ...styles.input }

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New RFI</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.form}>
        {/* Project */}
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

        {/* Subject */}
        <View style={styles.field}>
          <Text style={styles.label}>Subject <Text style={styles.req}>*</Text></Text>
          <TextInput
            style={styles.input}
            value={subject}
            onChangeText={setSubject}
            placeholder="Describe the query…"
            placeholderTextColor="#475569"
            autoFocus
          />
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Provide full context, reference drawings, standards…"
            placeholderTextColor="#475569"
            multiline
            numberOfLines={4}
          />
        </View>

        {/* Priority */}
        <View style={styles.field}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.pills}>
            {PRIORITIES.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.pill, priority === p && { backgroundColor: PRIORITY_COLORS[p] + '33', borderColor: PRIORITY_COLORS[p] }]}
                onPress={() => setPriority(p)}
              >
                <Text style={[styles.pillText, priority === p && { color: PRIORITY_COLORS[p] }]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Category */}
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

        {/* Due date */}
        <View style={styles.field}>
          <Text style={styles.label}>Due date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="2026-05-01"
            placeholderTextColor="#475569"
            keyboardType="numeric"
          />
        </View>

        <TouchableOpacity style={[styles.submitBtn, saving && styles.submitDisabled]} onPress={submit} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit RFI</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16, borderBottomWidth: 1, borderColor: '#1E293B' },
  backBtn: { padding: 4 },
  backText: { color: '#94A3B8', fontSize: 14 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  form: { padding: 16, gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 12, fontWeight: '600', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 },
  req: { color: '#EF4444' },
  input: { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#fff' },
  textarea: { height: 100, textAlignVertical: 'top' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1E293B' },
  pillText: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  pillActive: { backgroundColor: '#1D4ED820', borderColor: '#3B82F6' },
  pillActiveText: { color: '#3B82F6' },
  submitBtn: { backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
