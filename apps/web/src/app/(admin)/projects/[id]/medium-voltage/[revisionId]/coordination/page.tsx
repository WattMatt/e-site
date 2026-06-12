import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { TableScrollX } from '@/components/ui/TableScrollX'
import {
  projectService,
  mvProtectionService,
  tccSeries,
  IEC_CONSTANTS,
  IEEE_CONSTANTS,
  ORG_WRITE_ROLES,
  type DeviceModel,
  type IecCurve,
  type IeeeCurve,
  type ProtectionDeviceSettings,
} from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { requireMvAccess } from '@/lib/mv-access'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { SandboxNotice } from '@/components/mv/SandboxNotice'
import { TccPlot, type TccSeries } from '@/components/mv/TccPlot'
import { RevisionStatusBadge } from '../../../cables/[revisionId]/RevisionStatusBadge'

export const metadata: Metadata = { title: 'MV coordination' }

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string; revisionId: string }>
}

const COLORS = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be185d']

/**
 * A stored device → an engine DeviceModel for plotting, or null when it can't be
 * curved. tccSeries → iecTime/ieeeTime THROWS (CurveError) on a missing/unknown
 * curve, which would crash this server render, so an IEC/IEEE device is skipped
 * unless its `settings.curve` is a real key in the engine's constant tables. DT
 * devices need no curve. A device with no positive pickup is also skipped (Is is
 * required). The form already constrains these — this guards stale/partial JSONB.
 */
function toDeviceModel(label: string, id: string, settings: ProtectionDeviceSettings): DeviceModel | null {
  const pickupA = settings.pickupA
  if (pickupA == null || !(pickupA > 0)) return null
  const std = settings.std === 'IEEE' ? 'IEEE' : settings.std === 'DT' ? 'DT' : 'IEC'
  let curve: IecCurve | IeeeCurve | undefined
  if (std === 'IEC') {
    if (settings.curve == null || !(settings.curve in IEC_CONSTANTS)) return null
    curve = settings.curve as IecCurve
  } else if (std === 'IEEE') {
    if (settings.curve == null || !(settings.curve in IEEE_CONSTANTS)) return null
    curve = settings.curve as IeeeCurve
  }
  return {
    id,
    label,
    std,
    curve,
    pickupA,
    tms: settings.tms,
    td: settings.td,
    dtS: settings.dtS,
    instMultiple: settings.instMultiple,
    instTimeS: settings.instTimeS,
  }
}

