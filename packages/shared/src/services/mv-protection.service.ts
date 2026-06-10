/**
 * mv-protection.service — data-service for the MV protection study facet of a
 * cable_schedule revision (migrations 00124 / 00125).
 *
 * All methods take a TypedSupabaseClient first; RLS enforces org-scoped
 * read/write (get_user_org_ids + user_is_client_viewer). Writes target
 * cable_schedule via the typed client (NO Content-Profile header — that's only
 * for `structure` writes; this service only READS structure.nodes). Inputs are
 * validated with the Zod schemas before any DB write; rows come back camelCase
 * via the mappers. The schema('cable_schedule')/schema('structure') boundary is
 * cast `any` — the four MV tables aren't in the generated DB types yet (same
 * convention as project-settings.service / boq.service).
 */
import type { TypedSupabaseClient } from '@esite/db'
import {
  mvStudySettingsInputSchema,
  mvStudySignoffInputSchema,
  faultSourceInputSchema,
  protectionDeviceInputSchema,
  type MvStudySettingsInput,
  type MvStudySignoffInput,
  type FaultSourceInput,
  type ProtectionDeviceInput,
} from '../schemas/mv-protection.schema'
import {
  rowToMvStudySettings,
  mvStudySettingsToRow,
  rowToMvStudySignoff,
  mvStudySignoffToRow,
  rowToFaultSource,
  faultSourceToRow,
  rowToProtectionDevice,
  protectionDeviceToRow,
  rowToAdapterFaultSource,
  faultResultToRow,
  rowToFaultResult,
  rowToDiscriminationCheck,
  type MvStudySettingsRow,
  type MvStudySignoffRow,
  type MvFaultSourceRow,
  type MvProtectionDeviceRow,
  type MvFaultResultRow,
  type MvDiscriminationCheckRow,
  type FaultResultRow,
} from './_mv-protection-mappers'
import type { MvNetworkInput } from './mv-network.service'

// The four MV tables (cable_schedule.*) aren't in the generated DB types yet —
// cast at the schema() boundary, matching project-settings.service / boq.service.
type AnyClient = any

