import { redirect } from 'next/navigation'
import { getSolarAccessLevel } from '@/lib/solar/access'

export const dynamic = 'force-dynamic'

/** Sidebar target: into the module when the caller has a level, else the locked screen. */
export default async function SolarIndexPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const level = await getSolarAccessLevel(id)
  redirect(level ? `/projects/${id}/solar/overview` : `/projects/${id}/solar/locked`)
}
