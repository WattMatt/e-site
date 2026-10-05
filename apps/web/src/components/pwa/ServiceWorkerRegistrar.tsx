'use client'

import { useEffect } from 'react'

/**
 * Registers /sw.js (app-shell caching only — see public/sw.js) in production,
 * after the page has loaded so it never competes with first paint.
 *
 * Outside production (next dev) it UNREGISTERS instead: a worker left behind
 * by a local `next start` would otherwise keep serving cached dev chunks,
 * whose names carry no hash, and edits would never show.
 *
 * Kill switch: a build with NEXT_PUBLIC_SW_DISABLED=true (inlined at build
 * time) unregisters every worker and clears its caches on the next visit. The
 * primary way back is a self-unregistering sw.js — see the header of that file.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const sw = navigator.serviceWorker

    if (process.env.NEXT_PUBLIC_SW_DISABLED === 'true' || process.env.NODE_ENV !== 'production') {
      sw.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {})
      if (typeof caches !== 'undefined') {
        caches.keys()
          .then(keys => Promise.all(keys.filter(k => k.startsWith('esite-')).map(k => caches.delete(k))))
          .catch(() => {})
      }
      return
    }

    const register = () => { sw.register('/sw.js', { scope: '/' }).catch(() => { /* non-fatal: the app works without it */ }) }
    if (document.readyState === 'complete') register()
    else {
      window.addEventListener('load', register, { once: true })
      return () => window.removeEventListener('load', register)
    }
  }, [])
  return null
}
