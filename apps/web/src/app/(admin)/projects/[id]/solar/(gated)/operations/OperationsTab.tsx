/**
 * Operations tab (spec §10). Composes the cards from ONE server-built view model; money (the monthly
 * report panel) renders only at Edit + financials. Anything handed to a client card is JSON.
 */
import type { OperationsView } from '@/lib/solar/operations/data'
import { InstallationCard } from './InstallationCard'
import { MetersCard } from './MetersCard'
import { GuaranteeCard } from './GuaranteeCard'
import { PerformanceTable } from './PerformanceTable'
import { IrradiationCard } from './IrradiationCard'
import { DowntimeLog } from './DowntimeLog'
import { MonthlyReportPanel } from './MonthlyReportPanel'
import { HandoverChecklist } from './HandoverChecklist'

export function OperationsTab({ projectId, view }: { projectId: string; view: OperationsView }) {
  if (!view.installation) {
    return (
      <InstallationCard projectId={projectId} canEdit={view.canEdit} installation={null}
        acceptedProposal={view.acceptedProposal} setupReason={view.setupReason} setupAction={view.setupAction} />
    )
  }
  const inst = view.installation
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <InstallationCard projectId={projectId} canEdit={view.canEdit} installation={inst} acceptedProposal={null} setupReason={null} />
      <MetersCard projectId={projectId} installationId={inst.id} organisationId={view.organisationId ?? ''} canEdit={view.canEdit}
        meters={view.meters} availableMeters={view.availableMeters} shareNote={view.shareNote} />
      <GuaranteeCard projectId={projectId} installationId={inst.id} canEdit={view.canEdit} guarantee={view.guarantee} />
      <PerformanceTable projectId={projectId} rows={view.performance} selectedMonth={view.selectedMonth} note={view.performanceNote} />
      <IrradiationCard projectId={projectId} installationId={inst.id} canEdit={view.canEdit} entries={view.irradiation} />
      <DowntimeLog projectId={projectId} installationId={inst.id} canEdit={view.canEdit} downtime={view.downtime}
        candidates={view.candidates} selectedMonth={view.selectedMonth} />
      {view.canSeeMoney && view.monthly
        ? <MonthlyReportPanel projectId={projectId} installationId={inst.id} month={view.selectedMonth} monthly={view.monthly} />
        : null}
      <HandoverChecklist projectId={projectId} installationId={inst.id} canEdit={view.canEdit} handover={view.handover} />
    </div>
  )
}
