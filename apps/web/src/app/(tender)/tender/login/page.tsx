import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { TenderSignIn } from '../../_components/TenderSignIn'

export const dynamic = 'force-dynamic'

export default async function TenderLoginPage({ searchParams }: { searchParams: Promise<{ k?: string; t?: string; e?: string }> }) {
  const { k, t, e } = await searchParams
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Your tenders</span></CardHeader>
      <CardBody>
        <p style={{ marginTop: 0, fontSize: 14 }}>
          There is no password. Enter the email address your invitation was sent to and we will email you a link and a 6-digit code.
          New here? Open the invitation email you received and press <strong>Open my invitation</strong>.
        </p>
        <TenderSignIn access={k && t ? { k, t } : null} initialEmail={e ?? ''} />
      </CardBody>
    </Card>
  )
}
