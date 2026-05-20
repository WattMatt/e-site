/**
 * node.service.ts — query-builder service for structure.nodes.
 *
 * IMPORTANT: All table access goes through `client.schema('structure').from('nodes')`.
 * The `structure` schema is not yet in the generated DB types, so we cast the
 * `.schema()` call as `any` — the same pattern used in the inspections module.
 *
 * Cross-schema write gotcha (CLAUDE.md 2026-05-18):
 * supabase-js `.schema('structure')` can silently drop the service-role auth
 * header on INSERT/UPDATE, causing RLS denials.  Server-side callers that need
 * service-role writes should use raw PostgREST fetch with `Content-Profile:
 * structure` instead.  This service is the query-builder layer only — auth
 * wiring is handled by the Next.js server-action callers in later phases.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { nodeSchema } from './node-schema';
import type { Node, NodeKind, NodeStatus } from './types';
import type { NodeInput } from './node-schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the `structure.nodes` PostgREST builder for the given client. */
function nodesTable(client: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).schema('structure').from('nodes');
}

/** Unwrap a PostgREST result; throws if error is non-null. */
function unwrap<T>(result: { data: T | null; error: unknown }): T {
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
  return result.data as Node | null;
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

  const result = await nodesTable(client)
    .insert(validated)
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
  const result = await nodesTable(client)
    .update(patch)
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
