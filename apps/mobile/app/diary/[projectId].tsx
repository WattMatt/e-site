import { useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { diaryService, ENTRY_TYPE_LABELS } from '@esite/shared'
import type { DiaryEntryType } from '@esite/shared'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useAuth } from '../../src/providers/AuthProvider'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

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
  const [entryType, setEntryType] = useState<DiaryEntryType>('progress')
  const [progressNotes, setProgressNotes] = useState('')
  const [safetyNotes, setSafetyNotes] = useState('')
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
        entryType,
        progressNotes: progressNotes.trim(),
        safetyNotes: safetyNotes.trim() || undefined,
        weather: weather || undefined,
        workersOnSite: workers ? parseInt(workers, 10) : undefined,
        delays: delays.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diary', projectId] })
      setShowForm(false)
      setEntryType('progress')
      setProgressNotes('')
      setSafetyNotes('')
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
    return <View style={styles.center}><ActivityIndicator color={colors.amber} size="large" /></View>
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
            {/* Entry type */}
            <View>
              <Text style={styles.fieldLabel}>Entry type</Text>
              <View style={styles.pills}>
                {(Object.keys(ENTRY_TYPE_LABELS) as DiaryEntryType[]).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.pill, entryType === type && styles.pillActive]}
                    onPress={() => setEntryType(type)}
                  >
                    <Text style={[styles.pillText, entryType === type && styles.pillActiveText]}>
                      {ENTRY_TYPE_LABELS[type]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Date + workers row */}
            <View style={styles.formRow}>
              <View style={styles.formHalf}>
                <Text style={styles.fieldLabel}>Date *</Text>
                <TextInput
                  style={styles.input}
                  value={entryDate}
                  onChangeText={setEntryDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textDim}
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
                  placeholderTextColor={colors.textDim}
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
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
            </View>

            {/* Safety notes — shown when relevant */}
            {(entryType === 'safety' || entryType === 'general') && (
              <View>
                <Text style={[styles.fieldLabel, { color: colors.red }]}>Safety notes</Text>
                <TextInput
                  style={[styles.input, styles.textareaSm]}
                  value={safetyNotes}
                  onChangeText={setSafetyNotes}
                  placeholder="Safety observations, near-misses, incidents…"
                  placeholderTextColor={colors.textDim}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            )}

            {/* Delays */}
            <View>
              <Text style={styles.fieldLabel}>Delays / issues</Text>
              <TextInput
                style={[styles.input, styles.textareaSm]}
                value={delays}
                onChangeText={setDelays}
                placeholder="Any blockers or delays…"
                placeholderTextColor={colors.textDim}
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
                ? <ActivityIndicator color={colors.base} size="small" />
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
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.lg,
    borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  backBtn: { padding: spacing.xs },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  headerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  addBtn: { backgroundColor: colors.amber, paddingHorizontal: spacing.md + 2, paddingVertical: 7, borderRadius: radius.pill },
  addBtnText: { color: colors.base, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  formScroll: { flex: 1 },
  form: { padding: spacing.lg, gap: spacing.lg },
  formRow: { flexDirection: 'row', gap: spacing.md },
  formHalf: { flex: 1, gap: 6 },
  fieldLabel: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg - 2, paddingVertical: 11,
    fontSize: fontSize.bodyLg, color: colors.text,
  },
  textarea: { height: 110, textAlignVertical: 'top' },
  textareaSm: { height: 72, textAlignVertical: 'top' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 6 },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel },
  pillText: { fontSize: fontSize.small, color: colors.textMid, fontWeight: fontWeight.medium },
  pillActive: { backgroundColor: colors.amberDim, borderColor: colors.amberMid },
  pillActiveText: { color: colors.amber },
  submitBtn: { backgroundColor: colors.amber, borderRadius: radius.md, paddingVertical: spacing.lg - 2, alignItems: 'center', marginTop: spacing.xs },
  btnDisabled: { opacity: 0.5 },
  submitText: { color: colors.base, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  list: { padding: spacing.lg, gap: spacing.md },
  empty: { padding: 48, alignItems: 'center', gap: spacing.sm },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  emptySubtitle: { fontSize: fontSize.body, color: colors.textMid, textAlign: 'center' },
  card: { backgroundColor: colors.panel, borderRadius: radius.lg, padding: spacing.lg - 2, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  dateText: { fontSize: fontSize.body, fontWeight: fontWeight.bold, color: colors.text, flex: 1 },
  cardMeta: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  weatherTag: { backgroundColor: colors.blueDim, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 3, fontSize: fontSize.caption, color: colors.blue },
  metaText: { fontSize: fontSize.caption, color: colors.textMid },
  progressText: { fontSize: fontSize.body, color: colors.text, lineHeight: 20 },
  delayBox: { backgroundColor: colors.amberDim, borderLeftWidth: 2, borderLeftColor: colors.amber, paddingLeft: spacing.sm + 2, paddingVertical: 6, gap: 2, borderRadius: radius.sm },
  delayLabel: { fontSize: fontSize.tiny, fontWeight: fontWeight.bold, color: colors.amber, textTransform: 'uppercase', letterSpacing: 0.6 },
  delayText: { fontSize: fontSize.small, color: colors.text, lineHeight: 18 },
  authorText: { fontSize: fontSize.caption, color: colors.textDim, marginTop: 2 },
})
