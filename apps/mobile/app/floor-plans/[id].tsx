import { useState, useCallback } from 'react'
import {
  View, Text, Image, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Modal, Dimensions,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { floorPlanService, storageService, snagService } from '@esite/shared'
import { useSupabase } from '../../src/providers/SupabaseProvider'
import { useAuth } from '../../src/providers/AuthProvider'
import { colors, fontSize, fontWeight, priorityColor, radius, spacing, statusBadge } from '../../src/theme'

const SCREEN_W = Dimensions.get('window').width

export default function FloorPlanViewer() {
  const { id, mode, snagId: pendingSnagId } = useLocalSearchParams<{
    id: string
    mode?: 'pin' | 'view'
    snagId?: string
  }>()
  const router = useRouter()
  const client = useSupabase()
  const { profile } = useAuth()
  const queryClient = useQueryClient()

  const [imageLayout, setImageLayout] = useState({ width: 0, height: 0 })
  const [selectedPin, setSelectedPin] = useState<any | null>(null)
  const [placingPin, setPlacingPin] = useState(false)

  const isPickMode = mode === 'pin' && !!pendingSnagId

  // Load floor plan metadata
  const { data: plan, isLoading: loadingPlan } = useQuery({
    queryKey: ['floor-plan', id],
    queryFn: () => floorPlanService.getById(client, id),
    enabled: !!id,
  })

  // Get signed URL for the image
  const { data: imageUrl } = useQuery({
    queryKey: ['floor-plan-url', id],
    queryFn: () => plan ? storageService.signedUrl(client, 'drawings', plan.file_path, 7200) : null,
    enabled: !!plan,
  })

  // Load snag pins on this floor plan
  const { data: pins = [] } = useQuery({
    queryKey: ['floor-plan-pins', id],
    queryFn: () => floorPlanService.getSnagPins(client, id),
    enabled: !!id,
  })

  async function handleTap(e: any) {
    if (!isPickMode || !pendingSnagId) return
    const { locationX, locationY } = e.nativeEvent
    const relX = locationX / imageLayout.width
    const relY = locationY / imageLayout.height

    Alert.alert('Place Pin Here?', `Position: ${Math.round(relX * 100)}%, ${Math.round(relY * 100)}%`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          setPlacingPin(true)
          try {
            await snagService.update(client, pendingSnagId, {
              floorPlanPin: { x: relX, y: relY, floorPlanId: id },
            } as any)
            queryClient.invalidateQueries({ queryKey: ['snag', pendingSnagId] })
            router.back()
          } catch (err: any) {
            Alert.alert('Error', err.message)
          } finally {
            setPlacingPin(false)
          }
        },
      },
    ])
  }

  if (loadingPlan) {
    return <View style={styles.center}><ActivityIndicator color={colors.amber} size="large" /></View>
  }
  if (!plan) {
    return <View style={styles.center}><Text style={styles.emptyText}>Floor plan not found</Text></View>
  }

  const isImage = /\.(png|jpe?g|webp|svg)$/i.test(plan.file_path)

  return (
    <>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerMid}>
            <Text style={styles.title} numberOfLines={1}>{plan.name}</Text>
            {plan.level ? <Text style={styles.subtitle}>{plan.level}</Text> : null}
          </View>
          {isPickMode && (
            <View style={styles.pinModeBadge}>
              <Text style={styles.pinModeText}>Tap to pin</Text>
            </View>
          )}
        </View>

        {/* Floor Plan Image */}
        <ScrollView
          style={styles.imageScroll}
          contentContainerStyle={styles.imageContainer}
          maximumZoomScale={4}
          minimumZoomScale={1}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          {isImage && imageUrl ? (
            <View
              style={styles.imageWrap}
              onLayout={e => setImageLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
            >
              <Image
                source={{ uri: imageUrl }}
                style={styles.planImage}
                resizeMode="contain"
              />

              {/* Tap overlay for pin placement */}
              {isPickMode && (
                <TouchableOpacity
                  style={StyleSheet.absoluteFillObject}
                  onPress={handleTap}
                  activeOpacity={1}
                >
                  {placingPin && (
                    <View style={styles.placingOverlay}>
                      <ActivityIndicator color={colors.amber} />
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {imageLayout.width > 0 && pins.map((snag: any) => {
                const pin = snag.floor_plan_pin as { x: number; y: number }
                if (!pin) return null
                const left = pin.x * imageLayout.width - 10
                const top = pin.y * imageLayout.height - 10
                return (
                  <TouchableOpacity
                    key={snag.id}
                    style={[styles.pin, { left, top, backgroundColor: priorityColor(snag.priority) }]}
                    onPress={() => setSelectedPin(snag)}
                  >
                    <Text style={styles.pinText}>!</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          ) : (
            <View style={styles.nonImageFile}>
              <Text style={styles.fileIcon}>📄</Text>
              <Text style={styles.fileName}>{plan.name}</Text>
              <Text style={styles.fileHint}>Preview not available — open on web to view this file.</Text>
            </View>
          )}
        </ScrollView>

        {/* Legend */}
        {!isPickMode && pins.length > 0 && (
          <View style={styles.legend}>
            <Text style={styles.legendText}>{pins.length} snag{pins.length !== 1 ? 's' : ''} pinned · tap a pin to view</Text>
          </View>
        )}

        {isPickMode && (
          <View style={styles.legend}>
            <Text style={styles.legendText}>Tap anywhere on the drawing to place the snag pin</Text>
          </View>
        )}
      </View>

      {/* Pin detail modal */}
      <Modal visible={!!selectedPin} transparent animationType="slide" onRequestClose={() => setSelectedPin(null)}>
        <TouchableOpacity style={styles.modalBg} activeOpacity={1} onPress={() => setSelectedPin(null)}>
          <View style={styles.pinSheet} onStartShouldSetResponder={() => true}>
            {selectedPin && (() => {
              const badge = statusBadge(selectedPin.status)
              return (
                <>
                  <View style={styles.pinSheetHandle} />
                  <View style={styles.pinSheetRow}>
                    <View style={[styles.pinSheetDot, { backgroundColor: priorityColor(selectedPin.priority) }]} />
                    <Text style={styles.pinSheetTitle}>{selectedPin.title}</Text>
                  </View>
                  <View style={[styles.pinSheetStatus, { backgroundColor: badge.bg, borderColor: badge.border, borderWidth: 1 }]}>
                    <Text style={[styles.pinSheetStatusText, { color: badge.fg }]}>
                      {selectedPin.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.pinSheetBtn}
                    onPress={() => {
                      setSelectedPin(null)
                      router.push(`/snags/${selectedPin.id}` as any)
                    }}
                  >
                    <Text style={styles.pinSheetBtnText}>View Snag →</Text>
                  </TouchableOpacity>
                </>
              )
            })()}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, backgroundColor: colors.base, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textMid, fontSize: fontSize.md },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: 14, gap: spacing.md, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  backBtn: { padding: spacing.xs },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  headerMid: { flex: 1 },
  title: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.small, color: colors.textMid, marginTop: 1 },
  pinModeBadge: { backgroundColor: colors.amberDim, borderColor: colors.amberMid, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  pinModeText: { fontSize: fontSize.caption, color: colors.amber, fontWeight: fontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  imageScroll: { flex: 1 },
  imageContainer: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.sm },
  imageWrap: { width: SCREEN_W - 16, position: 'relative' },
  planImage: { width: '100%', height: undefined, aspectRatio: 1.41, backgroundColor: '#F8F8F0' },
  placingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,146,58,0.12)' },
  pin: { position: 'absolute', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.text, elevation: 4, shadowColor: colors.black, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 3 },
  pinText: { color: colors.text, fontSize: fontSize.caption, fontWeight: '900', lineHeight: 14 },
  nonImageFile: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: spacing.md },
  fileIcon: { fontSize: 64 },
  fileName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'center' },
  fileHint: { fontSize: fontSize.body, color: colors.textMid, textAlign: 'center' },
  legend: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  legendText: { fontSize: fontSize.small, color: colors.textMid, textAlign: 'center' },
  modalBg: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  pinSheet: { backgroundColor: colors.panel, borderTopLeftRadius: radius.xl + 8, borderTopRightRadius: radius.xl + 8, padding: spacing.xxl, gap: spacing.md + 2, borderTopWidth: 1, borderColor: colors.border },
  pinSheetHandle: { width: 36, height: 4, backgroundColor: colors.borderHi, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.xs },
  pinSheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  pinSheetDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  pinSheetTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text, flex: 1 },
  pinSheetStatus: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pinSheetStatusText: { fontSize: fontSize.small, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.6 },
  pinSheetBtn: { backgroundColor: colors.amber, borderRadius: radius.lg, paddingVertical: spacing.lg - 2, alignItems: 'center', marginTop: spacing.xs },
  pinSheetBtnText: { color: colors.base, fontSize: fontSize.base, fontWeight: fontWeight.bold },
})
