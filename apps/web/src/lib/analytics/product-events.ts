import 'server-only'
import { after } from 'next/server'
import { PRODUCT_EVENTS, type ProductEvent } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Write one row to public.product_events.
 *
 * Goes through the service client because public.emit_product_event is granted
 * to service_role alone — the role stamp and the organisation are resolved
 * server-side so a caller cannot invent either. Same shape as
 * dispatchNotification (lib/notifications.ts:26): verify the user with your own
 * client FIRST, then call this.
 *
 * Off the user-visible path. Inside a request scope the RPC is handed to
 * next/server's after(), so the row lands AFTER the response is sent and the
 * caller never waits on it. Call sites still register it only once their own
 * write has succeeded, so a failed write never emits. after() rather than a
 * bare `void promise`: on Vercel the function may be frozen the moment the
 * response is flushed, and a dangling promise is a row that never lands.
 * Outside a request scope (scripts, vitest) after() throws and the RPC runs
 * inline instead.
 *
 * Never throws. A metric that can fail a write is worse than no metric.
 *
 * ⚠ Tests: `server-only` throws outside the react-server condition, which is
 * the condition vitest runs in. Under vitest the specifier resolves to
 * src/test/server-only-stub.ts (vitest.config.ts), so the
 * `vi.mock('server-only', () => ({}))` in the tests is belt-and-braces, not
 * required — kept so the intent survives a config change.
 */
export interface ProductEventArgs {
  actorId: string | null
  projectId: string | null
  event: ProductEvent
  properties?: Record<string, unknown>
  sessionId?: string | null
  /** Required only when projectId is null (org-level events, project_deleted). */
  organisationId?: string | null
}

// public.emit_product_event is not in the generated Database types
// (packages/db/src/types.ts predates migration 00194), so the call is typed
// against the one surface it needs rather than widened to `any`.
type RpcClient = {
  rpc: (
    fn: 'emit_product_event',
    args: Record<string, unknown>,
  ) => PromiseLike<{ error: { message: string } | null }>
}

export async function emitProductEvent(args: ProductEventArgs): Promise<void> {
  const run = async () => {
    try {
      if (!(PRODUCT_EVENTS as readonly string[]).includes(args.event)) {
        console.error('[product-events] unregistered event key, refusing to write', { event: args.event })
        return
      }
      const supabase = createServiceClient() as unknown as RpcClient
      const { error } = await supabase.rpc('emit_product_event', {
        p_actor_id: args.actorId ?? null,
        // ?? null on every optional: JSON.stringify DROPS an undefined value, and
        // PostgREST answers 404 for a missing argument, which this function then
        // swallows — losing the event with no signal anywhere.
        p_project_id: args.projectId ?? null,
        p_event: args.event,
        p_properties: args.properties ?? {},
        p_session_id: args.sessionId ?? null,
        p_organisation_id: args.organisationId ?? null,
      })
      if (error) console.error('[product-events] rpc failed', { event: args.event, err: error.message })
    } catch (e) {
      console.error('[product-events] threw', { event: args.event, err: String(e) })
    }
  }

  try {
    after(run)
  } catch {
    // after() throws outside a request scope (scripts, vitest): run inline.
    await run()
  }
}
