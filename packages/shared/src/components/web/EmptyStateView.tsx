import type { EmptyStateConfig } from '../EmptyState'

interface Props extends Partial<EmptyStateConfig> {
  icon?: string
  heading?: string
  body?: string
  actionLabel?: string
  actionHref?: string
  onAction?: () => void
  className?: string
}

/**
 * Web EmptyStateView — renders an EmptyStateConfig as a centred panel.
 * Works in both RSC and client components.
 */
export function EmptyStateView({
  icon = '📭',
  heading = 'Nothing here',
  body,
  actionLabel,
  actionHref,
  onAction,
  className = '',
}: Props) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-8 text-center ${className}`}>
      <span className="text-5xl mb-4 select-none">{icon}</span>
      <p className="text-white font-semibold text-lg mb-1">{heading}</p>
      {body && <p className="text-slate-400 text-sm max-w-xs leading-relaxed">{body}</p>}
      {(actionLabel && (actionHref || onAction)) && (
        <div className="mt-6">
          {actionHref ? (
            <a
              href={actionHref}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              {actionLabel}
            </a>
          ) : (
            <button
              onClick={onAction}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
