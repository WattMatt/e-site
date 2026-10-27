import { describe, it, expect } from 'vitest'
import { summariseInspections, type InspectionOverviewRow } from './inspection-overview.service'

// The seven inspections on ZZ status-guard test as they stood on 2026-10-12.
const ERNST = 'u-ernst'
const RONLI = 'u-ronli'
const ARNO = 'u-arno'
const row = (target_label: string, status: string, assigned_to_id: string | null, verifier_id: string | null, updated_at: string): InspectionOverviewRow =>
  ({ id: target_label, target_label, project_id: 'p-zzs', status, assigned_to_id, verifier_id, updated_at })
const ZZS: InspectionOverviewRow[] = [
  row('A - happy path', 'certified', ARNO, ARNO, '2026-10-06T14:17:12Z'),
  row('Shoprite', 'awaiting_verification', ERNST, ERNST, '2026-10-12T12:30:50Z'),
  row('Boxer', 'in_progress', RONLI, ERNST, '2026-10-12T12:24:00Z'),
  row('Rage', 'in_progress', RONLI, ERNST, '2026-10-12T11:41:54Z'),
  row('Main DB 1.1', 'in_progress', RONLI, ERNST, '2026-10-12T11:53:23Z'),
  row('Shoprite generator', 're-inspect_required', RONLI, ERNST, '2026-10-12T12:15:55Z'),
  row('MINISUB 1', 'in_progress', RONLI, ERNST, '2026-10-12T12:55:58Z'),
]
const names = new Map([['p-zzs', 'ZZ status-guard test']])

describe('summariseInspections', () => {
  it('counts every state, so in-progress inspections show up too', () => {
    expect(summariseInspections(ZZS, ERNST).counts).toEqual({ open: 4, awaiting: 1, sentBack: 1, certified: 1 })
  })

  it("lists what is waiting on the verifier: Shoprite to verify", () => {
    const s = summariseInspections(ZZS, ERNST, names)
    expect(s.waitingOnYou.map((i) => [i.target_label, i.yours])).toEqual([['Shoprite', 'verify']])
    expect(s.waitingOnYou[0].project_name).toBe('ZZ status-guard test')
    expect(s.toVerify).toBe(1)
  })

  it('lists what is waiting on the inspector: the send-back first, then the open ones, newest first', () => {
    const s = summariseInspections(ZZS, RONLI, names, 10)
    expect(s.waitingOnYou.map((i) => [i.target_label, i.yours])).toEqual([
      ['Shoprite generator', 'fix'],
      ['MINISUB 1', 'inspect'],
      ['Boxer', 'inspect'],
      ['Main DB 1.1', 'inspect'],
      ['Rage', 'inspect'],
    ])
  })

  it('recent shows open work only, most recently active first, capped', () => {
    const s = summariseInspections(ZZS, ARNO, names, 3)
    expect(s.recent.map((i) => i.target_label)).toEqual(['MINISUB 1', 'Shoprite', 'Boxer'])
    expect(s.waitingOnYou).toEqual([])
  })

  it('nobody signed in: counts only, nothing is "yours"', () => {
    const s = summariseInspections(ZZS, null)
    expect(s.waitingOnYou).toEqual([])
    expect(s.recent.every((i) => i.yours === null)).toBe(true)
  })
})
