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
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/supplier/catalogue"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Catalogue
        </Link>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Edit: {item.name}</h1>
          <p className="page-subtitle">Update pricing, availability, and item details.</p>
        </div>
      </div>
      <CatalogueItemForm item={item as any} />
    </div>
  )
}
