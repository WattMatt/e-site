import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, useWindowDimensions,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native'
import {
  Canvas, Image as SkImage, Group, Path, Rect, Circle, Skia, useImage,
  Text as SkText, matchFont,
} from '@shopify/react-native-skia'
import type { SkCanvas } from '@shopify/react-native-skia'
import * as FileSystem from 'expo-file-system'
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme'
import type {
  AnnotationColor, AnnotationData, AnnotationShape, AnnotationTool,
} from './types'

const COLORS: AnnotationColor[] = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#000000']
const TOOLS: AnnotationTool[] = ['pen', 'arrow', 'rect', 'circle', 'text', 'pin']
const STROKE_WIDTH = 3
// Header + toolbar + canvas padding reserved on every layout pass — keeps the
// Skia canvas inside the visible viewport on tablets (landscape + portrait).
const HEADER_HEIGHT = 96
const TOOLBAR_HEIGHT = 56
const CANVAS_PADDING = 16

interface Props {
  floorPlanName: string
  sourceImageUrl: string
  sourceFloorPlanId: string | null
  initialAnnotation?: AnnotationData | null
  onCancel: () => void
  onSave: (result: { uri: string; annotationData: AnnotationData; fileName: string }) => void
}

export function FloorPlanAnnotator({
  floorPlanName, sourceImageUrl, sourceFloorPlanId: _sourceFloorPlanId,
  initialAnnotation, onCancel, onSave,
}: Props) {
  const image = useImage(sourceImageUrl)
  const canvasRef = useRef<any>(null)
  const { width: winW, height: winH } = useWindowDimensions()
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [tool, setTool] = useState<AnnotationTool>('pen')
  const [color, setColor] = useState<AnnotationColor>('#ef4444')
  const [shapes, setShapes] = useState<AnnotationShape[]>(initialAnnotation?.shapes ?? [])
  const [history, setHistory] = useState<AnnotationShape[][]>([])
  const [future, setFuture] = useState<AnnotationShape[][]>([])
  const [drawing, setDrawing] = useState<AnnotationShape | null>(null)
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // Fit image inside both axes of the available viewport, and rescale any
  // existing shapes so the annotation layer tracks the image through
  // orientation changes on phone + tablet.
  useEffect(() => {
    if (!image) return
    const viewportW = Math.max(100, winW - 2 * CANVAS_PADDING)
    const viewportH = Math.max(100, winH - HEADER_HEIGHT - TOOLBAR_HEIGHT - 2 * CANVAS_PADDING)
    const iw = image.width()
    const ih = image.height()
    const scale = Math.min(viewportW / iw, viewportH / ih, 1)
    const width = Math.round(iw * scale)
    const height = Math.round(ih * scale)

    setCanvasSize(prev => {
      if (prev.width > 0 && (prev.width !== width || prev.height !== height)) {
        const sx = width / prev.width
        const sy = height / prev.height
        setShapes(ss => ss.map(s => rescaleShape(s, sx, sy)))
        setHistory(h => h.map(snap => snap.map(s => rescaleShape(s, sx, sy))))
        setFuture(f => f.map(snap => snap.map(s => rescaleShape(s, sx, sy))))
      }
      return { width, height }
    })
  }, [image, winW, winH])

  const font = useMemo(() => {
    return matchFont({
      fontFamily: 'system',
      fontSize: 18,
      fontStyle: 'normal',
      fontWeight: 'bold',
    })
  }, [])

  const pinFont = useMemo(() => {
    return matchFont({
      fontFamily: 'system',
      fontSize: 13,
      fontStyle: 'normal',
      fontWeight: 'bold',
    })
  }, [])

  function push(next: AnnotationShape[]) {
    setHistory(prev => [...prev.slice(-49), shapes])
    setFuture([])
    setShapes(next)
  }

  function undo() {
    if (history.length === 0) return
    const last = history[history.length - 1]!
    setFuture(f => [shapes, ...f])
    setShapes(last)
    setHistory(h => h.slice(0, -1))
  }

  function redo() {
    if (future.length === 0) return
    const [next, ...rest] = future
    setHistory(h => [...h, shapes])
    setShapes(next!)
    setFuture(rest)
  }

  function mkId() { return Math.random().toString(36).slice(2, 10) }

  const handleTouchStart = useCallback((e: any) => {
    const { locationX, locationY } = e.nativeEvent
    const x = locationX, y = locationY

    if (tool === 'text') {
      setTextInput({ x, y, value: '' })
      return
    }

    if (tool === 'pin') {
      push([...shapes, { id: mkId(), type: 'pin', x, y, color }])
      return
    }

    if (tool === 'pen') {
      setDrawing({ id: mkId(), type: 'pen', points: [x, y], color, strokeWidth: STROKE_WIDTH })
    } else if (tool === 'arrow') {
      setDrawing({ id: mkId(), type: 'arrow', points: [x, y, x, y], color, strokeWidth: STROKE_WIDTH })
    } else if (tool === 'rect') {
      setDrawing({ id: mkId(), type: 'rect', x, y, width: 0, height: 0, color, strokeWidth: STROKE_WIDTH })
    } else if (tool === 'circle') {
      setDrawing({ id: mkId(), type: 'circle', x, y, radius: 0, color, strokeWidth: STROKE_WIDTH })
    }
  }, [tool, color, shapes])

  const handleTouchMove = useCallback((e: any) => {
    if (!drawing) return
    const { locationX: x, locationY: y } = e.nativeEvent
    if (drawing.type === 'pen') {
      setDrawing({ ...drawing, points: [...drawing.points, x, y] })
    } else if (drawing.type === 'arrow') {
      setDrawing({ ...drawing, points: [drawing.points[0], drawing.points[1], x, y] })
    } else if (drawing.type === 'rect') {
      setDrawing({ ...drawing, width: x - drawing.x, height: y - drawing.y })
    } else if (drawing.type === 'circle') {
      const dx = x - drawing.x, dy = y - drawing.y
      setDrawing({ ...drawing, radius: Math.sqrt(dx * dx + dy * dy) })
    }
  }, [drawing])

  const handleTouchEnd = useCallback(() => {
    if (!drawing) return
    const trivial =
      (drawing.type === 'rect' && Math.abs(drawing.width) < 3 && Math.abs(drawing.height) < 3) ||
      (drawing.type === 'circle' && drawing.radius < 3) ||
      (drawing.type === 'pen' && drawing.points.length < 4)
    if (!trivial) push([...shapes, drawing])
    setDrawing(null)
  }, [drawing, shapes])

  async function handleSave() {
    if (!canvasRef.current) return
    setSaving(true)
    try {
      const snapshot = canvasRef.current.makeImageSnapshot()
      if (!snapshot) throw new Error('Could not snapshot canvas')
      const base64 = snapshot.encodeToBase64()
      const fileName = `floorplan-markup-${Date.now()}.png`
      const uri = `${FileSystem.cacheDirectory}${fileName}`
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 })
      const annotationData: AnnotationData = {
        version: 1,
        canvas: canvasSize,
        baseImage: image
          ? { naturalWidth: image.width(), naturalHeight: image.height(), signedUrl: sourceImageUrl }
          : { naturalWidth: 0, naturalHeight: 0, signedUrl: sourceImageUrl },
        shapes,
      }
      onSave({ uri, annotationData, fileName })
    } catch (e: any) {
      Alert.alert('Save failed', e.message ?? 'Could not save annotation')
    } finally {
      setSaving(false)
    }
  }

  function submitTextInput() {
    if (!textInput) return
    const value = textInput.value.trim()
    if (value) {
      push([...shapes, {
        id: mkId(), type: 'text',
        x: textInput.x, y: textInput.y,
        text: value, color, fontSize: 18,
      }])
    }
    setTextInput(null)
  }

  const current = drawing ? [...shapes, drawing] : shapes

  return (
    <View style={styles.overlay}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>Mark up: {floorPlanName}</Text>
          <Text style={styles.meta}>
            {shapes.length} annotation{shapes.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleSave} style={styles.saveBtn} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.base} /> : <Text style={styles.saveText}>Save</Text>}
        </TouchableOpacity>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        {TOOLS.map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => setTool(t)}
            style={[styles.toolBtn, tool === t && styles.toolBtnActive]}
          >
            <Text style={[styles.toolText, tool === t && styles.toolTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.divider} />
        {COLORS.map(c => (
          <TouchableOpacity
            key={c}
            onPress={() => setColor(c)}
            style={[
              styles.swatch,
              { backgroundColor: c },
              color === c && styles.swatchActive,
            ]}
          />
        ))}
        <View style={styles.divider} />
        <TouchableOpacity onPress={undo} style={[styles.toolBtn, history.length === 0 && styles.disabled]}>
          <Text style={styles.toolText}>↶</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={redo} style={[styles.toolBtn, future.length === 0 && styles.disabled]}>
          <Text style={styles.toolText}>↷</Text>
        </TouchableOpacity>
      </View>

      {/* Canvas */}
      <View style={styles.canvasWrap}>
        {(!image || canvasSize.width === 0) && <ActivityIndicator color={colors.amber} />}
        {image && canvasSize.width > 0 && (
          <View
            style={{ width: canvasSize.width, height: canvasSize.height }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleTouchStart}
            onResponderMove={handleTouchMove}
            onResponderRelease={handleTouchEnd}
            onResponderTerminate={handleTouchEnd}
          >
            <Canvas ref={canvasRef} style={{ width: canvasSize.width, height: canvasSize.height }}>
              <SkImage image={image} x={0} y={0} width={canvasSize.width} height={canvasSize.height} />
              {current.map(s => renderShape(s, font, pinFont))}
            </Canvas>
          </View>
        )}
      </View>

      {textInput && (
        <View style={styles.textInputOverlay}>
          <View style={styles.textInputBox}>
            <Text style={styles.textInputLabel}>Text label</Text>
            <TextInput
              value={textInput.value}
              onChangeText={v => setTextInput({ ...textInput, value: v })}
              style={styles.textInputField}
              placeholder="Type a label…"
              placeholderTextColor={colors.textDim}
              autoFocus
              onSubmitEditing={submitTextInput}
            />
            <View style={styles.textInputRow}>
              <TouchableOpacity onPress={() => setTextInput(null)} style={styles.textInputCancel}>
                <Text style={styles.textInputCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitTextInput} style={styles.textInputOk}>
                <Text style={styles.textInputOkText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

function rescaleShape(s: AnnotationShape, sx: number, sy: number): AnnotationShape {
  if (s.type === 'pen') {
    return {
      ...s,
      points: s.points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy)),
    }
  }
  if (s.type === 'arrow') {
    const [x1, y1, x2, y2] = s.points
    return { ...s, points: [x1 * sx, y1 * sy, x2 * sx, y2 * sy] }
  }
  if (s.type === 'rect') {
    return { ...s, x: s.x * sx, y: s.y * sy, width: s.width * sx, height: s.height * sy }
  }
  if (s.type === 'circle') {
    return { ...s, x: s.x * sx, y: s.y * sy, radius: s.radius * Math.min(sx, sy) }
  }
  if (s.type === 'text' || s.type === 'pin') {
    return { ...s, x: s.x * sx, y: s.y * sy }
  }
  return s
}

function renderShape(s: AnnotationShape, font: any, pinFont: any) {
  if (s.type === 'pen' && s.points.length >= 4) {
    const path = Skia.Path.Make()
    path.moveTo(s.points[0]!, s.points[1]!)
    for (let i = 2; i < s.points.length; i += 2) {
      path.lineTo(s.points[i]!, s.points[i + 1]!)
    }
    return (
      <Path
        key={s.id}
        path={path}
        color={s.color}
        style="stroke"
        strokeWidth={s.strokeWidth}
        strokeCap="round"
        strokeJoin="round"
      />
    )
  }
  if (s.type === 'arrow') {
    const [x1, y1, x2, y2] = s.points
    const path = Skia.Path.Make()
    path.moveTo(x1, y1)
    path.lineTo(x2, y2)

    // Arrow head
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const headLen = 12
    const a1 = angle - Math.PI / 7
    const a2 = angle + Math.PI / 7
    path.moveTo(x2, y2)
    path.lineTo(x2 - headLen * Math.cos(a1), y2 - headLen * Math.sin(a1))
    path.moveTo(x2, y2)
    path.lineTo(x2 - headLen * Math.cos(a2), y2 - headLen * Math.sin(a2))

    return (
      <Path key={s.id} path={path} color={s.color} style="stroke"
        strokeWidth={s.strokeWidth} strokeCap="round" strokeJoin="round" />
    )
  }
  if (s.type === 'rect') {
    const x = Math.min(s.x, s.x + s.width)
    const y = Math.min(s.y, s.y + s.height)
    const w = Math.abs(s.width)
    const h = Math.abs(s.height)
    return (
      <Rect key={s.id} x={x} y={y} width={w} height={h}
        color={s.color} style="stroke" strokeWidth={s.strokeWidth} />
    )
  }
  if (s.type === 'circle') {
    return (
      <Circle key={s.id} cx={s.x} cy={s.y} r={s.radius}
        color={s.color} style="stroke" strokeWidth={s.strokeWidth} />
    )
  }
  if (s.type === 'text') {
    return <SkText key={s.id} x={s.x} y={s.y} text={s.text} color={s.color} font={font} />
  }
  if (s.type === 'pin') {
    return (
      <Group key={s.id}>
        <Circle cx={s.x} cy={s.y} r={10} color={s.color} />
        <Circle cx={s.x} cy={s.y} r={10} color="#0D0B09" style="stroke" strokeWidth={2} />
        <Circle cx={s.x} cy={s.y} r={3} color="#0D0B09" />
        {s.label && <SkText x={s.x + 14} y={s.y - 6} text={s.label} color={s.color} font={pinFont} />}
      </Group>
    )
  }
  return null
}

// Type-safety guard — the `SkCanvas` type is exported for ref typing future-proofing.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Ref = SkCanvas

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.base, zIndex: 100,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: 56, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.caption, color: colors.textDim, marginTop: 2 },
  cancelBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  cancelText: { color: colors.textMid, fontSize: fontSize.body },
  saveBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.amber,
  },
  saveText: { color: colors.base, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  toolbar: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    alignItems: 'center',
  },
  toolBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel,
  },
  toolBtnActive: { backgroundColor: colors.amberDim, borderColor: colors.amberMid },
  toolText: { fontSize: fontSize.caption, color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.4 },
  toolTextActive: { color: colors.amber, fontWeight: fontWeight.bold },
  divider: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 4 },
  swatch: {
    width: 24, height: 24, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  swatchActive: { borderWidth: 2, borderColor: colors.amber },
  canvasWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: CANVAS_PADDING, backgroundColor: '#000',
  },
  disabled: { opacity: 0.4 },
  textInputOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center',
    padding: spacing.lg, zIndex: 110,
  },
  textInputBox: {
    width: '100%', maxWidth: 320, backgroundColor: colors.panel,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, gap: spacing.md,
  },
  textInputLabel: {
    fontSize: fontSize.small, fontWeight: fontWeight.semibold,
    color: colors.textMid, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  textInputField: {
    backgroundColor: colors.base, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.text, fontSize: fontSize.bodyLg,
  },
  textInputRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  textInputCancel: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  textInputCancelText: { color: colors.textMid, fontSize: fontSize.body },
  textInputOk: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.md, backgroundColor: colors.amber,
  },
  textInputOkText: { color: colors.base, fontSize: fontSize.body, fontWeight: fontWeight.bold },
})
