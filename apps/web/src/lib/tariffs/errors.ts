/**
 * tariffs.* errors -> one human sentence (spec §0.4 rule 5). Keyed on the
 * exact sentences raised by 00209's guards and 00213's functions, then the
 * SQLSTATE. Never returns the raw message.
 */
export const TARIFF_GENERIC_ERROR = 'Something went wrong. Try again.'

export function humanTariffError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  if (m.includes('nothing to publish')) return 'There is nothing to publish: this year has no tariffs.'
  if (m.includes('have no charges')) return 'Some tariffs have no charges. Add charges or delete those tariffs before publishing.'
  if (m.includes('inferred unit(s) not reviewed')) return 'Some charges with an inferred unit are not reviewed yet. Approve them first.'
  if (m.includes('not validated')) return 'Run the checks again: the year changed since it was last checked, or the checks found blocking issues.'
  if (m.includes('needs a signed-in platform tariff admin')) return 'Publishing needs a signed-in tariff administrator.'
  if (m.includes('is not a legal transition')) return 'That state change is not allowed.'
  if (m.includes('changed while it was being checked')) return 'The year changed while it was being checked. Run the checks again.'
  if (m.includes('immutable')) return 'Published tariff data cannot be changed. Correct it in a new version.'
  if (m.includes('sha256 and storage_path are fixed')) return 'A stored source file cannot be replaced. Upload it as a new document.'
  if (err?.code === '23505') return 'That already exists.'
  if (err?.code === '23503') return 'It is still used elsewhere, so it cannot be removed.'
  if (err?.code === '23514') return 'That value is not allowed.'
  if (err?.code === '42501') return 'You do not have permission to do that.'
  return TARIFF_GENERIC_ERROR
}
