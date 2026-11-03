// Columns that match the money name pattern but are not commercial figures. Everything else the migrations
// declare as a numeric column named like rate/price/amount/value/total/cost/retention is masked for site roles.
// '*' matches any schema, table or column. A new matching column fails masked-columns.contract.test.ts until it
// is masked by regeneration or listed here WITH a reason.
export type AllowEntry = { schema: string; table: string; column: string; reason: string }

export const MASK_ALLOWLIST: ReadonlyArray<AllowEntry> = [
  { schema: 'tariffs', table: '*', column: '*', reason: 'public reference data (published utility tariffs)' },
  { schema: '*', table: '*', column: 'vat_rate', reason: 'statutory rate' },
  { schema: 'inspections', table: 'responses', column: 'value_number', reason: 'a measurement taken on site (insulation resistance, a meter serial)' },
  { schema: 'inspections', table: 'response_history', column: 'value_number', reason: 'history of a measurement taken on site' },
  { schema: 'field', table: 'form_responses', column: 'value_number', reason: 'a measurement entered on a site form' },
  { schema: 'field', table: 'form_response_history', column: 'value_number', reason: 'history of a measurement entered on a site form' },
  { schema: 'solar', table: 'meter_readings', column: 'value', reason: 'a metered reading, not money' },
  { schema: 'cable_schedule', table: 'supply_routes', column: 'total_length_m', reason: 'a measured cable length in metres' },
  { schema: 'public', table: 'platform_metrics_weekly', column: 'value', reason: 'a product usage count' },
  { schema: 'billing', table: 'usage_records', column: 'value', reason: 'a usage count' },
  { schema: 'public', table: 'rate_index_values', column: 'value', reason: 'a public price index (CPI-style), not a contract figure' },
  { schema: 'solar', table: 'tariff_override_charges', column: 'amount_excl_vat', reason: 'a utility tariff reference figure' },
  { schema: 'solar', table: 'study_export_rates', column: 'amount_excl_vat', reason: 'a utility tariff reference figure' },
]

const hit = (pattern: string, name: string) => pattern === '*' || pattern === name
export function isAllowlisted(c: { schema: string; table: string; column: string }, entries: ReadonlyArray<AllowEntry> = MASK_ALLOWLIST): boolean {
  return entries.some(e => hit(e.schema, c.schema) && hit(e.table, c.table) && hit(e.column, c.column))
}
