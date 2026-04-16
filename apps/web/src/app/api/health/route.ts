/**
 * T-061: Health check endpoint
 * GET /api/health
 *
 * Returns a structured JSON payload with per-component status and an
 * overall "healthy" boolean.  Intended for uptime monitors and the
 * Sentry cron-check heartbeat.
 *
 * Response shape:
 * {
 *   "healthy": true,
 *   "timestamp": "2026-04-16T10:00:00.000Z",
 *   "version": "1.0.0",
 *   "components": {
 *     "database": { "status": "ok", "latencyMs": 12 },
 *     "auth":     { "status": "ok" },
 *     "storage":  { "status": "ok" },
 *     "paystack": { "status": "ok" },
 *     "powersync":{ "status": "ok" }
 *   }
 * }
 *
 * Status values: "ok" | "degraded" | "error"
 * HTTP 200 if all ok/degraded, 503 if any "error".
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY
const POWERSYNC_URL = process.env.NEXT_PUBLIC_POWERSYNC_URL

type ComponentStatus = 'ok' | 'degraded' | 'error'

interface ComponentResult {
  status: ComponentStatus
  latencyMs?: number
  message?: string
}

// ─── Individual component checks ─────────────────────────────────────────────

async function checkDatabase(): Promise<ComponentResult> {
  const start = Date.now()
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    // Lightweight round-trip: count rows in a tiny system table
    const { error } = await supabase
      .from('organisations')
      .select('id', { count: 'exact', head: true })
    const latencyMs = Date.now() - start
    if (error) return { status: 'error', latencyMs, message: error.message }
    return { status: latencyMs > 2000 ? 'degraded' : 'ok', latencyMs }
  } catch (err: any) {
    return { status: 'error', latencyMs: Date.now() - start, message: err.message }
  }
}

async function checkAuth(): Promise<ComponentResult> {
  const start = Date.now()
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    // List users with limit 1 — verifies auth.admin is reachable
    const { error } = await (supabase.auth.admin as any).listUsers({ page: 1, perPage: 1 })
    const latencyMs = Date.now() - start
    if (error) return { status: 'error', latencyMs, message: error.message }
    return { status: 'ok', latencyMs }
  } catch (err: any) {
    return { status: 'error', latencyMs: Date.now() - start, message: err.message }
  }
}

async function checkStorage(): Promise<ComponentResult> {
  const start = Date.now()
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    // List root of a known private bucket — just checks connectivity
    const { error } = await supabase.storage.from('coc-uploads').list('', { limit: 1 })
    const latencyMs = Date.now() - start
    if (error) return { status: 'degraded', latencyMs, message: error.message }
    return { status: 'ok', latencyMs }
  } catch (err: any) {
    return { status: 'error', latencyMs: Date.now() - start, message: err.message }
  }
}

async function checkPaystack(): Promise<ComponentResult> {
  if (!PAYSTACK_SECRET) {
    return { status: 'degraded', message: 'PAYSTACK_SECRET_KEY not configured' }
  }
  const start = Date.now()
  try {
    const res = await fetch('https://api.paystack.co/transaction?perPage=1', {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      signal: AbortSignal.timeout(5000),
    })
    const latencyMs = Date.now() - start
    if (!res.ok) {
      return { status: res.status === 401 ? 'error' : 'degraded', latencyMs, message: `HTTP ${res.status}` }
    }
    return { status: latencyMs > 3000 ? 'degraded' : 'ok', latencyMs }
  } catch (err: any) {
    return { status: 'error', latencyMs: Date.now() - start, message: err.message }
  }
}

async function checkPowerSync(): Promise<ComponentResult> {
  if (!POWERSYNC_URL) {
    return { status: 'degraded', message: 'NEXT_PUBLIC_POWERSYNC_URL not configured' }
  }
  const start = Date.now()
  try {
    // PowerSync exposes a /api/v1 health route on the hosted service
    const res = await fetch(`${POWERSYNC_URL}/api/v1`, {
      signal: AbortSignal.timeout(5000),
    })
    const latencyMs = Date.now() - start
    // 401 is expected without a JWT — it means the server is reachable
    if (res.status === 401 || res.ok) {
      return { status: latencyMs > 3000 ? 'degraded' : 'ok', latencyMs }
    }
    return { status: 'degraded', latencyMs, message: `HTTP ${res.status}` }
  } catch (err: any) {
    return { status: 'error', latencyMs: Date.now() - start, message: err.message }
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const [database, auth, storage, paystack, powersync] = await Promise.all([
    checkDatabase(),
    checkAuth(),
    checkStorage(),
    checkPaystack(),
    checkPowerSync(),
  ])

  const components = { database, auth, storage, paystack, powersync }

  const hasError = Object.values(components).some(c => c.status === 'error')
  const healthy = !hasError

  const payload = {
    healthy,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '1.0.0',
    environment: process.env.NODE_ENV ?? 'production',
    components,
  }

  return NextResponse.json(payload, { status: healthy ? 200 : 503 })
}
