/**
 * Equipment Schedule — redirect shim.
 *
 * The Equipment Schedule + Materials tabs were merged into one board-centric
 * tab, "Equipment & Materials" (/projects/[id]/equipment-materials). This route
 * is kept only to redirect existing links/bookmarks; all equipment management
 * (add/edit/decommission) now lives inline on the unified tab.
 */

import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

export default async function EquipmentScheduleRedirect({ params }: Props) {
  const { id } = await params
  redirect(`/projects/${id}/equipment-materials`)
}
