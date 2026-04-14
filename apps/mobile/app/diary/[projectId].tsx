import { useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { diaryService } from '@esite/shared'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useAuth } from '../../src/providers/AuthProvider'

const WEATHER_OPTIONS = ['Sunny', 'Cloudy', 'Overcast', 'Rain', 'Windy', 'Hot']

export default function SiteDiaryScreen() {
  const router = useRouter()
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const client = useSupabase()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''

  const [showForm, setShowForm] = useState(false)
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [progressNotes, setProgressNotes] = useState('')
  const [weather, setWeather] = useState('')
  const [workers, setWorkers] = useState('')
  const [delays, setDelays] = useState('')

  const { data: entries, isLoading } = useQuery({
    queryKey: ['diary', projectId],
    queryFn: () => diaryService.list(client, projectId),
    enabled: !!projectId,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      diaryService.create(client, orgId, profile!.id, {
        projectId,
        entryDate,
        progressNotes: progressNotes.trim(),
        weather: weather || undefined,
        workersOnSite: workers ? parseInt(workers, 10) : undefined,
        delays: delays.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diary', projectId] })
      setShowForm(false)
      setProgressNotes('')
      setWeather('')
      setWorkers('')
      setDelays('')
    },
    onError: (e: any) => Alert.alert('Error', e.message ?? 'Failed to save entry'),
  })

  function handleSubmit() {
    if (!progressNotes.trim()) {
      Alert.alert('Required', 'Please enter progress notes.')
      return
    }
    createMutation.mutate()
  }

  function formatEntryDate(dateStr: string) {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color="#3B82F6" size="large" /></View>
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Site Diary</Text>
        <TouchableOpacity onPress={() => setShowForm(!showForm)} style={styles.addBtn}>
          <Text style={styles.addBtnText}>{showForm ? 'Cancel' : '+ Add'}</Text>
        </TouchableOpacity>
      </View>

      {showForm ? (
        <ScrollView style={styles.formScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            {/* Date + workers row */}
            <View style={styles.formRow}>
              <View style={styles.formHalf}>
                <Text style={styles.fieldLabel}>Date *</Text>
                <TextInput
                  style={styles.input}
                  value={entryDate}
                  onChangeText={setEntryDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#475569"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.formHalf}>
                <Text style={styles.fieldLabel}>Workers on site</Text>
                <TextInput
                  style={styles.input}
                  value={workers}
                  onChangeText={setWorkers}
                  placeholder="0"
                  placeholderTextColor="#475569"
                  keyboardType="number-pad"
                />
              </View>
            </View>

            {/* Weather */}
            <View>
              <Text style={styles.fieldLabel}>Weather</Text>
              <View style={styles.pills}>
                {WEATHER_OPTIONS.map(w => (
                  <TouchableOpacity
                    key={w}
                    style={[styles.pill, weather === w && styles.pillActive]}
                    onPress={() => setWeather(w === weather ? '' : w)}
                  >
                    <Text style={[styles.pillText, weather === w && styles.pillActiveText]}>{w}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Progress notes */}
            <View>
              <Text style={styles.fieldLabel}>Progress notes *</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={progressNotes}
                onChangeText={setProgressNotes}
                placeholder="Describe work completed today…"
                placeholderTextColor="#475569"
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
            </View>

            {/* Delays */}
            <View>
              <Text style={styles.fieldLabel}>Delays / issues</Text>
              <TextInput
                style={[styles.input, styles.textareaSm]}
                value={delays}
                onChangeText={setDelays}
                placeholder="Any blockers or delays…"
                placeholderTextColor="#475569"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, createMutation.isPending && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitText}>Save Entry</Text>}
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={entries ?? []}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📓</Text>
              <Text style={styles.emptyTitle}>No entries yet</Text>
              <Text style={styles.emptySubtitle}>Tap "+ Add" to log today's site work.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.dateText}>{formatEntryDate((item as any).entry_date)}</Text>
                <View style={styles.cardMeta}>
                  {(item as any).weather ? <Text style={styles.weatherTag}>{(item as any).weather}</Text> : null}
                  {(item as any).workers_on_site != null ? (
                    <Text style={styles.metaText}>{(item as any).workers_on_site} workers</Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.progressText}>{(item as any).progress_notes}</Text>
              {(item as any).delays ? (
                <View style={styles.delayBox}>
                  <Text style={styles.delayLabel}>Delays</Text>
                  <Text style={styles.delayText}>{(item as any).delays}</Text>
                </View>
              ) : null}
              <Text style={styles.authorText}>
                {(item as any).author?.full_name ?? 'Unknown'} · {new Date((item as any).created_at).toLocaleDateString('en-ZA')}
              </Text>
            </View>
          )}
        />
      )}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F172A' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16,
    borderBottomWidth: 1, borderColor: '#1E293B',
  },
  backBtn: { padding: 4 },
  backText: { color: '#94A3B8', fontSize: 14 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  addBtn: { backgroundColor: '#2563EB', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  // Form
  formScroll: { flex: 1 },
  form: { padding: 16, gap: 16 },
  formRow: { flexDirection: 'row', gap: 12 },
  formHalf: { flex: 1, gap: 6 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, color: '#fff',
  },
  textarea: { height: 110, textAlignVertical: 'top' },
  textareaSm: { height: 72, textAlignVertical: 'top' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1E293B' },
  pillText: { fontSize: 12, color: '#64748B', fontWeight: '500' },
  pillActive: { backgroundColor: '#1D4ED820', borderColor: '#3B82F6' },
  pillActiveText: { color: '#3B82F6' },
  submitBtn: { backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  btnDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  // List
  list: { padding: 16, gap: 12 },
  empty: { padding: 48, alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  emptySubtitle: { fontSize: 13, color: '#64748B', textAlign: 'center' },
  card: { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155', gap: 8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  dateText: { fontSize: 13, fontWeight: '700', color: '#E2E8F0', flex: 1 },
  cardMeta: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  weatherTag: { backgroundColor: '#1D4ED820', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11, color: '#93C5FD' },
  metaText: { fontSize: 11, color: '#64748B' },
  progressText: { fontSize: 13, color: '#CBD5E1', lineHeight: 20 },
  delayBox: { backgroundColor: '#451A0310', borderLeftWidth: 2, borderLeftColor: '#F59E0B', paddingLeft: 10, gap: 2 },
  delayLabel: { fontSize: 10, fontWeight: '700', color: '#F59E0B', textTransform: 'uppercase' },
  delayText: { fontSize: 12, color: '#FCD34D', lineHeight: 18 },
  authorText: { fontSize: 11, color: '#475569', marginTop: 2 },
})
