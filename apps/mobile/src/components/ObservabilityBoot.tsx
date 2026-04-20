import { useEffect } from 'react'
import { initSentry } from '../lib/sentry'

// Single boot point for mobile observability. Mounted near the top of
// app/_layout.tsx so Sentry captures errors from every screen below.
export function ObservabilityBoot() {
  useEffect(() => { void initSentry() }, [])
  return null
}
