/**
 * Pure branching for the set-new-password (confirm) page.
 *
 * The page is reached two ways, distinguished by the `flow` query param the
 * /accept-invite page forwards:
 *
 *   - flow=invite  → brand-new user setting their first password. KEEP the
 *                    session and land them in-app (/dashboard) — bouncing them
 *                    to /login right after they set a password is clumsy.
 *   - (anything else, incl. absent) → password RESET. Sign the session out and
 *                    send them to /login, the historic behaviour.
 */
export type ConfirmFlow =
  | { kind: 'invite'; signOut: false; redirectTo: '/dashboard' }
  | { kind: 'reset'; signOut: true; redirectTo: '/login' }

export function resolveConfirmFlow(params: URLSearchParams): ConfirmFlow {
  if (params.get('flow') === 'invite') {
    return { kind: 'invite', signOut: false, redirectTo: '/dashboard' }
  }
  return { kind: 'reset', signOut: true, redirectTo: '/login' }
}
