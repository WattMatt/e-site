import type { Metadata } from 'next'
import { DataRequestForm } from './DataRequestForm'
import { H1, P, LastUpdated } from '@/components/layout/LegalPlaceholder'

export const metadata: Metadata = {
  title: 'Data subject request — E-Site',
  description: 'Request access to, correction of, or deletion of your personal data held by E-Site.',
}

export default function DataRequestPage() {
  return (
    <div>
      <H1>Data subject request</H1>
      <LastUpdated iso="2026-04-19" />
      <P>
        Under the Protection of Personal Information Act (POPIA) you have the right to ask us
        what personal information we hold about you, to correct it, or to ask us to delete it.
        Submit the form below and our Information Officer will respond within 30 days.
      </P>
      <P>
        Prefer email? Write to{' '}
        <a href="mailto:arno@watsonmattheus.com" style={{ color: 'var(--c-text-mid)' }}>
          arno@watsonmattheus.com
        </a>
        {' '}— our appointed Information Officer is Arno Mattheus.
      </P>
      <DataRequestForm />
    </div>
  )
}
