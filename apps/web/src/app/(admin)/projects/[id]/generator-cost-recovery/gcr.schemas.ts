/**
 * Zod schemas for generator cost-recovery config.
 *
 * Plain module — NOT 'use server' — so these can be imported from both
 * server actions and client components.
 */

import { z } from 'zod'

// ─── Settings ────────────────────────────────────────────────────────────────

export const gcrSettingsSchema = z.object({
  standard_kw_per_sqm:              z.coerce.number().nonnegative(),
  fast_food_kw_per_sqm:             z.coerce.number().nonnegative(),
  restaurant_kw_per_sqm:            z.coerce.number().nonnegative(),
  national_kw_per_sqm:              z.coerce.number().nonnegative(),
  capital_recovery_period_years:    z.coerce.number().int().min(1),
  capital_recovery_rate_percent:    z.coerce.number().min(0).max(100),
  rate_per_tenant_db:               z.coerce.number().nonnegative(),
  num_main_boards:                  z.coerce.number().int().nonnegative(),
  rate_per_main_board:              z.coerce.number().nonnegative(),
  additional_cabling_cost:          z.coerce.number().nonnegative(),
  control_wiring_cost:              z.coerce.number().nonnegative(),
  diesel_cost_per_litre:            z.coerce.number().nonnegative(),
  running_hours_per_month:          z.coerce.number().nonnegative(),
  maintenance_cost_annual:          z.coerce.number().nonnegative(),
  power_factor:                     z.coerce.number().min(0).max(100),
  running_load_percentage:          z.coerce.number().min(0).max(100),
  maintenance_contingency_percent:  z.coerce.number().min(0).max(100),
})

export type GcrSettingsInput = z.infer<typeof gcrSettingsSchema>

// ─── Zone ─────────────────────────────────────────────────────────────────────

export const gcrZoneSchema = z.object({
  id:          z.string().uuid().optional(),
  zone_name:   z.string().min(1),
  zone_number: z.coerce.number().int(),
})

export type GcrZoneInput = z.infer<typeof gcrZoneSchema>

// ─── Generator ────────────────────────────────────────────────────────────────

export const gcrGeneratorSchema = z.object({
  id:               z.string().uuid().optional(),
  zone_id:          z.string().uuid(),
  generator_number: z.coerce.number().int(),
  generator_size:   z.string().nullable(),
  generator_cost:   z.coerce.number().nonnegative(),
})

export type GcrGeneratorInput = z.infer<typeof gcrGeneratorSchema>

// ─── Tenant assignment (bulk patch) ───────────────────────────────────────────

export const gcrAssignmentPatchSchema = z
  .object({
    zone_id:            z.string().uuid().nullable().optional(),
    participation:      z.enum(['shared', 'own', 'none']).optional(),
    shop_category:      z.enum(['standard', 'fast_food', 'restaurant', 'national', 'other']).nullable().optional(),
    manual_kw_override: z.number().nonnegative().nullable().optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'Nothing to save' })

export const gcrBulkAssignmentSchema = z.object({
  nodeIds: z.array(z.string().uuid()).min(1).max(500),
  patch:   gcrAssignmentPatchSchema,
})

export type GcrAssignmentPatch = z.infer<typeof gcrAssignmentPatchSchema>
