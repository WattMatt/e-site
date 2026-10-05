/**
 * Inspection forms over WhatsApp (E4): the form service the edge function calls.
 *
 * The edge only routes chat. This module owns the form: it opens a session and sends the
 * template's Flow (or a signed web link when the template cannot be a Flow), maps a Flow's
 * reply onto response rows, files photos against numbered items, checks completeness with
 * the shared engine and submits. It decides nothing about ACCESS: every write goes through
 * a whatsapp.wa_inspection_* function that acts as the person under the inspections RLS and
 * also requires the org flag (migration 00227). The store is a port so this file is testable
 * without a database; ./store.ts is the Supabase implementation.
 */
import {
  buildInspectionFlow, flowCapability, mapFlowReply, photoItems, parseItemRef, imageInfo,
  type PhotoItem, type MappedResponse,
} from '@esite/shared/whatsapp-forms'
import { evaluateInspection, type Response, type Template } from '@esite/shared'
import { createHash } from 'node:crypto'

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const LINK_TTL_MS = 15 * 60 * 1000
export const STAGING_BUCKET = 'whatsapp-media'
export const PHOTO_BUCKET = 'inspection-photos'
/** Uncaptioned photos within this long of a numbered one go to the same item. */
export const PHOTO_FOLLOW_MS = 30 * 60 * 1000
const MAX_LINES = 12

export type FormsOp = 'open' | 'flow_reply' | 'photo' | 'item_choice' | 'submit'
export const FORMS_OPS: readonly FormsOp[] = ['open', 'flow_reply', 'photo', 'item_choice', 'submit']

export type FormsMessage =
  | { type: 'text'; body: string }
  | { type: 'buttons'; body: string; buttons: Array<{ id: string; title: string }> }
  | { type: 'flow'; flowId: string; token: string; cta: string; body: string; mode: 'draft' | 'published'; firstScreen: string }

export interface FormsReply { code: string; messages: FormsMessage[]; session_id?: string | null }

export interface Gate {
  code: string
  inspection_id?: string
  project_id?: string
  organisation_id?: string
  template_row_id?: string
  status?: string
  label?: string | null
}

export interface Session {
  id: string
  token_hash?: string
  user_id: string
  inspection_id: string
  template_row_id: string
  status: 'open' | 'answered' | 'submitted' | 'closed'
  expires_at: string
  answered_inbound_id: string | null
  /** Photos waiting for an item number, oldest first. */
  pending_photo_inbound_ids: string[]
  /** The item the last numbered photo went to, and when; uncaptioned photos soon after follow it (albums). */
  last_photo_item: number | null
  last_photo_at: string | null
}

export interface FormsStore {
  gate(userId: string, inspectionId: string): Promise<Gate>
  template(templateRowId: string): Promise<{ name: string; schema: Template } | null>
  flow(templateRowId: string): Promise<{ meta_flow_id: string; status: 'draft' | 'published'; flow_json_sha256: string } | null>
  closeLiveSessions(userId: string, inspectionId: string): Promise<void>
  createSession(row: { token_hash: string; user_id: string; inspection_id: string; template_row_id: string; expires_at: string }): Promise<{ id: string }>
  sessionByTokenHash(hash: string): Promise<Session | null>
  sessionById(id: string): Promise<Session | null>
  updateSession(id: string, patch: Partial<Session> & { submitted_at?: string }): Promise<void>
  createLink(row: { token_hash: string; user_id: string; form_session_id: string; target_path: string; expires_at: string }): Promise<void>
  saveResponses(userId: string, inspectionId: string, rows: MappedResponse[], inboundId: string | null): Promise<{ code: string; saved?: number; message?: string }>
  answers(inspectionId: string): Promise<Response[]>
  attachments(inspectionId: string): Promise<{ photos: { section_id: string; field_id: string }[]; signatures: { section_id: string; field_id: string }[] }>
  photoExists(inspectionId: string, path: string): Promise<boolean>
  download(bucket: string, path: string): Promise<Uint8Array | null>
  upload(bucket: string, path: string, bytes: Uint8Array, mime: string): Promise<void>
  addPhoto(userId: string, inspectionId: string, sectionId: string, fieldId: string, path: string,
           size: number, width: number, height: number): Promise<{ code: string; message?: string }>
  /** wa_inspection_submit: also stamps inspections.submitted_session_id = sessionId in the same statement. */
  submit(userId: string, inspectionId: string, sessionId: string): Promise<{ code: string; verifier_id?: string | null }>
  /** Current status and which WhatsApp session (if any) moved it, read with the service role (retry recovery). */
  inspectionState(inspectionId: string): Promise<{ status: string; submitted_via: string | null; submitted_session_id: string | null } | null>
  /** Atomically append an inbound photo to the session's held list (no duplicates); returns the list. */
  holdPhoto(sessionId: string, inboundId: string): Promise<string[]>
  /** Atomically remove these ids from the held list (only the ones actually attached). */
  releasePhotos(sessionId: string, inboundIds: string[]): Promise<void>
  profileName(userId: string): Promise<string | null>
}