export const mvProtectionService = {

  // ─── mv_study_settings ───────────────────────────────────────────────

  /**
   * Returns the study-settings row for a revision, or null if none exists yet
   * (or RLS denies the read).
   */
  async getMvStudySettings(
    client: TypedSupabaseClient,
    revisionId: string,
  ): Promise<MvStudySettingsRow | null> {
    const { data, error } = await (client as AnyClient)
      .schema('cable_schedule')
      .from('mv_study_settings')
      .select('*')
      .eq('revision_id', revisionId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return rowToMvStudySettings(data)
  },

  /**
   * Upserts the one-per-revision study-settings row (revision_id is UNIQUE).
   * `organisationId` is server-resolved (from the revision) by the caller.
   */
  async upsertMvStudySettings(
    client: TypedSupabaseClient,
    organisationId: string,
    input: MvStudySettingsInput,
  ): Promise<MvStudySettingsRow> {
    const validated = mvStudySettingsInputSchema.parse(input)
    const row = {
      revision_id: validated.revisionId,
      organisation_id: organisationId,
      ...mvStudySettingsToRow(validated),
    }
    const { data, error } = await (client as AnyClient)
      .schema('cable_schedule')
      .from('mv_study_settings')
      .upsert(row, { onConflict: 'revision_id' })
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    return rowToMvStudySettings(data)
  },

  // ─── mv_study_signoff (§9 gated-issue evidence) ──────────────────────

  /**
   * Returns the §9 sign-off row for a revision, or null if none exists yet
   * (cable-only revisions never create one) or RLS denies the read.
   */
  async getMvStudySignoff(
    client: TypedSupabaseClient,
    revisionId: string,
  ): Promise<MvStudySignoffRow | null> {
    const { data, error } = await (client as AnyClient)
      .schema('cable_schedule')
      .from('mv_study_signoff')
      .select('*')
      .eq('revision_id', revisionId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return rowToMvStudySignoff(data)
  },

  /**
   * Upserts the one-per-revision sign-off row (revision_id is UNIQUE).
   * `organisationId` is server-resolved (from the revision) by the caller.
   * `opts.signedOffBy` / `opts.signedOffAt` are the stamp the action sets when
   * the gate is complete (else null) — passed through here so the row is
   * written in one place. When `opts` is omitted the stamp columns are left
   * untouched (defined-keys-only patch).
   */
  async upsertMvStudySignoff(
    client: TypedSupabaseClient,
    revisionId: string,
    organisationId: string,
    input: MvStudySignoffInput,
    opts: { signedOffBy?: string | null; signedOffAt?: string | null } = {},
  ): Promise<MvStudySignoffRow> {
    const validated = mvStudySignoffInputSchema.parse({ ...input, revisionId })
    const row: Record<string, unknown> = {
      revision_id: revisionId,
      organisation_id: organisationId,
      ...mvStudySignoffToRow(validated),
    }
    if (opts.signedOffBy !== undefined) row.signed_off_by = opts.signedOffBy
    if (opts.signedOffAt !== undefined) row.signed_off_at = opts.signedOffAt
    const { data, error } = await (client as AnyClient)
      .schema('cable_schedule')
      .from('mv_study_signoff')
      .upsert(row, { onConflict: 'revision_id' })
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    return rowToMvStudySignoff(data)
  },

  // ─── fault_sources ───────────────────────────────────────────────────

  async listFaultSources(
    client: TypedSupabaseClient,
    revisionId: string,
  ): Promise<MvFaultSourceRow[]> {
    const { data, error } = await (client as AnyClient)
      .schema('cable_schedule')
      .from('fault_sources')
      .select('*')
      .eq('revision_id', revisionId)
    if (error) throw new Error(error.message)
    return (data ?? []).map(rowToFaultSource)
  },

  /**
   * Insert or update a fault-source facet. When `id` is supplied the row is
   * updated in place (scoped to revision_id); otherwise a new row is inserted.
   */
  async upsertFaultSource(
    client: TypedSupabaseClient,
    organisationId: string,
    input: FaultSourceInput,
    id?: string,
  ): Promise<MvFaultSourceRow> {
    const validated = faultSourceInputSchema.parse(input)
    const db = (client as AnyClient).schema('cable_schedule').from('fault_sources')
    if (id) {
      const { data, error } = await db
        .update(faultSourceToRow(validated))
        .eq('id', id)
        .eq('revision_id', validated.revisionId)
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return rowToFaultSource(data)
    }
    const row = {
      revision_id: validated.revisionId,
      organisation_id: organisationId,
      ...faultSourceToRow(validated),
    }
    const { data, error } = await db.insert(row).select('*').single()
    if (error) throw new Error(error.message)
    return rowToFaultSource(data)
  },

  // ─── protection_devices ──────────────────────────────────────────────

  async listProtectionDevices(
    client: TypedSupabaseClient,
    revisionId: string,
  ): Promise<MvProtectionDeviceRow[]> {
    const { data, error } = await (client as AnyClient)
      .schema('cable_schedule')
      .from('protection_devices')
      .select('*')
      .eq('revision_id', revisionId)
    if (error) throw new Error(error.message)
    return (data ?? []).map(rowToProtectionDevice)
  },

  /**
   * Insert or update a protection device. When `id` is supplied the row is
   * updated in place (scoped to revision_id); otherwise a new row is inserted.
   * `createdBy` is set on insert only.
   */
  async upsertProtectionDevice(
    client: TypedSupabaseClient,
    organisationId: string,
    input: ProtectionDeviceInput,
    opts: { id?: string; createdBy?: string | null } = {},
  ): Promise<MvProtectionDeviceRow> {
    const validated = protectionDeviceInputSchema.parse(input)
    const db = (client as AnyClient).schema('cable_schedule').from('protection_devices')
    if (opts.id) {
      const { data, error } = await db
        .update(protectionDeviceToRow(validated))
        .eq('id', opts.id)
        .eq('revision_id', validated.revisionId)
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return rowToProtectionDevice(data)
    }
    const row = {
      revision_id: validated.revisionId,
      organisation_id: organisationId,
      created_by: opts.createdBy ?? null,
      ...protectionDeviceToRow(validated),
    }
    const { data, error } = await db.insert(row).select('*').single()
    if (error) throw new Error(error.message)
    return rowToProtectionDevice(data)
  },

  // ─── study graph (read) ──────────────────────────────────────────────

  /**
   * Load everything `buildMvNetwork` needs for a revision: the revision's
   * structure.nodes (project-scoped) + its cable_schedule sources / supplies /
   * cables / fault_sources + the study settings. Reads only — structure.nodes
   * via the typed client (a normal authenticated read). Returns null if the
   * revision can't be resolved.
   *
   * Mirrors the revision-workspace page's graph read
   * (apps/web/.../cables/[revisionId]/page.tsx): sources/supplies/cables by
   * revision_id; nodes by project_id. The flat fault_sources rows are reshaped
   * (incl. nested lv_earthing) by rowToAdapterFaultSource.
   */
  async loadStudyGraph(
    client: TypedSupabaseClient,
    revisionId: string,
  ): Promise<{ input: MvNetworkInput; projectId: string; organisationId: string } | null> {
    const c = client as AnyClient

    const { data: rev } = await c
      .schema('cable_schedule')
      .from('revisions')
      .select('id, project_id, organisation_id')
      .eq('id', revisionId)
      .maybeSingle()
    if (!rev) return null
    const projectId = rev.project_id as string
    const organisationId = rev.organisation_id as string

    const [sourcesRes, nodesRes, suppliesRes, cablesRes, faultSourcesRes, settings] =
      await Promise.all([
        c
          .schema('cable_schedule')
          .from('sources')
          .select('id, type')
          .eq('revision_id', revisionId),
        // Boards/equipment are structure.nodes — PROJECT-scoped, read-only here.
        c
          .schema('structure')
          .from('nodes')
          .select('id, code, kind, voltage_v, breaker_rating_a')
          .eq('project_id', projectId)
          .is('deleted_at', null),
        c
          .schema('cable_schedule')
          .from('supplies')
          .select('id, from_source_id, from_node_id, to_node_id')
          .eq('revision_id', revisionId),
        c
          .schema('cable_schedule')
          .from('cables')
          .select('id, supply_id, ohm_per_km, x_per_km, measured_length_m, confirmed_length_m')
          .eq('revision_id', revisionId),
        c
          .schema('cable_schedule')
          .from('fault_sources')
          .select('*')
          .eq('revision_id', revisionId),
        this.getMvStudySettings(client, revisionId),
      ])

    const settingsRow = settings ?? null
    const input: MvNetworkInput = {
      nodes: (nodesRes.data ?? []).map((n: Record<string, unknown>) => ({
        id: n.id as string,
        code: n.code as string,
        kind: n.kind as string,
        voltage_v: n.voltage_v == null ? null : Number(n.voltage_v),
        breaker_rating_a: n.breaker_rating_a == null ? null : Number(n.breaker_rating_a),
      })),
      sources: (sourcesRes.data ?? []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        type: s.type as string,
      })),
      supplies: (suppliesRes.data ?? []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        from_source_id: (s.from_source_id as string) ?? null,
        from_node_id: (s.from_node_id as string) ?? null,
        to_node_id: s.to_node_id as string,
      })),
      cables: (cablesRes.data ?? []).map((c2: Record<string, unknown>) => ({
        id: c2.id as string,
        supply_id: c2.supply_id as string,
        ohm_per_km: c2.ohm_per_km == null ? null : Number(c2.ohm_per_km),
        x_per_km: c2.x_per_km == null ? null : Number(c2.x_per_km),
        measured_length_m: c2.measured_length_m == null ? null : Number(c2.measured_length_m),
        confirmed_length_m: c2.confirmed_length_m == null ? null : Number(c2.confirmed_length_m),
      })),
      faultSources: (faultSourcesRes.data ?? []).map(rowToAdapterFaultSource),
      settings: {
        base_mva: settingsRow?.baseMva ?? 100,
        c_max: settingsRow?.cMax ?? 1.1,
        c_min: settingsRow?.cMin ?? 1.0,
        ef_fault_resistance_ohm: settingsRow?.efFaultResistanceOhm ?? 0,
      },
    }

    return { input, projectId, organisationId }
  },

  // ─── fault_results (write cache) ─────────────────────────────────────

  /**
   * Upsert the computed per-node fault-result cache for a revision (UNIQUE on
   * revision_id + node_id). One row per node; basis carries the governance
   * stamp from the engine.
   */
  async saveFaultResults(
    client: TypedSupabaseClient,
    revisionId: string,
    organisationId: string,
    results: FaultResultRow[],
  ): Promise<number> {
    if (results.length === 0) return 0
    const rows = results.map((r) => faultResultToRow(revisionId, organisationId, r))
    const { error } = await (client as AnyClient)
      .schema('cable_schedule')
      .from('fault_results')
      .upsert(rows, { onConflict: 'revision_id,node_id' })
    if (error) throw new Error(error.message)
    return rows.length
  },

  /**
   * Read the cached per-node fault results for a revision (one row per node;
   * empty until the study route has run). Mirrors listFaultSources.
   */
  async listFaultResults(
    client: TypedSupabaseClient,
    revisionId: string,
  ): Promise<MvFaultResultRow[]> {
    const { data, error } = await (client as AnyClient)
      .schema('cable_schedule')
      .from('fault_results')
      .select('*')
      .eq('revision_id', revisionId)
    if (error) throw new Error(error.message)
    return (data ?? []).map(rowToFaultResult)
  },

  // ─── discrimination_checks (read) ────────────────────────────────────

  /**
   * Read the cached upstream/downstream discrimination checks for a revision.
   * Empty until device-pairing lands (Phase 4b) — the coordination view shows
   * a "pairing pending" note in that case. Mirrors listFaultSources.
   */
  async listDiscriminationChecks(
    client: TypedSupabaseClient,
    revisionId: string,
  ): Promise<MvDiscriminationCheckRow[]> {
    const { data, error } = await (client as AnyClient)
      .schema('cable_schedule')
      .from('discrimination_checks')
      .select('*')
      .eq('revision_id', revisionId)
    if (error) throw new Error(error.message)
    return (data ?? []).map(rowToDiscriminationCheck)
  },
}

