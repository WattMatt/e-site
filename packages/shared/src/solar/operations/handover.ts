/**
 * Handover checklist (spec §10; carried from WM's Documents tab checklist). Each item links ONE file
 * in E-Site Documents (tenants.documents) — there is no separate document store and no dependence on
 * folder names. The org edits the template in /settings/solar; without one, this default applies.
 */
import { z } from 'zod'

export const HandoverTemplateItemSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,60}$/, 'Use lower-case letters, digits and underscores.'),
  label: z.string().trim().min(1).max(200),
  required: z.boolean(),
}).strict()

export const HandoverTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(HandoverTemplateItemSchema).min(1).max(60),
}).strict().superRefine((t, ctx) => {
  const seen = new Set<string>()
  t.items.forEach((i, k) => {
    if (seen.has(i.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', k, 'key'], message: `"${i.key}" is used twice.` })
    seen.add(i.key)
  })
})
export type HandoverTemplate = z.infer<typeof HandoverTemplateSchema>

export const DEFAULT_HANDOVER_TEMPLATE: HandoverTemplate = {
  name: 'Solar PV Handover',
  items: [
    { key: 'coc', label: 'Certificate of Compliance (CoC)', required: true },
    { key: 'sld_as_built', label: 'Single-line diagram (as-built)', required: true },
    { key: 'commissioning_tests', label: 'Commissioning test sheets', required: true },
    { key: 'om_manual', label: 'Operation and maintenance manual', required: true },
    { key: 'warranties', label: 'Warranties (modules, inverters, batteries)', required: true },
    { key: 'sseg_registration', label: 'SSEG registration / approval letter', required: true },
    { key: 'monitoring_handover', label: 'Monitoring portal login handed over', required: true },
    { key: 'as_built_layout', label: 'As-built array layout', required: false },
    { key: 'training_record', label: 'Client training record', required: false },
  ],
}

export function parseHandoverTemplate(raw: unknown): { ok: true; value: HandoverTemplate } | { ok: false; errors: string[] } {
  const r = HandoverTemplateSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'template'}: ${i.message}`) }
}

export function templateFromRow(row: { name: unknown; items: unknown } | null): HandoverTemplate {
  if (!row) return DEFAULT_HANDOVER_TEMPLATE
  const r = parseHandoverTemplate({ name: row.name, items: row.items })
  return r.ok ? r.value : DEFAULT_HANDOVER_TEMPLATE
}

export interface HandoverCompletion { done: number; total: number; pct: number; requiredDone: number; requiredTotal: number }

export function handoverCompletion(items: ReadonlyArray<{ required: boolean; documentId: string | null; notApplicable: boolean }>): HandoverCompletion {
  const complete = (i: { documentId: string | null; notApplicable: boolean }) => i.documentId !== null || i.notApplicable
  const done = items.filter(complete).length
  const required = items.filter((i) => i.required)
  return {
    done, total: items.length,
    pct: items.length === 0 ? 0 : Math.round((done / items.length) * 100),
    requiredDone: required.filter(complete).length, requiredTotal: required.length,
  }
}
