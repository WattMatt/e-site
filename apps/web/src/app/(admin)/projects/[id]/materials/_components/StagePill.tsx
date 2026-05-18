import type { Stage } from '@esite/shared'

const LABEL: Record<Stage, string> = {
  plan: 'Plan',
  quote: 'Quote',
  order: 'Order',
  deliver: 'Deliver',
  pay: 'Pay',
}

export function StagePill({ stage }: { stage: Stage }) {
  return (
    <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>
      Also: {LABEL[stage]}
    </span>
  )
}
