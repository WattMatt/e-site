import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../../src/providers/AuthProvider'
import { useProjects } from '../../src/hooks/useProjects'
import { formatZAR } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../../src/theme'

const PROJECT_STATUS: Record<string, { bg: string; fg: string; border: string }> = {
  active:    { bg: colors.greenDim, fg: colors.green,   border: colors.greenMid },
  planning:  { bg: colors.blueDim,  fg: colors.blue,    border: colors.blueMid },
  on_hold:   { bg: colors.amberDim, fg: colors.amber,   border: colors.amberMid },
  completed: { bg: colors.elevated, fg: colors.textMid, border: colors.borderMid },
  cancelled: { bg: colors.redDim,   fg: colors.red,     border: colors.redMid },
}
const STATUS_DEFAULT = { bg: colors.elevated, fg: colors.textMid, border: colors.borderMid }

export default function ProjectsTab() {
  const { profile } = useAuth()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? ''
  const { data: projects, isLoading, refetch, isRefetching } = useProjects(orgId)
  const router = useRouter()

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.amber} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={projects ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.amber} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyIcon}>📁</Text>
            <Text style={styles.emptyTitle}>No projects yet</Text>
            <Text style={styles.emptyDesc}>Projects created on the web will appear here.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const status = PROJECT_STATUS[item.status] ?? STATUS_DEFAULT
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/projects/${item.id}` as any)}
              activeOpacity={0.7}
            >
              <View style={styles.cardRow}>
                <View style={styles.cardFlex}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  {item.city && <Text style={styles.cardSub}>{item.city}{item.province ? `, ${item.province}` : ''}</Text>}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: status.bg, borderColor: status.border }]}>
                  <Text style={[styles.statusText, { color: status.fg }]}>{item.status}</Text>
                </View>
              </View>
              {item.client_name && (
                <Text style={styles.clientText}>Client: {item.client_name}</Text>
              )}
              {item.contract_value && (
                <Text style={styles.valueText}>{formatZAR(item.contract_value)}</Text>
              )}
            </TouchableOpacity>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  list: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardFlex: { flex: 1, marginRight: spacing.sm },
  cardTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  cardSub: { fontSize: fontSize.small, color: colors.textMid, marginTop: 2 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.md, borderWidth: 1 },
  statusText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  clientText: { fontSize: fontSize.small, color: colors.textMid, marginTop: spacing.sm },
  valueText: { fontSize: fontSize.body, color: colors.amber, fontWeight: fontWeight.semibold, marginTop: spacing.xs },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text, marginBottom: spacing.xs },
  emptyDesc: { fontSize: fontSize.body, color: colors.textMid, textAlign: 'center' },
})
