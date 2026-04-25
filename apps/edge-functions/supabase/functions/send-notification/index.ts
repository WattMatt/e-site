/**
 * Edge Function: send-notification
 *
 * Sends push notifications via Expo's Push Notification service.
 *
 * Request body:
 *   {
 *     userIds: string[]           // profile IDs to notify
 *     title: string
 *     body: string
 *     data?: Record<string, any>  // e.g. { route: '/snags/123' }
 *   }
 *   Authorization: Bearer <service_role_key>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

interface PushMessage {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: 'default'
  priority?: 'default' | 'normal' | 'high'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Only service_role callers may trigger push notifications.
  try {
    const payload = JSON.parse(atob(authHeader.slice(7).split('.')[1]))
    if (payload.role !== 'service_role') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { userIds, title, body, data, type, entityType, entityId } = await req.json() as {
      userIds: string[]
      title: string
      body: string
      data?: Record<string, unknown>
      type?: string         // notification.type (NOT NULL in schema). Defaults to 'general'.
      entityType?: string   // optional entity_type column
      entityId?: string     // optional entity_id column (uuid)
    }

    if (!userIds?.length || !title || !body) {
      return new Response(JSON.stringify({ error: 'userIds, title, and body are required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Persist in-app notifications (non-blocking — log + continue on error).
    // Schema: public.notifications has `type` NOT NULL, plus optional
    // `action_url`, `entity_type`, `entity_id` columns. We pull `route` out of
    // `data` for action_url so existing in-app UIs can link directly.
    const actionUrl = (data && typeof data === 'object' && 'route' in data && typeof data.route === 'string')
      ? data.route as string
      : null
    const inAppRows = userIds.map((userId) => ({
      user_id: userId,
      type: type ?? 'general',
      title,
      body,
      data: data ?? {},
      action_url: actionUrl,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
    }))
    const { error: inAppErr } = await supabase.from('notifications').insert(inAppRows)
    if (inAppErr) console.error('Failed to persist in-app notifications:', inAppErr)

    // Fetch push tokens for the specified users
    const { data: tokens, error: tokenErr } = await supabase
      .from('push_tokens')
      .select('token')
      .in('user_id', userIds)
      .eq('is_active', true)

    if (tokenErr) throw tokenErr
    if (!tokens?.length) {
      return new Response(JSON.stringify({ sent: 0, message: 'No active push tokens' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Build messages (deduplicate tokens)
    const uniqueTokens = [...new Set(tokens.map((t) => t.token))]
    const messages: PushMessage[] = uniqueTokens.map((token) => ({
      to: token,
      title,
      body,
      data: data ?? {},
      sound: 'default',
      priority: 'high',
    }))

    // Send to Expo Push API in batches of 100
    const results: any[] = []
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100)
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(batch),
      })
      const json = await res.json()
      results.push(...(json.data ?? []))
    }

    // Deactivate invalid tokens
    const invalid = results
      .filter((r) => r.status === 'error' && r.details?.error === 'DeviceNotRegistered')
      .map((r) => r.details?.expoPushToken)
      .filter(Boolean)

    if (invalid.length > 0) {
      await supabase
        .from('push_tokens')
        .update({ is_active: false })
        .in('token', invalid)
    }

    console.log(`Sent ${messages.length} notifications, ${invalid.length} invalid tokens deactivated`)
    return new Response(JSON.stringify({ sent: messages.length, invalid: invalid.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('send-notification error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
