/**
 * PostgREST 42703 (undefined_column) fallback helper.
 *
 * When a migration hasn't been applied yet, a SELECT projecting the new
 * column returns 42703 and breaks the whole query. The pattern is to
 * try the projection first; on 42703 fall back to a pre-migration
 * projection that omits the new column. Mappers default the missing
 * field on the fallback path.
 *
 * Used by cable-schedule export loaders to ship code that's safe
 * before AND after migrations 00060 (vat_pct) and 00061 (conductor)
 * are applied. Same pattern lives in the in-app cost/page.tsx too.
 */

type PostgRESTResult<T = any> = { data: T | null; error: { code?: string; message?: string } | null }

/**
 * Run `primary`. If it fails with PostgREST 42703 (undefined column),
 * run `fallback`. Otherwise return the primary result. Both branches
 * must produce the same `{ data, error }` shape (PostgREST conventions).
 *
 * Typical use:
 *   const { data: row } = await selectWithFallbackOn42703(
 *     () => supabase.schema('x').from('y').select('id, code, new_col').eq('id', id).single(),
 *     () => supabase.schema('x').from('y').select('id, code'           ).eq('id', id).single(),
 *   )
 *
 * Note: thunks are required — PostgREST query builders execute when
 * awaited, so we wrap each in `() => …` to control execution order.
 */
export async function selectWithFallbackOn42703<T = any>(
  primary: () => PromiseLike<PostgRESTResult<T>>,
  fallback: () => PromiseLike<PostgRESTResult<T>>,
): Promise<PostgRESTResult<T>> {
  const tryFull = await primary()
  if (tryFull.error?.code === '42703') {
    return await fallback()
  }
  return tryFull
}
