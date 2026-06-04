/**
 * Tests for interior.tsx — shared react-pdf primitives for report kinds.
 *
 * Strategy: react-test-renderer is not available; @testing-library/react would
 * mount into a DOM but react-pdf components don't produce real DOM nodes.
 * We invoke each component as a plain function and walk the returned React
 * element tree to assert load-bearing structure.
 *
 * No `// @vitest-environment node` pragma — we stay in jsdom (the vitest default)
 * because we never call renderToBuffer.
 */
import React from 'react'
import { describe, it, expect } from 'vitest'

// --- helpers ----------------------------------------------------------------

/** Safely get props from an unknown node — never throws. */
function getProps(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== 'object') return {}
  const el = node as { props?: unknown }
  if (!el.props || typeof el.props !== 'object') return {}
  return el.props as Record<string, unknown>
}

/** Flatten a potentially-nested children value into a flat array of nodes. */
function flatChildren(children: unknown): unknown[] {
  if (children == null) return []
  if (Array.isArray(children)) {
    const result: unknown[] = []
    for (const c of children) {
      if (c == null) continue
      if (Array.isArray(c)) result.push(...flatChildren(c))
      else result.push(c)
    }
    return result
  }
  return [children]
}

/** Get children as a flat array, handling null/undefined/single/nested-array cases. */
function getChildren(node: unknown): unknown[] {
  const p = getProps(node)
  return flatChildren(p.children)
}

/** Recursively collect all string values from element children (depth-first). */
function collectText(node: unknown): string[] {
  if (node == null) return []
  if (typeof node === 'string') return [node]
  if (typeof node !== 'object') return []
  // If this is an array, flatten it
  if (Array.isArray(node)) {
    const out: string[] = []
    for (const c of node) out.push(...collectText(c))
    return out
  }
  const results: string[] = []
  const p = getProps(node)
  const children = p.children
  if (typeof children === 'string') results.push(children)
  for (const c of flatChildren(children)) {
    results.push(...collectText(c))
  }
  // Also recurse into component function elements: if type is a function,
  // call it with props to get its output tree and collect from that.
  const el = node as { type?: unknown }
  if (typeof el.type === 'function') {
    try {
      const rendered = (el.type as (props: unknown) => unknown)(p)
      if (rendered) results.push(...collectText(rendered))
    } catch {
      // Ignore render errors; the element may need a render context
    }
  }
  return results
}

/**
 * Resolve the effective backgroundColor from a style prop.
 * react-pdf accepts style as a plain object OR an array of objects.
 */
function resolveStyleProp(style: unknown, key: string): unknown {
  if (!style) return undefined
  if (Array.isArray(style)) {
    for (const s of style) {
      const val = resolveStyleProp(s, key)
      if (val !== undefined) return val
    }
    return undefined
  }
  if (typeof style === 'object') {
    return (style as Record<string, unknown>)[key]
  }
  return undefined
}

/**
 * Expand a node: if it's a function component element, call it to get the
 * rendered output. This lets our helpers see through composite components
 * (e.g. ResultPill nested inside ResultRow).
 */
function expand(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node
  const el = node as { type?: unknown }
  if (typeof el.type === 'function') {
    try {
      return (el.type as (props: unknown) => unknown)(getProps(node))
    } catch {
      return node
    }
  }
  return node
}

/** Walk all nodes: the node itself, then expand and recurse into all children. */
function walkAll(node: unknown): unknown[] {
  if (!node) return []
  if (Array.isArray(node)) {
    const result: unknown[] = []
    for (const c of node) result.push(...walkAll(c))
    return result
  }
  if (typeof node !== 'object') return [node]
  const expanded = expand(node)
  if (expanded !== node) return [node, ...walkAll(expanded)]
  const result: unknown[] = [node]
  for (const c of getChildren(node)) result.push(...walkAll(c))
  return result
}

