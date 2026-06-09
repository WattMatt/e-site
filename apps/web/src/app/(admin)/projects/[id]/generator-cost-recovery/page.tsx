import { loadGcrConfigAction } from './gcr.actions'
import { GcrTabs } from './GcrTabs'

interface Props {
  params: Promise<{ id: string }>
}

export default async function GeneratorCostRecoveryPage({ params }: Props) {
  const { id } = await params

  const result = await loadGcrConfigAction(id)

  if ('error' in result) {
    return (
      <div className="animate-fadeup">
        <div className="page-header">
          <div>
            <h1 className="page-title">Generator Cost-Recovery</h1>
          </div>
        </div>
        <div className="data-panel">
          <div
            className="data-panel-empty"
            style={{ padding: '48px 18px', textAlign: 'center' }}
          >
            {result.error === 'Forbidden' || result.error.toLowerCase().includes('forbidden')
              ? 'You do not have permission to view generator cost-recovery for this project.'
              : 'Not found or not authorised.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Generator Cost-Recovery</h1>
          <p className="page-subtitle">
            Configure recovery rates, capital costs, and tenant assignments
          </p>
        </div>
      </div>

      <GcrTabs projectId={id} data={result} />
    </div>
  )
}
