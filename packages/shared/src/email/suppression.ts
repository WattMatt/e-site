/**
 * The bounce/complaint suppression consult.
 *
 * `public.email_suppressions` is created in migration 00185 and written by the
 * Resend delivery webhook on a hard bounce or a complaint. This module is the
 * single read side of that list.
 *
 * WHICH PATHS CONSULT IT, AND WHY THAT SPLIT
 *
 * `filterSuppressed` is wired into the ALWAYS-FIRES paths — the ones a project
 * generates over and over: `apps/web/src/lib/notify.ts` (diary, QC, snags and
 * site-form distribution all route through it), `rfi-email.ts`, `snag-email.ts`
 * and the site-form recipient preview. Those drive a full site roster (19
 * addresses on KINGSWALK) on every entry, forever, so an address Resend has
 * stopped delivering to keeps being mailed until something reads this list.
 *
 * The seven lifecycle edge functions are NOT wired yet, and the reason they are
 * lower priority is worth recording accurately: `UNIQUE (user_id,
 * sequence_name, step_name)` means a dead address receives each lifecycle step
 * at most ONCE, ever — roughly 14 lifetime emails, not a daily repeat. They are
 * self-capping. Wiring them means CLI-deploying seven Deno functions, which is
 * why they wait.
 *
 * `auth-email-hook` is deliberately never consulted: a password reset or an
 * invite must go out even to an address that once bounced, or a suppression
 * entry becomes an account lockout.
 *
 * FAIL OPEN, ALWAYS. See the comment on the error branch.
 */

/** The narrow slice of a Supabase client this needs. Structural on purpose. */
export interface SuppressionClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: unknown; error: unknown }>
      }
    }
  }
}

export async function isSuppressed(
  supabase: SuppressionClient,
  emailAddress: string,
): Promise<boolean> {
  const address = (emailAddress ?? '').trim().toLowerCase()
  if (!address) return false

  const { data, error } = await supabase
    .from('email_suppressions')
    .select('email_address')
    .eq('email_address', address)
    .maybeSingle()

  if (error) {
    // FAIL OPEN, on purpose. Failing closed on a read error would silence
    // every outbound email on the platform simultaneously — an invisible total
    // outage. Mailing a handful of dead addresses until the error is fixed is
    // the cheaper failure, and it is visible: it produces more bounce events.
    // The loud log is what makes it reach §15 §(b2) Rule 3's Monday review.
    console.error('isSuppressed: suppression read failed, allowing the send', error)
    return false
  }

  return data !== null
}


// ─────────────────────────────────────────────────────────────────────────────
// Batch consult — the shape the always-fires paths need.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The narrow slice of a Supabase client the batch consult needs.
 *
 * Separate from `SuppressionClient` on purpose: this one terminates on `.in()`,
 * not `.maybeSingle()`, so the two cannot be confused at a call site.
 */
export interface SuppressionListClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): PromiseLike<{ data: unknown; error: unknown }>
    }
  }
}

export interface FilterSuppressedResult {
  /** Addresses that may be mailed, in input order, with their original casing. */
  allowed: string[]
  /** Addresses dropped because Resend hard-bounced or a recipient complained. */
  suppressed: string[]
}

/**
 * Partition a roster into the addresses that may be mailed and the ones that
 * must not be, in ONE round trip.
 *
 * Deliberately batch: the always-fires paths hand this a whole site roster on
 * every diary entry / RFI / snag / QC report / form distribution, and a
 * per-address `isSuppressed` loop would turn one site note into nineteen
 * queries. Callers should surface `suppressed.length` rather than silently
 * shrinking the audience — on a site-form distribution the recipient list IS
 * the safety control.
 *
 * Blank entries are dropped from both lists: they are not sendable and were
 * never a recipient.
 */
export async function filterSuppressed(
  supabase: SuppressionListClient,
  addresses: readonly (string | null | undefined)[],
): Promise<FilterSuppressedResult> {
  // Keep the original string (roster addresses come from auth.users.email and
  // are not normalised) alongside the normalised key the table is stored under.
  const candidates: { original: string; key: string }[] = []
  for (const raw of addresses) {
    const original = raw ?? ''
    const key = original.trim().toLowerCase()
    if (!key) continue
    candidates.push({ original, key })
  }
  if (candidates.length === 0) return { allowed: [], suppressed: [] }

  const lookupKeys = [...new Set(candidates.map((c) => c.key))]

  const { data, error } = await supabase
    .from('email_suppressions')
    .select('email_address')
    .in('email_address', lookupKeys)

  if (error) {
    // FAIL OPEN, on purpose — same reasoning as isSuppressed. Failing closed on
    // a read error would silence every outbound email on the platform at once,
    // invisibly. Mailing a handful of dead addresses until the error is fixed
    // is the cheaper failure, and it is self-announcing: it produces more
    // bounce events, which is what makes it reach the Monday review.
    console.error('filterSuppressed: suppression read failed, allowing the send', error)
    return { allowed: candidates.map((c) => c.original), suppressed: [] }
  }

  const blocked = new Set(
    (Array.isArray(data) ? data : [])
      .map((row) => String((row as { email_address?: unknown })?.email_address ?? '').trim().toLowerCase())
      .filter(Boolean),
  )

  const allowed: string[] = []
  const suppressed: string[] = []
  for (const c of candidates) {
    if (blocked.has(c.key)) suppressed.push(c.original)
    else allowed.push(c.original)
  }
  return { allowed, suppressed }
}
