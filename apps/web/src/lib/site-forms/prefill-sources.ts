/**
 * Gathers everything the project already knows about a board, for
 * pre-populating a new site form.
 *
 * All the judgement about what those values MEAN lives in `buildPrefill`
 * (`@esite/shared`); this file only fetches. Every lookup is best-effort: a
 * missing project, board or cable schedule yields fewer prefilled answers, never
 * an error. Creating the form must not fail because a lookup did.
 *
 * What is actually available in production, measured rather than assumed:
 *   - projects.projects           name/code/client/address are ~100% populated
 *   - public.organisations        name + registration
 *   - structure.nodes             code/name always; incomer_breaker_a ~65%
 *   - cable_schedule              374 supplies across 6 of 14 projects
 *   - structure.node_circuits     effectively EMPTY (12 rows, all descriptive
 *                                 columns null) -- deliberately not a source
 *   - structure.tenant_details    db_location/db_fed_from/earth_leakage all
 *                                 null in every one of its 411 rows -- likewise
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPrefill, type PrefillResponse, type PrefillSources } from '@esite/shared'

type AnyClient = SupabaseClient<any, any, any>

export interface PrefillOptions {
  projectId: string
  /** The structure node this form is about, when one was picked. */
  nodeId: string | null
  /**
   * Board to read the cable schedule from. Defaults to `nodeId`; set when the
   * user linked a different cable-schedule board because theirs is not in it.
   */
  cableScheduleNodeId?: string | null
  userId: string
  formNo: string | null
}

async function safe<T>(p: PromiseLike<{ data: T | null }>): Promise<T | null> {
  try {
    const { data } = await p
    return (data as T) ?? null
  } catch {
    return null
  }
}

/**
 * Resolve the current cable-schedule revision for a project.
 *
 * "Current" is the newest revision; a project with none simply contributes no
 * cable-schedule prefill.
 */
