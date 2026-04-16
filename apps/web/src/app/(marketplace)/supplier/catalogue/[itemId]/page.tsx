import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CatalogueItemForm } from '../CatalogueItemForm'

interface Props { params: Promise<{ itemId: string }> }

export default async function EditCatalogueItemPage({ params }: Props) {
  const { itemId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: item } = await supabase
    .schema('marketplace')
    .from('catalogue_items')
    .select('*')
    .eq('id', itemId)
    .single()

  if (!item) notFound()

  return (
    <div>
      <div className="mb-6">
        <Link href="/supplier/catalogue" className="text-slate-400 hover:text-white text-sm">← Catalogue</Link>
      </div>
      <h1 className="text-xl font-bold text-white mb-6">Edit: {item.name}</h1>
      <CatalogueItemForm item={item as any} />
    </div>
  )
}
