/**
 * /projects/[id]/settings → /projects/[id]/settings/general
 *
 * The shell has no "default content" — every visit lands on a specific
 * sub-page. Redirect to the most-viewed one (general).
 */

import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

export default async function SettingsRoot({ params }: Props) {
  const { id } = await params
  redirect(`/projects/${id}/settings/general`)
}
