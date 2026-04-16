'use client'

import { useState, useEffect, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatRelative } from '@esite/shared'

interface Notification {
  id: string
  title: string
  body: string
  data: Record<string, string>
  is_read: boolean
  created_at: string
}

export function NotificationCentre() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [isPending, startTransition] = useTransition()

  const unreadCount = notifications.filter(n => !n.is_read).length

  useEffect(() => {
    fetchNotifications()
    // Subscribe to realtime inserts
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
    setNotifications((data as Notification[]) ?? [])
  }

  async function markAllRead() {
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

  function handleNotificationClick(n: Notification) {
    markRead(n.id)
    if (n.data?.route) {
      window.location.href = n.data.route
    }
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-slate-800"
        title="Notifications"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-xs text-white flex items-center justify-center font-bold leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-40 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  disabled={isPending}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-slate-400 text-sm">No notifications</p>
                </div>
              ) : (
                notifications.map(n => (
                  <button
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-800 hover:bg-slate-800 transition-colors ${!n.is_read ? 'bg-blue-950/20' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.is_read && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />}
                      <div className={!n.is_read ? '' : 'pl-3.5'}>
                        <p className="text-sm font-medium text-white leading-tight">{n.title}</p>
                        <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{n.body}</p>
                        <p className="text-xs text-slate-600 mt-1">{formatRelative(n.created_at)}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
