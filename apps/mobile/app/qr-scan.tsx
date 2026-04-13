import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, Clipboard } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function extractSnagId(raw: string): string | null {
  // Try to find a UUID in the scanned string
  const match = raw.match(UUID_RE)
  if (!match) return null
  // Check if it's a snag URL: /snags/{uuid}
  if (raw.includes('/snags/')) return match[0]
  // Could be a bare UUID (e.g. from a printed QR on a snag report)
  if (raw.trim() === match[0]) return match[0]
  return null
}

export default function QrScanScreen() {
  const router = useRouter()
  const [permission, requestPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)

  useEffect(() => {
    if (!permission?.granted) requestPermission()
  }, [])

  function handleBarcode({ data }: { data: string }) {
    if (scanned) return
    setScanned(true)

    const snagId = extractSnagId(data)
    if (snagId) {
      router.replace(`/snags/${snagId}` as any)
      return
    }

    // Not a snag ID — show the raw value
    Alert.alert(
      'QR Code Scanned',
      data,
      [
        {
          text: 'Copy',
          onPress: () => {
            Clipboard.setString(data)
            setScanned(false)
          },
        },
        { text: 'Scan Again', onPress: () => setScanned(false) },
        { text: 'Close', style: 'cancel', onPress: () => router.back() },
      ]
    )
  }

  if (!permission) {
    return <View style={styles.center}><Text style={styles.text}>Requesting camera…</Text></View>
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Camera permission required</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcode}
      />

      {/* Overlay */}
      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Scan QR Code</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.viewfinderWrap}>
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
          </View>
        </View>

        <View style={styles.bottomHint}>
          <Text style={styles.hintText}>
            {scanned ? 'Processing…' : 'Point camera at a snag QR code or label'}
          </Text>
          {scanned && (
            <TouchableOpacity style={styles.rescanBtn} onPress={() => setScanned(false)}>
              <Text style={styles.rescanText}>Scan Again</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )
}

const CORNER = 24
const BORDER = 3

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  text: { color: '#94A3B8', fontSize: 16, textAlign: 'center' },
  btn: { backgroundColor: '#2563EB', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  backLink: { marginTop: 8 },
  backText: { color: '#64748B', fontSize: 14 },

  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16, backgroundColor: 'rgba(0,0,0,0.55)' },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  title: { fontSize: 16, fontWeight: '700', color: '#fff' },

  viewfinderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewfinder: { width: 240, height: 240, position: 'relative' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#3B82F6', borderWidth: BORDER },
  tl: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0 },
  tr: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0 },
  bl: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0 },
  br: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0 },

  bottomHint: { paddingHorizontal: 24, paddingBottom: 48, paddingTop: 24, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', gap: 14 },
  hintText: { color: '#CBD5E1', fontSize: 14, textAlign: 'center' },
  rescanBtn: { backgroundColor: '#2563EB', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  rescanText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})