export interface FormsDeps {
  store: FormsStore
  now: () => Date
  appUrl: string
  /** PDF, fan-out, verifier notice. Runs after a successful submit (also from the web path). */
  afterSubmit(sessionId: string, opts: { notifyVerifier: boolean }): Promise<void>
  newToken(): string
  hash(token: string): string
}

export const REPLY = {
  flagOff: 'Inspections over WhatsApp are off for your organisation.',
  notAvailable: 'That inspection is not available to you.',
  notWritable: (status: string) => `That inspection can't be changed any more (it is ${status.replace(/_/g, ' ')}).`,
  flowBody: (label: string, template: string) =>
    `*${label}*\n${template}\n\nAnswer the questions in the form. Photos and the signature come after.`,
  flowCta: 'Open the inspection form',
  webLink: (label: string, url: string) =>
    `*${label}* is filled in on the web (it is too detailed for a WhatsApp form):\n${url}\n\nThe link opens E-Site signed in as you. It works once, for 15 minutes.`,
  expired: 'That form has expired or was already sent. Send MENU and open the inspection again.',
  foreign: 'That form was sent to someone else, so nothing was saved.',
  saved: (n: number, label: string) => `✅ Saved ${n} answer${n === 1 ? '' : 's'} for *${label}*.`,
  refusedValues: (labels: string[]) => `These answers were not accepted, please check them: ${labels.join(', ')}.`,
  stillNeeded: 'Still needed:',
  allAnswered: 'All questions are answered.',
  photoHow: 'Send a photo with the item number as its caption (for example *10*). Reply *SUBMIT* when you are done.',
  itemsTitle: 'Items you can add photos to:',
  notAnImage: 'That file is not a photo E-Site can store (JPEG or PNG only).',
  whichItem: (max: number) => `Which item is this photo for? Reply with its number (1 to ${max}).`,
  noSuchItem: (n: number, max: number) => `There is no item ${n}. Reply with a number from 1 to ${max}.`,
  photoAdded: (n: number, label: string) => `📎 Photo added to item ${n}: ${label}.`,
  incomplete: 'Not ready to submit yet. Still needed:',
  againWhenDone: 'Reply *SUBMIT* again when these are done.',
  needsSignature: (label: string, url: string) =>
    `Almost done. *${label}* needs the inspector signature, which is signed on the web:\n${url}\n\nSign, then press Submit there. The link works once, for 15 minutes.`,
  submitted: (label: string, verifier: string | null) =>
    `✅ Submitted *${label}*. It is with ${verifier ?? 'the verifier'} to verify. The PDF follows.`,
  refused: (code: string, msg?: string) => `Couldn't do that (${code}${msg ? `: ${msg}` : ''}).`,
  submitButton: 'Submit',
  useWeb: (label: string, url: string) =>
    `*${label}* is finished and submitted on the web:\n${url}\n\nThe link opens E-Site signed in as you. It works once, for 15 minutes.`,
  photosAdded: (count: number, n: number, label: string) => `📎 ${count} photos added to item ${n}: ${label}.`,
} as const

