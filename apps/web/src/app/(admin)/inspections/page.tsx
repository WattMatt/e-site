// The org-level inspections area is the template library; real inspections
// are tracked per-project under /projects/[id]/inspections.
import { redirect } from 'next/navigation'

export default function InspectionsIndexPage() {
  redirect('/inspections/templates')
}