async function currentRevisionId(
  supabase: AnyClient,
  projectId: string,
): Promise<string | null> {
  const row = await safe<{ id: string }[]>(
    supabase
      .schema('cable_schedule')
      .from('revisions')
      .select('id, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1),
  )
  return row && row.length > 0 ? row[0].id : null
}

export async function gatherPrefill(
  supabase: AnyClient,
  opts: PrefillOptions,
): Promise<PrefillResponse[]> {
  const csNodeId = opts.cableScheduleNodeId ?? opts.nodeId

  const project = await safe<{
    name: string | null
    code: string | null
    client_name: string | null
    address: string | null
    city: string | null
    province: string | null
    organisation_id: string
  }>(
    supabase
      .from('projects')
      .select('name, code, client_name, address, city, province, organisation_id')
      .eq('id', opts.projectId)
      .maybeSingle() as never,
  )

  const [organisation, userRow, node] = await Promise.all([
    project
      ? safe<{ name: string | null; registration_no: string | null; registration_number: string | null }>(
          supabase
            .from('organisations')
            .select('name, registration_no, registration_number')
            .eq('id', project.organisation_id)
            .maybeSingle() as never,
        )
      : Promise.resolve(null),
    safe<{ full_name: string | null }>(
      supabase.from('profiles').select('full_name').eq('id', opts.userId).maybeSingle() as never,
    ),
    opts.nodeId
      ? safe<{
          code: string | null
          name: string | null
          shop_number: string | null
          shop_name: string | null
          incomer_breaker_a: number | null
          incomer_pole_config: string | null
        }>(
          supabase
            .schema('structure')
            .from('nodes')
            .select('code, name, shop_number, shop_name, incomer_breaker_a, incomer_pole_config')
            .eq('id', opts.nodeId)
            .maybeSingle(),
        )
      : Promise.resolve(null),
  ])

  let feed: PrefillSources['feed'] = null
  let downstream: PrefillSources['downstream'] = []

  if (csNodeId) {
    const revisionId = await currentRevisionId(supabase, opts.projectId)
    if (revisionId) {
      // What feeds this board (SANS 6.6.1.21(a) — the label to verify against).
      const feedRows = await safe<
        { voltage_v: number | null; section: string | null; from_node_id: string | null }[]
      >(
        supabase
          .schema('cable_schedule')
          .from('supplies')
          .select('voltage_v, section, from_node_id')
          .eq('revision_id', revisionId)
          .eq('to_node_id', csNodeId)
          .limit(1),
      )
      if (feedRows && feedRows.length > 0) {
        const f = feedRows[0]
        const fromNode = f.from_node_id
          ? await safe<{ code: string | null }>(
              supabase
                .schema('structure')
                .from('nodes')
                .select('code')
                .eq('id', f.from_node_id)
                .maybeSingle(),
            )
          : null
        feed = {
          fromBoardCode: fromNode?.code ?? null,
          voltage_v: f.voltage_v,
          section: f.section,
        }
      }

      // What this board feeds — one candidate circuit row each.
      const supplies = await safe<{ id: string; to_node_id: string | null }[]>(
        supabase
          .schema('cable_schedule')
          .from('supplies')
          .select('id, to_node_id')
          .eq('revision_id', revisionId)
          .eq('from_node_id', csNodeId),
      )
      if (supplies && supplies.length > 0) {
        const supplyIds = supplies.map((x) => x.id)
        const toIds = supplies.map((x) => x.to_node_id).filter((x): x is string => Boolean(x))

        const [cables, nodes] = await Promise.all([
          safe<{ supply_id: string; size_mm2: number | null; cores: string | null; armour: string | null }[]>(
            supabase
              .schema('cable_schedule')
              .from('cables')
              .select('supply_id, size_mm2, cores, armour')
              .in('supply_id', supplyIds),
          ),
          toIds.length
            ? safe<{ id: string; code: string | null; name: string | null }[]>(
                supabase
                  .schema('structure')
                  .from('nodes')
                  .select('id, code, name')
                  .in('id', toIds),
              )
            : Promise.resolve([]),
        ])

        const cableBySupply = new Map((cables ?? []).map((c) => [c.supply_id, c]))
        const nodeById = new Map((nodes ?? []).map((n) => [n.id, n]))

        downstream = supplies
          .map((sup) => {
            const n = sup.to_node_id ? nodeById.get(sup.to_node_id) : undefined
            const c = cableBySupply.get(sup.id)
            return {
              code: n?.code ?? null,
              name: n?.name ?? null,
              size_mm2: c?.size_mm2 ?? null,
              cores: c?.cores ?? null,
              armour: c?.armour ?? null,
            }
          })
          // A row with no identity is not a usable circuit line.
          .filter((d) => d.code !== null || d.name !== null)
          .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }))
      }
    }
  }

  return buildPrefill({
    project: project
      ? {
          name: project.name,
          code: project.code,
          client_name: project.client_name,
          address: project.address,
          city: project.city,
          province: project.province,
        }
      : null,
    organisation,
    userFullName: userRow?.full_name ?? null,
    node,
    feed,
    downstream,
    formNo: opts.formNo,
    todayISO: new Date().toISOString().slice(0, 10),
  })
}

/** True when the project has a cable-schedule revision at all. */
export async function projectHasCableSchedule(
  supabase: AnyClient,
  projectId: string,
): Promise<boolean> {
  return (await currentRevisionId(supabase, projectId)) !== null
}

/** True when this specific board appears in the current cable schedule. */
export async function nodeIsInCableSchedule(
  supabase: AnyClient,
  projectId: string,
  nodeId: string,
): Promise<boolean> {
  const revisionId = await currentRevisionId(supabase, projectId)
  if (!revisionId) return false
  const rows = await safe<{ id: string }[]>(
    supabase
      .schema('cable_schedule')
      .from('supplies')
      .select('id')
      .eq('revision_id', revisionId)
      .or(`to_node_id.eq.${nodeId},from_node_id.eq.${nodeId}`)
      .limit(1),
  )
  return Boolean(rows && rows.length > 0)
}
