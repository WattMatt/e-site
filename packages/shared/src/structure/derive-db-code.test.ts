/**
 * Tests for deriveDbCode.
 *
 * Rule (§3 of 2026-05-20-tenant-schedule-design.md):
 *   Strip leading "SHOP " (case-insensitive), trim, prefix "DB-".
 *   If there is no "SHOP " prefix, just prefix "DB-" to the trimmed value.
 */

import { describe, it, expect } from 'vitest';
import { deriveDbCode } from './derive-db-code';

describe('deriveDbCode', () => {
  // --- Spec examples (§3) ---
  it('SHOP 3 → DB-3', () => {
    expect(deriveDbCode('SHOP 3')).toBe('DB-3');
  });

  it('SHOP 4A → DB-4A', () => {
    expect(deriveDbCode('SHOP 4A')).toBe('DB-4A');
  });

  it('SHOP 1/2 → DB-1/2', () => {
    expect(deriveDbCode('SHOP 1/2')).toBe('DB-1/2');
  });

  // --- Case-insensitive "SHOP " prefix ---
  it('lowercase "shop 3" strips prefix case-insensitively', () => {
    expect(deriveDbCode('shop 3')).toBe('DB-3');
  });

  it('mixed-case "Shop 11A" strips prefix case-insensitively', () => {
    expect(deriveDbCode('Shop 11A')).toBe('DB-11A');
  });

  // --- Leading/trailing whitespace ---
  it('trims leading whitespace before stripping prefix', () => {
    expect(deriveDbCode('  SHOP 3')).toBe('DB-3');
  });

  it('trims trailing whitespace from the remainder', () => {
    expect(deriveDbCode('SHOP 4A  ')).toBe('DB-4A');
  });

  it('handles extra whitespace inside: "SHOP  3" (double space) passes through intact after strip', () => {
    // "SHOP " is stripped, remainder is " 3" → trimmed → "3"
    expect(deriveDbCode('SHOP  3')).toBe('DB-3');
  });

  // --- No "SHOP " prefix — design doc is silent, safe fallback: prefix DB- to the trimmed value ---
  it('value with no SHOP prefix gets DB- prepended directly', () => {
    expect(deriveDbCode('KIOSK 1')).toBe('DB-KIOSK 1');
  });

  it('bare numeric value with no prefix', () => {
    expect(deriveDbCode('42')).toBe('DB-42');
  });

  // --- SHOP NO. that is literally "SHOP" with nothing after the keyword ---
  it('"SHOP" alone (no trailing space/suffix) → DB-SHOP (no prefix stripped)', () => {
    // "SHOP" without a following space does NOT match "SHOP " pattern
    expect(deriveDbCode('SHOP')).toBe('DB-SHOP');
  });

  // --- Alphanumeric suffixes from §2 examples ---
  it('SHOP 11A → DB-11A', () => {
    expect(deriveDbCode('SHOP 11A')).toBe('DB-11A');
  });

  // --- Slash suffixes ---
  it('SHOP 10/11 → DB-10/11', () => {
    expect(deriveDbCode('SHOP 10/11')).toBe('DB-10/11');
  });

  // --- VACANT shops: the parser lets VACANT shop_numbers through if the SHOP NO. column
  //     contains a normal identifier like "SHOP 5" (TENANT column carries "VACANT").
  //     A SHOP NO. value of literally "VACANT" would be pathological but must not throw. ---
  it('"VACANT" as shop number gets DB- prefix (no SHOP prefix to strip)', () => {
    expect(deriveDbCode('VACANT')).toBe('DB-VACANT');
  });
});
