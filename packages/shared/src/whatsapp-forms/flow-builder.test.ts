import { describe, expect, it } from 'vitest'
import type { Template } from '../inspections/types'
import { buildInspectionFlow, flowCapability, flowFieldKeys, FLOW_LIMITS } from './flow-builder'
import miniSub from './__fixtures__/mini-sub-inspection-report.json'
import preFat from './__fixtures__/mini-sub-pre-post-fat.json'

const MINI = miniSub as unknown as Template
const PREFAT = preFat as unknown as Template

type Comp = Record<string, unknown> & { type: string }
const children = (s: { layout: { children: Comp[] } }) => s.layout.children

function walkStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => walkStrings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => walkStrings(x, out))
  return out
}

describe('flowCapability', () => {
  it('accepts both production templates that tie for most-used', () => {
    expect(flowCapability(MINI)).toMatchObject({ ok: true })
    expect(flowCapability(PREFAT)).toMatchObject({ ok: true })
  })

  it('reports what the Flow leaves to chat or the web for the D2 template', () => {
    const cap = flowCapability(MINI)
    expect(cap.photoFields.map((f) => f.fieldId)).toEqual(['thermographic_survey'])
    expect(cap.signatureFields.map((f) => f.fieldId)).toEqual(['inspector_signature'])
    expect(cap.skippedFields.map((f) => f.fieldId)).toEqual(['service_report'])
  })

  it('refuses repeating groups, conditions and required files, naming each', () => {
    const t: Template = {
      ...MINI,
      sections: [
        { section_id: 'a', title: 'A', fields: [{ field_id: 'g', label: 'G', type: 'repeating_group', fields: [] }] },
        { section_id: 'b', title: 'B', conditional_on: { field_id: 'x', equals: true }, fields: [] },
        { section_id: 'c', title: 'C', fields: [{ field_id: 'f', label: 'F', type: 'file', required: true }] },
        { section_id: 'd', title: 'D', fields: [{ field_id: 'y', label: 'Y', type: 'text', conditional_on: { field_id: 'x', equals: 1 } }] },
        { section_id: 'e', title: 'E', fields: [], subsections: [{ subsection_id: 's', title: 'S', fields: [] }] },
      ],
    }
    const cap = flowCapability(t)
    expect(cap.ok).toBe(false)
    expect(cap.reasons.join('\n')).toMatch(/repeating group "g"/)
    expect(cap.reasons.join('\n')).toMatch(/section "b" is conditional/)
    expect(cap.reasons.join('\n')).toMatch(/required file "f"/)
    expect(cap.reasons.join('\n')).toMatch(/field "y" is conditional/)
    expect(cap.reasons.join('\n')).toMatch(/subsections/)
  })

  it('refuses a template whose screen would exceed the component cap', () => {
    const fields = Array.from({ length: 30 }, (_, i) => ({ field_id: `p${i}`, label: `P${i}`, type: 'pass_fail' as const }))
    const cap = flowCapability({ ...MINI, sections: [{ section_id: 'big', title: 'Big', fields }] })
    expect(cap.ok).toBe(false)
    expect(cap.reasons.join()).toMatch(/50 components/)
  })

  it('refuses what Meta would reject at publish: blank labels, blank or duplicate options, duplicate field ids', () => {
    const one = (f: object) => flowCapability({ ...MINI, sections: [{ section_id: 's', title: 'S', fields: [f as never] }] })
    expect(one({ field_id: 'a', label: '  ', type: 'text' }).reasons.join()).toMatch(/blank label/)
    expect(one({ field_id: 'd', label: 'D', type: 'dropdown', options: ['x', ''] }).reasons.join()).toMatch(/blank option/)
    expect(one({ field_id: 'd', label: 'D', type: 'dropdown', options: ['x', 'x'] }).reasons.join()).toMatch(/duplicate option/)
    const dup = flowCapability({ ...MINI, sections: [{ section_id: 's', title: 'S', fields: [
      { field_id: 'a', label: 'A', type: 'text' }, { field_id: 'a', label: 'A2', type: 'text' }] }] })
    expect(dup.reasons.join()).toMatch(/duplicate field "a"/)
    expect(flowCapability({ ...MINI, sections: [{ section_id: 's', title: ' ', fields: [{ field_id: 'a', label: 'A', type: 'text' }] }] })
      .reasons.join()).toMatch(/blank title/)
  })

  it('refuses dropdown options beyond the radio/dropdown limits', () => {
    const options = Array.from({ length: 201 }, (_, i) => `o${i}`)
    const cap = flowCapability({ ...MINI, sections: [{ section_id: 's', title: 'S', fields: [{ field_id: 'd', label: 'D', type: 'dropdown', options }] }] })
    expect(cap.ok).toBe(false)
  })
})

