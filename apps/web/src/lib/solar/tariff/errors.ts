/** 00214 errors on the Tariff tab -> sentences; falls back to 1c's humanSolarError. */
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'

export function humanSolarTariffError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  if (m.includes('only a published tariff')) return 'That tariff is not published in the library.'
  if (m.includes('revert it first')) return 'Revert the project override before choosing another tariff.'
  if (m.includes('need Edit + financials')) return 'Choosing the tariff needs Edit + financials access.'
  if (m.includes('a changed rate needs a reason')) return 'Say why this rate differs from the published one.'
  if (m.includes('already has an override')) return 'This study already has a project override.'
  if (m.includes('pin a published tariff first')) return 'Choose a published tariff first.'
  if (m.includes('changed while the bill was being checked')) return STALE_MESSAGE
  if (m.includes('change only with the rate')) return 'Change the rate to change its reason: the reason explains a rate that differs from the published one.'
  if (m.includes('missing some of the tariff')) return 'The project override is incomplete. Revert it and create it again.'
  if (m.includes('only for a manual export rule')) return 'Rates are entered only when the export rate is entered manually.'
  if (err?.code === '40001') return STALE_MESSAGE
  return humanSolarError(err)
}
