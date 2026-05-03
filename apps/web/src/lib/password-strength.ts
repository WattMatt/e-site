/**
 * Password strength + breach checks for client-side use only.
 *
 * - zxcvbn-ts (lazy-loaded) for entropy + dictionary scoring
 * - HIBP Pwned Passwords API via k-anonymity (only the first 5 chars of
 *   SHA-1 leave the browser; full hash never transmitted)
 *
 * Both checks are best-effort: a network failure on HIBP must not block
 * the user from setting a password — surface a warning, allow override.
 */

export interface PasswordEvaluation {
  score:    0 | 1 | 2 | 3 | 4
  warning:  string
  suggestions: string[]
  pwned:    boolean | null   // null when the breach check failed (network)
  pwnCount: number | null
}

let zxcvbnPromise: Promise<typeof import('@zxcvbn-ts/core').zxcvbn> | null = null

async function loadZxcvbn() {
  if (!zxcvbnPromise) {
    zxcvbnPromise = (async () => {
      const [core, common, en] = await Promise.all([
        import('@zxcvbn-ts/core'),
        import('@zxcvbn-ts/language-common'),
        import('@zxcvbn-ts/language-en'),
      ])
      core.zxcvbnOptions.setOptions({
        translations: en.translations,
        graphs:       common.adjacencyGraphs,
        dictionary:   { ...common.dictionary, ...en.dictionary },
      })
      return core.zxcvbn
    })()
  }
  return zxcvbnPromise
}

async function sha1Hex(s: string): Promise<string> {
  const buf  = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-1', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * HIBP k-anonymity check. Returns the breach count for the password,
 * or `null` if the check failed (treat as unknown — not as "safe").
 */
export async function checkPwned(password: string): Promise<number | null> {
  try {
    const hash   = await sha1Hex(password)
    const prefix = hash.slice(0, 5)
    const suffix = hash.slice(5)
    const res    = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
    })
    if (!res.ok) return null
    const text = await res.text()
    for (const line of text.split('\n')) {
      const [s, c] = line.trim().split(':')
      if (s === suffix) return parseInt(c ?? '0', 10) || 1
    }
    return 0
  } catch {
    return null
  }
}

export async function evaluatePassword(password: string): Promise<PasswordEvaluation> {
  const zxcvbn = await loadZxcvbn()
  const result = zxcvbn(password)
  const pwnCount = await checkPwned(password)
  return {
    score:       result.score as PasswordEvaluation['score'],
    warning:     result.feedback.warning ?? '',
    suggestions: result.feedback.suggestions ?? [],
    pwned:       pwnCount === null ? null : pwnCount > 0,
    pwnCount,
  }
}

export function strengthLabel(score: number): string {
  return ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'][score] ?? 'Unknown'
}

export function strengthColor(score: number): string {
  return ['#ef4444', '#f59e0b', '#fbbf24', '#34d399', '#10b981'][score] ?? '#6b7280'
}
