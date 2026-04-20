import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CatalogueItemForm } from '../CatalogueItemForm'

export default async function NewCatalogueItemPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/supplier/catalogue/new')

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
          <h1 className="page-title">Add Catalogue Item</h1>
          <p className="page-subtitle">Publish a new item to the E-Site marketplace.</p>
        </div>
      </div>
      <CatalogueItemForm />
    </div>
  )
}
