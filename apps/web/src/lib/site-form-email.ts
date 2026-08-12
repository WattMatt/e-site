/**
 * Site-form distribution notification — bell + email to the full project roster.
 *
 * `notifySiteFormDistributed` is the single fan-out for "a termination /
 * making-safe record was distributed". It resolves the roster ONCE through the
 * shared `notifyEntityEvent` helper (bell to everyone but the actor; email to
 * the whole roster, gated by the project `notifyFormEmail` toggle) so the two
 * channels can never disagree about who was told.
 *
 * Thumbnails and the logo are signed URLs with a 7-DAY TTL. The email long
 * outlives the 1-hour TTL used for in-app previews, and `data:` URIs are
 * stripped by Gmail and most webmail clients in `<img src>`. (The inverse holds
 * for the PDF, which embeds bytes.) The deep link points at the form PAGE, never
 * at a signed file URL — signed URLs expire and cannot be re-shared.
 *
 * Best-effort: never throws. A mail failure must not roll back a filed report or
 * unwind a distribution the DB already recorded.
 */

import {
  projectSettingsService,
  renderSiteFormDistributedEmail,
  asLeftStatusLabel,
  type SiteFormDefectLine,
  type SiteFormEmailPhoto,
} from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { notifyEntityEvent } from './notify'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.e-site.live'

/** Inline thumbnails in the distribution email; the rest are summarised as a count. */
const MAX_EMAIL_PHOTOS = 4
/** Defects listed inline; the rest are summarised as a count. */
const MAX_EMAIL_DEFECTS = 3
/** Signed-URL lifetime for email images — the mail outlives a short TTL. */
const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60

const PHOTO_BUCKET = 'site-form-photos'
const LOGO_BUCKET = 'report-logos'

/** Last-resort brand accent when neither the project nor the org sets one. */
const DEFAULT_ACCENT = '#E69500'

/**
 * `circuits[i].action_taken` values that leave a circuit in a NON-permanent
 * state — the count the email leads with, because it is what endangers whoever
 * opens the board next.
 *
 * Tokens are copied verbatim from the `action_taken` dropdown of the `circuits`
 * repeating group in
 * `packages/shared/src/site-forms/templates/termination-and-making-safe.json`.
 * The other four options (`terminated_and_removed`,
 * `disconnected_and_capped_left_in_situ`, `retained_and_reconnected`,
 * `no_action_reference_only`) are terminal states and are deliberately excluded.
 */
export const TEMPORARY_ACTION_TOKENS: ReadonlySet<string> = new Set([
  'left_isolated_locked_off',
  'made_safe_pending_removal_by_others',
  'disconnected_at_db_only_far_end_open',
])

/** `<group>[<index>].<sub>` — the engine's synthetic repeating-group response id. */
const RG_KEY = /^([a-z0-9_]+)\[(\d+)\]\.([a-z0-9_]+)$/

interface ResponseRow {
  section_id: string
  field_id: string
  value_bool?: boolean | null
  value_number?: number | null
  value_text?: string | null
  value_array?: string[] | null
}

