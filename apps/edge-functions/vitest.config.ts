import { defineConfig } from 'vitest/config'

// Pure auth-email modules are runtime-agnostic TS and use explicit `.ts`
// relative imports (Deno style). Vitest resolves explicit `.ts` extensions
// natively, so no alias is required. index.ts (the Deno wrapper) imports
// from https://esm.sh/... and is intentionally excluded from unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['supabase/functions/**/*.test.ts'],
    exclude: ['**/index.ts', 'node_modules/**'],
  },
})
