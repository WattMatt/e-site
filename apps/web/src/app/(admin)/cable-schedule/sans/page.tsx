import { redirect } from 'next/navigation'

/** The SANS reference library moved to /standards (edition-aware, cited). */
export default function SansReferenceMovedPage(): never {
  redirect('/standards')
}
