/**
 * The `server-only` build-time guard, behind a path Vite can resolve.
 *
 * `server-only` is NOT installed under apps/web. Next.js aliases it to its own
 * bundled copy (next/dist/compiled/server-only) at build time, which is why the
 * existing `import 'server-only'` modules (services/*.server.ts,
 * lib/jbcc/letterhead.ts, lib/tenant-electrical/recompute.ts) compile — and
 * `tsc` does not check side-effect imports, so type-check passes too. Vite has
 * no such alias: a test that imports a module importing 'server-only' fails at
 * TRANSFORM time ("Failed to resolve import "server-only""), before
 * `vi.mock('server-only', …)` can intercept anything. That is why every one of
 * those modules is only ever mocked away in tests, never imported by one.
 *
 * A module that needs BOTH the guard and a unit test imports this file instead
 * and its test does `vi.mock('@/lib/server-only', () => ({}))`. The guard is
 * unchanged: this file imports 'server-only' itself, so a Client Component
 * that (transitively) imports such a module still fails the Next build.
 *
 * If `server-only` is ever added to apps/web's dependencies, delete this file,
 * switch the imports back to 'server-only', and mock that directly.
 */
import 'server-only'
