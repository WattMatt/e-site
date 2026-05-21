/**
 * Tests for bo.service.ts — beneficial-occupation date computation.
 * Design spec: SPEC DOCS/2026-05-21-tenant-bo-dates-design.md.
 */

import { describe, it, expect } from 'vitest';
import {
  computeBoDate,
  computeOrderRequiredBy,
  computeRagStatus,
  BO_PERIOD_PRESETS,
  AMBER_WINDOW_DAYS,
} from './bo.service';

// ─────────────────────────────────────────────────────────────────────────────
// computeBoDate
// ─────────────────────────────────────────────────────────────────────────────

describe('computeBoDate', () => {
  it('computes opening date minus the period', () => {
    expect(computeBoDate('2026-12-01', 60, null)).toBe('2026-10-02');
  });

  it('computes across a year boundary', () => {
    expect(computeBoDate('2026-02-15', 90, null)).toBe('2025-11-17');
  });

  it('handles each preset period', () => {
    expect(computeBoDate('2026-12-01', 90, null)).toBe('2026-09-02');
    expect(computeBoDate('2026-12-01', 60, null)).toBe('2026-10-02');
    expect(computeBoDate('2026-12-01', 45, null)).toBe('2026-10-17');
    expect(computeBoDate('2026-12-01', 30, null)).toBe('2026-11-01');
  });

  it('handles a leap-year February correctly', () => {
    // 2028 is a leap year — 2028-03-01 minus 30 days = 2028-01-31
    expect(computeBoDate('2028-03-01', 30, null)).toBe('2028-01-31');
  });

  it('override wins over the computed date', () => {
    expect(computeBoDate('2026-12-01', 60, '2026-11-15')).toBe('2026-11-15');
  });

  it('override is valid even with no opening date or period', () => {
    expect(computeBoDate(null, null, '2026-11-15')).toBe('2026-11-15');
  });

  it('returns null when the opening date is missing', () => {
    expect(computeBoDate(null, 60, null)).toBeNull();
  });

  it('returns null when the period is missing', () => {
    expect(computeBoDate('2026-12-01', null, null)).toBeNull();
  });

  it('returns null when the period is zero or negative', () => {
    expect(computeBoDate('2026-12-01', 0, null)).toBeNull();
    expect(computeBoDate('2026-12-01', -10, null)).toBeNull();
  });

  it('returns null for a malformed opening date', () => {
    expect(computeBoDate('not-a-date', 60, null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeOrderRequiredBy
// ─────────────────────────────────────────────────────────────────────────────

describe('computeOrderRequiredBy', () => {
  it('tenant order uses the tenant BO date', () => {
    expect(
      computeOrderRequiredBy({
        openingDate: '2026-12-01',
        tenant: { boPeriodDays: 60, boDateOverride: null },
      }),
    ).toBe('2026-10-02');
  });

  it('tenant order honours the override', () => {
    expect(
      computeOrderRequiredBy({
        openingDate: '2026-12-01',
        tenant: { boPeriodDays: 60, boDateOverride: '2026-11-20' },
      }),
    ).toBe('2026-11-20');
  });

  it('equipment order (tenant null) uses the opening date', () => {
    expect(computeOrderRequiredBy({ openingDate: '2026-12-01', tenant: null })).toBe('2026-12-01');
  });

  it('equipment order with no opening date is null', () => {
    expect(computeOrderRequiredBy({ openingDate: null, tenant: null })).toBeNull();
  });

  it('tenant order with no period and no opening date is null', () => {
    expect(
      computeOrderRequiredBy({
        openingDate: null,
        tenant: { boPeriodDays: null, boDateOverride: null },
      }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeRagStatus
// ─────────────────────────────────────────────────────────────────────────────

describe('computeRagStatus', () => {
  const TODAY = '2026-06-01';

  it('received order → green regardless of date', () => {
    expect(computeRagStatus('2026-01-01', 'received', TODAY)).toBe('green');
  });

  it('by_tenant order → neutral', () => {
    expect(computeRagStatus('2026-01-01', 'by_tenant', TODAY)).toBe('neutral');
  });

  it('no required-by date → neutral', () => {
    expect(computeRagStatus(null, 'required', TODAY)).toBe('neutral');
  });

  it('overdue + not received → red', () => {
    expect(computeRagStatus('2026-05-31', 'required', TODAY)).toBe('red');
    expect(computeRagStatus('2026-05-01', 'ordered', TODAY)).toBe('red');
  });

  it('due today → amber', () => {
    expect(computeRagStatus(TODAY, 'required', TODAY)).toBe('amber');
  });

  it('within the amber window → amber', () => {
    expect(computeRagStatus('2026-06-10', 'required', TODAY)).toBe('amber');
  });

  it('exactly at the amber edge → amber', () => {
    // TODAY + 14 days = 2026-06-15
    expect(computeRagStatus('2026-06-15', 'required', TODAY)).toBe('amber');
  });

  it('one day past the amber edge → green', () => {
    expect(computeRagStatus('2026-06-16', 'required', TODAY)).toBe('green');
  });

  it('comfortably ahead → green', () => {
    expect(computeRagStatus('2026-09-01', 'ordered', TODAY)).toBe('green');
  });

  it('honours a custom amber window', () => {
    expect(computeRagStatus('2026-06-20', 'required', TODAY, 30)).toBe('amber');
    expect(computeRagStatus('2026-06-20', 'required', TODAY, 7)).toBe('green');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('BO_PERIOD_PRESETS are the four standard periods, descending', () => {
    expect([...BO_PERIOD_PRESETS]).toEqual([90, 60, 45, 30]);
  });

  it('AMBER_WINDOW_DAYS is 14', () => {
    expect(AMBER_WINDOW_DAYS).toBe(14);
  });
});