// ─────────────────────────────────────────────────────────────────────────
// §9 gated-issue — completeness rule + the issue guard
// ─────────────────────────────────────────────────────────────────────────

const nonEmpty = (s: string | null | undefined): boolean => typeof s === 'string' && s.trim() !== ''

/**
 * Pure completeness test for the §9 sign-off (no DB). The study may be issued
 * only when all four gate fields carry a value AND source data is confirmed:
 *   GATE-1  pr_eng_name + pr_eng_ecsa_reg  (named Pr.Eng approver + ECSA reg)
 *   GATE-2  curve_manual_rev               (curve re-validation manual rev)
 *   GATE-3  source_data_confirmed === true (impedances confirmed)
 *   GATE-4  validation_pack_ref            (signed validation pack reference)
 * `missing` names every gap in human-readable form (for the guard's error and
 * the UI). Passing `null` (no row yet) reports all gates missing.
 */
export function mvSignoffComplete(
  signoff: MvStudySignoffRow | null,
): { complete: boolean; missing: string[] } {
  const missing: string[] = []
  if (!nonEmpty(signoff?.prEngName)) missing.push('Pr.Eng approver name')
  if (!nonEmpty(signoff?.prEngEcsaReg)) missing.push('Pr.Eng ECSA registration')
  if (!nonEmpty(signoff?.curveManualRev)) missing.push('curve re-validation manual revision')
  if (signoff?.sourceDataConfirmed !== true) missing.push('source data confirmation')
  if (!nonEmpty(signoff?.validationPackRef)) missing.push('signed validation pack reference')
  return { complete: missing.length === 0, missing }
}

