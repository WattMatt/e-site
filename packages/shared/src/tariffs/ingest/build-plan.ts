import { effectiveDates } from '../financial-year'
import { netBillingRule } from '../net-billing-rules'
import { parseEskomWorkbook } from '../parsers/eskom-xlsm'
import { parseProvinceWorkbook } from '../parsers/province-xlsx'
import { parseRfdText } from '../parsers/rfd-text'
import { loadWorkbookGrids } from '../parsers/xlsx-load'
import type { IngestPlan, ParserName } from './ingest-core'
import { ESKOM_APPROVED_INCREASE_PCT } from './reference-documents'

export interface BuildPlanInput {
  parser: ParserName
  fileName: string
  bytes: Uint8Array
  sha256: string
  financialYear: string
  /** pdftotext -layout output; required for rfd_pdf. */
  pdfText?: string
  /** Required for rfd_pdf: one RfD is one licensee (from manifest.csv). */
  licenseeName?: string
  url?: string | null
  retrievedAt?: string | null
  /** sha256 of the stored Net-Billing Rules PDF the Eskom SSEG rule cites (owner default 9). */
  netBillingRulesSha256?: string | null
}

const CONTENT_TYPES: Record<ParserName, string> = {
  province_xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  eskom_xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  rfd_pdf: 'application/pdf',
}

export async function buildIngestPlan(input: BuildPlanInput): Promise<IngestPlan> {
  const common = {
    fileName: input.fileName, bytes: input.bytes, sha256: input.sha256, contentType: CONTENT_TYPES[input.parser],
    financialYear: input.financialYear, status: 'nersa_approved' as const,
    url: input.url ?? null, retrievedAt: input.retrievedAt ?? null,
  }

  if (input.parser === 'province_xlsx') {
    const sheets = parseProvinceWorkbook(await loadWorkbookGrids(input.bytes), { fileSha256: input.sha256 })
    const dates = effectiveDates('municipal', input.financialYear)
    return {
      parser: input.parser,
      source: { ...common, kind: 'tariff_book', title: `NERSA municipal tariff compendium: ${input.fileName}`, pageCount: null },
      years: sheets.map((s) => ({
        licenseeName: s.titleName, aliases: [s.sheet, s.titleName], kind: 'municipal',
        effectiveFrom: dates.from, effectiveTo: dates.to, approvedIncreasePct: s.increasePct,
        tariffs: s.tariffs, lossFactors: [], ssegRule: null, issues: s.issues, unresolved: s.unresolved,
      })),
    }
  }

  if (input.parser === 'eskom_xlsm') {
    const parsed = parseEskomWorkbook(await loadWorkbookGrids(input.bytes), { fileSha256: input.sha256 })
    const dates = effectiveDates('eskom', input.financialYear)
    return {
      parser: input.parser,
      source: { ...common, kind: 'eskom_schedule', title: `Eskom tariffs ${input.financialYear}: ${input.fileName}`, pageCount: null },
      years: [{
        licenseeName: 'Eskom', aliases: ['ESKOM', 'ESKOM HOLDINGS SOC LTD'], kind: 'eskom',
        // Owner default 8: the direct (non-local-authority) figure; unknown years stay null.
        effectiveFrom: dates.from, effectiveTo: dates.to, approvedIncreasePct: ESKOM_APPROVED_INCREASE_PCT[input.financialYear]?.direct ?? null,
        tariffs: parsed.tariffs, lossFactors: parsed.lossFactors,
        ssegRule: netBillingRule('eskom', { rulesSha256: input.netBillingRulesSha256 ?? null }),
        issues: [
          ...parsed.issues,
          ...parsed.skippedSheets.map((s) => ({ code: 'sheet_skipped' as const, severity: 'warn' as const, message: `sheet "${s.sheet}" not parsed: ${s.reason}` })),
        ],
        unresolved: [],
      }],
    }
  }

  if (!input.pdfText) throw new Error('rfd_pdf needs pdfText (run pdftotext -layout)')
  if (!input.licenseeName) throw new Error('rfd_pdf needs --licensee: one RfD is one licensee (see manifest.csv)')
  const parsed = parseRfdText(input.pdfText, { fileSha256: input.sha256 })
  const dates = effectiveDates('municipal', input.financialYear)
  return {
    parser: input.parser,
    source: {
      ...common, kind: 'nersa_decision', title: `NERSA RfD ${input.financialYear}: ${input.licenseeName}`,
      pageCount: (input.pdfText.match(/\f/g) ?? []).length + 1,
    },
    years: [{
      licenseeName: input.licenseeName, aliases: [input.licenseeName], kind: 'municipal',
      effectiveFrom: dates.from, effectiveTo: dates.to, approvedIncreasePct: parsed.increasePct,
      tariffs: parsed.tariffs, lossFactors: [], ssegRule: null, issues: parsed.issues, unresolved: parsed.unresolved,
    }],
  }
}
