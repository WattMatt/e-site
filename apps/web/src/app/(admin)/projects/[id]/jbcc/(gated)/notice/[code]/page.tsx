import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getNotice, getNoticeFields } from '@esite/shared'

interface PageProps {
  params: Promise<{ id: string; code: string }>
}

export default async function NoticeDetailPage({ params }: PageProps) {
  const { id: projectId, code } = await params
  const supabase = await createClient()

  const notice = await getNotice(supabase, code)
  if (!notice) notFound()

  const fields = await getNoticeFields(supabase, notice.id)
  const manualFields = fields.filter(f => f.source === 'manual')

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <Link
        href={`/projects/${projectId}/jbcc`}
        className="text-sm opacity-60 hover:opacity-100 inline-block mb-3"
      >
        ← Notice library
      </Link>

      <header className="mb-6">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-sm opacity-60">{notice.code}</span>
          <h1 className="text-xl font-semibold">{notice.title}</h1>
        </div>
        <p className="text-sm opacity-60 mt-1">
          {notice.from_party} → {notice.to_party} · {notice.contract} {notice.edition}
        </p>
      </header>

      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 text-sm mb-8">
        <div>
          <dt className="opacity-60 text-xs uppercase tracking-wide mb-1">Triggering clause</dt>
          <dd>{notice.triggering_clause}</dd>
        </div>
        <div>
          <dt className="opacity-60 text-xs uppercase tracking-wide mb-1">Time-bar</dt>
          <dd>{notice.time_bar_text}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="opacity-60 text-xs uppercase tracking-wide mb-1">Purpose</dt>
          <dd>{notice.purpose}</dd>
        </div>
        <div className="md:col-span-2">
          <dt className="opacity-60 text-xs uppercase tracking-wide mb-1">
            Consequence of failure to issue
          </dt>
          <dd className="text-amber-700 dark:text-amber-400">{notice.consequence_of_failure}</dd>
        </div>
      </dl>

      <div className="mb-10">
        <Link
          href={`/projects/${projectId}/jbcc/notice/${notice.code}/new`}
          className="inline-block px-5 py-2 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700"
        >
          Generate letter
        </Link>
      </div>

      {manualFields.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-3">
            Fields the contractor fills in
          </h2>
          <ul className="text-sm space-y-1">
            {manualFields.map(f => (
              <li key={f.id} className="border-l-2 border-amber-600/40 pl-3 py-1.5">
                <span className="font-medium">{f.label}</span>
                <span className="opacity-50 text-xs ml-2">({f.field_type})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
