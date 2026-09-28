import { Check } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'

const FEATURES = [
  'Tariff library',
  'Meter-data load modelling',
  'Schematics',
  'PV layout on project drawings with 3D',
  'Yield & battery simulation',
  'Financial model (cash / debt / PPA / lease)',
  'Feasibility reports',
  'Client proposals with e-acceptance',
  'Schedule',
  'Operations',
]

export function FeatureSummary() {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">What Solar does</span></CardHeader>
      <CardBody>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {FEATURES.map((f) => (
            <li key={f} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--c-text-mid)' }}>
              <Check size={14} style={{ color: 'var(--c-green)', marginTop: 2 }} aria-hidden="true" />
              {f}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
