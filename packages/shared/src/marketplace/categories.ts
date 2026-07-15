/** Canonical marketplace supplier/catalogue category taxonomy — single source.
 *
 * Resolves the historical 5-vs-7 divergence between the supplier registration
 * form, the catalogue item form, and the buyer directory. Import from
 * `@esite/shared` everywhere; never hardcode category arrays at call sites.
 */
export interface MarketplaceCategory {
  value: string
  label: string
  icon: string
}

export const MARKETPLACE_CATEGORIES: readonly MarketplaceCategory[] = [
  { value: 'electrical', label: 'Electrical', icon: '⚡' },
  { value: 'mechanical', label: 'Mechanical', icon: '⚙' },
  { value: 'civil',      label: 'Civil',      icon: '🏗' },
  { value: 'safety',     label: 'Safety',     icon: '🦺' },
  { value: 'tools',      label: 'Tools',      icon: '🔧' },
  { value: 'materials',  label: 'Materials',  icon: '🧱' },
  { value: 'general',    label: 'General',    icon: '📦' },
] as const

export const MARKETPLACE_CATEGORY_VALUES: readonly string[] =
  MARKETPLACE_CATEGORIES.map((c) => c.value)

export function isMarketplaceCategory(value: string): boolean {
  return MARKETPLACE_CATEGORY_VALUES.includes(value)
}
