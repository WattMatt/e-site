/**
 * POST /api/medium-voltage/study
 *
 * Heavy-compute route for the MV protection study (spec §7). Runs the full
 * Z-bus three-phase + zero-sequence earth-fault solve for a revision and caches
 * the per-node results — kept out of a server action to dodge action timeouts.
 *
 * Body: { revisionId }
 * Flow:
 *   1. Resolve the revision's org + status, gate with requireRoleAPI(ORG_WRITE_ROLES).
 *   2. Refuse non-DRAFT (this WRITES fault_results — an ISSUED snapshot is frozen).
 *   3. loadStudyGraph → buildMvNetwork → faultsForNetwork + earthFaultForNetwork.
 *   4. Merge per node (ik3 max/min + xr + ip from faults; ik1 max/min + ic_amps
 *      from earth faults) and saveFaultResults.
 *   5. Return { data: { nodeCount, computedAt } }.
 *
 * Discrimination/coordination compute is DEFERRED — it needs the upstream/
 * downstream device-pairing design (no pairing model exists yet); see the
 * TODO Phase 4b note below. Do not invent pairing here.
 */

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { requireRoleAPI } from '@/lib/auth/require-role'
import {
  mvProtectionService,
  buildMvNetwork,
  faultsForNetwork,
  earthFaultForNetwork,
  ORG_WRITE_ROLES,
  type FaultResultRow,
} from '@esite/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { revisionId?: string } | null
  const revisionId = body?.revisionId
  if (!revisionId) {
    return NextResponse.json({ error: 'revisionId is required' }, { status: 400 })
  }

  // Resolve the revision's org + status (so the role gate is against the
  // revision's org, not the caller's primary org) and refuse frozen revisions.
  const supabase = await createClient()
  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, status, project_id, organisation_id')
    .eq('id', revisionId)
    .maybeSingle()
  if (!rev) return NextResponse.json({ error: 'Revision not found' }, { status: 404 })
  if (rev.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Revision is ISSUED — start a new revision to recompute.' },
      { status: 422 },
    )
  }

  const guard = await requireRoleAPI(ORG_WRITE_ROLES, rev.organisation_id as string)
  if (!guard.ok) return guard.response

  // Load the graph + settings and solve.
  const graph = await mvProtectionService.loadStudyGraph(supabase as any, revisionId)
  if (!graph) return NextResponse.json({ error: 'Revision not found' }, { status: 404 })

  const net = buildMvNetwork(graph.input)
  const faults = faultsForNetwork(net)
  const earthFaults = earthFaultForNetwork(net)

  // Merge per node into fault_results rows. Every bus in the network is a node;
  // ik3 max/min + xr + ip come from the three-phase solve, ik1 max/min + ic_amps
  // from the earth-fault solve. basis carries the engine's governance stamp.
  const rows: FaultResultRow[] = net.buses.map((bus) => {
    const f = faults[bus.id]
    const ef = earthFaults[bus.id]
    return {
      nodeId: bus.id,
      ik3MaxKa: f && !f.islanded ? f.ik3MaxKa : null,
      ik3MinKa: f && !f.islanded ? f.ik3MinKa : null,
      xrRatio: f && !f.islanded ? f.xrRatio : null,
      ipKa: f && !f.islanded ? f.ipKa : null,
      ik1MaxKa: ef && !('noEarthPath' in ef) ? ef.ik1Ka : null,
      ik1MinKa: ef && !('noEarthPath' in ef) ? ef.ik1MinKa : null,
      icAmps: ef && 'noEarthPath' in ef ? (ef.icAmps ?? null) : null,
      basis: (f?.basis ?? ef?.basis) ?? 'sandbox — not for issue',
    }
  })

  // TODO Phase 4b: discrimination pairing — compute discrimination_checks over the
  // protection_devices register once the upstream/downstream device-pairing design
  // exists (which feeder protects which, walking the supply graph). No pairing model
  // is defined yet; do NOT invent one here. coordinateStudy() (mv-coordination.service)
  // is the engine entry point once pairs are resolved.

  try {
    const nodeCount = await mvProtectionService.saveFaultResults(
      supabase as any,
      revisionId,
      graph.organisationId,
      rows,
    )
    revalidatePath(`/projects/${graph.projectId}/medium-voltage/${revisionId}`)
    return NextResponse.json({ data: { nodeCount, computedAt: new Date().toISOString() } })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save fault results' },
      { status: 500 },
    )
  }
}
