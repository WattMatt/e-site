'use client'

import { useEffect } from 'react'
import { initSentry } from '@/lib/sentry'

// Client-side Sentry boot. Server-side init lives in instrumentation.ts and
// runs before this component mounts; this file handles the browser bundle.
//
// Note: when running `next dev` WITHOUT `--turbopack`, the @sentry/nextjs +
// OpenTelemetry chain triggers a "Cannot read properties of undefined
// (reading 'call')" runtime error in the (admin) layout via webpack's
// require-in-the-middle interception. Use `--turbopack` for dev (already
// the default in `.claude/launch.json`).
export function SentryBoot() {
  useEffect(() => { void initSentry() }, [])
  return null
}
