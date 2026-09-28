// apps/web/src/lib/solar/load/messages.ts
/** Error code → one human sentence (spec §0.4 rule 5). Codes come from the 3a routes, 00214 and the builder. */
export const LOAD_MESSAGES: Record<string, string> = {
  no_study: 'Set up the study first — save Site & Supply or any Load setting.',
  save_failed: 'The site profile could not be saved — try again.',
  rebuild_failed: 'The site profile could not be built — try again.',
  no_mapping: 'This project has no cloud folder mapped. Map one on the Floor Plans or Documents page.',
  daily_interval: 'This meter has only daily data, so it has no time-of-day pattern.',
  not_found: 'That meter is not in this study.',
  identity_conflict: 'Resolve the identity conflict first: link to the existing meter, skip, or override with a reason.',
  override_needs_reason: 'Give a reason for the override (at least 5 characters).',
  link_needs_existing_meter: 'Choose the existing meter to link to.',
  unresolved_errors: 'The file still has errors — make the choices it asks for, or skip it.',
  already_imported: 'This file is already imported.',
  duplicate_in_other_project: 'These bytes are already imported through another project — use Copy from org meter library.',
  water_is_not_load: 'A water meter is never load data.',
  multi_serial_meter_is_virtual: 'This file holds several meter serials, so its meter kind must be Virtual (multi-serial).',
  primary_not_eligible: 'That channel cannot be the primary channel (it is excluded or its time labels lag).',
  one_primary_channel: 'Choose one primary channel.',
  sha256_mismatch: 'The stored file does not match its fingerprint — upload it again.',
  raw_file_missing: 'The stored file is missing — upload it again.',
  raw_path_invalid: 'The stored file is not where it should be — upload it again.',
  file_too_large: 'The file is larger than 50 MB.',
  commit_failed: 'The import could not be completed — try again.',
  readings_verification_failed: 'The readings did not all save — try again.',
  not_a_meter_series: 'This file is not meter data.',
  not_a_register: 'This file is not a meter register.',
  sheet_not_found: 'That sheet is no longer in the workbook.',
  stale: 'Someone else changed this — reload to see their version.',
}
export function loadErrorMessage(code: string | null | undefined): string {
  return (code && LOAD_MESSAGES[code]) || 'Something went wrong — try again.'
}
