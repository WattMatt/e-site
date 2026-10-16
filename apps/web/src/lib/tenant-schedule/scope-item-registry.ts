/**
 * The org-wide scope item registry (structure.scope_item_types, 00080).
 *
 * 'db' and 'lighting' are seeded for every organisation and every tenant
 * schedule is built around them, so they can never be removed. Shared by the
 * server action (which enforces it) and the Scope items modal (which hides the
 * Remove control for them).
 */
export const BUILT_IN_SCOPE_ITEM_KEYS: readonly string[] = ['db', 'lighting']

export function isBuiltInScopeItem(key: string): boolean {
  return BUILT_IN_SCOPE_ITEM_KEYS.includes(key)
}
