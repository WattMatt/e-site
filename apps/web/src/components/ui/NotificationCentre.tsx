'use client'

import { createContext, useContext, useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatRelative } from '@esite/shared'
import { Bell } from 'lucide-react'

export interface AppNotification {
  id: string
  title: string
  body: string | null
  is_read: boolean
  created_at: string
  action_url: string | null
}

interface NotificationsState {
  notifications: AppNotification[]
  unreadCount: number
  isPending: boolean
  markAllRead: () => void
  /** Marks the notification read and follows its link, if it has one. */
  open: (n: AppNotification) => void
}

const NotificationsContext = createContext<NotificationsState | null>(null)

/**
 * One fetch + one realtime subscription for the whole shell. The desktop header
 * bell and the phone shell's Inbox tab both read from here, so mounting both
 * (one is hidden by media query) never opens two channels or disagrees on the
 * unread count.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    fetchNotifications()
    const supabase = createClient()
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      }, () => fetchNotifications())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  async function fetchNotifications() {
    const supabase = createClient()
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications((data as AppNotification[]) ?? [])
  }

  function markAllRead() {
    startTransition(async () => {
      const supabase = createClient()
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('is_read', false)
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    })
  }

  async function markRead(id: string) {
    const supabase = createClient()
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  function open(n: AppNotification) {
    markRead(n.id)
    if (n.action_url) {
      window.location.href = n.action_url
    }
  }

  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, isPending, markAllRead, open }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationsProvider>')
  return ctx
}

export function UnreadBadge({ count, style }: { count: number; style?: React.CSSProperties }) {
  if (count <= 0) return null
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 16,
        height: 16,
        background: 'var(--c-red)',
        borderRadius: '50%',
        fontSize: 10,
        color: 'var(--c-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        lineHeight: 1,
        ...style,
      }}
    >
      {count > 9 ? '9+' : count}
    </span>
  )
}

/** Header row + list. Rendered in the desktop dropdown and in the phone Inbox sheet. */
export function NotificationList({ onNavigate, maxHeight, showTitle = true }: {
  onNavigate?: () => void
  maxHeight?: number
  showTitle?: boolean
}) {
  const { notifications, unreadCount, isPending, markAllRead, open } = useNotifications()
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: showTitle ? 'space-between' : 'flex-end',
          padding: '12px 16px',
          borderBottom: '1px solid var(--c-border)',
          minHeight: 44,
        }}
      >
        {showTitle && (
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
            Notifications
          </h3>
        )}
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={isPending}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--c-amber)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.04em',
              opacity: isPending ? 0.5 : 1,
              minHeight: 32,
            }}
          >
            Mark all read
          </button>
        )}
      </div>
      <div style={{ maxHeight, overflowY: maxHeight ? 'auto' : undefined }}>
        {notifications.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.04em' }}>
              No notifications
            </p>
          </div>
        ) : (
          notifications.map((n, idx) => (
            <button
              key={n.id}
              onClick={() => { open(n); onNavigate?.() }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '12px 16px',
                background: n.is_read ? 'transparent' : 'var(--c-amber-dim)',
                border: 'none',
                borderTop: idx > 0 ? '1px solid var(--c-border)' : 'none',
                cursor: 'pointer',
                color: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                {!n.is_read && (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--c-amber)',
                      marginTop: 6,
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ paddingLeft: n.is_read ? 14 : 0, flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', lineHeight: 1.3 }}>
                    {n.title}
                  </p>
                  {n.body && (
                    <p style={{ fontSize: 11, color: 'var(--c-text-mid)', marginTop: 3, lineHeight: 1.5 }}>
                      {n.body}
                    </p>
                  )}
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 4, letterSpacing: '0.04em' }}>
                    {formatRelative(n.created_at)}
                  </p>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </>
  )
}

/** Desktop header bell + dropdown. Hidden below 768 px, where the Inbox tab takes over. */
export function NotificationCentre() {
  const [open, setOpen] = useState(false)
  const { unreadCount } = useNotifications()

  return (
    <div style={{ position: 'relative' }} className="portal-header-desktop-only">
      <button
        onClick={() => setOpen(!open)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          position: 'relative',
          padding: 8,
          color: 'var(--c-text-mid)',
          background: 'transparent',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          transition: 'color 0.15s, background 0.15s',
        }}
      >
        <Bell size={20} aria-hidden="true" />
        <UnreadBadge count={unreadCount} style={{ top: 4, right: 4 }} />
      </button>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 30 }}
          />
          <div
            role="dialog"
            aria-label="Notifications"
            style={{
              position: 'absolute',
              right: 0,
              top: 40,
              width: 320,
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              borderRadius: 8,
              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
              zIndex: 40,
              overflow: 'hidden',
            }}
          >
            <NotificationList maxHeight={384} onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  )
}