const text = (body: string): FormsMessage => ({ type: 'text', body })
const reply = (code: string, messages: FormsMessage[], session_id?: string | null): FormsReply =>
  (session_id === undefined ? { code, messages } : { code, messages, session_id })

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function gateRefusal(g: Gate): FormsReply {
  if (g.code === 'flag_off') return reply(g.code, [text(REPLY.flagOff)])
  if (g.code === 'not_writable') return reply(g.code, [text(REPLY.notWritable(g.status ?? 'closed'))])
  return reply(g.code, [text(REPLY.notAvailable)])
}

function liveSession(s: Session | null, userId: string, now: Date): s is Session {
  return !!s && s.user_id === userId && (s.status === 'open' || s.status === 'answered') && Date.parse(s.expires_at) > now.getTime()
}

async function signedLink(deps: FormsDeps, userId: string, sessionId: string, projectId: string, inspectionId: string): Promise<string> {
  const token = deps.newToken()
  await deps.store.createLink({ token_hash: deps.hash(token), user_id: userId, form_session_id: sessionId,
    target_path: `/projects/${projectId}/inspections/${inspectionId}`,
    expires_at: new Date(deps.now().getTime() + LINK_TTL_MS).toISOString() })
  return `${deps.appUrl}/auth/wa-link/${token}`
}

/** What is still missing, in words, using the engine the web capture form uses. */
async function missingLines(deps: FormsDeps, t: Template, inspectionId: string, items: PhotoItem[]):
    Promise<{ lines: string[]; onlySignature: boolean; complete: boolean }> {
  const [answers, att] = await Promise.all([deps.store.answers(inspectionId), deps.store.attachments(inspectionId)])
  const ev = evaluateInspection(t, answers, att)
  const fields = new Map(t.sections.flatMap((s) => [...s.fields, ...(s.subsections ?? []).flatMap((x) => x.fields)]
    .map((f) => [`${s.section_id}|${f.field_id}`, f] as const)))
  // Photos and signatures first: they are the steps a Flow cannot do, so the person must not miss them.
  const attachLines: string[] = []
  const answerLines: string[] = []
  let nonSignature = 0
  for (const m of ev.missingRequired) {
    const f = fields.get(`${m.sectionId}|${m.fieldId}`)
    // A field the lookup cannot label (a repeating-group entry) is still missing: name it by id.
    if (!f) { nonSignature++; answerLines.push(`• ${m.fieldId}`); continue }
    if (f.type === 'signature') { attachLines.push(`• ${f.label} (on the web, after SUBMIT)`); continue }
    nonSignature++
    const item = items.find((i) => i.sectionId === m.sectionId && i.fieldId === m.fieldId)
    if (f.type === 'photo') attachLines.push(`• Item ${item?.n ?? '?'} photo: ${f.label}`)
    else answerLines.push(`• ${item ? `Item ${item.n}: ` : ''}${f.label}`)
  }
  const all = [...attachLines, ...answerLines]
  const lines = all.length > MAX_LINES ? [...all.slice(0, MAX_LINES), `…and ${all.length - MAX_LINES} more`] : all
  // Completeness is the engine's verdict, never the count of lines we managed to render.
  return { lines, onlySignature: ev.missingRequired.length > 0 && nonSignature === 0, complete: ev.missingRequired.length === 0 }
}

