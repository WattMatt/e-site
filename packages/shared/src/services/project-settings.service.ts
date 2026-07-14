import type { TypedSupabaseClient } from '@esite/db'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  projectSettingsSchema,
  projectSettingsPatchSchema,
  projectSettingsDefaults,
  type ProjectSettings,
  type ProjectSettingsPatch,
  type ProjectSettingsHistoryRow,
} from '../schemas/project-settings.schema'
import {
  rowToProjectSettings,
  patchToRow,
  rowToHistoryRow,
} from './_project-settings-mappers'
import { z } from 'zod'

// The project_settings table isn't in the generated DB types yet (added
// in 00101 post type-gen). Cast as `any` at the schema('projects') boundary,
// matching the existing codebase pattern for inspections schema access.
type AnyClient = any

/** camelCase → snake_case (for JSONB key lookup). */
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
}

/**
 * Project settings service — full surface from spec §6.
 * All methods take a TypedSupabaseClient as the first argument; RLS enforces
 * read/write authorisation per migration 00101_project_settings.sql.
 */
export const projectSettingsService = {

  // ─── Defaults (re-exported from the schema module for convenience) ───
  DEFAULTS: projectSettingsDefaults,

  // ─── Core CRUD ───

  /**
   * Returns the settings row for a project, or null if (a) no row exists
   * (shouldn't happen post-PR-1a — the ensure trigger guarantees 1:1) or
   * (b) RLS denies the read.
   */
  async get(
    client: TypedSupabaseClient,
    projectId: string,
  ): Promise<ProjectSettings | null> {
    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('project_settings')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return rowToProjectSettings(data)
  },

  /**
   * Defensive read: returns the existing row, or — if absent — INSERTs a
   * default-values row and returns it. The ensure_project_settings_row
   * trigger should make this branch unreachable in practice, but keep it
   * as a safety net for any path that races with project creation.
   */
  async getOrCreate(
    client: TypedSupabaseClient,
    projectId: string,
    organisationId: string,
  ): Promise<ProjectSettings> {
    const existing = await this.get(client, projectId)
    if (existing) return existing

    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('project_settings')
      .insert({ project_id: projectId, organisation_id: organisationId })
      .select('*')
      .single()
    if (error) throw error
    return rowToProjectSettings(data)
  },

  /**
   * Partial update. `patch` is validated by Zod before being sent to the DB.
   * Returns the updated row. `updated_by` should be set by the caller if
   * known (server actions read auth.uid() via the gen helpers).
   */
  async update(
    client: TypedSupabaseClient,
    projectId: string,
    patch: ProjectSettingsPatch,
  ): Promise<ProjectSettings> {
    const validated = projectSettingsPatchSchema.parse(patch)
    const rowPatch = patchToRow(validated)
    if (Object.keys(rowPatch).length === 0) {
      // No-op: nothing to update. Just return current state.
      const current = await this.get(client, projectId)
      if (!current) throw new Error(`No project_settings row for project ${projectId}`)
      return current
    }
    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('project_settings')
      .update(rowPatch)
      .eq('project_id', projectId)
      .select('*')
      .single()
    if (error) throw error
    return rowToProjectSettings(data)
  },

  /**
   * Typed single-field update — convenience wrapper around `update`.
   */
  async updateField<K extends keyof ProjectSettingsPatch>(
    client: TypedSupabaseClient,
    projectId: string,
    key: K,
    value: ProjectSettingsPatch[K],
  ): Promise<ProjectSettings> {
    return this.update(client, projectId, { [key]: value } as ProjectSettingsPatch)
  },

  // ─── Defaults + reset ───

  /**
   * Reverts the named fields to their DEFAULTS values. Emits one audit
   * history row (UPDATE) with diff covering exactly the changed fields.
   */
  async reset(
    client: TypedSupabaseClient,
    projectId: string,
    fields: Array<keyof ProjectSettingsPatch>,
  ): Promise<ProjectSettings> {
    if (fields.length === 0) {
      throw new Error('reset requires at least one field')
    }
    const patch: ProjectSettingsPatch = {}
    for (const f of fields) {
      if (f in projectSettingsDefaults) {
        ;(patch as any)[f] = (projectSettingsDefaults as any)[f]
      }
    }
    return this.update(client, projectId, patch)
  },

  /**
   * Reverts every column to DEFAULTS. One UPDATE, one history row.
   */
  async resetAll(
    client: TypedSupabaseClient,
    projectId: string,
  ): Promise<ProjectSettings> {
    return this.update(client, projectId, { ...projectSettingsDefaults } as ProjectSettingsPatch)
  },

  // ─── validatePatch ───

  /**
   * Pre-flight Zod validation. Returns a discriminated union so callers
   * (server actions, form handlers) can branch without try/catch.
   */
  validatePatch(patch: unknown):
    | { ok: true; patch: ProjectSettingsPatch }
    | { ok: false; errors: z.ZodFormattedError<ProjectSettingsPatch> } {
    const parsed = projectSettingsPatchSchema.safeParse(patch)
    if (parsed.success) {
      return { ok: true, patch: parsed.data }
    }
    return { ok: false, errors: parsed.error.format() as z.ZodFormattedError<ProjectSettingsPatch> }
  },

  // ─── History ───

  /**
   * Returns history rows for a project, newest-first.
   * Filters: `before` (only entries strictly before this date), `field`
   * (only entries where that camelCase field changed), `limit` (default 50).
   */
  async getHistory(
    client: TypedSupabaseClient,
    projectId: string,
    opts: { limit?: number; before?: Date; field?: keyof ProjectSettingsPatch } = {},
  ): Promise<ProjectSettingsHistoryRow[]> {
    const limit = opts.limit ?? 50
    let q = (client as AnyClient)
      .schema('projects')
      .from('project_settings_history')
      .select('*')
      .eq('project_id', projectId)

    if (opts.before) {
      q = q.lt('changed_at', opts.before.toISOString())
    }
    if (opts.field) {
      // The diff column is JSONB shaped `{column_name: [old, new]}`. We need
      // to match by the snake_case column name, so convert.
      const snake = camelToSnake(opts.field as string)
      // JSONB containment: rows where `diff` contains the key. We pass the
      // snake_col with a null value sentinel; the integration test verifies
      // the real-DB semantics.
      q = q.contains('diff', { [snake]: null })
    }

    const { data, error } = await q.order('changed_at', { ascending: false }).limit(limit)
    if (error) throw error
    return (data ?? []).map(rowToHistoryRow)
  },

  /**
   * Time-travel: returns the settings state as of the given timestamp.
   * Reads the most recent history row at or before `date` and deserialises
   * its `snapshot` JSONB. Returns null if no history exists before `date`
   * (e.g. project was created later).
   */
  async getAsOf(
    client: TypedSupabaseClient,
    projectId: string,
    date: Date,
  ): Promise<ProjectSettings | null> {
    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('project_settings_history')
      .select('snapshot')
      .eq('project_id', projectId)
      .lte('changed_at', date.toISOString())
      .order('changed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    return rowToProjectSettings(data.snapshot as any)
  },

  /**
   * Returns just the value-changes for a single field, timeline order.
   * Convenience for sparkline-style displays of one setting over time.
   */
  async getFieldHistory<K extends keyof ProjectSettings>(
    client: TypedSupabaseClient,
    projectId: string,
    field: K,
    opts: { limit?: number; before?: Date } = {},
  ): Promise<Array<{ value: ProjectSettings[K]; changedAt: string; changedBy: string | null }>> {
    const rows = await this.getHistory(client, projectId, {
      ...opts,
      field: field as keyof ProjectSettingsPatch,
    })
    return rows.map(r => ({
      value: r.snapshot[field],
      changedAt: r.changedAt,
      changedBy: r.changedBy,
    }))
  },

  /**
   * Restores the settings to the state captured in `historyRowId`'s
   * snapshot. Writes a NEW history row (so the restoration itself is
   * auditable). Throws if the named history row doesn't exist or doesn't
   * belong to this project.
   */
  async restore(
    client: TypedSupabaseClient,
    projectId: string,
    historyRowId: string,
  ): Promise<ProjectSettings> {
    const { data, error } = await (client as AnyClient)
      .schema('projects')
      .from('project_settings_history')
      .select('*')
      .eq('id', historyRowId)
      .single()
    if (error) throw error
    if (!data) throw new Error(`history row not found: ${historyRowId}`)
    if (data.project_id !== projectId) {
      throw new Error(`history row ${historyRowId} does not belong to project ${projectId}`)
    }
    const historyRow = rowToHistoryRow(data)
    // Build a patch from the snapshot, omitting server-managed fields.
    const snap = historyRow.snapshot
    const patch: ProjectSettingsPatch = {
      workingDays: snap.workingDays,
      holidayCalendar: snap.holidayCalendar,
      extraHolidays: snap.extraHolidays,
      buildersHoliday: snap.buildersHoliday,
      units: snap.units,
      dateFormat: snap.dateFormat,
      defaultRfiPriority: snap.defaultRfiPriority,
      defaultRfiAssigneeId: snap.defaultRfiAssigneeId,
      defaultRfiDueDays: snap.defaultRfiDueDays,
      defaultInspectionTemplateId: snap.defaultInspectionTemplateId,
      contractType: snap.contractType,
      contractSignedDate: snap.contractSignedDate,
      practicalCompletionDate: snap.practicalCompletionDate,
      retentionPct: snap.retentionPct,
      notifyRfiEmail: snap.notifyRfiEmail,
      notifyRfiTo: snap.notifyRfiTo,
      notifyInspectionEmail: snap.notifyInspectionEmail,
    }
    return this.update(client, projectId, patch)
  },

  // ─── Convenience bundles ───

  /** Working-day engine inputs (JBCC, scheduling). M3-safe: returns DEFAULTS if row missing. */
  async getWorkingDayConfig(client: TypedSupabaseClient, projectId: string) {
    const s = await this.get(client, projectId)
    if (!s) {
      return {
        workingDays: projectSettingsDefaults.workingDays,
        holidayCalendar: projectSettingsDefaults.holidayCalendar,
        extraHolidays: projectSettingsDefaults.extraHolidays,
        buildersHoliday: projectSettingsDefaults.buildersHoliday,
      }
    }
    return {
      workingDays: s.workingDays,
      holidayCalendar: s.holidayCalendar,
      extraHolidays: s.extraHolidays,
      buildersHoliday: s.buildersHoliday,
    }
  },

  /** RFI form defaults. M3-safe: returns DEFAULTS if row missing. */
  async getRfiDefaults(client: TypedSupabaseClient, projectId: string) {
    const s = await this.get(client, projectId)
    if (!s) {
      return {
        priority: projectSettingsDefaults.defaultRfiPriority,
        assigneeId: projectSettingsDefaults.defaultRfiAssigneeId,
        dueDays: projectSettingsDefaults.defaultRfiDueDays,
      }
    }
    return {
      priority: s.defaultRfiPriority,
      assigneeId: s.defaultRfiAssigneeId,
      dueDays: s.defaultRfiDueDays,
    }
  },

  /** Inspection form defaults. M3-safe: returns null templateId if row missing. */
  async getInspectionDefaults(client: TypedSupabaseClient, projectId: string) {
    const s = await this.get(client, projectId)
    if (!s) return { templateId: null }
    return { templateId: s.defaultInspectionTemplateId }
  },

  /** Contract metadata bundle. M3-safe: returns DEFAULTS if row missing. */
  async getContractInfo(client: TypedSupabaseClient, projectId: string) {
    const s = await this.get(client, projectId)
    if (!s) {
      return {
        type: projectSettingsDefaults.contractType,
        signedDate: projectSettingsDefaults.contractSignedDate,
        practicalCompletionDate: projectSettingsDefaults.practicalCompletionDate,
        retentionPct: projectSettingsDefaults.retentionPct,
      }
    }
    return {
      type: s.contractType,
      signedDate: s.contractSignedDate,
      practicalCompletionDate: s.practicalCompletionDate,
      retentionPct: s.retentionPct,
    }
  },

  /** Notification config bundle. M3-safe: returns DEFAULTS if row missing. */
  async getNotificationConfig(client: TypedSupabaseClient, projectId: string) {
    const s = await this.get(client, projectId)
    if (!s) {
      return {
        rfiEmail: projectSettingsDefaults.notifyRfiEmail,
        rfiTo: projectSettingsDefaults.notifyRfiTo,
        inspectionEmail: projectSettingsDefaults.notifyInspectionEmail,
        snagEmail: projectSettingsDefaults.notifySnagEmail,
        diaryEmail: projectSettingsDefaults.notifyDiaryEmail,
        qcEmail: projectSettingsDefaults.notifyQcEmail,
      }
    }
    return {
      rfiEmail: s.notifyRfiEmail,
      rfiTo: s.notifyRfiTo,
      inspectionEmail: s.notifyInspectionEmail,
      snagEmail: s.notifySnagEmail,
      diaryEmail: s.notifyDiaryEmail,
      qcEmail: s.notifyQcEmail,
    }
  },

  // ─── Realtime ───

  /**
   * Realtime subscription. Returns the supabase RealtimeChannel; the caller
   * is responsible for unsubscribing (e.g. on component unmount).
   *
   * Useful for two-operator scenarios where one edits while the other is
   * looking at the same form — the form gets pinged to refresh.
   */
  subscribe(
    client: TypedSupabaseClient,
    projectId: string,
    callback: (next: ProjectSettings) => void,
  ): RealtimeChannel {
    const channel = (client as AnyClient).channel(`project_settings:${projectId}`)
    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'projects',
          table: 'project_settings',
          filter: `project_id=eq.${projectId}`,
        },
        (payload: { new: unknown }) => {
          // INSERT and UPDATE provide payload.new with the new row.
          // For DELETE there's no new row; we treat that as "row gone" and
          // pass DEFAULTS to the callback (caller can re-read if it cares).
          if (payload.new) {
            callback(rowToProjectSettings(payload.new as any))
          }
        },
      )
      .subscribe()
    return channel
  },
}
