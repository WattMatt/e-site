/**
 * Equipment-code auto-suggest helper.
 *
 * Rule (§4 of 2026-05-20-equipment-schedule-design.md):
 *   Return the next free "{PREFIX}-{n}" code for the given equipment kind,
 *   where n is the lowest positive integer not already used by a code that
 *   matches exactly "{PREFIX}-{positive integer}".
 *
 * Per-kind prefixes:
 *   rmu                → RMU-{n}
 *   mini_sub           → MS-{n}
 *   generator          → GEN-{n}
 *   main_board         → MB-{n}
 *   common_area_board  → CB-{n}
 *
 * Pure function — no I/O, deterministic.
 */

import type { NodeKind } from './types';

/** Equipment kinds managed by the Equipment Schedule (not tenant_db). */
export const EQUIPMENT_KINDS = [
  'main_board',
  'common_area_board',
  'rmu',
  'mini_sub',
  'generator',
] as const satisfies ReadonlyArray<Exclude<NodeKind, 'tenant_db'>>;

export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

const KIND_PREFIX: Record<EquipmentKind, string> = {
  rmu: 'RMU',
  mini_sub: 'MS',
  generator: 'GEN',
  main_board: 'MB',
  common_area_board: 'CB',
};

/**
 * Suggest the next available code for the given equipment kind.
 *
 * @param kind - One of the five equipment kinds (not tenant_db).
 * @param existingCodes - All codes already in use on this project (any kind).
 * @returns The next free "{PREFIX}-{n}" string, e.g. "RMU-3".
 */
export function suggestEquipmentCode(kind: EquipmentKind, existingCodes: string[]): string {
  const prefix = KIND_PREFIX[kind];
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);

  // Collect all positive integers already used under this prefix.
  const used = new Set<number>();
  for (const code of existingCodes) {
    const m = code.match(pattern);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0) used.add(n);
    }
  }

  // Find the lowest positive integer not in the used set.
  let n = 1;
  while (used.has(n)) n++;

  return `${prefix}-${n}`;
}
