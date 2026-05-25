'use client'

import type { JbccTimeBar } from '@esite/shared'

interface Props { timebars: JbccTimeBar[] }

export function TimeBarSchedule({ timebars }: Props) {
  return (
    <div className="px-6 py-8">
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/30 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Clause</th>
              <th className="px-3 py-2 font-medium">Period</th>
              <th className="px-3 py-2 font-medium">Parties</th>
              <th className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {timebars.map(t => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{t.clause}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{t.time_period}</td>
                <td className="px-3 py-2 text-xs opacity-70">{t.parties}</td>
                <td className="px-3 py-2">{t.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
