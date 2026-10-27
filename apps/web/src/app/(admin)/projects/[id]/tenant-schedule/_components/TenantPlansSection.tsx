/**
 * "Tenant plans" on the tenant schedule (spec 2026-10-12 §2): exactly two cards,
 * Floor plan and Line diagram. Server-renderable (links only, no state).
 * Writers get Upload (nothing loaded) or Open + Upload / Replace; every other
 * role gets Open when something is loaded.
 */
import Link from 'next/link'
import type { StatusPlanPurpose } from '@esite/shared/status-plans'
import { tenantPlanHref } from '@/lib/status-plans/plan-urls'
import type { TenantPlanCard } from '@/lib/status-plans/plan-cards'

const COPY: Record<StatusPlanPurpose, { title: string; blurb: string; linked: string }> = {
  tenant_layout: { title: 'Floor plan', blurb: 'Upload the floor plan, then mask and link shops.', linked: 'shops linked' },
  distribution_schematic: { title: 'Line diagram', blurb: 'Upload the 300 schematic, then detect DB blocks and colour them by order status.', linked: 'boards linked' },
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const button = {
  border: '1px solid var(--c-border)', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 600,
  textDecoration: 'none', color: 'var(--c-text)', whiteSpace: 'nowrap',
} as const

export function TenantPlansSection({ projectId, cards, canWrite }: { projectId: string; cards: TenantPlanCard[]; canWrite: boolean }) {
  return (
    <section aria-labelledby="tenant-plans-heading" style={{ marginBottom: 16 }}>
      <h2 id="tenant-plans-heading" style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>Tenant plans</h2>
      <div className="stack-on-phone" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {cards.map((c) => {
          const copy = COPY[c.purpose]
          const href = tenantPlanHref(projectId, c.purpose)
          const loaded = c.sheets > 0
          return (
            <article key={c.purpose} aria-label={copy.title} className="data-panel" style={{ padding: 16, display: 'grid', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{copy.title}</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)' }}>{copy.blurb}</p>
              <p style={{ margin: 0, fontSize: 13, fontFamily: loaded ? 'var(--font-mono)' : undefined, color: 'var(--c-text-mid)' }}>
                {loaded ? `${plural(c.sheets, 'sheet')} · ${plural(c.shapes, 'shape')} · ${c.linked} ${copy.linked}` : 'Nothing uploaded yet.'}
              </p>
              {(loaded || canWrite) && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {loaded && <Link href={href} style={button}>Open</Link>}
                  {canWrite && <Link href={href} style={button}>{loaded ? 'Upload / Replace' : 'Upload'}</Link>}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
