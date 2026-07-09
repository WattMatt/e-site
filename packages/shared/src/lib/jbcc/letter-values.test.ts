// packages/shared/src/lib/jbcc/letter-values.test.ts
import { describe, it, expect } from 'vitest'
import { buildLetterValues } from './letter-values'

describe('buildLetterValues', () => {
  it('fills real recipient/sender/project values', () => {
    const v = buildLetterValues({
      today: '2026-07-09',
      documentRef: 'JBCC-KW-2026-0007',
      recipient: { name: 'Jane Architect', company: 'Archi Ltd', address: '1 Long St', partyRole: 'principal_agent' },
      sender: { signatoryName: 'Sam Site', signatoryTitle: 'Contracts Manager', companyName: 'WM Consulting', addressLines: ['12 Bree St', 'Cape Town'] },
      projectName: 'Kingswalk Mall',
      projectNumber: 'KW-001',
    })
    expect(v['Name of Recipient']).toBe('Jane Architect')
    expect(v['Principal Agent']).toBe('Jane Architect')
    expect(v['Sender Company Name']).toBe('WM Consulting')
    expect(v['Sender Address']).toBe('12 Bree St, Cape Town')
    expect(v['Project Name']).toBe('Kingswalk Mall')
    expect(v['Our Reference']).toBe('JBCC-KW-2026-0007')
    expect(v['Date']).toBe('2026-07-09')
  })

  it('does not bleed the recipient company into the sender company (collision fix)', () => {
    const v = buildLetterValues({
      today: '2026-07-09',
      recipient: { name: 'Jane', company: 'RecipientCo' },
      sender: { companyName: 'SenderCo' },
    })
    expect(v['Company Name']).toBe('RecipientCo')       // recipient address block
    expect(v['Sender Company Name']).toBe('SenderCo')   // signature / letterhead
    expect(v['Company Name']).not.toBe(v['Sender Company Name'])
  })

  it('specimen mode renders visible [Label] markers for blanks', () => {
    const v = buildLetterValues({
      today: '2026-07-09',
      specimen: true,
      manualFields: [{ placeholder: 'describe additional work', label: 'Description of Work' }],
    })
    expect(v['Name of Recipient']).toBe('[Recipient Name]')
    expect(v['Sender Company Name']).toBe('[Your Company]')
    expect(v['describe additional work']).toBe('[Description of Work]')
    // date is always real, even in specimen mode
    expect(v['Date']).toBe('2026-07-09')
  })

  it('non-specimen mode leaves blanks empty (not [Label])', () => {
    const v = buildLetterValues({ today: '2026-07-09' })
    expect(v['Name of Recipient']).toBe('')
    expect(v['Sender Company Name']).toBe('')
  })

  it('manual values overlay wins over specimen markers and defaults', () => {
    const v = buildLetterValues({
      today: '2026-07-09',
      specimen: true,
      manualFields: [{ placeholder: 'describe additional work', label: 'Description of Work' }],
      manualValues: { 'describe additional work': 'Excavate the sump' },
    })
    expect(v['describe additional work']).toBe('Excavate the sump')
  })
})
