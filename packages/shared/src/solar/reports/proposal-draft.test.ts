import { describe, it, expect } from 'vitest'
import { defaultProposalDraft, parseProposalDraft, readProposalDraft, type ProposalDraft } from './proposal-draft'

const good: ProposalDraft = {
  clientName: 'Acme Retail (Pty) Ltd', marginPct: 15, validityDays: 30, financeOptions: ['cash', 'ppa'],
  summary: 'A 500 kWp rooftop system.', scope: 'Supply and install.', priceTerms: '40 % deposit.',
  assumptions: 'Roof is sound.', inclusions: ['Monitoring'], exclusions: ['Roof repairs'], terms: 'Standard terms.', narrative: '',
}

describe('proposal draft (§9.3 structured fields)', () => {
  it('accepts a complete draft', () => {
    expect(parseProposalDraft(good)).toEqual({ ok: true, draft: good })
  })
  it('names every invalid field', () => {
    const r = parseProposalDraft({ ...good, clientName: ' ', marginPct: 120, financeOptions: [], validityDays: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(['clientName', 'financeOptions', 'marginPct', 'validityDays'])
      expect(r.errors.financeOptions).toBe('Offer at least one finance option')
    }
  })
  it('refuses a finance option offered twice', () => {
    const r = parseProposalDraft({ ...good, financeOptions: ['cash', 'cash'] })
    expect(r.ok).toBe(false)
  })
  it('defaults from the org templates, the rate-card margin and the case’s enabled models', () => {
    const d = defaultProposalDraft({ clientName: 'Acme', marginPct: null, validityDays: 45, termsText: 'Org terms', enabledKinds: ['debt', 'cash'] })
    expect(d).toMatchObject({ clientName: 'Acme', marginPct: 0, validityDays: 45, terms: 'Org terms', financeOptions: ['cash', 'debt'] })
    expect(defaultProposalDraft({ clientName: null, marginPct: 12, validityDays: null, termsText: null, enabledKinds: [] }))
      .toMatchObject({ clientName: '', marginPct: 12, validityDays: 30, terms: '', financeOptions: ['cash'] })
  })
  it('reads a stored draft leniently (unknown keys dropped, wrong types defaulted)', () => {
    expect(readProposalDraft({ clientName: 'X', marginPct: 'ten', inclusions: ['a', 3], evil: true })).toMatchObject({
      clientName: 'X', marginPct: 0, inclusions: ['a'],
    })
    expect(readProposalDraft(null).financeOptions).toEqual(['cash'])
  })
})
