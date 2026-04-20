'use client'

import { useEffect } from 'react'
import { initSentry } from '@/lib/sentry'

// Client-side Sentry boot. Server-side init lives in instrumentation.ts and
// runs before this component mounts; this file handles the browser bundle.
export function SentryBoot() {
  useEffect(() => { void initSentry() }, [])
  return null
}