/** Mirrors the shared gate reader: first non-null of the typed value columns. */
function firstDefined(r: ResponseRow): unknown {
  if (r.value_bool !== undefined && r.value_bool !== null) return r.value_bool
  if (r.value_number !== undefined && r.value_number !== null) return r.value_number
  if (r.value_array !== undefined && r.value_array !== null) return r.value_array
  if (r.value_text !== undefined && r.value_text !== null) return r.value_text
  return undefined
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

interface ParsedResponses {
  flat: Record<string, unknown>
  /** Repeating-group entries keyed by group name, then by entry index. */
  groups: Map<string, Map<number, Record<string, unknown>>>
}

function parseResponses(rows: ResponseRow[]): ParsedResponses {
  const flat: Record<string, unknown> = {}
  const groups = new Map<string, Map<number, Record<string, unknown>>>()

  for (const r of rows) {
    const m = r.field_id.match(RG_KEY)
    if (!m) {
      flat[`${r.section_id}:${r.field_id}`] = firstDefined(r)
      continue
    }
    const [, group, idxRaw, sub] = m
    const idx = parseInt(idxRaw, 10)
    let bucket = groups.get(group)
    if (!bucket) {
      bucket = new Map<number, Record<string, unknown>>()
      groups.set(group, bucket)
    }
    const entry = bucket.get(idx) ?? {}
    entry[sub] = firstDefined(r)
    bucket.set(idx, entry)
  }

  return { flat, groups }
}

/**
 * A stored logo may be a full URL (already public) or a bucket path. Only the
 * latter needs signing; anything unresolvable degrades to null so the email
 * still sends without branding rather than not sending at all.
 */
async function resolveLogoUrl(
  svc: ReturnType<typeof createServiceClient>,
  value: string | null,
): Promise<string | null> {
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  try {
    const { data } = await svc.storage
      .from(LOGO_BUCKET)
      .createSignedUrl(value, SIGNED_URL_TTL_SECONDS)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}

export interface NotifySiteFormDistributedArgs {
  formId: string
  projectId: string
  /** Who pressed Distribute — excluded from the in-app bell (no self-ping). */
  actorId: string
}

/**
 * Fan out the "site form distributed" bell + roster email.
 *
 * Everything runs on the SERVICE client: the actor routinely cannot read
 * cross-org profiles, the template row, or another org's branding under RLS,
 * and a silently-collapsed read here would produce a truthful-looking email
 * missing the facts that keep the next person on site safe.
 */
export async function notifySiteFormDistributed(
  args: NotifySiteFormDistributedArgs,
): Promise<void> {
  try {
    const svc = createServiceClient()
    const cfg = await projectSettingsService.getNotificationConfig(svc as never, args.projectId)

    const field = (svc as never as {
      schema: (s: string) => {
        from: (t: string) => any
      }
    }).schema('field')

    // Form under distribution. Project-scoped read: a form id from another
    // project must not be able to address this project's roster.
    const { data: formRow } = await field
      .from('site_forms')
      .select(
        'id, form_no, board_label, board_ref, as_left_status, template_row_id, project_id',
      )
      .eq('id', args.formId)
      .eq('project_id', args.projectId)
      .maybeSingle()
    if (!formRow) return

    const form = formRow as {
      form_no: string | null
      board_label: string | null
      board_ref: string | null
      as_left_status: string | null
      template_row_id: string | null
    }

    // ── Template name ────────────────────────────────────────────────────────
    let templateName = 'Site form'
    if (form.template_row_id) {
      const { data: tpl } = await field
        .from('form_templates')
        .select('name')
        .eq('id', form.template_row_id)
        .maybeSingle()
      templateName = (tpl as { name?: string } | null)?.name ?? templateName
    }

    // ── Project + org (branding, names) ──────────────────────────────────────
    const { data: projectRow } = await (svc as any)
      .schema('projects')
      .from('projects')
      .select(
        'id, name, organisation_id, report_accent_color, project_logo_url, client_logo_url',
      )
      .eq('id', args.projectId)
      .maybeSingle()
    const project = (projectRow ?? {}) as {
      name?: string | null
      organisation_id?: string | null
      report_accent_color?: string | null
      project_logo_url?: string | null
      client_logo_url?: string | null
    }

    let orgAccent: string | null = null
    if (project.organisation_id) {
      const { data: orgRow } = await (svc as any)
        .from('organisations')
        .select('report_accent_color')
        .eq('id', project.organisation_id)
        .maybeSingle()
      orgAccent = (orgRow as { report_accent_color?: string | null } | null)
        ?.report_accent_color ?? null
    }

    const accentColor = project.report_accent_color ?? orgAccent ?? DEFAULT_ACCENT
    const logoUrl = await resolveLogoUrl(
      svc,
      project.project_logo_url ?? project.client_logo_url ?? null,
    )

    // ── Photos: first N by sort_order, signed for 7 days ─────────────────────
    const { data: photoRows } = await field
      .from('form_photos')
      .select('storage_path, caption, sort_order')
      .eq('form_id', args.formId)
      .order('sort_order', { ascending: true })

    const allPhotos = ((photoRows ?? []) as {
      storage_path: string
      caption: string | null
    }[]).filter((p) => Boolean(p.storage_path))

    const photos: SiteFormEmailPhoto[] = []
    for (const p of allPhotos.slice(0, MAX_EMAIL_PHOTOS)) {
      const { data } = await svc.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(p.storage_path, SIGNED_URL_TTL_SECONDS)
      if (data?.signedUrl) {
        photos.push({ url: data.signedUrl, caption: p.caption ?? undefined })
      }
    }
    const morePhotoCount = Math.max(0, allPhotos.length - photos.length)

    // ── Responses: defects, temporary circuits, personnel ────────────────────
    const { data: responseRows } = await field
      .from('form_responses')
      .select('section_id, field_id, value_bool, value_number, value_text, value_array')
      .eq('form_id', args.formId)

    const { flat, groups } = parseResponses((responseRows ?? []) as ResponseRow[])

    const circuits = groups.get('circuits') ?? new Map<number, Record<string, unknown>>()
    let circuitsLeftTemporary = 0
    for (const entry of circuits.values()) {
      const action = str(entry.action_taken)
      if (action && TEMPORARY_ACTION_TOKENS.has(action)) circuitsLeftTemporary += 1
    }

    const defectEntries = [
      ...(groups.get('defect_register') ?? new Map<number, Record<string, unknown>>()).entries(),
    ]
      .sort((a, b) => a[0] - b[0])
      .map(([, e]) => ({
        classification: str(e.classification),
        description: str(e.description),
      }))
      .filter((d): d is { classification: string; description: string | null } =>
        Boolean(d.classification),
      )

    const topDefects: SiteFormDefectLine[] = defectEntries
      .slice(0, MAX_EMAIL_DEFECTS)
      .map((d) => ({ classification: d.classification, description: d.description ?? '' }))
    const moreDefectCount = Math.max(0, defectEntries.length - topDefects.length)

    const electricianName = str(flat['personnel:electrician_name']) ?? 'Not recorded'
    const workDate =
      str(flat['personnel:date_of_work']) ?? new Date().toISOString().slice(0, 10)

    // ── Distributor's name ───────────────────────────────────────────────────
    let distributedByName: string | null = null
    if (args.actorId) {
      const { data: prof } = await (svc as any)
        .from('profiles')
        .select('full_name')
        .eq('id', args.actorId)
        .maybeSingle()
      distributedByName = (prof as { full_name?: string | null } | null)?.full_name ?? null
    }

    const boardLabel = form.board_label ?? form.board_ref ?? 'Distribution board'
    const formNo = form.form_no ?? 'Unnumbered'
    const asLeftStatus = form.as_left_status ?? 'made_safe_de_energised'
    const projectName = project.name ?? 'your project'

    const { subject, html } = renderSiteFormDistributedEmail({
      projectId: args.projectId,
      formId: args.formId,
      formNo,
      projectName,
      boardLabel,
      boardRef: form.board_ref ?? null,
      templateName,
      asLeftStatus,
      circuitsLeftTemporary,
      topDefects,
      moreDefectCount,
      photos,
      morePhotoCount,
      electricianName,
      distributedByName,
      workDate,
      accentColor,
      logoUrl,
      siteUrl: SITE_URL,
    })

    const tempNote =
      circuitsLeftTemporary > 0
        ? ` · ${circuitsLeftTemporary} circuit${circuitsLeftTemporary === 1 ? '' : 's'} temporary`
        : ''

    await notifyEntityEvent({
      projectId: args.projectId,
      actorId: args.actorId,
      bell: {
        title: `${formNo} — ${boardLabel}`,
        body: `${asLeftStatusLabel(asLeftStatus)}${tempNote}`,
        route: `/projects/${args.projectId}/forms/${args.formId}`,
        // Pinned to the notifications_type_check CHECK added by migration 00179 —
        // any other value fails the constraint and loses the bell entirely.
        type: 'site_form_distributed',
        entityType: 'site_form',
        entityId: args.formId,
      },
      email: { enabled: Boolean(cfg.formEmail), subject, html },
    })
  } catch (e) {
    // Never propagate: the record is filed and distributed either way.
    console.error('[site-form-email] notify failed', {
      formId: args.formId,
      projectId: args.projectId,
      err: String(e),
    })
  }
}
