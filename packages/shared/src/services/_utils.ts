import type { TypedSupabaseClient } from '@esite/db'

export type ProfileSnippet = {
  id: string
  full_name: string | null
  avatar_url?: string | null
  email?: string | null
}

/** Batch-fetch profiles by ID from public.profiles (no cross-schema FK hint needed). */
export async function fetchProfileMap(
  client: TypedSupabaseClient,
  ids: (string | null | undefined)[],
): Promise<Record<string, ProfileSnippet>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))]
  if (!unique.length) return {}
  const { data } = await client
    .from('profiles')
    .select('id, full_name, avatar_url, email')
    .in('id', unique)
  return Object.fromEntries((data ?? []).map((p: any) => [p.id, p]))
}

/** Batch-fetch projects by ID from projects.projects (no cross-schema FK hint needed). */
export async function fetchProjectMap(
  client: TypedSupabaseClient,
  ids: (string | null | undefined)[],
): Promise<Record<string, { id: string; name: string }>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))]
  if (!unique.length) return {}
  const { data } = await (client as any)
    .schema('projects')
    .from('projects')
    .select('id, name')
    .in('id', unique)
  return Object.fromEntries((data ?? []).map((p: any) => [p.id, p]))
}

/** Batch-fetch suppliers by ID from suppliers.suppliers. */
export async function fetchSupplierMap(
  client: TypedSupabaseClient,
  ids: (string | null | undefined)[],
): Promise<Record<string, { id: string; name: string }>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))]
  if (!unique.length) return {}
  const { data } = await (client as any)
    .schema('suppliers')
    .from('suppliers')
    .select('id, name')
    .in('id', unique)
  return Object.fromEntries((data ?? []).map((s: any) => [s.id, s]))
}