export default async function CoordinationPage({ params }: Props) {
  const { id: projectId, revisionId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) redirect(`/projects/${projectId}/cables/${revisionId}`)

  // Per-user MV paywall (Phase 7). Server-side gate on every MV route; the
  // mv-unlock page itself is exempt.
  const { data: { user } } = await supabase.auth.getUser()
  if (user) await requireMvAccess(supabase, user.id, `/projects/${projectId}/medium-voltage/${revisionId}/mv-unlock`)

  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .single()
  if (!rev) notFound()

  const [devices, checks, { data: nodesData }] = await Promise.all([
    mvProtectionService.listProtectionDevices(supabase as never, revisionId),
    mvProtectionService.listDiscriminationChecks(supabase as never, revisionId),
    supabase
      .schema('structure')
      .from('nodes')
      .select('id, code')
      .eq('project_id', projectId)
      .is('deleted_at' as never, null),
  ])

  const nodeCode = new Map<string, string>()
  for (const n of (nodesData ?? []) as Array<{ id: string; code: string }>) nodeCode.set(n.id, n.code)
  const deviceLabel = (d: (typeof devices)[number]): string => {
    const where = d.nodeId ? nodeCode.get(d.nodeId) ?? '' : ''
    return [d.manufacturer, d.model].filter(Boolean).join(' ') || where || `${d.deviceType} (${d.deviceRole})`
  }
  const deviceLabelById = new Map(devices.map((d) => [d.id, deviceLabel(d)] as const))

  // Build plottable models; pickup-less devices are listed but not curved.
  const models = devices
    .map((d) => ({ device: d, model: toDeviceModel(deviceLabel(d), d.id, d.settings) }))
    .filter((m): m is { device: (typeof devices)[number]; model: DeviceModel } => m.model != null)

  // Plot bounds from the device pickups (1.05× lowest pickup → 20× highest, a
  // sensible default span when no fault markers are available yet).
  const pickups = models.map((m) => m.model.pickupA)
  const minA = pickups.length ? Math.max(1, Math.min(...pickups) * 1.05) : 10
  const maxA = pickups.length ? Math.max(...pickups) * 20 : 10000

  const series: TccSeries[] = models.map((m, i) => ({
    label: m.model.label,
    color: COLORS[i % COLORS.length],
    points: tccSeries(m.model, { minA, maxA, points: 240 }),
  }))

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables/${revisionId}`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em',
          }}
        >
          ← {rev.code} · {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Coordination<RevisionStatusBadge status={rev.status} /></h1>
          <p className="page-subtitle">
            {rev.code} · {series.length} curve{series.length !== 1 ? 's' : ''} plotted ·
            {' '}log-log time–current characteristics
          </p>
        </div>
        <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Link
            href={`/projects/${projectId}/medium-voltage/${revisionId}/protection`}
            style={{
              background: 'var(--c-panel)', border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)', borderRadius: 6, padding: '9px 16px',
              fontSize: 13, textDecoration: 'none',
            }}
          >
            🛡 Devices
          </Link>
        </div>
      </div>

      <SandboxNotice />

      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Time–current curves (log-log)
          </span>
        </CardHeader>
        <CardBody>
          {series.length === 0 ? (
            <div style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--c-text-dim)', fontSize: 13 }}>
              📈 No curves to plot yet. Add{' '}
              <Link href={`/projects/${projectId}/medium-voltage/${revisionId}/protection`} style={{ color: 'var(--c-amber)' }}>protection devices</Link>{' '}
              with a curve standard + pickup setting, and they appear here.
            </div>
          ) : (
            <TccPlot series={series} />
          )}
        </CardBody>
      </Card>

      <div style={{ marginTop: 20 }}>
        <Card>
          <CardHeader>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>Discrimination</span>
          </CardHeader>
          <CardBody>
            {checks.length === 0 ? (
              <div style={{
                padding: '14px 16px', borderRadius: 6,
                background: 'var(--c-base)', border: '1px dashed var(--c-border)',
                fontSize: 13, color: 'var(--c-text-mid)',
              }}>
                ⏳ <strong>Discrimination pairing pending (Phase 4b).</strong> The upstream/downstream
                device-pairing model isn&apos;t built yet, so no margins are computed. Once pairing lands,
                the study route will populate this table with per-pair margins coloured ok / marginal / fails.
              </div>
            ) : (
              <TableScrollX>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--c-base)' }}>
                      <Th>Upstream</Th>
                      <Th>Downstream</Th>
                      <Th align="right">Fault (A)</Th>
                      <Th align="right">t down (s)</Th>
                      <Th align="right">t up (s)</Th>
                      <Th align="right">Margin (ms)</Th>
                      <Th>Verdict</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.map((c) => (
                      <tr key={c.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                        <Td>{deviceLabelById.get(c.upstreamDeviceId) ?? c.upstreamDeviceId.slice(0, 8)}</Td>
                        <Td>{deviceLabelById.get(c.downstreamDeviceId) ?? c.downstreamDeviceId.slice(0, 8)}</Td>
                        <Td align="right" mono>{c.atFaultA ?? '—'}</Td>
                        <Td align="right" mono>{c.tDownS == null ? '—' : c.tDownS.toFixed(3)}</Td>
                        <Td align="right" mono>{c.tUpS == null ? '—' : c.tUpS.toFixed(3)}</Td>
                        <Td align="right" mono>{c.marginMs == null ? '—' : c.marginMs.toFixed(0)}</Td>
                        <Td>
                          <span className={verdictClass(c.verdict)}>{c.verdict}</span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScrollX>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function verdictClass(v: 'ok' | 'marginal' | 'fails'): string {
  return v === 'ok' ? 'badge badge-green' : v === 'marginal' ? 'badge badge-amber' : 'badge badge-red'
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left', padding: '10px 12px',
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--c-text-dim)',
      fontWeight: 600, whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({
  children, align, mono,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean
}) {
  return (
    <td style={{
      textAlign: align ?? 'left', padding: '8px 12px', verticalAlign: 'middle',
      fontFamily: mono ? 'var(--font-mono)' : undefined,
      fontSize: 12, color: 'var(--c-text)', whiteSpace: 'nowrap',
    }}>{children}</td>
  )
}
