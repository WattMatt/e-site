import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CatalogueItemForm } from '../CatalogueItemForm'

export default async function NewCatalogueItemPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/supplier/catalogue/new')

  return (
    <div>
      <div className="mb-6">
        <Link href="/supplier/catalogue" className="text-slate-400 hover:text-white text-sm">← Catalogue</Link>
      </div>
      <h1 className="text-xl font-bold text-white mb-6">Add Catalogue Item</h1>
      <CatalogueItemForm />
    </div>
  )
}