describe('buildInspectionFlow (D2 template)', () => {
  const flow = buildInspectionFlow(MINI)

  it('uses the recommended Flow JSON version and one screen per section', () => {
    expect(flow.version).toBe('7.3')
    expect(flow.screens.map((s) => s.id)).toEqual(['SECTION_A', 'SECTION_B', 'SECTION_C', 'SECTION_D', 'SECTION_E'])
    expect(flow.screens.at(-1)).toMatchObject({ terminal: true, success: true })
    expect(flow.screens.slice(0, -1).every((s) => !s.terminal)).toBe(true)
  })

  it('chains screens forward and completes with every input from every screen', () => {
    const footers = flow.screens.map((s) => children(s).find((c) => c.type === 'Footer')!)
    footers.slice(0, -1).forEach((f, i) => {
      expect(f['on-click-action']).toMatchObject({ name: 'navigate', next: { type: 'screen', name: flow.screens[i + 1].id } })
    })
    const done = footers.at(-1)!['on-click-action'] as { name: string; payload: Record<string, string> }
    expect(done.name).toBe('complete')
    const keys = flowFieldKeys(MINI)
    expect(Object.keys(done.payload).sort()).toEqual(keys.map((k) => k.key).sort())
    for (const k of keys) expect(done.payload[k.key]).toBe(`\${screen.${k.screenId}.form.${k.key}}`)
  })

  it('every component respects Meta limits: labels, 50 per screen, no empty strings', () => {
    for (const s of flow.screens) {
      const cs = children(s)
      expect(cs.length).toBeLessThanOrEqual(FLOW_LIMITS.componentsPerScreen)
      expect(cs.filter((c) => c.type === 'Footer')).toHaveLength(1)
      for (const c of cs) {
        const lim = FLOW_LIMITS.label[c.type as keyof typeof FLOW_LIMITS.label]
        if (lim && typeof c.label === 'string') expect(c.label.length, `${c.type} ${c.label}`).toBeLessThanOrEqual(lim)
        if (c.type === 'TextBody') expect((c.text as string).length).toBeLessThanOrEqual(4096)
      }
      if (s.title) expect(s.title.length).toBeLessThanOrEqual(FLOW_LIMITS.screenTitle)
    }
    for (const str of walkStrings(flow)) expect(str.trim().length, 'empty string in Flow JSON').toBeGreaterThan(0)
  })

  it('maps field types to components and never pre-selects an answer', () => {
    const all = flow.screens.flatMap(children)
    const byName = new Map(all.filter((c) => typeof c.name === 'string').map((c) => [c.name as string, c]))
    const key = (fid: string) => flowFieldKeys(MINI).find((k) => k.fieldId === fid)!.key
    expect(byName.get(key('enclosure_integrity'))).toMatchObject({ type: 'RadioButtonsGroup', required: true,
      'data-source': [{ id: 'pass', title: 'Pass' }, { id: 'fail', title: 'Fail' }, { id: 'na', title: 'N/A' }] })
    expect(byName.get(key('corrosion_level'))).toMatchObject({ type: 'Dropdown', required: true })
    expect(byName.get(key('max_winding_temp'))).toMatchObject({ type: 'TextInput', 'input-type': 'number', required: true })
    expect(byName.get(key('last_service_date'))).toMatchObject({ type: 'DatePicker', required: true })
    expect(byName.get(key('sld_availability_notes'))).toMatchObject({ type: 'TextArea', required: false })
    for (const c of all) expect(c).not.toHaveProperty('init-value')
    // photo, signature and file fields are not Flow inputs
    for (const fid of ['thermographic_survey', 'inspector_signature', 'service_report']) {
      expect(flowFieldKeys(MINI).some((k) => k.fieldId === fid)).toBe(false)
    }
  })

  it('keeps the full question text when a label had to be shortened', () => {
    const all = flow.screens.flatMap(children)
    const body = all.filter((c) => c.type === 'TextBody').map((c) => c.text as string)
    // "Thermographic survey…" is a photo; use a long pass_fail label instead
    expect(body.some((t) => t.includes('Fire extinguisher in date'))).toBe(false) // fits in 30 → no TextBody
    expect(body.some((t) => t.includes('Maximum winding temperature'))).toBe(true) // 27 > 20 for TextInput
  })

  it('offers a fail reason only alongside pass/fail questions', () => {
    const keys = flowFieldKeys(MINI)
    const reasons = keys.filter((k) => k.role === 'fail_reason')
    expect(reasons).toHaveLength(16)
    expect(reasons.every((r) => keys.some((k) => k.role === 'value' && k.fieldId === r.fieldId))).toBe(true)
  })

  it('is deterministic, so a published Flow and its mapper never drift', () => {
    expect(JSON.stringify(buildInspectionFlow(MINI))).toBe(JSON.stringify(flow))
  })

  it('throws rather than build a Flow for a template that cannot be one', () => {
    expect(() => buildInspectionFlow({ ...MINI, sections: [{ section_id: 'a', title: 'A', fields: [{ field_id: 'g', label: 'G', type: 'repeating_group', fields: [] }] }] }))
      .toThrow(/cannot be a Flow/)
  })
})
