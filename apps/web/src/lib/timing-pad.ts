/**
 * Enumeration-defence timing pad (Onboarding Standard A6, IL ForgotPassword
 * pattern).
 *
 * A reset / magic-link request must take the same time whether or not the
 * account exists, otherwise "user exists" leaks through response latency.
 * Call startTimingPad() BEFORE the auth call and await the returned function
 * AFTER it: total elapsed time is padded up to a randomized 1.0–1.3 s
 * minimum. The floor is randomized per request so the pad itself doesn't
 * become a fingerprint for the fast path.
 *
 *   const pad = startTimingPad()
 *   const { error } = await supabase.auth.resetPasswordForEmail(...)
 *   await pad()
 *   // ...uniform response handling
 */
export function startTimingPad(minMs = 1000, jitterMs = 300): () => Promise<void> {
  const start = Date.now()
  const min = minMs + Math.random() * jitterMs
  return async () => {
    const remaining = min - (Date.now() - start)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
  }
}
