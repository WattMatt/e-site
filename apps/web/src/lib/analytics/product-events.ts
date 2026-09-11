// The `server-only` guard via a Vite-resolvable path — see lib/server-only.ts.
import '@/lib/server-only'
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
 * Never throws and is never awaited on a path the user is waiting on. A metric
 * that can fail a write is worse than no metric.
 *
 * ⚠ Any test importing this module must `vi.mock('@/lib/server-only', () => ({}))`
 * ABOVE the import — the real package throws outside the react-server
 * condition, which is the condition vitest runs in (and is not even resolvable
 * from apps/web, which is why the guard sits behind lib/server-only.ts).
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
