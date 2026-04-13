import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { useAuth } from '../../src/providers/AuthProvider'

export default function DashboardTab() {
  const { profile } = useAuth()

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>
        {profile ? `Welcome, ${profile.full_name.split(' ')[0]}` : 'Dashboard'}
      </Text>

      <View style={styles.kpiRow}>
        {[
          { label: 'Active Projects', value: '—' },
          { label: 'Open Snags', value: '—' },
          { label: 'Pending COCs', value: '—' },
        ].map(({ label, value }) => (
          <View key={label} style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{value}</Text>
            <Text style={styles.kpiLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  content: { padding: 20 },
  greeting: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 24 },
  kpiRow: { flexDirection: 'row', gap: 12 },
  kpiCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  kpiValue: { fontSize: 28, fontWeight: '700', color: '#fff' },
  kpiLabel: { fontSize: 12, color: '#64748B', marginTop: 4 },
})
