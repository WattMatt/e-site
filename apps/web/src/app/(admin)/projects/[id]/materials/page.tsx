/**
 * Materials — redirect shim.
 *
 * The Materials + Equipment Schedule tabs were merged into one board-centric
 * tab, "Equipment & Materials" (/projects/[id]/equipment-materials). This route
 * is kept only to redirect existing links/bookmarks; the procurement buy-list
 * now lives on the unified tab.
 */

import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

export default async function MaterialsRedirect({ params }: Props) {
  const { id } = await params
  redirect(`/projects/${id}/equipment-materials`)
}
