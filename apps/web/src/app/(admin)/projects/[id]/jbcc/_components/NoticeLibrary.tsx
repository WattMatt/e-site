'use client'

import Link from 'next/link'
import type { JbccNotice } from '@esite/shared'

const CATEGORY_ORDER = [
  'Changes, Delays & Site Conditions',
  'Financial & Security',
  'Performance & Administrative',
  'Subcontract',
  'Suspension & Termination',
  'Dispute Resolution',
] as const

interface Props {
  projectId: string
  notices: JbccNotice[]
}

export function NoticeLibrary({ projectId, notices }: Props) {
  const byCategory = new Map<string, JbccNotice[]>()
  for (const n of notices) {
    const bucket = byCategory.get(n.category) ?? []
    bucket.push(n)
    byCategory.set(n.category, bucket)
  }

  return (
    <div className="px-6 py-8 space-y-10">
      {CATEGORY_ORDER.filter(c => byCategory.has(c)).map(category => (
        <section key={category}>
          <h3 className="text-xs uppercase tracking-wider opacity-60 mb-3">
            {category}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {byCategory.get(category)!.map(n => (
              <Link
                key={n.code}
                href={`/projects/${projectId}/jbcc/notice/${n.code}`}
                className="border rounded-lg p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition block"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-mono opacity-60">{n.code}</span>
                  <span className="text-xs opacity-40">·</span>
                  <span className="text-xs opacity-60">
                    {n.time_bar_days !== null
                      ? `${n.time_bar_days} ${n.time_bar_unit}`
                      : 'see rule'}
                  </span>
                </div>
                <div className="text-sm font-medium leading-snug">{n.title}</div>
                <div className="text-xs opacity-60 mt-1.5">cl. {n.triggering_clause}</div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