/**
 * The issue precondition (spec §9), called additively from issueRevisionAction.
 * MV sign-off only gates a revision that actually carries MV data — so:
 *   (a) if the revision has no fault_sources AND no protection_devices, there
 *       is no MV study to gate → { ok: true } (cable-only revisions unaffected);
 *   (b) otherwise load the sign-off and run `mvSignoffComplete`; an incomplete
 *       gate refuses the issue with a message naming the gaps.
 */
export async function assertMvSignoffComplete(
  client: TypedSupabaseClient,
  revisionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = client as AnyClient

  const [faultSourcesRes, devicesRes] = await Promise.all([
    c
      .schema('cable_schedule')
      .from('fault_sources')
      .select('id', { count: 'exact', head: true })
      .eq('revision_id', revisionId),
    c
      .schema('cable_schedule')
      .from('protection_devices')
      .select('id', { count: 'exact', head: true })
      .eq('revision_id', revisionId),
  ])

  const mvDataCount = (faultSourcesRes.count ?? 0) + (devicesRes.count ?? 0)
  if (mvDataCount === 0) return { ok: true }

  const signoff = await mvProtectionService.getMvStudySignoff(client, revisionId)
  const { complete, missing } = mvSignoffComplete(signoff)
  if (complete) return { ok: true }
  return {
    ok: false,
    error: `MV protection study must be signed off before issue — missing: ${missing.join(', ')}`,
  }
}
