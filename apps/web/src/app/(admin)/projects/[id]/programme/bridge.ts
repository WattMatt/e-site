/**
 * What the grid and the timeline hand the toolbar. The panes own the DOM they act on (the
 * scroll viewport, the selection, the inline editor), so the toolbar's buttons call commands
 * the panes register in a ref, and read the little state a button needs (`GridUi`) from a
 * callback. Nothing here is a React component.
 */
import type { MutableRefObject } from 'react'
import type { Zoom } from '@esite/shared/programme'
import type { NewRowKind } from './grid-ops'

/** Why indent, outdent, move and add are off while the rows shown are not the whole outline. */
export const STRUCTURE_LOCKED = 'Clear filters and grouping to restructure the programme.'

export interface GridCommands {
  add(kind: NewRowKind): void
  structure(direction: 'indent' | 'outdent'): void
  /** Asks to delete the selection; the toolbar then shows the inline confirm. */
  arm(): void
  confirmDelete(): void
  cancelDelete(): void
}

export interface GridUi {
  /** Rows selected and shown. */
  selectedCount: number
  /** Rows a confirmed delete would remove (the selection and its sub-activities), or null when not armed. */
  armedCount: number | null
  notice: string | null
}
export const NO_GRID_UI: GridUi = { selectedCount: 0, armedCount: null, notice: null }

export interface TimelineCommands {
  setZoom(zoom: Zoom): void
  scrollToToday(): void
  fit(): void
}

export type CommandsRef<T> = MutableRefObject<T | null>