async function open(b: Record<string, unknown>, deps: FormsDeps): Promise<FormsReply> {
  const userId = String(b.user_id ?? '')
  const g = await deps.store.gate(userId, String(b.inspection_id ?? ''))
  if (g.code !== 'ok') return gateRefusal(g)
  const tpl = await deps.store.template(g.template_row_id!)
  if (!tpl) return reply('not_found', [text(REPLY.notAvailable)])
  const label = g.label || tpl.name

  await deps.store.closeLiveSessions(userId, g.inspection_id!)
  const token = deps.newToken()
  const { id } = await deps.store.createSession({ token_hash: deps.hash(token), user_id: userId, inspection_id: g.inspection_id!,
    template_row_id: g.template_row_id!, expires_at: new Date(deps.now().getTime() + SESSION_TTL_MS).toISOString() })

  const flow = await deps.store.flow(g.template_row_id!)
  const cap = flowCapability(tpl.schema)
  // The published Flow must be the one THIS code would build for this template row, or its
  // input names would not map back. A mismatch falls back to the web form.
  const matches = !!flow && cap.ok && flow.flow_json_sha256 === sha256Hex(JSON.stringify(buildInspectionFlow(tpl.schema)))
  if (!matches) {
    if (flow) console.warn('[whatsapp-forms] published Flow does not match the builder output', g.template_row_id)
    const url = await signedLink(deps, userId, id, g.project_id!, g.inspection_id!)
    return reply('ok', [text(REPLY.webLink(label, url))], id)
  }
  return reply('ok', [{ type: 'flow', flowId: flow!.meta_flow_id, token, cta: REPLY.flowCta, body: REPLY.flowBody(label, tpl.name),
    mode: flow!.status, firstScreen: 'SECTION_A' }], id)
}