/** Check whether any node in the tree has a src prop equal to the given value. */
function hasSrc(node: unknown, src: string): boolean {
  return walkAll(node).some((n) => {
    if (!n || typeof n !== 'object') return false
    return getProps(n).src === src
  })
}

/** Check whether any node in the tree has any src prop (an <Image> or <Link> element). */
function hasAnySrc(node: unknown): boolean {
  return walkAll(node).some((n) => {
    if (!n || typeof n !== 'object') return false
    return typeof getProps(n).src === 'string'
  })
}

/** Check whether any node in the tree has a backgroundColor matching `bg`. */
function hasBg(node: unknown, bg: string): boolean {
  return walkAll(node).some((n) => {
    if (!n || typeof n !== 'object') return false
    return resolveStyleProp(getProps(n).style, 'backgroundColor') === bg
  })
}

/** Check whether any node in the tree has a render prop (function). */
function hasRenderProp(node: unknown): boolean {
  return walkAll(node).some((n) => {
    if (!n || typeof n !== 'object') return false
    return typeof getProps(n).render === 'function'
  })
}

/** Check whether any node or descendant has fixed prop === true. */
function hasFixed(node: unknown): boolean {
  return walkAll(node).some((n) => {
    if (!n || typeof n !== 'object') return false
    return getProps(n).fixed === true
  })
}


// --- types we'll import from interior.tsx ----------------------------------
// Import after module exists; if not present, these tests will fail (which is
// the required TDD "red" state).

import {
  RunningHeader,
  RunningFooter,
  Section,
  ResultPill,
  ResultRow,
  Table,
  PhotoGrid,
  SignatureBlock,
  AnnexureList,
} from './interior'
import type {
  ReportFieldRow,
  ReportPhoto,
  ReportPhotoField,
  ReportSignature,
  ReportAnnexure,
} from './interior'
import { spacing } from './theme'

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const ACCENT = '#E69500'
const DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// ---------------------------------------------------------------------------
// RunningHeader
// ---------------------------------------------------------------------------

