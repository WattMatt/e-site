// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildInspectionFlow } from '@esite/shared/whatsapp-forms'
import type { Template } from '@esite/shared'
import { createHash } from 'node:crypto'
import miniSub from '../../../../../packages/shared/src/whatsapp-forms/__fixtures__/mini-sub-inspection-report.json'
import { handleFormsOp, REPLY, type FormsDeps, type FormsStore, type Session } from './service'

const T = miniSub as unknown as Template
const SHA = createHash('sha256').update(JSON.stringify(buildInspectionFlow(T))).digest('hex')
const USER = 'u-1'
const OTHER = 'u-2'
const INSP = 'i-1'
const PROJ = 'p-1'
const TROW = 't-1'
const NOW = new Date('2026-10-05T10:00:00Z')
const HOUR = 3600_000
const hash = (s: string) => `h(${s})`

// A JPEG header big enough for imageInfo(): SOI, APP0, SOF0 1600x1200.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 0x11, 8, 0x04, 0xb0, 0x06, 0x40, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])

let sessions: Session[]
let links: Array<Record<string, unknown>>
let saved: Array<{ user: string; rows: unknown[] }>
let photos: Array<{ section_id: string; field_id: string; path: string; user: string }>
let uploads: Array<{ bucket: string; path: string }>
let answers: Array<Record<string, unknown>>
let signatures: Array<{ section_id: string; field_id: string }>
let gateCode: string
let flowRow: { meta_flow_id: string; status: 'draft' | 'published'; flow_json_sha256: string } | null
let staged: Record<string, Uint8Array>
let submitted: string[]
let submitSessions: Array<string | undefined>
let afterSubmit: ReturnType<typeof vi.fn>
let tokens: number

function session(over: Partial<Session> = {}): Session {
  return { id: 's-1', user_id: USER, inspection_id: INSP, template_row_id: TROW, status: 'answered',
    expires_at: new Date(NOW.getTime() + HOUR).toISOString(), answered_inbound_id: null, pending_photo_inbound_ids: [], last_photo_item: null, last_photo_at: null, ...over }
}

beforeEach(() => {
  sessions = []; links = []; saved = []; photos = []; uploads = []; answers = []; signatures = []; submitted = []; submitSessions = []
  gateCode = 'ok'
  flowRow = { meta_flow_id: 'F9', status: 'draft', flow_json_sha256: SHA }
  staged = { 'inbound/in-7': JPEG }
  tokens = 0
  afterSubmit = vi.fn(async () => {})
})

function deps(): FormsDeps {
  const store: FormsStore = {
    gate: async () => gateCode === 'ok'
      ? { code: 'ok', inspection_id: INSP, project_id: PROJ, organisation_id: 'o', template_row_id: TROW, status: 'in_progress', label: 'MINI SUB 1' }
      : { code: gateCode },
    template: async () => ({ name: 'Miniature Substation Inspection Report', schema: T }),
    flow: async () => flowRow,
    closeLiveSessions: async (u, i) => { sessions.filter((s) => s.user_id === u && s.inspection_id === i && ['open', 'answered'].includes(s.status)).forEach((s) => { s.status = 'closed' }) },
    createSession: async (row) => { const s = { ...session({ status: 'open' }), ...row, id: `s-${sessions.length + 1}` } as Session; sessions.push(s); return { id: s.id } },
    sessionByTokenHash: async (h) => sessions.find((s) => s.token_hash === h) ?? null,
    sessionById: async (id) => sessions.find((s) => s.id === id) ?? null,
    updateSession: async (id, p) => { Object.assign(sessions.find((s) => s.id === id)!, p) },
    createLink: async (row) => { links.push(row) },
    saveResponses: async (u, _i, rows) => { saved.push({ user: u, rows }); for (const r of rows) answers.push(r as never); return { code: 'ok', saved: rows.length } },
    answers: async () => answers as never,
    attachments: async () => ({ photos: photos.map((p) => ({ section_id: p.section_id, field_id: p.field_id })), signatures }),
    photoExists: async (_i, path) => photos.some((p) => p.path === path),
    download: async (_b, path) => staged[path] ?? null,
    upload: async (bucket, path) => { uploads.push({ bucket, path }) },
    addPhoto: async (u, _i, section_id, field_id, path) => { photos.push({ section_id, field_id, path, user: u }); return { code: 'ok' } },
    submit: async (_u, i, sid) => { submitted.push(i); submitSessions.push(sid); return { code: 'ok', verifier_id: 'v-1' } },
    inspectionState: async () => ({ status: 'in_progress', submitted_via: null, submitted_session_id: null }),
    holdPhoto: async (sid, inbound) => { const s = sessions.find((x) => x.id === sid)!; if (!s.pending_photo_inbound_ids.includes(inbound)) s.pending_photo_inbound_ids = [...s.pending_photo_inbound_ids, inbound]; return s.pending_photo_inbound_ids },
    releasePhotos: async (sid, ids) => { const s = sessions.find((x) => x.id === sid)!; s.pending_photo_inbound_ids = s.pending_photo_inbound_ids.filter((x) => !ids.includes(x)) },
    profileName: async () => 'Johan B',
  }
  return { store, now: () => NOW, appUrl: 'https://www.e-site.live', afterSubmit, newToken: () => `tok${++tokens}`, hash }
}

