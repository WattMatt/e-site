/**
 * bo.service.ts — pure computation for beneficial-occupation (BO) date tracking.
 *
 * Design spec: SPEC DOCS/2026-05-21-tenant-bo-dates-design.md.
 *
 * WM hands shops over to tenants on beneficial-occupation dates so they can fit
 * out before the centre opens. Each tenant has a BO period (days before the
 * project opening date); its BO date is opening_date - bo_period_days, with an
 * optional negotiated override. Material orders inherit a "required by" date
 * from their tenant's BO date (equipment orders use the opening date) and get a
 * red/amber/green status against today.
 *
 * Nothing here touches the DB — these are pure functions over YYYY-MM-DD
 * strings. Date arithmetic is UTC-based so it never drifts with the runner's
 * local timezone.
 */

import type { NodeOrderStatus } from './node-order.service';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Common BO periods (days before opening). Larger tenants take longer. */
export const BO_PERIOD_PRESETS = [90, 60, 45, 30] as const;

/**
 * How many days ahead of a required-by date a material order flags amber.
 * Inside this window (and not yet received) the order is "due soon".
 */
export const AMBER_WINDOW_DAYS = 14;

/** Red / amber / green health of a material order against its required-by date. */
export type RagStatus = 'red' | 'amber' | 'green' | 'neutral';

// ─────────────────────────────────────────────────────────────────────────────
// Internal — UTC date arithmetic over YYYY-MM-DD strings
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a YYYY-MM-DD string to a UTC-midnight epoch, or null when the string is
 * malformed or names a calendar date that does not exist (e.g. 2026-02-30).
 */
function isoToUtcMs(iso: string): number | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // Date.UTC rolls overflowing components over (Feb 30 → Mar 2); reject those.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/** Format a UTC epoch back to a YYYY-MM-DD string. */
function utcMsToIso(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Add (or, with a negative n, subtract) whole days to a YYYY-MM-DD string. */
function addDays(iso: string, days: number): string | null {
  const ms = isoToUtcMs(iso);
  if (ms === null) return null;
  return utcMsToIso(ms + days * DAY_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// BO date
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The effective beneficial-occupation date for a tenant.
 *
 * An explicit override always wins — it is a negotiated date and is valid even
 * when no opening date is set. Otherwise the date is opening_date - periodDays.
 * Returns null when there is nothing to compute from.
 */
export function computeBoDate(
  openingDate: string | null,
  periodDays: number | null,
  override: string | null,
): string | null {
  if (override && ISO_DATE_RE.test(override)) return override;
  if (!openingDate || periodDays == null || periodDays <= 0) return null;
  return addDays(openingDate, -periodDays);
}

// ─────────────────────────────────────────────────────────────────────────────
// Material-order required-by date
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderRequiredByArgs {
  /** Project opening date (YYYY-MM-DD), or null when unset. */
  openingDate: string | null;
  /**
   * BO inputs for a tenant order, or null for an equipment order. Equipment
   * orders have no tenant — they fall back to the project opening date.
   */
  tenant: { boPeriodDays: number | null; boDateOverride: string | null } | null;
}

/**
 * The date a material order must be fulfilled by.
 *   Tenant order    → the tenant's effective BO date.
 *   Equipment order → the project opening date.
 * Returns null when the underlying date is not set.
 */
export function computeOrderRequiredBy(args: OrderRequiredByArgs): string | null {
  if (args.tenant) {
    return computeBoDate(args.openingDate, args.tenant.boPeriodDays, args.tenant.boDateOverride);
  }
  return args.openingDate;
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG status
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Red / amber / green health for a material order.
 *
 *   received          → green   (nothing outstanding)
 *   by_tenant         → neutral (the tenant's responsibility — WM cannot action)
 *   no required-by    → neutral (no deadline to measure against)
 *   required-by past  → red     (overdue and not received)
 *   within amberDays  → amber   (due soon)
 *   otherwise         → green   (comfortably ahead)
 *
 * `today` is supplied by the caller (YYYY-MM-DD) so the function stays pure.
 */
export function computeRagStatus(
  requiredBy: string | null,
  orderStatus: NodeOrderStatus,
  today: string,
  amberDays: number = AMBER_WINDOW_DAYS,
): RagStatus {
  if (orderStatus === 'received') return 'green';
  if (orderStatus === 'by_tenant') return 'neutral';
  if (!requiredBy) return 'neutral';

  const requiredMs = isoToUtcMs(requiredBy);
  const todayMs = isoToUtcMs(today);
  if (requiredMs === null || todayMs === null) return 'neutral';

  if (requiredMs < todayMs) return 'red';
  if (requiredMs <= todayMs + amberDays * DAY_MS) return 'amber';
  return 'green';
}
