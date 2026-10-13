import { describe, it, expect } from 'vitest'
import { TENANT_PLAN_SEGMENT, fileLabel, parseColourBy, isPdfPath, tenantPlanHref, tenantScheduleHref } from './plan-urls'

describe('tenant plan routes', () => {
  it('two routes under the tenant schedule', () => {
    expect(TENANT_PLAN_SEGMENT).toEqual({ tenant_layout: 'floor-plan', distribution_schematic: 'line-diagram' })
    expect(tenantScheduleHref('p1')).toBe('/projects/p1/tenant-schedule')
    expect(tenantPlanHref('p1', 'tenant_layout')).toBe('/projects/p1/tenant-schedule/floor-plan')
    expect(tenantPlanHref('p1', 'distribution_schematic', { sheet: 's 1' })).toBe('/projects/p1/tenant-schedule/line-diagram?sheet=s%201')
  })
  it('sheet first, then shape, both optional', () => {
    expect(tenantPlanHref('p1', 'tenant_layout', { sheet: 'sh1', shape: 'sp1' })).toBe('/projects/p1/tenant-schedule/floor-plan?sheet=sh1&shape=sp1')
    expect(tenantPlanHref('p1', 'tenant_layout', { shape: 'sp1' })).toBe('/projects/p1/tenant-schedule/floor-plan?shape=sp1')
    expect(tenantPlanHref('p1', 'tenant_layout', { sheet: null, shape: null })).toBe('/projects/p1/tenant-schedule/floor-plan')
  })
  it('file helpers', () => {
    expect(isPdfPath('a/b.PDF')).toBe(true)
    expect(fileLabel('o/p/pl/sh/2.pdf')).toBe('2.pdf')
  })
})

describe('colour mode in the URL', () => {
  it('?colour=board is the only way into board mode; anything else is status', () => {
    expect(parseColourBy('board')).toBe('board')
    expect(parseColourBy('status')).toBe('status')
    expect(parseColourBy('BOARD')).toBe('status')
    expect(parseColourBy(undefined)).toBe('status')
    expect(parseColourBy(null)).toBe('status')
  })
  it('tenantPlanHref carries colour=board after sheet and shape, and drops status', () => {
    expect(tenantPlanHref('p1', 'tenant_layout', { sheet: 's1', shape: 'x', colour: 'board' }))
      .toBe('/projects/p1/tenant-schedule/floor-plan?sheet=s1&shape=x&colour=board')
    expect(tenantPlanHref('p1', 'tenant_layout', { sheet: 's1', colour: 'status' }))
      .toBe('/projects/p1/tenant-schedule/floor-plan?sheet=s1')
  })
})