async function flowReply(b: Record<string, unknown>, deps: FormsDeps): Promise<FormsReply> {
  const userId = String(b.user_id ?? '')
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(String(b.response_json ?? ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
  } catch {
    return reply('expired', [text(REPLY.expired)])
  }
  const token = typeof parsed.flow_token === 'string' ? parsed.flow_token : ''
  const s = token ? await deps.store.sessionByTokenHash(deps.hash(token)) : null
  if (s && s.user_id !== userId) {
    console.warn('[whatsapp-forms] Flow reply from a different person than the session', s.id)
    return reply('foreign', [text(REPLY.foreign)])
  }
  if (!liveSession(s, userId, deps.now())) return reply('expired', [text(REPLY.expired)])
  const tpl = await deps.store.template(s.template_row_id)
  if (!tpl) return reply('expired', [text(REPLY.expired)])

  const mapped = mapFlowReply(tpl.schema, parsed)
  if (mapped.unknownKeys.length) console.warn('[whatsapp-forms] ignored unknown Flow keys', mapped.unknownKeys)
  let savedCount = 0
  if (mapped.responses.length > 0) {
    const r = await deps.store.saveResponses(userId, s.inspection_id, mapped.responses, String(b.inbound_id ?? '') || null)
    if (r.code !== 'ok') {
      if (r.code === 'refused') return reply(r.code, [text(REPLY.refused(r.code, r.message))])
      const g = await deps.store.gate(userId, s.inspection_id)
      return gateRefusal(g.code === 'ok' ? { code: r.code } : g)
    }
    savedCount = r.saved ?? mapped.responses.length
  }
  await deps.store.updateSession(s.id, { status: 'answered', answered_inbound_id: String(b.inbound_id ?? '') || null })

  const g = await deps.store.gate(userId, s.inspection_id)
  const label = g.label || tpl.name
  const items = photoItems(tpl.schema)
  const miss = await missingLines(deps, tpl.schema, s.inspection_id, items)
  const fieldLabel = new Map(tpl.schema.sections.flatMap((x) => x.fields.map((f) => [f.field_id, f.label] as const)))
  const parts = [REPLY.saved(savedCount, label)]
  if (mapped.errors.length) parts.push(REPLY.refusedValues(mapped.errors.map((e) => fieldLabel.get(e.fieldId) ?? e.fieldId)))
  parts.push(miss.complete ? REPLY.allAnswered : [REPLY.stillNeeded, ...miss.lines].join('\n'))
  parts.push(REPLY.photoHow)
  const list = [REPLY.itemsTitle, ...items.map((i) => `${i.n}. ${i.label}${i.required ? ' (photo required)' : ''}`)].join('\n')
  return reply('ok', [
    { type: 'buttons', body: parts.join('\n\n').slice(0, 1024), buttons: [{ id: `fsubmit:${s.id}`, title: REPLY.submitButton }] },
    text(list),
  ], s.id)
}

async function attach(deps: FormsDeps, s: Session, item: PhotoItem, inboundId: string, bytes: Uint8Array): Promise<FormsReply> {
  const info = imageInfo(bytes)
  if (!info) return reply('not_an_image', [text(REPLY.notAnImage)])
  const g = await deps.store.gate(s.user_id, s.inspection_id)
  if (g.code !== 'ok') return gateRefusal(g)
  const ext = info.mime === 'image/png' ? 'png' : 'jpg'
  const safeInbound = inboundId.replace(/[^A-Za-z0-9_-]/g, '')
  const path = `${g.project_id}/${s.inspection_id}/${item.sectionId}/${item.fieldId}/wa-${safeInbound}.${ext}`
  if (!(await deps.store.photoExists(s.inspection_id, path))) {
    await deps.store.upload(PHOTO_BUCKET, path, bytes, info.mime)
    const r = await deps.store.addPhoto(s.user_id, s.inspection_id, item.sectionId, item.fieldId, path, bytes.length, info.width, info.height)
    if (r.code !== 'ok') return r.code === 'refused' ? reply(r.code, [text(REPLY.refused(r.code, r.message))]) : gateRefusal({ code: r.code })
  }
  await deps.store.updateSession(s.id, { last_photo_item: item.n, last_photo_at: deps.now().toISOString() })
  return reply('ok', [text(REPLY.photoAdded(item.n, item.label))], s.id)
}

async function photo(b: Record<string, unknown>, deps: FormsDeps): Promise<FormsReply> {
  const userId = String(b.user_id ?? '')
  const s = await deps.store.sessionById(String(b.session_id ?? ''))
  if (!liveSession(s, userId, deps.now())) return reply('no_session', [], null)
  const tpl = await deps.store.template(s.template_row_id)
  if (!tpl) return reply('no_session', [], null)
  const inboundId = String(b.inbound_id ?? '')
  const bytes = await deps.store.download(STAGING_BUCKET, String(b.staging_path ?? ''))
  if (!bytes || !imageInfo(bytes)) return reply('not_an_image', [text(REPLY.notAnImage)])
  const items = photoItems(tpl.schema)
  const caption = typeof b.caption === 'string' && b.caption.trim() ? b.caption : null
  let n = caption ? parseItemRef(caption) : null
  // An album: only the first photo carries the caption, so an uncaptioned photo soon after a numbered one follows it.
  if (n === null && !caption && s.last_photo_item && isRecent(s.last_photo_at, deps.now())) n = s.last_photo_item
  const item = n === null ? undefined : items.find((i) => i.n === n)
  if (!item) {
    await deps.store.holdPhoto(s.id, inboundId)
    return reply('ok', [text(n === null ? REPLY.whichItem(items.length) : REPLY.noSuchItem(n, items.length))], s.id)
  }
  return attach(deps, s, item, inboundId, bytes)
}

async function itemChoice(b: Record<string, unknown>, deps: FormsDeps): Promise<FormsReply> {
  const userId = String(b.user_id ?? '')
  const s = await deps.store.sessionById(String(b.session_id ?? ''))
  if (!liveSession(s, userId, deps.now())) return reply('no_session', [], null)
  const waiting = s.pending_photo_inbound_ids ?? []
  if (waiting.length === 0) return reply('not_waiting', [])
  const tpl = await deps.store.template(s.template_row_id)
  if (!tpl) return reply('no_session', [], null)
  const items = photoItems(tpl.schema)
  const n = parseItemRef(String(b.text ?? ''))
  const item = n === null ? undefined : items.find((i) => i.n === n)
  if (!item) return reply('ok', [text(REPLY.noSuchItem(n ?? 0, items.length))], s.id)
  let added = 0
  const done: string[] = []
  let last: FormsReply = reply('not_an_image', [text(REPLY.notAnImage)])
  for (const inbound of waiting) {
    const bytes = await deps.store.download(STAGING_BUCKET, `inbound/${inbound}`)
    if (!bytes) { done.push(inbound); continue }
    last = await attach(deps, s, item, inbound, bytes)
    if (last.code !== 'ok') break
    done.push(inbound)
    added++
  }
  // Only what was handled leaves the queue; a photo held meanwhile by a concurrent message stays.
  await deps.store.releasePhotos(s.id, done)
  if (last.code !== 'ok' && added === 0) return last
  return added > 1 ? reply('ok', [text(REPLY.photosAdded(added, item.n, item.label))], s.id) : last
}

function isRecent(at: string | null, now: Date): boolean {
  return !!at && now.getTime() - Date.parse(at) <= PHOTO_FOLLOW_MS
}

async function submit(b: Record<string, unknown>, deps: FormsDeps): Promise<FormsReply> {
  const userId = String(b.user_id ?? '')
  const s = await deps.store.sessionById(String(b.session_id ?? ''))
  if (!liveSession(s, userId, deps.now())) return reply('no_session', [], null)
  const tpl = await deps.store.template(s.template_row_id)
  if (!tpl) return reply('no_session', [], null)
  const g = await deps.store.gate(userId, s.inspection_id)
  // Retry recovery: THIS session's own earlier SUBMIT moved the inspection (stamped atomically by
  // wa_inspection_submit) but its follow-up did not finish. Never another person's submit, and only
  // while the person still has access (the gate's not_writable means visible but no longer open).
  if (g.code === 'not_writable') {
    const state = await deps.store.inspectionState(s.inspection_id)
    if (state?.status === 'awaiting_verification' && state.submitted_session_id === s.id) {
      await deps.afterSubmit(s.id, { notifyVerifier: true })
      return reply('ok', [text(REPLY.submitted(g.label || tpl.name, null))], null)
    }
  }
  if (g.code !== 'ok') return gateRefusal(g)
  const label = g.label || tpl.name
  // A template that cannot be a Flow (tables, conditions, files) is completed on the web, signed in as the person.
  if (!flowCapability(tpl.schema).ok) {
    const url = await signedLink(deps, userId, s.id, g.project_id!, s.inspection_id)
    return reply('use_web', [text(REPLY.useWeb(label, url))], s.id)
  }
  const miss = await missingLines(deps, tpl.schema, s.inspection_id, photoItems(tpl.schema))
  if (miss.onlySignature) {
    const url = await signedLink(deps, userId, s.id, g.project_id!, s.inspection_id)
    return reply('needs_signature', [text(REPLY.needsSignature(label, url))], s.id)
  }
  if (!miss.complete) return reply('incomplete', [text([REPLY.incomplete, ...miss.lines, '', REPLY.againWhenDone].join('\n'))], s.id)

  const r = await deps.store.submit(userId, s.inspection_id, s.id)
  if (r.code !== 'ok') return r.code === 'nothing_answered' || r.code === 'refused' ? reply(r.code, [text(REPLY.refused(r.code))]) : gateRefusal({ code: r.code })
  await deps.afterSubmit(s.id, { notifyVerifier: true })
  const verifier = r.verifier_id ? await deps.store.profileName(r.verifier_id) : null
  return reply('ok', [text(REPLY.submitted(label, verifier))], null)
}

export async function handleFormsOp(op: FormsOp, body: Record<string, unknown>, deps: FormsDeps): Promise<FormsReply> {
  switch (op) {
    case 'open': return open(body, deps)
    case 'flow_reply': return flowReply(body, deps)
    case 'photo': return photo(body, deps)
    case 'item_choice': return itemChoice(body, deps)
    case 'submit': return submit(body, deps)
    default: return reply('bad_request', [])
  }
}
