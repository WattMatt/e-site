/**
 * PostgREST caps every response, table or set-returning function, at max_rows
 * (1 000 on this project) whatever .range() asks for. Anything that must see a
 * whole BOQ pages until a short page. Pass a page function that applies a
 * stable order (unique keys) and .range(from, to).
 */
export const PAGE_SIZE = 1000

export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: T[] } | { error: string }> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) return { error: error.message }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return { data: out }
  }
}
