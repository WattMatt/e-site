'use client'

import type { JbccClause } from '@esite/shared'

interface Props { clauses: JbccClause[] }

export function ClauseRegister({ clauses }: Props) {
  return (
    <div className="px-6 py-8">
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 dark:bg-zinc-900/30 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Clause</th>
              <th className="px-3 py-2 font-medium">Contract</th>
              <th className="px-3 py-2 font-medium">Topic</th>
              <th className="px-3 py-2 font-medium">Time-bar</th>
              <th className="px-3 py-2 font-medium">Linked notice</th>
            </tr>
          </thead>
          <tbody>
            {clauses.map(c => (
              <tr key={c.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {c.clause_ref}
                </td>
                <td className="px-3 py-2 text-xs opacity-70 whitespace-nowrap">
                  {c.contract}
                </td>
                <td className="px-3 py-2">{c.topic}</td>
                <td className="px-3 py-2 text-xs opacity-70">{c.time_bar}</td>
                <td className="px-3 py-2 text-xs opacity-70">{c.linked_notice}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
