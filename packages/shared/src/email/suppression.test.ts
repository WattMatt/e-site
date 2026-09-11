import { describe, it, expect, vi } from 'vitest'
import { isSuppressed, filterSuppressed } from './suppression'

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

// ─── filterSuppressed — the batch variant the always-fires paths use ─────────
//
// notify.ts drives a 19-address roster on every diary entry, RFI, snag, QC
// report and site-form distribution. One round-trip per address would be 19
// queries per site-diary note, so the consult on that path MUST be a single
// `.in()`. The call-count assertions below are the point of this block: a
// re-implementation as `addresses.map(isSuppressed)` would still return the
// right answer and would still pass every value assertion.

/** Recorder standing in for a Supabase client's `.from().select().in()`. */
function listClient(result: { data: unknown; error: unknown }) {
  const calls: { table: string; columns: string; column: string; values: string[] }[] = []
  return {
    calls,
    from(table: string) {
      return {
        select: (columns: string) => ({
          in: (column: string, values: string[]) => {
            calls.push({ table, columns, column, values })
            return Promise.resolve(result)
          },
        }),
      }
    },
  }
}

describe('filterSuppressed', () => {
  it('asks ONE question for a whole roster', async () => {
    const roster = [
      'arno@wmeng.co.za', 'ghost@aeec.co.za', 'sipho@siyaya.co.za',
      'dead@matlapm.co.za', 'lee@gmigroup.co.za',
    ]
    const c = listClient({ data: [{ email_address: 'ghost@aeec.co.za' }], error: null })

    const res = await filterSuppressed(c as never, roster)

    // One round-trip for five addresses — not five.
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0].table).toBe('email_suppressions')
    expect(c.calls[0].column).toBe('email_address')
    // Same reasoning as isSuppressed: a `.select()` naming a column that does
    // not exist is a 42703, which this helper turns into a FAIL OPEN.
    expect(c.calls[0].columns).toBe('email_address')
    expect(c.calls[0].values).toEqual(roster)

    expect(res.allowed).toEqual([
      'arno@wmeng.co.za', 'sipho@siyaya.co.za', 'dead@matlapm.co.za', 'lee@gmigroup.co.za',
    ])
    expect(res.suppressed).toEqual(['ghost@aeec.co.za'])
  })

  it('matches a stored lowercase row against a mixed-case roster address, and keeps the original casing of the survivors', async () => {
    // The roster comes from auth.users.email, which is not normalised. A
    // suppression row written by the Resend webhook is lowercased. A filter
    // that compares raw strings would let every mixed-case dead address
    // through and every assertion about counts would still pass.
    const c = listClient({ data: [{ email_address: 'ghost@aeec.co.za' }], error: null })

    const res = await filterSuppressed(c as never, ['  Ghost@AEEC.co.za ', 'Arno@Wmeng.co.za'])

    expect(c.calls[0].values).toEqual(['ghost@aeec.co.za', 'arno@wmeng.co.za'])
    expect(res.suppressed).toEqual(['  Ghost@AEEC.co.za '])
    expect(res.allowed).toEqual(['Arno@Wmeng.co.za'])
  })

  it('FAILS OPEN on a read error — the whole roster still gets the mail', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const c = listClient({ data: null, error: { message: 'permission denied' } })

    const res = await filterSuppressed(c as never, ['a@b.com', 'c@d.com'])

    expect(res.allowed).toEqual(['a@b.com', 'c@d.com'])
    expect(res.suppressed).toEqual([])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not query at all for an empty or blank-only roster', async () => {
    const c = listClient({ data: [], error: null })
    expect(await filterSuppressed(c as never, [])).toEqual({ allowed: [], suppressed: [] })
    expect(await filterSuppressed(c as never, ['', '   ', null, undefined])).toEqual({
      allowed: [], suppressed: [],
    })
    expect(c.calls).toHaveLength(0)
  })

  it('de-duplicates the lookup but keeps one entry per surviving address', async () => {
    const c = listClient({ data: [], error: null })
    const res = await filterSuppressed(c as never, ['a@b.com', 'A@B.com', 'c@d.com'])
    expect(c.calls[0].values).toEqual(['a@b.com', 'c@d.com'])
    expect(res.allowed).toEqual(['a@b.com', 'A@B.com', 'c@d.com'])
  })
})
