import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { TenderSignIn } from '../../_components/TenderSignIn'

export const dynamic = 'force-dynamic'

export default function TenderLoginPage() {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Sign in to your tender</span></CardHeader>
      <CardBody>
        <p style={{ marginTop: 0, fontSize: 14 }}>
          Enter the email address your invitation was sent to. We will email you a sign-in link.
        </p>
        <TenderSignIn />
      </CardBody>
    </Card>
  )
}
