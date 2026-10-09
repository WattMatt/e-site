import { describe, it, expect } from 'vitest'
import { shopStatus, isShopComplete, SHOP_STATUS_LABEL, type ShopProgressFacts } from './shop-status'

const TODAY = '2026-06-20'
const COMPLETE: ShopProgressFacts = {
  scope: 'received',
  layoutIssued: true,
  db: 'received',
  lights: 'received',
  boDate: '2026-05-01',
}
const active = (over: Partial<ShopProgressFacts> = {}) =>
  ({ state: 'active', facts: { ...COMPLETE, ...over } }) as const

describe('isShopComplete', () => {
  it('needs scope, layout, DB and lights all done', () => {
    expect(isShopComplete(COMPLETE)).toBe(true)
  })
  it('accepts not-required scope and by-tenant orders as done', () => {
    expect(isShopComplete({ ...COMPLETE, scope: 'not_required', db: 'by_tenant', lights: 'by_tenant' })).toBe(true)
  })
  it.each([
    ['scope awaited', { scope: 'awaited' as const }],
    ['layout not issued', { layoutIssued: false }],
    ['DB required', { db: 'required' as const }],
    ['DB ordered', { db: 'ordered' as const }],
    ['lights required', { lights: 'required' as const }],
    ['lights ordered', { lights: 'ordered' as const }],
    ['no DB order row', { db: null }],
    ['no lights order row', { lights: null }],
  ])('is not complete when %s', (_label, over) => {
    expect(isShopComplete({ ...COMPLETE, ...over })).toBe(false)
  })
})

describe('shopStatus', () => {
  it('complete is never overdue, even with a past BO date', () => {
    expect(shopStatus(active(), TODAY)).toEqual({ status: 'complete', overdue: false })
  })
  it('incomplete with a past BO date is in progress and overdue', () => {
    expect(shopStatus(active({ db: 'ordered' }), TODAY)).toEqual({ status: 'in_progress', overdue: true })
  })
  it('a BO date of today is not overdue', () => {
    expect(shopStatus(active({ db: 'ordered', boDate: TODAY }), TODAY)).toEqual({ status: 'in_progress', overdue: false })
  })
  it('a future BO date is not overdue', () => {
    expect(shopStatus(active({ db: 'ordered', boDate: '2026-07-01' }), TODAY)).toEqual({ status: 'in_progress', overdue: false })
  })
  it('no BO date is not overdue', () => {
    expect(shopStatus(active({ db: null, boDate: null }), TODAY)).toEqual({ status: 'in_progress', overdue: false })
  })
  it('decommissioned and unlinked are never overdue', () => {
    expect(shopStatus({ state: 'decommissioned' }, TODAY)).toEqual({ status: 'decommissioned', overdue: false })
    expect(shopStatus({ state: 'unlinked' }, TODAY)).toEqual({ status: 'unlinked', overdue: false })
  })
  it('has a label for every status', () => {
    expect(SHOP_STATUS_LABEL).toEqual({
      complete: 'Complete',
      in_progress: 'In progress',
      decommissioned: 'Decommissioned',
      unlinked: 'Unassigned',
    })
  })
})
