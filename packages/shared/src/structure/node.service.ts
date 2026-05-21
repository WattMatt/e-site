/**
 * node.service.ts — query-builder service for structure.nodes.
 *
 * All table access goes through `client.schema('structure').from('nodes')`.
 * The `structure` schema is now included in the generated DB types (packages/db),
 * so no `as any` cast is needed on the schema call.
 *
 * Cross-schema write gotcha (CLAUDE.md 2026-05-18):
 * supabase-js `.schema('structure')` can silently drop the service-role auth
 * header on INSERT/UPDATE, causing RLS denials.  Server-side callers that need
 * service-role writes should use raw PostgREST fetch with `Content-Profile:
 * structure` instead.  This service is the query-builder layer only — auth
 * wiring is handled by the Next.js server-action callers in later phases.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@esite/db';
import { nodeSchema } from './node-schema';
import type { Node, NodeKind, NodeStatus } from './types';
import type { NodeInput } from './node-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the `structure.nodes` PostgREST builder for the given client. */
function nodesTable(client: SupabaseClient) {
  return (client as SupabaseClient<Database>).schema('structure').from('nodes');
}

/** Unwrap a PostgREST result; throws if error is non-null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrap<T>(result: { data: any; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all nodes for a project.  Optionally filter by kind and/or status.
 */
export async function listNodes(
  client: SupabaseClient,
  projectId: string,
  filters?: { kind?: NodeKind; status?: NodeStatus },
): Promise<Node[]> {
  let query = nodesTable(client).select('*').eq('project_id', projectId);

  if (filters?.kind) {
    query = query.eq('kind', filters.kind);
  }
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  const result = await query;
  return unwrap<Node[]>(result) ?? [];
}

/**
 * Fetch a single node by id.  Returns null when not found.
 */
export async function getNode(
  client: SupabaseClient,
  nodeId: string,
): Promise<Node | null> {
  const result = await nodesTable(client)
    .select('*')
    .eq('id', nodeId)
    .single();

  if (result.error) return null;
  // Generated DB types lag migration 00090 (custom_kind_label); cast at the
  // app-type boundary.
  return result.data as unknown as Node | null;
}

/**
 * Validate input with nodeSchema, then insert a new node.
 * Throws a ZodError on invalid input (before any DB call).
 */
export async function createNode(
  client: SupabaseClient,
  input: NodeInput,
): Promise<Node> {
  // Validate first — throws ZodError if invalid.
  const validated = nodeSchema.parse(input);

  // validated carries custom_kind_label (00090); the generated Insert type
  // lags it, so cast at this boundary.
  const result = await nodesTable(client)
    .insert(validated as never)
    .select('*')
    .single();

  return unwrap<Node>(result);
}

/**
 * Partial update on a node.  Returns the updated row.
 */
export async function updateNode(
  client: SupabaseClient,
  nodeId: string,
  patch: Partial<NodeInput>,
): Promise<Node> {
  // patch may carry custom_kind_label (00090); generated types lag it.
  const result = await nodesTable(client)
    .update(patch as never)
    .eq('id', nodeId)
    .select('*')
    .single();

  return unwrap<Node>(result);
}

/**
 * Set a node's status to 'decommissioned'.  Returns the updated row.
 */
export async function decommissionNode(
  client: SupabaseClient,
  nodeId: string,
): Promise<Node> {
  const result = await nodesTable(client)
    .update({ status: 'decommissioned' })
    .eq('id', nodeId)
    .select('*')
    .single();

  return unwrap<Node>(result);
}
