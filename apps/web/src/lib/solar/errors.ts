/**
 * Postgres/PostgREST errors from the Solar tables → one human sentence
 * (spec §0.4 rule 5). Keyed on the SQLSTATE and the exact sentences raised by
 * 00207's bind trigger and request guard. Never returns the raw message.
 */
export const STALE_MESSAGE = 'Someone else changed this — reload to see their version.'
export const ALREADY_ANSWERED = 'This request has already been answered — reload to see it.'
export const GENERIC_ERROR = 'Something went wrong — try again.'

export function humanSolarError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  if (err?.code === '23505') return 'You already have a request waiting for an answer.'
  if (m.includes('requester is not an eligible member')) return 'Your account cannot be given Solar access on this project.'
  if (m.includes('not an eligible member')) {
    return 'This person cannot be given Solar access on this project. Clients and suppliers never can, and only active project members can.'
  }
  if (m.includes('exceeds')) {
    return 'That level is higher than this person can hold. Members from outside the organisation can have View only.'
  }
  if (m.includes('request a subscription')) return 'Only members of this project’s organisation can ask for a subscription.'
  if (m.includes('request already')) return ALREADY_ANSWERED
  if (m.includes('point-of-connection node')) return 'That board belongs to another project.'
  // 00215 cases_bind: an equipment snapshot that does not name a row of the case org's (or the
  // platform) catalogue. The kind is read from a fixed list, never echoed from the message.
  if (err?.code === '23514' && m.startsWith('solar.cases:') && m.includes('catalogue')) {
    const kind = (['module', 'inverter', 'battery'] as const).find((k) => m.includes(`the ${k} `)) ?? 'equipment'
    return `Pick the ${kind} again — it is not in your catalogue.`
  }
  // 00216: a study or case an issued proposal depends on is kept as evidence (fixed messages).
  if (err?.code === '42501' && m.startsWith('solar.cases: an issued proposal depends on this case')) {
    return 'An issued proposal was made from this case — it is kept as evidence and cannot be deleted.'
  }
  if (err?.code === '42501' && m.startsWith('solar.studies: an issued proposal depends on this study')) {
    return 'This study has an issued proposal — it is kept as evidence and cannot be deleted.'
  }
  if (err?.code === '42501') return 'You do not have permission to do that.'
  return GENERIC_ERROR
}
