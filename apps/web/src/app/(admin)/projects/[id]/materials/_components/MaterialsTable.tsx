import { ReactNode } from 'react'
import type { EnrichedItem, Stage } from '@esite/shared'
import { secondaryStages } from '@esite/shared'
import { StagePill } from './StagePill'

export type Column = {
  key: string
  label: string
  align?: 'left' | 'right' | 'center'
  width?: string
  cell: (item: EnrichedItem) => ReactNode
}

type Props = {
  items: EnrichedItem[]
  columns: Column[]
  primaryStage: Stage
  expand?: (item: EnrichedItem) => ReactNode
  emptyMessage?: string
}

export function MaterialsTable({ items, columns, primaryStage, expand, emptyMessage }: Props) {
  if (items.length === 0) {
    return (
      <div className="data-panel data-panel-empty" style={{ padding: '1.5rem', textAlign: 'center' }}>
        {emptyMessage ?? 'No items in this stage.'}
      </div>
    )
  }

  return (
    <div className="data-panel" style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--c-border)', textAlign: 'left' }}>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--c-text-dim)',
                  textAlign: c.align ?? 'left',
                  width: c.width,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ItemRow key={item.id} item={item} columns={columns} expand={expand} primaryStage={primaryStage} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ItemRow({
  item,
  columns,
  expand,
  primaryStage,
}: {
  item: EnrichedItem
  columns: Column[]
  expand?: (item: EnrichedItem) => ReactNode
  primaryStage: Stage
}) {
  const secondary = secondaryStages(item).filter((s) => s !== primaryStage)
  return (
    <>
      <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
        {columns.map((c, idx) => (
          <td
            key={c.key}
            style={{
              padding: '0.5rem 0.75rem',
              verticalAlign: 'top',
              textAlign: c.align ?? 'left',
            }}
          >
            {c.cell(item)}
            {idx === 0 && secondary.map((s) => <StagePill key={s} stage={s} />)}
          </td>
        ))}
      </tr>
      {expand && (
        <tr>
          <td colSpan={columns.length} style={{ padding: '0.5rem 0.75rem', background: 'var(--c-elevated)' }}>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: 'var(--c-amber)' }}>
                Open details
              </summary>
              <div style={{ paddingTop: '0.5rem' }}>{expand(item)}</div>
            </details>
          </td>
        </tr>
      )}
    </>
  )
}
