import { describe, it, expect, vi } from 'vitest'
import { isSuppressed } from './suppression'

/** Minimal recorder standing in for a Supabase client. */
function client(result: { data: unknown; error: unknown }) {
  const seen: { table?: string; columns?: string; column?: string; value?: string } = {}
  return {
    seen,
    from(table: string) {
      seen.table = table
      return {
        select: (columns: string) => {
          seen.columns = columns
          return {
            eq: (column: string, value: string) => {
              seen.column = column
              seen.value = value
              return { maybeSingle: async () => result }
            },
          }
        },
      }
    },
  }
}

describe('isSuppressed', () => {
  it('is true when the address has a row', async () => {
    const c = client({ data: { email_address: 'ghost@aeec.co.za' }, error: null })
    expect(await isSuppressed(c as never, 'ghost@aeec.co.za')).toBe(true)
    expect(c.seen.table).toBe('email_suppressions')
    expect(c.seen.column).toBe('email_address')
    // The selected column is pinned, not just the filter. A `.select()` naming
    // a column that does not exist is a PostgREST 42703, which this helper
    // deliberately turns into a FAIL OPEN — so a one-character typo here reads
    // as "nobody is suppressed", silently, forever, while every other
    // assertion in this file still passes. A fixture that discards the
    // argument cannot express that failure.
    expect(c.seen.columns).toBe('email_address')
  })

  it('is false when it does not', async () => {
    const c = client({ data: null, error: null })
    expect(await isSuppressed(c as never, 'live@aeec.co.za')).toBe(false)
  })

  it('normalises case and whitespace before looking up', async () => {
    const c = client({ data: null, error: null })
    await isSuppressed(c as never, '  Ghost@AEEC.co.za ')
    expect(c.seen.value).toBe('ghost@aeec.co.za')
  })

  it('is false for an empty address without querying at all', async () => {
    const c = client({ data: null, error: null })
    expect(await isSuppressed(c as never, '   ')).toBe(false)
    expect(c.seen.table).toBeUndefined()
  })

  it('FAILS OPEN on a read error, and says so loudly', async () => {
    // A read error here would otherwise silence every outbound email on the
    // platform at once. Mailing a handful of dead addresses until someone
    // fixes the query is the cheaper failure.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const c = client({ data: null, error: { message: 'permission denied' } })
    expect(await isSuppressed(c as never, 'ghost@aeec.co.za')).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