const texts = (r: { messages: Array<{ type: string; body?: string }> }) => r.messages.map((m) => m.body ?? '').join('\n---\n')

describe('open', () => {
  it('refuses with a plain reason when the database gate says no', async () => {
    for (const [code, re] of [['flag_off', /off for your organisation/], ['no_access', /not available to you/], ['not_found', /not available to you/], ['not_writable', /can't be changed/]] as const) {
      gateCode = code
      const r = await handleFormsOp('open', { user_id: USER, inspection_id: INSP }, deps())
      expect(r.code).toBe(code)
      expect(texts(r)).toMatch(re)
      expect(sessions).toEqual([])
    }
  })
  it('sends the published Flow with a fresh token and points the link at the new session', async () => {
    const r = await handleFormsOp('open', { user_id: USER, inspection_id: INSP }, deps())
    expect(r).toMatchObject({ code: 'ok', session_id: 's-1' })
    expect(r.messages[0]).toMatchObject({ type: 'flow', flowId: 'F9', token: 'tok1', mode: 'draft', firstScreen: 'SECTION_A' })
    expect(sessions[0]).toMatchObject({ token_hash: hash('tok1'), user_id: USER, inspection_id: INSP, template_row_id: TROW,
      expires_at: new Date(NOW.getTime() + 24 * HOUR).toISOString() })
  })
  it('closes the person\'s earlier live session on the same inspection', async () => {
    await handleFormsOp('open', { user_id: USER, inspection_id: INSP }, deps())
    await handleFormsOp('open', { user_id: USER, inspection_id: INSP }, deps())
    expect(sessions.map((s) => s.status)).toEqual(['closed', 'open'])
  })
  it('sends a signed web link instead when no Flow is published for the template', async () => {
    flowRow = null
    const r = await handleFormsOp('open', { user_id: USER, inspection_id: INSP }, deps())
    expect(r.code).toBe('ok')
    expect(texts(r)).toContain('https://www.e-site.live/auth/wa-link/tok2')
    expect(links[0]).toMatchObject({ token_hash: hash('tok2'), user_id: USER, form_session_id: 's-1',
      target_path: `/projects/${PROJ}/inspections/${INSP}`, expires_at: new Date(NOW.getTime() + 15 * 60_000).toISOString() })
  })
  it('never sends a Flow built from a different template than the one it maps', async () => {
    flowRow = { ...flowRow!, flow_json_sha256: '0'.repeat(64) }
    const r = await handleFormsOp('open', { user_id: USER, inspection_id: INSP }, deps())
    expect(r.messages.some((m) => m.type === 'flow')).toBe(false)
    expect(texts(r)).toContain('/auth/wa-link/')
  })
})

describe('flow_reply', () => {
  const key = (sectionIdx: number, fieldIdx: number) => `s${sectionIdx}_f${fieldIdx}`
  const reply = (token: string, extra: Record<string, unknown>) => JSON.stringify({ flow_token: token, ...extra })

  it('an unknown or expired token is refused, nothing saved', async () => {
    const r = await handleFormsOp('flow_reply', { user_id: USER, inbound_id: 'in-1', response_json: reply('nope', {}) }, deps())
    expect(r.code).toBe('expired')
    expect(saved).toEqual([])
    sessions.push(session({ token_hash: hash('old'), expires_at: new Date(NOW.getTime() - 1).toISOString() }))
    expect((await handleFormsOp('flow_reply', { user_id: USER, inbound_id: 'in-1', response_json: reply('old', {}) }, deps())).code).toBe('expired')
  })
  it('a reply from someone other than the session\'s person is refused', async () => {
    sessions.push(session({ token_hash: hash('t'), status: 'open' }))
    const r = await handleFormsOp('flow_reply', { user_id: OTHER, inbound_id: 'in-1', response_json: reply('t', { [key(0, 0)]: 'pass' }) }, deps())
    expect(r.code).toBe('foreign')
    expect(saved).toEqual([])
  })
  it('saves the mapped answers as the person, then says what is still needed', async () => {
    sessions.push(session({ token_hash: hash('t'), status: 'open' }))
    const r = await handleFormsOp('flow_reply', { user_id: USER, inbound_id: 'in-1',
      response_json: reply('t', { [key(0, 0)]: 'pass', [key(0, 1)]: 'light' }) }, deps())
    expect(r).toMatchObject({ code: 'ok', session_id: 's-1' })
    expect(saved[0].user).toBe(USER)
    expect(saved[0].rows).toEqual([
      expect.objectContaining({ section_id: 'visual_structural_checks', field_id: 'enclosure_integrity', value_bool: true, pass_state: 'pass' }),
      expect.objectContaining({ field_id: 'corrosion_level', value_text: 'light' }),
    ])
    expect(sessions[0]).toMatchObject({ status: 'answered', answered_inbound_id: 'in-1' })
    const all = texts(r)
    expect(all).toMatch(/Saved 2 answers/)
    expect(all).toMatch(/Item 10 .*Thermographic survey/)
    expect(all).toMatch(/Inspector signature/)
  })
  it('reports values it refused instead of silently dropping them', async () => {
    sessions.push(session({ token_hash: hash('t') }))
    const r = await handleFormsOp('flow_reply', { user_id: USER, inbound_id: 'in-1', response_json: reply('t', { [key(0, 1)]: 'rusty' }) }, deps())
    expect(texts(r)).toMatch(/Corrosion level/)
  })
  it('a malformed response_json is refused', async () => {
    const r = await handleFormsOp('flow_reply', { user_id: USER, inbound_id: 'in-1', response_json: '{nope' }, deps())
    expect(r.code).toBe('expired')
  })
})

describe('photos', () => {
  beforeEach(() => { sessions.push(session()) })
  const photo = (caption: string | null) =>
    handleFormsOp('photo', { user_id: USER, session_id: 's-1', inbound_id: 'in-7', staging_path: 'inbound/in-7', caption }, deps())

  it('attaches a numbered photo to that item, under the inspection\'s own path, as the person', async () => {
    const r = await photo('10')
    expect(r.code).toBe('ok')
    const path = `${PROJ}/${INSP}/electrical_functional_thermal_checks/thermographic_survey/wa-in-7.jpg`
    expect(uploads).toEqual([{ bucket: 'inspection-photos', path }])
    expect(photos).toEqual([{ section_id: 'electrical_functional_thermal_checks', field_id: 'thermographic_survey', path, user: USER }])
    expect(texts(r)).toMatch(/item 10/i)
  })
  it('a retried delivery does not add the photo twice', async () => {
    await photo('10'); await photo('10')
    expect(photos).toHaveLength(1)
  })
  it('an unnumbered photo is held and the bot asks which item', async () => {
    const r = await photo(null)
    expect(sessions[0].pending_photo_inbound_ids).toEqual(['in-7'])
    expect(photos).toEqual([])
    expect(texts(r)).toMatch(/Which item/)
  })
  it('a number with no such item is held and the range is given', async () => {
    const r = await photo('99')
    expect(photos).toEqual([])
    expect(sessions[0].pending_photo_inbound_ids).toEqual(['in-7'])
    expect(texts(r)).toMatch(/1 to 25/)
  })
  it('bytes that are not a JPEG or PNG are refused, whatever Meta called them', async () => {
    staged['inbound/in-7'] = new TextEncoder().encode('<html>')
    const r = await photo('10')
    expect(r.code).toBe('not_an_image')
    expect(uploads).toEqual([])
  })
  it('a session that is gone, foreign or finished is "not mine"', async () => {
    sessions[0].status = 'submitted'
    expect((await photo('10')).code).toBe('no_session')
    sessions[0].status = 'answered'; sessions[0].user_id = OTHER
    expect((await photo('10')).code).toBe('no_session')
  })
  it('the item number for a held photo attaches it', async () => {
    await photo(null)
    const r = await handleFormsOp('item_choice', { user_id: USER, session_id: 's-1', inbound_id: 'in-8', text: 'item 10' }, deps())
    expect(r.code).toBe('ok')
    expect(photos[0]).toMatchObject({ field_id: 'thermographic_survey', path: expect.stringContaining('wa-in-7.jpg') })
    expect(sessions[0].pending_photo_inbound_ids).toEqual([])
  })
  it('a number with no photo waiting is "not mine"', async () => {
    const r = await handleFormsOp('item_choice', { user_id: USER, session_id: 's-1', inbound_id: 'in-8', text: '10' }, deps())
    expect(r.code).toBe('not_waiting')
  })
})

describe('submit', () => {
  beforeEach(() => { sessions.push(session()) })
  const everyAnswer = () => {
    for (const s of T.sections) for (const f of s.fields) {
      if (f.type === 'pass_fail') answers.push({ section_id: s.section_id, field_id: f.field_id, value_bool: true, pass_state: 'pass' })
      else if (f.type === 'number') answers.push({ section_id: s.section_id, field_id: f.field_id, value_number: 1 })
      else if (['text', 'textarea', 'dropdown', 'date'].includes(f.type)) answers.push({ section_id: s.section_id, field_id: f.field_id, value_text: f.type === 'dropdown' ? 'none' : '2026-01-01' })
    }
    photos.push({ section_id: 'electrical_functional_thermal_checks', field_id: 'thermographic_survey', path: 'x', user: USER })
  }
  const submit = () => handleFormsOp('submit', { user_id: USER, session_id: 's-1' }, deps())

  it('lists what is missing and does not submit', async () => {
    const r = await submit()
    expect(r.code).toBe('incomplete')
    expect(texts(r)).toMatch(/Enclosure integrity/)
    expect(submitted).toEqual([])
  })
  it('when only the signature is missing, sends a signed web link to sign and submit', async () => {
    everyAnswer()
    const r = await submit()
    expect(r.code).toBe('needs_signature')
    expect(texts(r)).toContain('/auth/wa-link/')
    expect(links[0]).toMatchObject({ form_session_id: 's-1', target_path: `/projects/${PROJ}/inspections/${INSP}` })
    expect(submitted).toEqual([])
  })
  it('complete: submits as the person, runs the after-submit work and forgets the session', async () => {
    everyAnswer()
    signatures.push({ section_id: 'critical_safety_checks', field_id: 'inspector_signature' })
    const r = await submit()
    expect(r).toMatchObject({ code: 'ok', session_id: null })
    expect(submitted).toEqual([INSP])
    expect(submitSessions).toEqual(['s-1'])
    expect(afterSubmit).toHaveBeenCalledWith('s-1', { notifyVerifier: true })
  })
  it('a submit the database refuses is reported, and nothing follows', async () => {
    everyAnswer()
    signatures.push({ section_id: 'critical_safety_checks', field_id: 'inspector_signature' })
    const d = deps()
    d.store.submit = async () => ({ code: 'not_writable' })
    const r = await handleFormsOp('submit', { user_id: USER, session_id: 's-1' }, d)
    expect(r.code).toBe('not_writable')
    expect(afterSubmit).not.toHaveBeenCalled()
  })
  it('a second submit of a submitted session says so', async () => {
    sessions[0].status = 'submitted'
    const r = await submit()
    expect(r.code).toBe('no_session')
  })
})

it('an unknown op is refused', async () => {
  const r = await handleFormsOp('delete_everything' as never, {}, deps())
  expect(r.code).toBe('bad_request')
  expect(REPLY).toBeDefined()
})

describe('review fixes', () => {
  const MIN = 60_000

  it('H1: a missing answer the line-renderer cannot label still blocks submit', async () => {
    // A template with a subsection is not Flow-capable; its required subsection field is missing.
    const withSub = { ...T, sections: [...T.sections, { section_id: 'extra', title: 'Extra', fields: [],
      subsections: [{ subsection_id: 'sub', title: 'Sub', fields: [{ field_id: 'sub_req', label: 'Sub required', type: 'text', required: true }] }] }] } as Template
    sessions.push(session())
    for (const s of T.sections) for (const f of s.fields) {
      if (f.type === 'pass_fail') answers.push({ section_id: s.section_id, field_id: f.field_id, value_bool: true, pass_state: 'pass' })
      else if (f.type === 'number') answers.push({ section_id: s.section_id, field_id: f.field_id, value_number: 1 })
      else if (['text', 'textarea', 'dropdown', 'date'].includes(f.type)) answers.push({ section_id: s.section_id, field_id: f.field_id, value_text: f.type === 'dropdown' ? 'none' : '2026-01-01' })
    }
    photos.push({ section_id: 'electrical_functional_thermal_checks', field_id: 'thermographic_survey', path: 'x', user: USER })
    signatures.push({ section_id: 'critical_safety_checks', field_id: 'inspector_signature' })
    const d = deps()
    d.store.template = async () => ({ name: 'X', schema: withSub })
    const r = await handleFormsOp('submit', { user_id: USER, session_id: 's-1' }, d)
    expect(r.code).not.toBe('ok')
    expect(submitted).toEqual([])
  })

  it('H1: a template that cannot be a Flow is finished on the web, not by SUBMIT in chat', async () => {
    const withGroup = { ...T, sections: [{ section_id: 'g', title: 'G', fields: [{ field_id: 'grp', label: 'Rows', type: 'repeating_group', fields: [] }] }] } as Template
    sessions.push(session())
    const d = deps()
    d.store.template = async () => ({ name: 'X', schema: withGroup })
    const r = await handleFormsOp('submit', { user_id: USER, session_id: 's-1' }, d)
    expect(r.code).toBe('use_web')
    expect(texts(r)).toContain('/auth/wa-link/')
    expect(submitted).toEqual([])
  })

  it('M1: a submit whose follow-up failed is finished by the retry instead of being refused', async () => {
    sessions.push(session())
    const d = deps()
    d.store.inspectionState = async () => ({ status: 'awaiting_verification', submitted_via: 'whatsapp', submitted_session_id: 's-1' })
    gateCode = 'not_writable'
    const r = await handleFormsOp('submit', { user_id: USER, session_id: 's-1' }, d)
    expect(r.code).toBe('ok')
    expect(afterSubmit).toHaveBeenCalledWith('s-1', { notifyVerifier: true })
    expect(submitted).toEqual([])
  })

  it('N1: another person\'s WhatsApp submit is never claimed by this session', async () => {
    sessions.push(session())
    const d = deps()
    d.store.inspectionState = async () => ({ status: 'awaiting_verification', submitted_via: 'whatsapp', submitted_session_id: 's-OTHER' })
    gateCode = 'not_writable'
    const r = await handleFormsOp('submit', { user_id: USER, session_id: 's-1' }, d)
    expect(r.code).toBe('not_writable')
    expect(afterSubmit).not.toHaveBeenCalled()
  })

  it('N1: a member removed since cannot finish even their own earlier submit', async () => {
    sessions.push(session())
    const d = deps()
    d.store.inspectionState = async () => ({ status: 'awaiting_verification', submitted_via: 'whatsapp', submitted_session_id: 's-1' })
    gateCode = 'no_access'
    const r = await handleFormsOp('submit', { user_id: USER, session_id: 's-1' }, d)
    expect(r.code).toBe('no_access')
    expect(afterSubmit).not.toHaveBeenCalled()
  })

  it('M1: but a submit someone else made on the web is not claimed', async () => {
    sessions.push(session())
    const d = deps()
    d.store.inspectionState = async () => ({ status: 'awaiting_verification', submitted_via: 'web', submitted_session_id: null })
    gateCode = 'not_writable'
    const r = await handleFormsOp('submit', { user_id: USER, session_id: 's-1' }, d)
    expect(r.code).toBe('not_writable')
    expect(afterSubmit).not.toHaveBeenCalled()
  })

  describe('M3: albums (WhatsApp captions only the first photo)', () => {
    beforeEach(() => { staged['inbound/in-8'] = JPEG; staged['inbound/in-9'] = JPEG })
    const photo = (inbound: string, caption: string | null) =>
      handleFormsOp('photo', { user_id: USER, session_id: 's-1', inbound_id: inbound, staging_path: `inbound/${inbound}`, caption }, deps())

    it('uncaptioned photos right after a numbered one go to the same item', async () => {
      sessions.push(session())
      await photo('in-7', '10'); await photo('in-8', null); await photo('in-9', null)
      expect(photos.map((p) => p.field_id)).toEqual(['thermographic_survey', 'thermographic_survey', 'thermographic_survey'])
      expect(sessions[0].last_photo_item).toBe(10)
    })
    it('several held photos all go to the item named next', async () => {
      sessions.push(session())
      await photo('in-7', null); await photo('in-8', null)
      expect(sessions[0].pending_photo_inbound_ids).toEqual(['in-7', 'in-8'])
      await handleFormsOp('item_choice', { user_id: USER, session_id: 's-1', inbound_id: 'in-x', text: '10' }, deps())
      expect(photos).toHaveLength(2)
      expect(sessions[0].pending_photo_inbound_ids).toEqual([])
    })
    it('the follow-on rule lapses after the activity window', async () => {
      sessions.push(session({ last_photo_item: 10, last_photo_at: new Date(NOW.getTime() - 31 * MIN).toISOString() }))
      await photo('in-8', null)
      expect(photos).toEqual([])
      expect(sessions[0].pending_photo_inbound_ids).toEqual(['in-8'])
    })
  })
})
