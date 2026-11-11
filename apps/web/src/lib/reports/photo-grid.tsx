/**
 * photo-grid.tsx — the one photo grid every photo-bearing PDF report uses.
 *
 * Rules (docs/reports/pdf-layout-rules.md; pinned by pdf-layout-rules.contract.test.ts):
 *
 *  1. No `flexWrap` in anything that paginates. react-pdf lays a wrapped flex
 *     line out once and does not move it at a page break, so a row of photos
 *     that straddles the page bottom is drawn past it — under the footer and
 *     off the paper. (QC Report 1, Steyns house, 2026-11-05: three of the five
 *     "Underfloor Heating" photos were in the file and invisible on paper.)
 *     Photos are chunked into explicit rows here instead.
 *  2. Each ROW is unbreakable (wrap={false}) and short (one frame + caption), so
 *     it either fits where it is or moves whole to the next page. Never make a
 *     whole card or grid unbreakable: anything taller than a page is clipped.
 *     Never wrap the rows in a BREAKABLE parent either: the grid returns a
 *     fragment and callers place it directly in the page flow (no card <View>
 *     around it), because react-pdf squeezes the children of a split parent.
 *  3. A `lead` (entry heading, field label) is rendered INSIDE the first row's
 *     unbreakable block, so a heading never ends a page with its photos
 *     overleaf. The caller keeps the lead short (see MAX_LEAD_CHARS).
 *  4. Photos are shown WHOLE: a fixed frame with objectFit 'contain'. 'cover' in
 *     a 2:1 box kept ~35 % of a 3:4 phone photo (the DB legend, the top row of
 *     breakers, the socket — gone).
 *  5. Every photo is downscaled before it is embedded (toReportJpeg); the grid
 *     never sees raw camera bytes.
 */

import React from 'react'
import { View, Text, Image, StyleSheet } from '@react-pdf/renderer'

export interface GridPhoto {
  key: string
  /** data: URI of a downscaled JPEG, or null for an "image unavailable" slot. */
  dataUri: string | null
  /** Bold tag under the frame, e.g. "Photo 3". */
  tag?: string | null
  /** Free text under the tag. */
  caption?: string | null
}

export interface PhotoGridLayout {
  cols: 2 | 3
  /** Frame height in pt. Every frame in a grid is the same size. */
  frameHeight: number
}

/** 2-up for evidence photos that must be legible on paper (QC, snag). */
export const PHOTO_GRID_2UP: PhotoGridLayout = { cols: 2, frameHeight: 180 }
/** 3-up for dense records (site forms). */
export const PHOTO_GRID_3UP: PhotoGridLayout = { cols: 3, frameHeight: 160 }

/**
 * A lead longer than this is not put inside the first unbreakable row: an
 * unbreakable block taller than the space left on a page is clipped, and a long
 * description can be. Callers render a long lead as normal breakable text.
 */
export const MAX_LEAD_CHARS = 600

const GUTTER = 6

const s = StyleSheet.create({
  // flexShrink 0 throughout: react-pdf otherwise SHRINKS a unit that does not
  // fit the space left on a page instead of moving it (a 180 pt frame came out
  // 16 pt tall at a page foot).
  block: { flexShrink: 0 },
  row: { flexDirection: 'row', marginBottom: GUTTER, flexShrink: 0 },
  // Explicit percentage widths (border-box, so the gutter padding sits inside them).
  // flexGrow/flexBasis:0 cells are NOT used: under react-pdf's page splitting they
  // produced rows placed millions of points down the page (QC Report 1 re-render,
  // 2026-11-11) — the layout must be fully determined before pagination.
  frame: {
    flexShrink: 0,
    backgroundColor: '#F4F4F5',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', objectFit: 'contain', flexShrink: 0 },
  unavailable: { fontSize: 6.5, color: '#9CA3AF', fontFamily: 'Helvetica' },
  tag: {
    fontSize: 6.5,
    fontFamily: 'Helvetica-Bold',
    color: '#888888',
    marginTop: 2,
    textAlign: 'center',
  },
  caption: { fontSize: 6.5, color: '#777777', marginTop: 1, textAlign: 'center', lineHeight: 1.25 },
})

/** Split items into rows of `cols`. Exported for the tests. */
export function chunkRows<T>(items: readonly T[], cols: number): T[][] {
  if (cols < 1) throw new Error('cols must be >= 1')
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols))
  return rows
}

function Cell({ photo, layout, col }: { photo: GridPhoto | null; layout: PhotoGridLayout; col: number }) {
  const half = GUTTER / 2
  const style = {
    width: `${100 / layout.cols}%`,
    paddingLeft: col === 0 ? 0 : half,
    paddingRight: col === layout.cols - 1 ? 0 : half,
  }
  // An empty spacer keeps a short last row's cells the same width as the rest.
  if (!photo) return <View style={style} />
  return (
    <View style={style}>
      <View style={[s.frame, { height: layout.frameHeight }]}>
        {photo.dataUri ? (
          <Image src={photo.dataUri} style={[s.image, { height: layout.frameHeight }]} />
        ) : (
          <Text style={s.unavailable}>Image unavailable</Text>
        )}
      </View>
      {photo.tag ? <Text style={s.tag}>{photo.tag}</Text> : null}
      {photo.caption ? <Text style={s.caption}>{photo.caption}</Text> : null}
    </View>
  )
}

export function ReportPhotoGrid({
  photos,
  layout,
  lead,
}: {
  photos: readonly GridPhoto[]
  layout: PhotoGridLayout
  /** Short heading kept on the same page as the first row of photos. */
  lead?: React.ReactNode
}) {
  const rows = chunkRows(photos, layout.cols)
  if (rows.length === 0) return lead ? <View wrap={false} style={s.block}>{lead}</View> : null
  // A FRAGMENT of row blocks, not a wrapping <View>: each row must be a direct
  // sibling in the page flow. When react-pdf splits a breakable parent across a
  // page it fixes the parent's height and re-lays it out, which squeezed the rows
  // inside it (180 pt frames drawn 16 pt tall) and threw others millions of
  // points down the page.
  return (
    <>
      {rows.map((row, r) => {
        const cells: (GridPhoto | null)[] = [...row]
        while (cells.length < layout.cols) cells.push(null)
        return (
          <View key={r} wrap={false} style={s.block}>
            {r === 0 ? lead : null}
            <View style={s.row}>
              {cells.map((p, i) => (
                <Cell key={p?.key ?? `spacer-${i}`} photo={p} layout={layout} col={i} />
              ))}
            </View>
          </View>
        )
      })}
    </>
  )
}
