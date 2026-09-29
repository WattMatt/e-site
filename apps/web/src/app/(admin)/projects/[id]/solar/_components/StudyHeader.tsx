import type { CSSProperties } from 'react'
import { Card, CardBody } from '@/components/ui/Card'

const DT: CSSProperties = { fontSize: 11, color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }
const DD: CSSProperties = { margin: '2px 0 0', fontSize: 13, color: 'var(--c-text)' }

/**
 * Study header (spec §2.1 item 1). The tariff and the selected case are shown
 * "if chosen" — neither can exist in Phase 1 (tariffs: Phase 2, cases: Phase 6),
 * so they are not rendered.
 */
export function StudyHeader({
  projectName,
  address,
  supplyAuthority,
}: {
  projectName: string
  address: string | null
  supplyAuthority: string | null
}) {
  return (
    <Card>
      <CardBody>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, margin: 0 }}>
          <div><dt style={DT}>Project</dt><dd style={DD}>{projectName}</dd></div>
          <div><dt style={DT}>Site address</dt><dd style={DD}>{address ?? 'No address on the project'}</dd></div>
          <div><dt style={DT}>Supply authority</dt><dd style={DD}>{supplyAuthority ?? 'Not set — add it on Site & Supply'}</dd></div>
        </dl>
      </CardBody>
    </Card>
  )
}
