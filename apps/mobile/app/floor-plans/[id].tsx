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

const SCREEN_W = Dimensions.get('window').width

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#6B7280',
}
const STATUS_COLORS: Record<string, string> = {
  open: '#EF4444', in_progress: '#F97316', resolved: '#3B82F6',
  pending_sign_off: '#EAB308', signed_off: '#10B981', closed: '#6B7280',
}

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
    return <View style={styles.center}><ActivityIndicator color="#3B82F6" size="large" /></View>
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
                      <ActivityIndicator color="#3B82F6" />
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {/* Existing snag pins */}
              {imageLayout.width > 0 && pins.map((snag: any) => {
                const pin = snag.floor_plan_pin as { x: number; y: number }
                if (!pin) return null
                const left = pin.x * imageLayout.width - 10
                const top = pin.y * imageLayout.height - 10
                return (
                  <TouchableOpacity
                    key={snag.id}
                    style={[styles.pin, { left, top, backgroundColor: PRIORITY_COLORS[snag.priority] ?? '#6B7280' }]}
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
            {selectedPin && (
              <>
                <View style={styles.pinSheetHandle} />
                <View style={styles.pinSheetRow}>
                  <View style={[styles.pinSheetDot, { backgroundColor: PRIORITY_COLORS[selectedPin.priority] }]} />
                  <Text style={styles.pinSheetTitle}>{selectedPin.title}</Text>
                </View>
                <View style={[styles.pinSheetStatus, { backgroundColor: STATUS_COLORS[selectedPin.status] + '22' }]}>
                  <Text style={[styles.pinSheetStatusText, { color: STATUS_COLORS[selectedPin.status] }]}>
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
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  center: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#64748B', fontSize: 16 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14, gap: 12, borderBottomWidth: 1, borderColor: '#1E293B' },
  backBtn: { padding: 4 },
  backText: { color: '#94A3B8', fontSize: 14 },
  headerMid: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 12, color: '#64748B', marginTop: 1 },
  pinModeBadge: { backgroundColor: '#2563EB22', borderColor: '#3B82F6', borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  pinModeText: { fontSize: 11, color: '#3B82F6', fontWeight: '700' },
  imageScroll: { flex: 1 },
  imageContainer: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  imageWrap: { width: SCREEN_W - 16, position: 'relative' },
  planImage: { width: '100%', height: undefined, aspectRatio: 1.41, backgroundColor: '#f8f8f0' }, // A4-ish ratio
  placingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(37,99,235,0.12)' },
  pin: { position: 'absolute', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 3 },
  pinText: { color: '#fff', fontSize: 11, fontWeight: '900', lineHeight: 14 },
  nonImageFile: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  fileIcon: { fontSize: 64 },
  fileName: { fontSize: 16, fontWeight: '700', color: '#fff', textAlign: 'center' },
  fileHint: { fontSize: 13, color: '#64748B', textAlign: 'center' },
  legend: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: '#1E293B', backgroundColor: '#0F172A' },
  legendText: { fontSize: 12, color: '#475569', textAlign: 'center' },
  modalBg: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  pinSheet: { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 14, borderTopWidth: 1, borderColor: '#334155' },
  pinSheetHandle: { width: 36, height: 4, backgroundColor: '#475569', borderRadius: 2, alignSelf: 'center', marginBottom: 4 },
  pinSheetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pinSheetDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  pinSheetTitle: { fontSize: 16, fontWeight: '700', color: '#fff', flex: 1 },
  pinSheetStatus: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start' },
  pinSheetStatusText: { fontSize: 12, fontWeight: '600' },
  pinSheetBtn: { backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  pinSheetBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
