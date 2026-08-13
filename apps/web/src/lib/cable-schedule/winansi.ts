/**
 * Re-export shim — the WinAnsi sanitiser moved to `@/lib/pdf/winansi` when the
 * react-pdf report renderers turned out to need it too (it is not a
 * cable-schedule concern). Kept so the three export renderers here keep their
 * short relative import.
 */
export { winAnsiSafe, isWinAnsi, isWinAnsiSafe } from '@/lib/pdf/winansi'
