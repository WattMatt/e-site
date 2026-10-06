import { describe, expect, it } from 'vitest'
import type { Template } from '../inspections/types'
import { photoItems, parseItemRef } from './photo-items'
import miniSub from './__fixtures__/mini-sub-inspection-report.json'

const MINI = miniSub as unknown as Template

describe('photoItems', () => {
  const items = photoItems(MINI)

  it('numbers every answerable field from 1 in template order', () => {
    expect(items[0]).toMatchObject({ n: 1, sectionId: 'visual_structural_checks', fieldId: 'enclosure_integrity' })
    expect(items.map((i) => i.n)).toEqual(items.map((_, i) => i + 1))
  })

  it('includes photo fields and excludes signatures and files', () => {
    const ids = items.map((i) => i.fieldId)
    expect(ids).toContain('thermographic_survey')
    expect(ids).not.toContain('inspector_signature')
    expect(ids).not.toContain('service_report')
    expect(items.find((i) => i.fieldId === 'thermographic_survey')).toMatchObject({ isPhotoField: true, required: true })
  })

  it('is stable: the same template always yields the same numbers', () => {
    expect(photoItems(MINI)).toEqual(items)
  })
})

describe('parseItemRef', () => {
  it.each([
    ['10', 10], [' 10 ', 10], ['item 10', 10], ['Item10', 10], ['#10', 10], ['no. 10', 10], ['10.', 10],
  ])('reads %j as item %d', (s, n) => expect(parseItemRef(s)).toBe(n))

  it.each([['', null], ['ten', null], ['10 and 11', null], ['0', null], ['item', null], ['2026-10-05', null], ['1000', null]])(
    'rejects %j', (s, n) => expect(parseItemRef(s)).toBe(n),
  )
})
