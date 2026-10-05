/**
 * Supabase implementation of the WhatsApp form service's store (./service.ts).
 *
 * Service-role client throughout, because there is no browser session. Every WRITE to the
 * inspection itself goes through a whatsapp.wa_inspection_* function, which acts as the person
 * under the inspections RLS (migration 00225); the direct table reads here are only of rows the
 * gate already let that person see, or of the service-only whatsapp.* tables.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Template } from '@esite/shared'
import type { FormsStore, Session } from './service'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any, any, any>

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`whatsapp-forms ${what}: ${r.error.message}`)
  return r.data
}

const SESSION_COLS = 'id, token_hash, user_id, inspection_id, template_row_id, status, expires_at, answered_inbound_id, pending_photo_inbound_id'

export function createFormsStore(sb: Sb): FormsStore {
  const wa = () => sb.schema('whatsapp')
  const insp = () => sb.schema('inspections')
  return {
    async gate(userId, inspectionId) {
      return must(await wa().rpc('wa_inspection_gate', { p_user: userId, p_inspection: inspectionId }), 'gate')
    },
    async template(id) {
      const r = must(await insp().from('templates').select('name, schema_json').eq('id', id).maybeSingle(), 'template')
      return r ? { name: r.name as string, schema: r.schema_json as Template } : null
    },
    async flow(templateRowId) {
      return must(await wa().from('flows').select('meta_flow_id, status, flow_json_sha256').eq('template_row_id', templateRowId).maybeSingle(), 'flow')
    },
    async closeLiveSessions(userId, inspectionId) {
      must(await wa().from('form_sessions').update({ status: 'closed' }).eq('user_id', userId).eq('inspection_id', inspectionId)
        .in('status', ['open', 'answered']), 'close sessions')
    },
    async createSession(row) {
      const r = must(await wa().from('form_sessions').insert(row).select('id').single(), 'create session') as { id: string } | null
      if (!r) throw new Error('whatsapp-forms create session: no row returned')
      return r
    },
    async sessionByTokenHash(hash) {
      return must(await wa().from('form_sessions').select(SESSION_COLS).eq('token_hash', hash).maybeSingle(), 'session by token') as Session | null
    },
    async sessionById(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null
      return must(await wa().from('form_sessions').select(SESSION_COLS).eq('id', id).maybeSingle(), 'session by id') as Session | null
    },
    async updateSession(id, patch) {
      must(await wa().from('form_sessions').update(patch).eq('id', id), 'update session')
    },
    async createLink(row) {
      must(await wa().from('form_links').insert(row), 'create link')
    },
    async saveResponses(userId, inspectionId, rows, inboundId) {
      return must(await wa().rpc('wa_inspection_save', { p_user: userId, p_inspection: inspectionId, p_rows: rows, p_inbound: inboundId }), 'save')
    },
    async answers(inspectionId) {
      return must(await insp().from('responses')
        .select('section_id, field_id, value_bool, value_number, value_text, value_array, pass_state, fail_reason')
        .eq('inspection_id', inspectionId), 'answers') ?? []
    },
    async attachments(inspectionId) {
      const [p, s] = await Promise.all([
        insp().from('photos').select('section_id, field_id').eq('inspection_id', inspectionId),
        insp().from('signatures').select('section_id, field_id').eq('inspection_id', inspectionId),
      ])
      return { photos: must(p, 'photos') ?? [], signatures: (must(s, 'signatures') ?? []).filter((x: { field_id: string | null }) => x.field_id) }
    },
    async photoExists(inspectionId, path) {
      const r = must(await insp().from('photos').select('id').eq('inspection_id', inspectionId).eq('storage_path', path).limit(1), 'photo exists')
      return (r ?? []).length > 0
    },
    async download(bucket, path) {
      const { data, error } = await sb.storage.from(bucket).download(path)
      if (error || !data) return null
      return new Uint8Array(await data.arrayBuffer())
    },
    async upload(bucket, path, bytes, mime) {
      const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false })
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`whatsapp-forms upload: ${error.message}`)
    },
    async addPhoto(userId, inspectionId, sectionId, fieldId, path, size, width, height) {
      return must(await wa().rpc('wa_inspection_add_photo', { p_user: userId, p_inspection: inspectionId, p_section: sectionId,
        p_field: fieldId, p_path: path, p_size: size, p_width: width, p_height: height }), 'add photo')
    },
    async submit(userId, inspectionId) {
      return must(await wa().rpc('wa_inspection_submit', { p_user: userId, p_inspection: inspectionId }), 'submit')
    },
    async profileName(userId) {
      const r = must(await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle(), 'profile')
      return (r?.full_name as string | undefined) ?? null
    },
  }
}
