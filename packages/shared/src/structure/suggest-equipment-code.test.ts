/**
 * Tests for suggestEquipmentCode.
 *
 * Rule (§4 of 2026-05-20-equipment-schedule-design.md):
 *   Return the next free "{PREFIX}-{n}" code for the given equipment kind,
 *   where n is the lowest positive integer not already in existingCodes.
 *
 * Per-kind prefixes:
 *   rmu                → RMU-{n}
 *   mini_sub           → MS-{n}
 *   generator          → GEN-{n}
 *   main_board         → MB-{n}
 *   common_area_board  → CB-{n}
 */

import { describe, it, expect } from 'vitest';
import { suggestEquipmentCode } from './suggest-equipment-code';

describe('suggestEquipmentCode — per-kind prefix', () => {
  it('rmu → RMU-1 when no existing codes', () => {
    expect(suggestEquipmentCode('rmu', [])).toBe('RMU-1');
  });

  it('mini_sub → MS-1 when no existing codes', () => {
    expect(suggestEquipmentCode('mini_sub', [])).toBe('MS-1');
  });

  it('generator → GEN-1 when no existing codes', () => {
    expect(suggestEquipmentCode('generator', [])).toBe('GEN-1');
  });

  it('main_board → MB-1 when no existing codes', () => {
    expect(suggestEquipmentCode('main_board', [])).toBe('MB-1');
  });

  it('common_area_board → CB-1 when no existing codes', () => {
    expect(suggestEquipmentCode('common_area_board', [])).toBe('CB-1');
  });
});

describe('suggestEquipmentCode — next-number logic', () => {
  it('returns n+1 when codes RMU-1 through RMU-n already exist (contiguous)', () => {
    expect(suggestEquipmentCode('rmu', ['RMU-1', 'RMU-2'])).toBe('RMU-3');
  });

  it('returns the first gap when existing codes are non-contiguous', () => {
    // RMU-1 and RMU-3 exist → RMU-2 is the gap
    expect(suggestEquipmentCode('rmu', ['RMU-1', 'RMU-3'])).toBe('RMU-2');
  });

  it('returns 1 when the only existing code for this kind is not RMU-1 (gap at start)', () => {
    expect(suggestEquipmentCode('rmu', ['RMU-2'])).toBe('RMU-1');
  });

  it('fills first gap among many', () => {
    // 1, 3, 4, 5 exist → 2 is first gap
    expect(suggestEquipmentCode('generator', ['GEN-1', 'GEN-3', 'GEN-4', 'GEN-5'])).toBe('GEN-2');
  });

  it('returns n+1 when 1..n all occupied with no gaps', () => {
    expect(suggestEquipmentCode('mini_sub', ['MS-1', 'MS-2', 'MS-3'])).toBe('MS-4');
  });
});

describe('suggestEquipmentCode — existing codes do not match prefix', () => {
  it('ignores codes belonging to other kinds', () => {
    // project has RMU-1..3 and GEN-1, asking for mini_sub → MS-1
    expect(suggestEquipmentCode('mini_sub', ['RMU-1', 'RMU-2', 'RMU-3', 'GEN-1'])).toBe('MS-1');
  });

  it('ignores non-matching codes even if they share a substring', () => {
    // MB-1 should not affect common_area_board (CB-n)
    expect(suggestEquipmentCode('common_area_board', ['MB-1', 'MB-2'])).toBe('CB-1');
  });

  it('handles mixed matching and non-matching codes', () => {
    // MS-1 matches; RMU-1, GEN-2 do not → next for mini_sub is MS-2
    expect(suggestEquipmentCode('mini_sub', ['MS-1', 'RMU-1', 'GEN-2'])).toBe('MS-2');
  });
});

describe('suggestEquipmentCode — edge cases', () => {
  it('ignores malformed codes with the right prefix but non-numeric suffix', () => {
    // "RMU-A" should not count toward the numbering
    expect(suggestEquipmentCode('rmu', ['RMU-A', 'RMU-2'])).toBe('RMU-1');
  });

  it('ignores codes with prefix but zero or negative suffix', () => {
    expect(suggestEquipmentCode('rmu', ['RMU-0', 'RMU--1'])).toBe('RMU-1');
  });

  it('handles large existing set correctly', () => {
    const codes = Array.from({ length: 10 }, (_, i) => `MB-${i + 1}`);
    expect(suggestEquipmentCode('main_board', codes)).toBe('MB-11');
  });
});
