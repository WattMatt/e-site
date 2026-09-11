/**
 * Vitest stand-in for the `server-only` package.
 *
 * `server-only` is NOT installed under apps/web. Next.js aliases the bare
 * specifier at build time — next/dist/build/create-compiler-aliases.js maps
 * `server-only$` to next/dist/compiled/server-only/empty on the React Server
 * layer and to next/dist/compiled/server-only/index (which throws "This module
 * cannot be imported from a Client Component module") on every other layer —
 * so production modules write `import 'server-only'` verbatim and the guard
 * works without the package being a dependency.
 *
 * Vite has no such alias: without one, any test that imports a module that
 * imports 'server-only' fails at TRANSFORM time ("Failed to resolve import"),
 * before `vi.mock` can intercept anything. vitest.config.ts therefore resolves
 * 'server-only' to this empty module, so modules keep the verbatim import and
 * tests `vi.mock('server-only', () => ({}))` above the import, as written.
 *
 * Test-only. Must stay side-effect free; `export {}` only marks it a module
 * (a comment-only file is a global script under isolatedModules).
 */
export {}
