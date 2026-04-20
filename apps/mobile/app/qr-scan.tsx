import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, Clipboard } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { parseSubsectionQrUrl } from '@esite/shared'
import { colors, fontSize, fontWeight, radius, spacing } from '../src/theme'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function extractSnagId(raw: string): string | null {
  const match = raw.match(UUID_RE)
  if (!match) return null
  if (raw.includes('/snags/')) return match[0]
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

    // 1. Check for compliance subsection QR (highest priority — spec T-026)
    const subsection = parseSubsectionQrUrl(data)
    if (subsection) {
      router.replace(`/compliance/${subsection.siteId}/${subsection.subsectionId}` as any)
      return
    }

    // 2. Check for snag QR
    const snagId = extractSnagId(data)
    if (snagId) {
      router.replace(`/snags/${snagId}` as any)
      return
    }

    // 3. Unrecognised — show raw value
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
    <View testID="qr-scan-screen" style={styles.container}>
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
            {scanned ? 'Processing…' : 'Point camera at a compliance subsection or snag QR code'}
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
  container: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, backgroundColor: colors.base, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.lg },
  text: { color: colors.textMid, fontSize: fontSize.md, textAlign: 'center' },
  btn: { backgroundColor: colors.amber, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md, borderRadius: radius.md },
  btnText: { color: colors.base, fontWeight: fontWeight.bold, fontSize: fontSize.base },
  backLink: { marginTop: spacing.sm },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },

  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.lg, backgroundColor: 'rgba(0,0,0,0.55)' },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
  closeText: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },

  viewfinderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewfinder: { width: 240, height: 240, position: 'relative' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.amber, borderWidth: BORDER },
  tl: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0 },
  tr: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0 },
  bl: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0 },
  br: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0 },

  bottomHint: { paddingHorizontal: spacing.xxl, paddingBottom: 48, paddingTop: spacing.xxl, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', gap: spacing.md + 2 },
  hintText: { color: colors.text, fontSize: fontSize.bodyLg, textAlign: 'center' },
  rescanBtn: { backgroundColor: colors.amber, paddingHorizontal: spacing.xxl, paddingVertical: spacing.sm + 2, borderRadius: radius.pill },
  rescanText: { color: colors.base, fontWeight: fontWeight.bold, fontSize: fontSize.bodyLg },
})
