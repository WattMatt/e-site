/**
 * The engine-free part of @esite/shared/solar-operations, for 'use client' files: labels, schemas
 * and calendar helpers only. The full subpath re-exports downtime-detect, which imports the SPA —
 * the browser must never run the engine (no-browser-engine.contract.test.ts).
 */
export * from './time'
export * from './as-built'
export { GUARANTEE_BASES, GUARANTEE_BASIS_LABELS, type Guarantee, type GuaranteeBasis } from './guarantee'
export { DEFAULT_HANDOVER_TEMPLATE, templateFromRow, type HandoverTemplate } from './handover'
export { CAUSE_LABELS, NOTE_SECTIONS, NOTE_SECTION_LABELS, type NoteSection } from './report'
