'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { classifyWheel, isPanPress } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/canvas-input'
import { fitTransform, zoomAbout } from './viewport-math'

/**
 * Zoom, pan and fit for a sheet drawn on a Konva Stage — shared by the markup
 * canvas and the cable-route canvas so the two cannot drift.
 *
 * The container is fixed-size; the Stage is the same size and the sheet is
 * scaled and translated inside it. `scale`/`offset` are state for rendering
 * and ALSO refs, because wheel and pinch handlers must read the current
 * transform synchronously between React commits (rapid input outpaces
 * useState).
 *
 * Input model, unchanged from the canvas it was lifted out of:
 *  · wheel: pinch-zoom (ctrl) zooms about the cursor; plain wheel pans
 *    (see `classifyWheel`)
 *  · two fingers: pinch to zoom, move to pan — `onPinchStart` fires once when
 *    the second finger lands so the caller can undo what the first one did
 *  · middle-drag, or space+left-drag: move the sheet in every tool, in
 *    CAPTURE phase on the container so Konva never sees the press
 *  · F or 0 fits, + and - zoom about the centre
 */
export function useSheetViewport({
  containerRef,
  image,
  resetKey,
  onPinchStart,
}: {
  containerRef: RefObject<HTMLDivElement | null>
  /** The sheet's backing size; null until loaded. Auto-fit runs once per `resetKey` once this is set. */
  image: { w: number; h: number } | null
  /** Change this to re-run the first-load auto-fit — the drawing id and page, never the signed URL. */
  resetKey: string
  /** A second finger landed: the first one's press was half a pinch, not a tap. */
  onPinchStart?: () => void
}) {
  const [viewport, setViewport] = useState({ w: 800, h: 560 })
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const initFitDone = useRef(false)
  const scaleRef = useRef(1)
  const offsetRef = useRef({ x: 0, y: 0 })
  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { offsetRef.current = offset }, [offset])
  const [gestureActive, setGestureActive] = useState(false)
  /**
   * A middle-drag or space-drag is moving the sheet. A ref because pointer
   * handlers read it synchronously on the same event tick that sets it, and
   * state would be a render behind; the paired state is only for the cursor.
   */
  const panningRef = useRef(false)
  const [panning, setPanning] = useState(false)
  /** Space held = temporary hand tool, for trackpads with no middle button. */
  const spaceHeldRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  /** Fingers currently down, so only the first one may act on the canvas. */
  const touchCountRef = useRef(0)
  const onPinchStartRef = useRef(onPinchStart)
  onPinchStartRef.current = onPinchStart

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setViewport({ w: r.width, h: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  // Reset auto-fit when the DRAWING or the page changes — not when a server
  // re-render merely re-mints the signed URL, which would snap the view back
  // to fit-to-width under the user after every save.
  useEffect(() => {
    initFitDone.current = false
  }, [resetKey])

  const imageW = image?.w ?? 0
  const imageH = image?.h ?? 0
  const fitToView = useCallback(() => {
    const t = fitTransform(viewport, { w: imageW, h: imageH })
    if (!t) return
    scaleRef.current = t.scale
    offsetRef.current = t.offset
    setScale(t.scale)
    setOffset(t.offset)
  }, [imageW, imageH, viewport])

  // First-load auto-fit
  useEffect(() => {
    if (!image || initFitDone.current) return
    if (viewport.w < 50) return
    fitToView()
    initFitDone.current = true
  }, [image, viewport.w, viewport.h, fitToView])

  // Zoom by `factor`, keeping (anchorX, anchorY) — container-local CSS pixels —
  // stationary on screen. Used by wheel, pinch and the toolbar buttons.
  const zoomBy = useCallback((factor: number, anchorX: number, anchorY: number) => {
    const next = zoomAbout({ scale: scaleRef.current, offset: offsetRef.current }, factor, { x: anchorX, y: anchorY })
    if (next.scale === scaleRef.current) return
    scaleRef.current = next.scale
    offsetRef.current = next.offset
    setScale(next.scale)
    setOffset(next.offset)
  }, [])

  const zoomIn = useCallback(() => zoomBy(1.25, viewport.w / 2, viewport.h / 2), [zoomBy, viewport.w, viewport.h])
  const zoomOut = useCallback(() => zoomBy(1 / 1.25, viewport.w / 2, viewport.h / 2), [zoomBy, viewport.w, viewport.h])

  /** For the Stage's own drag end (the select tool): adopt where Konva put it. */
  const setOffsetFromStage = useCallback((next: { x: number; y: number }) => {
    offsetRef.current = next
    setOffset(next)
  }, [])

  // Native wheel + multi-touch gestures. Konva doesn't expose pointerId for
  // reliable 2-finger tracking and wheel needs preventDefault (which Konva's
  // event wrapper doesn't cleanly support), so we bind directly to the
  // container.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const pointers = new Map<number, { x: number; y: number }>()
    let gesture: { dist: number; cx: number; cy: number } | null = null

    const localPt = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { x, y } = localPt(e)
      const intent = classifyWheel(e)
      if (intent.kind === 'zoom') {
        zoomBy(intent.factor, x, y)
        return
      }
      if (intent.dx === 0 && intent.dy === 0) return
      const next = { x: offsetRef.current.x + intent.dx, y: offsetRef.current.y + intent.dy }
      offsetRef.current = next
      setOffset(next)
    }
    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, localPt(e))
      if (e.pointerType === 'touch') touchCountRef.current = pointers.size
      if (pointers.size === 2) {
        const pts = [...pointers.values()]
        const dx = pts[1]!.x - pts[0]!.x
        const dy = pts[1]!.y - pts[0]!.y
        gesture = {
          dist: Math.hypot(dx, dy),
          cx: (pts[0]!.x + pts[1]!.x) / 2,
          cy: (pts[0]!.y + pts[1]!.y) / 2,
        }
        // Finger one already ran the tool — it was indistinguishable from a
        // deliberate tap until this moment. The caller cuts what it placed.
        onPinchStartRef.current?.()
        setGestureActive(true)
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, localPt(e))
      if (pointers.size === 2 && gesture) {
        e.preventDefault()
        const pts = [...pointers.values()]
        const dx = pts[1]!.x - pts[0]!.x
        const dy = pts[1]!.y - pts[0]!.y
        const dist = Math.hypot(dx, dy)
        const cx = (pts[0]!.x + pts[1]!.x) / 2
        const cy = (pts[0]!.y + pts[1]!.y) / 2
        if (dist > 0 && gesture.dist > 0) {
          zoomBy(dist / gesture.dist, cx, cy)
        }
        const panDx = cx - gesture.cx
        const panDy = cy - gesture.cy
        if (panDx !== 0 || panDy !== 0) {
          const newOffset = { x: offsetRef.current.x + panDx, y: offsetRef.current.y + panDy }
          offsetRef.current = newOffset
          setOffset(newOffset)
        }
        gesture = { dist, cx, cy }
      }
    }
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (e.pointerType === 'touch') touchCountRef.current = pointers.size
      if (pointers.size < 2) {
        gesture = null
        setGestureActive(false)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerleave', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onUp)
    }
  }, [zoomBy, containerRef])

  /**
   * Drag the sheet in every tool: middle-drag (mouse) and space+left-drag
   * (trackpad). CAPTURE phase on the container so Konva never sees the press
   * and no tool branch needs a `button` check; written straight to the offset
   * (not a Konva drag) so a wheel tick mid-drag composes instead of being
   * reverted; preventDefault on `mousedown` because that is the compatibility
   * event that opens Chrome's autoscroll puck on Windows and Linux.
   */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let last: { x: number; y: number } | null = null

    const begin = (e: PointerEvent) => {
      const wants = isPanPress(e) || (e.button === 0 && spaceHeldRef.current && e.pointerType !== 'touch')
      if (!wants) return
      e.preventDefault()
      e.stopPropagation()
      last = { x: e.clientX, y: e.clientY }
      panningRef.current = true
      setPanning(true)
      try { el.setPointerCapture(e.pointerId) } catch { /* capture is best-effort */ }
    }
    const move = (e: PointerEvent) => {
      if (!panningRef.current || !last) return
      e.preventDefault()
      e.stopPropagation()
      // Screen-space delta straight onto the offset, NOT divided by scale: the
      // sheet must follow the cursor 1:1 at any zoom.
      const next = { x: offsetRef.current.x + (e.clientX - last.x), y: offsetRef.current.y + (e.clientY - last.y) }
      last = { x: e.clientX, y: e.clientY }
      offsetRef.current = next
      setOffset(next)
    }
    const end = (e: PointerEvent) => {
      if (!panningRef.current) return
      panningRef.current = false
      last = null
      setPanning(false)
      try { el.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    }
    const killMiddleDefault = (e: MouseEvent) => { if (e.button === 1) e.preventDefault() }

    el.addEventListener('pointerdown', begin, { capture: true })
    el.addEventListener('pointermove', move, { capture: true })
    el.addEventListener('pointerup', end, { capture: true })
    el.addEventListener('pointercancel', end, { capture: true })
    el.addEventListener('lostpointercapture', end, { capture: true })
    el.addEventListener('mousedown', killMiddleDefault, { capture: true })
    el.addEventListener('auxclick', killMiddleDefault, { capture: true })
    return () => {
      el.removeEventListener('pointerdown', begin, { capture: true })
      el.removeEventListener('pointermove', move, { capture: true })
      el.removeEventListener('pointerup', end, { capture: true })
      el.removeEventListener('pointercancel', end, { capture: true })
      el.removeEventListener('lostpointercapture', end, { capture: true })
      el.removeEventListener('mousedown', killMiddleDefault, { capture: true })
      el.removeEventListener('auxclick', killMiddleDefault, { capture: true })
    }
  }, [containerRef])

  /**
   * Space = temporary hand. The guard skips typing targets AND buttons: space
   * on a focused button is that button's activate key.
   */
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || el.isContentEditable
    }
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e.target)) return
      e.preventDefault()
      spaceHeldRef.current = true
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceHeldRef.current = false
      setSpaceHeld(false)
    }
    // Releasing the key while the window is unfocused would otherwise leave
    // the hand latched on for ever.
    const blur = () => { spaceHeldRef.current = false; setSpaceHeld(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // Keyboard: F or 0 → fit, +/= zoom in, - zoom out. Skipped while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'f' || e.key === 'F' || e.key === '0') {
        e.preventDefault()
        fitToView()
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        zoomIn()
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        zoomOut()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitToView, zoomIn, zoomOut])

  return {
    viewport,
    scale,
    offset,
    fitToView,
    zoomIn,
    zoomOut,
    setOffsetFromStage,
    gestureActive,
    panning,
    spaceHeld,
    panningRef,
    touchCountRef,
  }
}
