import { Card, CardHeader, CardBody } from '@/components/ui/Card'

interface Props {
  title: string
  description: string
}

export function Placeholder({ title, description }: Props) {
  return (
    <Card>
      <CardHeader>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--c-text-mid)' }}>{description}</p>
      </CardHeader>
      <CardBody>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--c-text-mid)' }}>
          Coming soon — this sub-page lands in a Phase-2 PR.
        </p>
      </CardBody>
    </Card>
  )
}
