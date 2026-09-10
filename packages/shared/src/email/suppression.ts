/**
 * The bounce/complaint suppression consult.
 *
 * ⚠ NOTHING CALLS THIS YET, AND THAT IS DELIBERATE.
 *
 * public.email_suppressions is created in migration 00185 (pre-window, §13
 * item 0) and is WRITE-ONLY until §13 item 7 builds the 07:00 recap. Until
 * then the seven lifecycle edge functions gate only on hasOptedOut
 * (apps/edge-functions/supabase/functions/_shared/email-sequence.ts:121) and
 * will keep mailing a hard-bounced address daily.
 *
 * Wiring the consult into those functions would mean CLI-deploying seven Deno
 * edge functions, and §15 :164 records that Q1 introduces no edge-function work
 * precisely so that no Q1 deliverable waits on the workflow-scoped token. So
 * the list is a record now and a control from item 7.
 *
 * This file exists so that item 4's dispatcher and item 7's recap import ONE
 * implementation instead of writing two that drift. §05 :187 names this list as
 * one of exactly three switches the always-fires notifications honour; two
 * different implementations of one of those three is not a switch.
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
