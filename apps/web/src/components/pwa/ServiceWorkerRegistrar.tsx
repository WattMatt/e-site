'use client'

import { useEffect } from 'react'

/**
 * Registers /sw.js (app-shell caching only — see public/sw.js) in production,
 * after the page has loaded so it never competes with first paint.
 *
 * Kill switch: with NEXT_PUBLIC_SW_DISABLED=true every installed worker is
 * unregistered on the next visit — the way back if a worker ever misbehaves,
 * since a broken worker cannot be removed by deleting the file alone.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const sw = navigator.serviceWorker

    if (process.env.NEXT_PUBLIC_SW_DISABLED === 'true') {
      sw.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {})
      return
    }
    if (process.env.NODE_ENV !== 'production') return

    const register = () => { sw.register('/sw.js', { scope: '/' }).catch(() => { /* non-fatal: the app works without it */ }) }
    if (document.readyState === 'complete') register()
    else {
      window.addEventListener('load', register, { once: true })
      return () => window.removeEventListener('load', register)
    }
  }, [])
  return null
}