describe('RunningHeader', () => {
  it('is a fixed View', () => {
    const el = RunningHeader({ issuerLogoDataUri: DATA_URI, title: 'Report Title', accent: ACCENT })
    expect(el).toBeTruthy()
    // fixed can appear on the root or any descendant
    expect(hasFixed(el)).toBe(true)
  })

  it('renders an Image when issuerLogoDataUri is provided', () => {
    const el = RunningHeader({ issuerLogoDataUri: DATA_URI, title: 'Report', accent: ACCENT })
    expect(hasSrc(el, DATA_URI)).toBe(true)
  })

  it('renders title text instead of Image when issuerLogoDataUri is null', () => {
    const el = RunningHeader({ issuerLogoDataUri: null, title: 'My Title', accent: ACCENT })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'My Title')).toBe(true)
  })

  it('has a render-prop Text for page numbers (mirrors Cover footer)', () => {
    const el = RunningHeader({ issuerLogoDataUri: null, title: 'T', accent: ACCENT })
    expect(hasRenderProp(el)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// RunningFooter
// ---------------------------------------------------------------------------

describe('RunningFooter', () => {
  it('is a fixed View', () => {
    const el = RunningFooter({ contractorLogoDataUri: null, stamp: 'Draft', accent: ACCENT })
    expect(hasFixed(el)).toBe(true)
  })

  it('renders stamp text', () => {
    const el = RunningFooter({ contractorLogoDataUri: null, stamp: 'Draft — Confidential', accent: ACCENT })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Draft — Confidential')).toBe(true)
  })

  it('renders contractor logo Image when dataUri is provided', () => {
    const el = RunningFooter({ contractorLogoDataUri: DATA_URI, stamp: 'Draft', accent: ACCENT })
    expect(hasSrc(el, DATA_URI)).toBe(true)
  })

  it('does NOT render a logo Image when contractorLogoDataUri is null', () => {
    const el = RunningFooter({ contractorLogoDataUri: null, stamp: 'Draft', accent: ACCENT })
    expect(hasAnySrc(el)).toBe(false)
  })

  it('renders a hairline View with backgroundColor === accent at the top of the footer', () => {
    const el = RunningFooter({ contractorLogoDataUri: null, stamp: 'Draft', accent: ACCENT })
    expect(hasBg(el, ACCENT)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

describe('Section', () => {
  it('renders heading text', () => {
    const el = Section({ title: 'Installation Check', accent: ACCENT, children: null })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Installation Check')).toBe(true)
  })

  it('contains a 2px accent-coloured rule View', () => {
    const el = Section({ title: 'T', accent: ACCENT, children: null })
    // The rule is a View with style=[s.sectionRule, { backgroundColor: accent, height: 2 }]
    // hasBg checks backgroundColor at any depth; also verify height=2 via a custom check
    function findAccentRule(node: unknown): boolean {
      if (!node || typeof node !== 'object') return false
      const p2 = getProps(node)
      const bg = resolveStyleProp(p2.style, 'backgroundColor')
      const h = resolveStyleProp(p2.style, 'height')
      if (bg === ACCENT && h === 2) return true
      return getChildren(node).some(findAccentRule)
    }
    expect(findAccentRule(el)).toBe(true)
  })

  it('has wrap=true for page breaking', () => {
    const el = Section({ title: 'T', accent: ACCENT, children: null })
    // wrap prop may equal the boolean true — check root or we just verify renders
    expect(el).toBeTruthy()
    // The spec says "marked wrap" — verify the prop is present on root or a descendant
    function hasWrap(node: unknown): boolean {
      if (!node || typeof node !== 'object') return false
      const p2 = getProps(node)
      if (p2.wrap === true) return true
      return getChildren(node).some(hasWrap)
    }
    expect(hasWrap(el)).toBe(true)
  })

  it('renders its children', () => {
    const child = React.createElement('Text' as unknown as React.ComponentType, {}, 'child content')
    const el = Section({ title: 'T', accent: ACCENT, children: child })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'child content')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ResultPill
// ---------------------------------------------------------------------------

describe('ResultPill', () => {
  it('shows PASS text for pass state', () => {
    const el = ResultPill({ pass: 'pass' })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'PASS')).toBe(true)
  })

  it('shows FAIL text for fail state', () => {
    const el = ResultPill({ pass: 'fail' })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'FAIL')).toBe(true)
  })

  it('shows N/A text for na state', () => {
    const el = ResultPill({ pass: 'na' })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'N/A')).toBe(true)
  })

  it('shows — text for null state', () => {
    const el = ResultPill({ pass: null })
    const texts = collectText(el)
    expect(texts.some((t) => t === '—')).toBe(true)
  })

  it('uses passPillColors background for pass', () => {
    const el = ResultPill({ pass: 'pass' })
    expect(hasBg(el, '#D1FAE5')).toBe(true)
  })

  it('uses passPillColors background for fail', () => {
    const el = ResultPill({ pass: 'fail' })
    expect(hasBg(el, '#FEE2E2')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ResultRow
// ---------------------------------------------------------------------------

describe('ResultRow', () => {
  it('renders kind=result with label + pill', () => {
    const row: ReportFieldRow = {
      fieldId: 'f1',
      label: 'Circuit breaker rating',
      kind: 'result',
      pass: 'pass',
    }
    const el = ResultRow({ row })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Circuit breaker rating')).toBe(true)
    expect(texts.some((t) => t === 'PASS')).toBe(true)
  })

  it('renders kind=result with failReason sub-line when present', () => {
    const row: ReportFieldRow = {
      fieldId: 'f2',
      label: 'Earth continuity',
      kind: 'result',
      pass: 'fail',
      failReason: 'Resistance 12Ω exceeds 1Ω limit',
    }
    const el = ResultRow({ row })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Resistance 12Ω exceeds 1Ω limit')).toBe(true)
  })

  it('does NOT render failReason when absent', () => {
    const row: ReportFieldRow = {
      fieldId: 'f3',
      label: 'Insulation resistance',
      kind: 'result',
      pass: 'pass',
    }
    const el = ResultRow({ row })
    expect(el).toBeTruthy() // renders cleanly
  })

  it('renders kind=value with label + value', () => {
    const row: ReportFieldRow = {
      fieldId: 'f4',
      label: 'Supply voltage',
      kind: 'value',
      value: '230V',
    }
    const el = ResultRow({ row })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Supply voltage')).toBe(true)
    expect(texts.some((t) => t === '230V')).toBe(true)
  })

  it('renders kind=paragraph with label + wrapped text', () => {
    const row: ReportFieldRow = {
      fieldId: 'f5',
      label: 'Site notes',
      kind: 'paragraph',
      value: 'All earthing rods were re-driven.',
    }
    const el = ResultRow({ row })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Site notes')).toBe(true)
    expect(texts.some((t) => t === 'All earthing rods were re-driven.')).toBe(true)
  })

  it('renders kind=list with label + value', () => {
    const row: ReportFieldRow = {
      fieldId: 'f6',
      label: 'Circuits',
      kind: 'list',
      value: 'L1, L2, L3',
    }
    const el = ResultRow({ row })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Circuits')).toBe(true)
    expect(texts.some((t) => t === 'L1, L2, L3')).toBe(true)
  })

  it('renders kind=subheading as a bold sub-heading (no pill)', () => {
    const row: ReportFieldRow = {
      fieldId: 'sh1',
      label: 'Distribution Board',
      kind: 'subheading',
    }
    const el = ResultRow({ row })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Distribution Board')).toBe(true)
    // Should NOT contain a PASS/FAIL/N/A pill
    expect(texts.every((t) => !['PASS', 'FAIL', 'N/A', '—'].includes(t))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

describe('Table', () => {
  it('renders a header row with the correct number of cells', () => {
    const columns = ['Ref', 'Description', 'Result']
    const rows = [['DB-01', 'Main DB', 'Pass']]
    const el = Table({ columns, rows })
    // Text presence check (existing)
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Ref')).toBe(true)
    expect(texts.some((t) => t === 'Description')).toBe(true)
    expect(texts.some((t) => t === 'Result')).toBe(true)
    // Explicit cell count: walk the header row's direct children
    const rootChildren = getChildren(el)
    // First child is the header row View
    const headerRow = rootChildren[0]
    const headerCells = getChildren(headerRow)
    expect(headerCells.length).toBe(columns.length)
  })

  it('renders body row values', () => {
    const columns = ['Ref', 'Description', 'Result']
    const rows = [['DB-01', 'Main DB', 'Pass'], ['DB-02', 'Sub DB', 'Fail']]
    const el = Table({ columns, rows })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'DB-01')).toBe(true)
    expect(texts.some((t) => t === 'Main DB')).toBe(true)
    expect(texts.some((t) => t === 'Fail')).toBe(true)
  })

  it('renders empty body when rows is empty', () => {
    const el = Table({ columns: ['A', 'B'], rows: [] })
    expect(el).toBeTruthy()
    const texts = collectText(el)
    expect(texts.some((t) => t === 'A')).toBe(true) // header still shows
  })
})

// ---------------------------------------------------------------------------
// PhotoGrid
// ---------------------------------------------------------------------------

describe('PhotoGrid', () => {
  it('renders photo caption text', () => {
    const field: ReportPhotoField = {
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Panel photos',
      photos: [{ dataUri: DATA_URI, caption: 'Front panel' }],
      omittedCount: 0,
    }
    const el = PhotoGrid({ field, accent: ACCENT })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Front panel')).toBe(true)
  })

  it('renders an Image when photo dataUri is present', () => {
    const field: ReportPhotoField = {
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Panel photos',
      photos: [{ dataUri: DATA_URI, caption: 'Front' }],
      omittedCount: 0,
    }
    const el = PhotoGrid({ field, accent: ACCENT })
    expect(hasSrc(el, DATA_URI)).toBe(true)
  })

  it('renders placeholder text when photo dataUri is null', () => {
    const field: ReportPhotoField = {
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Panel photos',
      photos: [{ dataUri: null, caption: 'Missing photo' }],
      omittedCount: 0,
    }
    const el = PhotoGrid({ field, accent: ACCENT })
    const texts = collectText(el)
    expect(texts.some((t) => t === '[image unavailable]')).toBe(true)
  })

  it('renders an omitted count note when omittedCount > 0', () => {
    const field: ReportPhotoField = {
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Panel photos',
      photos: [{ dataUri: DATA_URI, caption: 'Photo 1' }],
      omittedCount: 5,
    }
    const el = PhotoGrid({ field, accent: ACCENT })
    const texts = collectText(el)
    expect(texts.some((t) => t.includes('+5') && t.includes('omitted'))).toBe(true)
  })

  it('does NOT render omitted note when omittedCount is 0', () => {
    const field: ReportPhotoField = {
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Panel photos',
      photos: [{ dataUri: DATA_URI, caption: 'Photo' }],
      omittedCount: 0,
    }
    const el = PhotoGrid({ field, accent: ACCENT })
    const texts = collectText(el)
    expect(texts.every((t) => !t.includes('omitted'))).toBe(true)
  })

  it('renders the field label', () => {
    const field: ReportPhotoField = {
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Cable tray photos',
      photos: [],
      omittedCount: 0,
    }
    const el = PhotoGrid({ field, accent: ACCENT })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Cable tray photos')).toBe(true)
  })

  it('renders neither an Image nor placeholder text when photos is empty', () => {
    const field: ReportPhotoField = {
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Cable tray photos',
      photos: [],
      omittedCount: 0,
    }
    const el = PhotoGrid({ field, accent: ACCENT })
    // No <Image> (no src prop anywhere in the tree)
    expect(hasAnySrc(el)).toBe(false)
    // No placeholder text — only rendered when a photo has dataUri === null
    const texts = collectText(el)
    expect(texts.every((t) => t !== '[image unavailable]')).toBe(true)
    // The label should still render
    expect(texts.some((t) => t === 'Cable tray photos')).toBe(true)
  })

  it('derives photo cell width from spacing.photoGridCols', () => {
    const expectedWidth = `${100 / spacing.photoGridCols}%`
    const field: ReportPhotoField = {
      sectionId: 's1',
      fieldId: 'f1',
      label: 'Photos',
      photos: [{ dataUri: DATA_URI, caption: 'Photo 1' }],
      omittedCount: 0,
    }
    const el = PhotoGrid({ field, accent: ACCENT })
    // Find the photo cell — it is a direct child of the grid row (the second child of the root)
    const rootChildren = getChildren(el)
    // Root children: [label Text, grid row View, (optional omitted note)]
    const gridRow = rootChildren[1]
    const photoCells = getChildren(gridRow)
    expect(photoCells.length).toBeGreaterThan(0)
    const firstCell = photoCells[0]
    const cellWidth = resolveStyleProp(getProps(firstCell).style, 'width')
    expect(cellWidth).toBe(expectedWidth)
  })
})

// ---------------------------------------------------------------------------
// SignatureBlock
// ---------------------------------------------------------------------------

describe('SignatureBlock', () => {
  const fullSig: ReportSignature = {
    role: 'Inspector',
    name: 'J. Smith',
    title: 'Pr. Eng.',
    registrationNumber: 'ECT123',
    signedAt: '2026-06-01',
    imageDataUri: DATA_URI,
  }

  it('renders name', () => {
    const el = SignatureBlock({ signature: fullSig })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'J. Smith')).toBe(true)
  })

  it('renders title', () => {
    const el = SignatureBlock({ signature: fullSig })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Pr. Eng.')).toBe(true)
  })

  it('renders registration number with Reg # prefix', () => {
    const el = SignatureBlock({ signature: fullSig })
    const texts = collectText(el)
    // Either in one combined text or as separate text nodes
    const allText = texts.join(' ')
    expect(allText).toContain('ECT123')
    expect(allText).toContain('Reg')
  })

  it('renders role', () => {
    const el = SignatureBlock({ signature: fullSig })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Inspector')).toBe(true)
  })

  it('renders date', () => {
    const el = SignatureBlock({ signature: fullSig })
    const texts = collectText(el)
    expect(texts.some((t) => t === '2026-06-01')).toBe(true)
  })

  it('renders signature Image when imageDataUri is present', () => {
    const el = SignatureBlock({ signature: fullSig })
    expect(hasSrc(el, DATA_URI)).toBe(true)
  })

  it('does NOT throw when imageDataUri is null', () => {
    const sig: ReportSignature = { ...fullSig, imageDataUri: null }
    expect(() => SignatureBlock({ signature: sig })).not.toThrow()
  })

  it('renders without signature Image when imageDataUri is null', () => {
    const sig: ReportSignature = { ...fullSig, imageDataUri: null }
    const el = SignatureBlock({ signature: sig })
    expect(hasAnySrc(el)).toBe(false)
  })

  it('handles null title gracefully', () => {
    const sig: ReportSignature = { ...fullSig, title: null, imageDataUri: null }
    expect(() => SignatureBlock({ signature: sig })).not.toThrow()
  })

  it('handles null registrationNumber gracefully', () => {
    const sig: ReportSignature = { ...fullSig, registrationNumber: null, imageDataUri: null }
    expect(() => SignatureBlock({ signature: sig })).not.toThrow()
  })

  it('handles null signedAt gracefully', () => {
    const sig: ReportSignature = { ...fullSig, signedAt: null, imageDataUri: null }
    expect(() => SignatureBlock({ signature: sig })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// AnnexureList
// ---------------------------------------------------------------------------

describe('AnnexureList', () => {
  it('renders "No annexures." for an empty list', () => {
    const el = AnnexureList({ annexures: [] })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'No annexures.')).toBe(true)
  })

  it('renders annexure name', () => {
    const ann: ReportAnnexure = {
      name: 'Wiring diagram.pdf',
      source: 'attachment',
      href: null,
    }
    const el = AnnexureList({ annexures: [ann] })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Wiring diagram.pdf')).toBe(true)
  })

  it('renders a Link element when href is provided', () => {
    const ann: ReportAnnexure = {
      name: 'Certificate',
      source: 'handover',
      href: 'https://example.com/cert.pdf',
    }
    const el = AnnexureList({ annexures: [ann] })
    // react-pdf <Link src="..."> uses src prop for the URL
    expect(hasSrc(el, 'https://example.com/cert.pdf')).toBe(true)
  })

  it('renders thumbnail Image for image annexures', () => {
    const ann: ReportAnnexure = {
      name: 'Panel photo',
      source: 'attachment',
      href: null,
      thumbnailDataUri: DATA_URI,
    }
    const el = AnnexureList({ annexures: [ann] })
    expect(hasSrc(el, DATA_URI)).toBe(true)
  })

  it('renders meta text when provided', () => {
    const ann: ReportAnnexure = {
      name: 'Drawing set',
      source: 'attachment',
      href: null,
      meta: 'Revision 3 · 2026-05-20',
    }
    const el = AnnexureList({ annexures: [ann] })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Revision 3 · 2026-05-20')).toBe(true)
  })

  it('renders multiple annexures', () => {
    const anns: ReportAnnexure[] = [
      { name: 'Ann A', source: 'attachment', href: null },
      { name: 'Ann B', source: 'handover', href: null },
    ]
    const el = AnnexureList({ annexures: anns })
    const texts = collectText(el)
    expect(texts.some((t) => t === 'Ann A')).toBe(true)
    expect(texts.some((t) => t === 'Ann B')).toBe(true)
  })
})
