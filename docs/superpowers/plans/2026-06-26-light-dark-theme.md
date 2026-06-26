# Light / Dark / System Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-selectable Light / Dark / System theme to the dark-only web app, with no flash of wrong theme and cross-device persistence.

**Architecture:** Theming stays CSS-variable based (no library). The existing `:root` palette is the dark theme; a warm-paper light palette is added under `:root[data-theme="light"]` and a `@media (prefers-color-scheme: light)` block for the System default. A `theme` cookie is the SSR-readable source of truth the root layout reads to set `<html data-theme>`; `profiles.theme_preference` is the durable cross-device store, seeded into the cookie at login and by middleware. A client `ThemeProvider` flips the theme instantly and persists via a server action.

**Tech Stack:** Next.js App Router (RSC + server actions), `@supabase/ssr`, Supabase Postgres, Vitest + Testing Library + Playwright, plain CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-06-25-light-dark-theme-design.md`

---

## File Structure

**New files (`apps/web/src/`):**
- `lib/theme/types.ts` — `ThemeMode` type + cookie constants.
- `lib/theme/resolve.ts` — pure `parseThemeMode()` + `resolveDataTheme()`.
- `lib/theme/resolve.test.ts` — Vitest unit tests for the resolver.
- `lib/theme/actions.ts` — `'use server'` `setThemePreference()` (cookie + DB).
- `components/providers/ThemeProvider.tsx` — client context + `useTheme()`.
- `components/theme/ThemeToggle.tsx` — compact header control.
- `components/theme/ThemeSegmentedControl.tsx` — labelled Settings control.

**Modified:**
- `app/globals.css` — light palette layer + `color-scheme`.
- `app/layout.tsx` — read cookie, set `<html data-theme>`, wrap `ThemeProvider`.
- `app/(auth)/auth/callback/route.ts` — seed `theme` cookie from profile on login.
- `src/middleware.ts` + `lib/supabase/middleware.ts` — seed `theme` cookie when missing.
- `app/(admin)/layout.tsx` — render the header `ThemeToggle`.
- `app/(admin)/settings/page.tsx` — render the Settings control.
- `packages/db/src/types.ts` — add `theme_preference` to `profiles`.
- `apps/edge-functions/supabase/migrations/<next>_add_profiles_theme_preference.sql` — new column.
- Colour-sweep targets across `apps/web/src` (Phase B).

**New E2E:** `apps/web/e2e/tests/NN-theme.spec.ts`.

---

# Phase A — Theme infrastructure

## Task 1: Database column + generated types

**Files:**
- Create: `apps/edge-functions/supabase/migrations/<next>_add_profiles_theme_preference.sql`
- Modify: `packages/db/src/types.ts` (profiles `Row`, `Insert`, `Update`)

- [ ] **Step 1: Find the next migration number**

Run: `ls apps/edge-functions/supabase/migrations | sort | tail -3`
Take the highest numeric prefix and add 1 (zero-padded to the same width). Use it as `<next>` below.

- [ ] **Step 2: Create the migration**

Create `apps/edge-functions/supabase/migrations/<next>_add_profiles_theme_preference.sql`:

```sql
-- Per-user UI theme preference for light/dark/system.
-- Default 'system' so existing users follow their device until they choose.
alter table public.profiles
  add column theme_preference text not null default 'system'
  check (theme_preference in ('light','dark','system'));
```

- [ ] **Step 3: Update generated DB types (hand-edit)**

The `gen-types` script (`pnpm -C packages/db gen-types`) requires a local Supabase instance; this repo runs prod-only, so hand-edit instead. In `packages/db/src/types.ts`, in the `profiles` table block, add `theme_preference` immediately after `popia_consent_at` in all three shapes:

In `Row` (non-optional, not null):
```typescript
            popia_consent_at: string | null
            theme_preference: string
            updated_at: string
```

In `Insert` (optional — has a default):
```typescript
            popia_consent_at?: string | null
            theme_preference?: string
            updated_at?: string
```

In `Update` (optional):
```typescript
            popia_consent_at?: string | null
            theme_preference?: string
            updated_at?: string
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -C packages/db build` (or `pnpm -C apps/web typecheck`)
Expected: passes — `theme_preference` now resolves on `profiles`.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/migrations packages/db/src/types.ts
git commit -m "feat(theme): add profiles.theme_preference column + types"
```

> **Deploy note (do not run now):** this migration must be applied to prod before the feature ships. See the project's migration deploy workflow.

---

## Task 2: Pure theme resolver (TDD)

**Files:**
- Create: `apps/web/src/lib/theme/types.ts`
- Create: `apps/web/src/lib/theme/resolve.ts`
- Test: `apps/web/src/lib/theme/resolve.test.ts`

- [ ] **Step 1: Create the types file**

Create `apps/web/src/lib/theme/types.ts`:

```typescript
export type ThemeMode = 'light' | 'dark' | 'system'

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'] as const

export const THEME_COOKIE = 'theme'

// 1 year — the preference is sticky; the user changes it deliberately.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/theme/resolve.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseThemeMode, resolveDataTheme } from './resolve'

describe('parseThemeMode', () => {
  it('returns the value when it is a valid mode', () => {
    expect(parseThemeMode('light')).toBe('light')
    expect(parseThemeMode('dark')).toBe('dark')
    expect(parseThemeMode('system')).toBe('system')
  })

  it('falls back to "system" for missing or invalid values', () => {
    expect(parseThemeMode(undefined)).toBe('system')
    expect(parseThemeMode('')).toBe('system')
    expect(parseThemeMode('purple')).toBe('system')
  })
})

describe('resolveDataTheme', () => {
  it('maps explicit modes to the data-theme attribute value', () => {
    expect(resolveDataTheme('light')).toBe('light')
    expect(resolveDataTheme('dark')).toBe('dark')
  })

  it('returns null for system so the attribute is omitted (CSS media query decides)', () => {
    expect(resolveDataTheme('system')).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C apps/web exec vitest run src/lib/theme/resolve.test.ts`
Expected: FAIL — cannot find module `./resolve`.

- [ ] **Step 4: Write the implementation**

Create `apps/web/src/lib/theme/resolve.ts`:

```typescript
import { THEME_MODES, type ThemeMode } from './types'

/** Coerce an untrusted cookie/string value to a valid ThemeMode, defaulting to 'system'. */
export function parseThemeMode(value: string | undefined | null): ThemeMode {
  return THEME_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'system'
}

/**
 * The value for the <html data-theme> attribute.
 * Returns null for 'system' — the attribute is omitted so the
 * `@media (prefers-color-scheme)` rules in globals.css take over.
 */
export function resolveDataTheme(mode: ThemeMode): 'light' | 'dark' | null {
  return mode === 'system' ? null : mode
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C apps/web exec vitest run src/lib/theme/resolve.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/theme/types.ts apps/web/src/lib/theme/resolve.ts apps/web/src/lib/theme/resolve.test.ts
git commit -m "feat(theme): pure theme-mode resolver with tests"
```

---

## Task 3: Light palette in globals.css

**Files:**
- Modify: `apps/web/src/app/globals.css` (after the `:root { … }` block ending at line 81)

- [ ] **Step 1: Add the light palette + color-scheme block**

Insert immediately after the closing `}` of the existing `:root` block (line 81). The existing `:root` remains the **dark** theme. Accent hex values are AA-tuned starting points; verify contrast during Task 10 / Phase B QA.

```css
/* ============================================================
   LIGHT THEME — "Warm Paper"
   Applied when the user explicitly chooses light (data-theme="light")
   AND, via the @media block below, when the user is on System and the
   device prefers light. The two declaration lists are intentionally
   duplicated: plain CSS cannot share a variable block across an
   attribute selector and a media query. Keep them in sync.
   ============================================================ */
:root[data-theme="light"] {
  color-scheme: light;

  /* Surfaces */
  --c-base:       #ECE7DD;
  --c-surface:    #F2EEE6;
  --c-panel:      #FBF8F2;
  --c-elevated:   #FFFFFF;

  /* Borders */
  --c-border:     #DAD2C4;
  --c-border-mid: #C7BDA9;
  --c-border-hi:  #A99E88;

  /* Text */
  --c-text:       #1C1814;
  --c-text-mid:   #5E574A;
  --c-text-dim:   #938A78;

  /* Accents (foreground — readable as text/icon on light surfaces) */
  --c-amber:      #B5670F;
  --c-amber-dim:  #FBEAD6;
  --c-amber-mid:  #C98A4A;
  --c-warning:    #B45309;
  --c-green:      #1F7A52;
  --c-green-dim:  #DCF3E8;
  --c-red:        #B5362A;
  --c-red-dim:    #FBE3E0;
  --c-blue:       #1F58C0;
  --c-blue-dim:   #E2ECFB;
  --c-orange:     #C2410C;

  /* JBCC "Procedural" extensions */
  --c-border-soft:   rgba(0,0,0,.06);
  --c-amber-dim-rgb: rgba(181,103,15,.12);
  --c-amber-mid-rgb: rgba(181,103,15,.30);
  --c-red-dim-rgb:   rgba(181,54,42,.10);
  --c-red-bright:    #C0392B;
  --c-text-muted:    #6B6456;
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    color-scheme: light;

    /* Surfaces */
    --c-base:       #ECE7DD;
    --c-surface:    #F2EEE6;
    --c-panel:      #FBF8F2;
    --c-elevated:   #FFFFFF;

    /* Borders */
    --c-border:     #DAD2C4;
    --c-border-mid: #C7BDA9;
    --c-border-hi:  #A99E88;

    /* Text */
    --c-text:       #1C1814;
    --c-text-mid:   #5E574A;
    --c-text-dim:   #938A78;

    /* Accents */
    --c-amber:      #B5670F;
    --c-amber-dim:  #FBEAD6;
    --c-amber-mid:  #C98A4A;
    --c-warning:    #B45309;
    --c-green:      #1F7A52;
    --c-green-dim:  #DCF3E8;
    --c-red:        #B5362A;
    --c-red-dim:    #FBE3E0;
    --c-blue:       #1F58C0;
    --c-blue-dim:   #E2ECFB;
    --c-orange:     #C2410C;

    /* JBCC "Procedural" extensions */
    --c-border-soft:   rgba(0,0,0,.06);
    --c-amber-dim-rgb: rgba(181,103,15,.12);
    --c-amber-mid-rgb: rgba(181,103,15,.30);
    --c-red-dim-rgb:   rgba(181,54,42,.10);
    --c-red-bright:    #C0392B;
    --c-text-muted:    #6B6456;
  }
}
```

- [ ] **Step 2: Set the dark default color-scheme**

In the existing `:root` block (the dark one), add `color-scheme: dark;` as the first declaration (so native controls/scrollbars are dark by default and when `data-theme="dark"` is set):

```css
:root {
  color-scheme: dark;
  /* Surfaces */
  --c-base:       #0B0B12;
  /* …existing… */
```

- [ ] **Step 3: Verify build compiles**

Run: `pnpm -C apps/web build` (or start the dev server)
Expected: no CSS/build errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(theme): add warm-paper light palette + color-scheme"
```

---

## Task 4: Theme persistence server action

**Files:**
- Create: `apps/web/src/lib/theme/actions.ts`

- [ ] **Step 1: Create the server action**

Create `apps/web/src/lib/theme/actions.ts`:

```typescript
'use server'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { parseThemeMode } from './resolve'
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type ThemeMode } from './types'

/**
 * Persist the user's theme choice. Always writes the cookie (the SSR source
 * of truth); also writes profiles.theme_preference when authenticated so the
 * choice follows the user across devices. RLS restricts the update to the
 * caller's own row.
 */
export async function setThemePreference(mode: ThemeMode): Promise<void> {
  const safe = parseThemeMode(mode)

  const cookieStore = await cookies()
  cookieStore.set(THEME_COOKIE, safe, {
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: 'lax',
  })

  // DB sync is best-effort: the cookie above already makes the choice stick on
  // this device, so a failed profile write must not break theme switching.
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({ theme_preference: safe }).eq('id', user.id)
    }
  } catch (err) {
    console.error('setThemePreference: profile update failed', err)
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/theme/actions.ts
git commit -m "feat(theme): server action to persist theme (cookie + profile)"
```

---

## Task 5: ThemeProvider + useTheme hook

**Files:**
- Create: `apps/web/src/components/providers/ThemeProvider.tsx`

- [ ] **Step 1: Create the provider**

Create `apps/web/src/components/providers/ThemeProvider.tsx`:

```typescript
'use client'

import { createContext, useCallback, useContext, useEffect, useState, useTransition } from 'react'
import { setThemePreference } from '@/lib/theme/actions'
import type { ThemeMode } from '@/lib/theme/types'

interface ThemeContextValue {
  /** The user's chosen mode. */
  mode: ThemeMode
  /** The concrete theme in effect ('light' | 'dark'), resolving 'system' via the OS. */
  resolvedTheme: 'light' | 'dark'
  setTheme: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Apply (or clear) the data-theme attribute. 'system' clears it so CSS media queries apply. */
function applyDataTheme(mode: ThemeMode) {
  const el = document.documentElement
  if (mode === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', mode)
}

export function ThemeProvider({
  initialMode,
  children,
}: {
  initialMode: ThemeMode
  children: React.ReactNode
}) {
  const [mode, setMode] = useState<ThemeMode>(initialMode)
  const [systemDark, setSystemDark] = useState(false)
  const [, startTransition] = useTransition()

  // Track the OS preference so resolvedTheme is correct for UI in 'system' mode,
  // and so a live OS flip updates dependent UI (CSS itself reacts via media query).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback((next: ThemeMode) => {
    setMode(next)
    applyDataTheme(next)              // instant visual switch
    startTransition(() => { setThemePreference(next) })  // persist: cookie + DB
  }, [])

  const resolvedTheme: 'light' | 'dark' =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  return (
    <ThemeContext.Provider value={{ mode, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/providers/ThemeProvider.tsx
git commit -m "feat(theme): ThemeProvider context + useTheme hook"
```

---

## Task 6: Wire theme into the root layout

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Add imports**

At the top of `apps/web/src/app/layout.tsx`, after the existing provider imports (line 7), add:

```typescript
import { cookies } from 'next/headers'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { parseThemeMode, resolveDataTheme } from '@/lib/theme/resolve'
import { THEME_COOKIE } from '@/lib/theme/types'
```

- [ ] **Step 2: Make RootLayout async and read the cookie**

Replace the `RootLayout` function (lines 44–56) with:

```typescript
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const mode = parseThemeMode(cookieStore.get(THEME_COOKIE)?.value)
  const dataTheme = resolveDataTheme(mode)

  return (
    <html lang="en" data-theme={dataTheme ?? undefined} suppressHydrationWarning>
      <body className={`${syne.variable} ${mono.variable} ${fraunces.variable} ${plexMono.variable}`}>
        <ErrorBoundary>
          <SentryBoot />
          <ThemeProvider initialMode={mode}>
            <AnalyticsProvider>
              {children}
            </AnalyticsProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Verify no flash, dark unchanged**

Run the dev server. With no `theme` cookie and an OS set to **dark**, the app looks identical to today. Set the OS to **light** (or run with the cookie) and reload — the light palette applies on first paint with no flash.

Run: `pnpm -C apps/web typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat(theme): apply theme cookie at the root layout (no-flash SSR)"
```

---

## Task 7: Seed the theme cookie from the profile (login + middleware)

**Files:**
- Modify: `apps/web/src/app/(auth)/auth/callback/route.ts`
- Modify: `apps/web/src/lib/supabase/middleware.ts`

- [ ] **Step 1: Add a seeding helper + use it on auth success**

In `apps/web/src/app/(auth)/auth/callback/route.ts`, add imports at the top:

```typescript
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE } from '@/lib/theme/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@esite/db'
```

Add this helper near `auditLogin` (bottom of file):

```typescript
async function redirectWithTheme(
  supabase: SupabaseClient<Database>,
  userId: string | null,
  url: string,
) {
  const res = NextResponse.redirect(url)
  if (userId) {
    const { data } = await supabase.from('profiles')
      .select('theme_preference').eq('id', userId).single()
    const mode = data?.theme_preference
    if (mode === 'light' || mode === 'dark' || mode === 'system') {
      res.cookies.set(THEME_COOKIE, mode, {
        path: '/', maxAge: THEME_COOKIE_MAX_AGE, sameSite: 'lax',
      })
    }
  }
  return res
}
```

Replace the PKCE success return (line 52) `return NextResponse.redirect(`${origin}${next}`)` with:

```typescript
      return await redirectWithTheme(supabase, data.user?.id ?? null, `${origin}${next}`)
```

Replace the OTP success return (line 69) `return NextResponse.redirect(`${origin}${next}`)` with:

```typescript
      return await redirectWithTheme(supabase, data.user?.id ?? null, `${origin}${next}`)
```

- [ ] **Step 2: Seed in middleware as a fallback (existing sessions)**

In `apps/web/src/lib/supabase/middleware.ts`, after the `getUser()` call block (after line 45, before the aal/amr decode), add:

```typescript
  // Seed the theme cookie for already-authenticated sessions that predate the
  // feature (or arrived without hitting the auth callback). Only runs when the
  // cookie is absent, so it fires at most once per device, then the long-lived
  // cookie carries it.
  if (user && !request.cookies.get('theme')) {
    const { data } = await supabase.from('profiles')
      .select('theme_preference').eq('id', user.id).single()
    const mode = data?.theme_preference
    if (mode === 'light' || mode === 'dark' || mode === 'system') {
      supabaseResponse.cookies.set('theme', mode, {
        path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax',
      })
    }
  }
```

> Note: this seeds the cookie for the *next* request. On a brand-new device with a divergent saved preference, the very first page may briefly render System before the cookie takes effect; this is the only edge where a one-time flash is possible and is acceptable.

- [ ] **Step 3: Typecheck**

Run: `pnpm -C apps/web typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(auth)/auth/callback/route.ts" apps/web/src/lib/supabase/middleware.ts
git commit -m "feat(theme): seed theme cookie from profile on login + middleware"
```

---

## Task 8: Header theme toggle

**Files:**
- Create: `apps/web/src/components/theme/ThemeToggle.tsx`
- Test: `apps/web/src/components/theme/ThemeToggle.test.tsx`
- Modify: `apps/web/src/app/(admin)/layout.tsx`

- [ ] **Step 1: Create the toggle**

Create `apps/web/src/components/theme/ThemeToggle.tsx`. Cycles Light → Dark → System; shows the active mode's icon. Matches the inline-style approach used elsewhere in the app.

```typescript
'use client'

import { useTheme } from '@/components/providers/ThemeProvider'
import type { ThemeMode } from '@/lib/theme/types'

const NEXT: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' }
const ICON: Record<ThemeMode, string> = { light: '☀', dark: '☾', system: '◐' }
const LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function ThemeToggle() {
  const { mode, setTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[mode])}
      aria-label={`Theme: ${LABEL[mode]}. Click to change.`}
      title={`Theme: ${LABEL[mode]}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
        background: 'transparent', border: '1px solid var(--c-border)',
        color: 'var(--c-text-mid)', fontSize: 16, lineHeight: 1,
      }}
    >
      <span aria-hidden>{ICON[mode]}</span>
    </button>
  )
}
```

- [ ] **Step 2: Write a component test (provider + toggle)**

Create `apps/web/src/components/theme/ThemeToggle.test.tsx`. This is the spec's component-level check: clicking updates `<html data-theme>` and calls the persistence action. The server action and `matchMedia` are mocked.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { ThemeToggle } from './ThemeToggle'

vi.mock('@/lib/theme/actions', () => ({
  setThemePreference: vi.fn().mockResolvedValue(undefined),
}))
import { setThemePreference } from '@/lib/theme/actions'

beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.removeAttribute('data-theme')
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
})

describe('ThemeToggle', () => {
  it('cycles light → dark: sets data-theme and persists', () => {
    render(<ThemeProvider initialMode="light"><ThemeToggle /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(setThemePreference).toHaveBeenCalledWith('dark')
  })

  it('cycles dark → system: clears data-theme and persists', () => {
    render(<ThemeProvider initialMode="dark"><ThemeToggle /></ThemeProvider>)
    fireEvent.click(screen.getByRole('button'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(setThemePreference).toHaveBeenCalledWith('system')
  })
})
```

- [ ] **Step 3: Run the component test**

Run: `pnpm -C apps/web exec vitest run src/components/theme/ThemeToggle.test.tsx`
Expected: PASS (2 tests). If the runner lacks a jsdom environment, add `// @vitest-environment jsdom` as the first line of the test file.

- [ ] **Step 4: Render it in the portal header**

In `apps/web/src/app/(admin)/layout.tsx`, add the import after line 9:

```typescript
import { ThemeToggle } from '@/components/theme/ThemeToggle'
```

Replace the header block (lines 52–54) with:

```typescript
        <header className="portal-header">
          <OrgSwitcher memberships={orgMemberships} />
          <ThemeToggle />
          <NotificationCentre />
        </header>
```

- [ ] **Step 5: Verify**

Run the dev server. Click the header toggle: the whole app switches Light → Dark → System instantly, and the choice survives a page reload (cookie). Confirm via DevTools that `<html>` gains/loses `data-theme` and a `theme` cookie is set.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/theme/ThemeToggle.tsx apps/web/src/components/theme/ThemeToggle.test.tsx "apps/web/src/app/(admin)/layout.tsx"
git commit -m "feat(theme): header theme toggle + component test"
```

---

## Task 9: Settings theme control

**Files:**
- Create: `apps/web/src/components/theme/ThemeSegmentedControl.tsx`
- Modify: `apps/web/src/app/(admin)/settings/page.tsx`

- [ ] **Step 1: Create the segmented control**

Create `apps/web/src/components/theme/ThemeSegmentedControl.tsx`:

```typescript
'use client'

import { useTheme } from '@/components/providers/ThemeProvider'
import { THEME_MODES, type ThemeMode } from '@/lib/theme/types'

const LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function ThemeSegmentedControl() {
  const { mode, setTheme } = useTheme()
  return (
    <div>
      <label className="ob-label">Appearance</label>
      <div role="radiogroup" aria-label="Appearance" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 10, background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}>
        {THEME_MODES.map((m) => {
          const active = mode === m
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(m)}
              style={{
                padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 13,
                border: 'none',
                background: active ? 'var(--c-amber-dim)' : 'transparent',
                color: active ? 'var(--c-amber)' : 'var(--c-text-mid)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {LABEL[m]}
            </button>
          )
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6 }}>
        System follows your device’s light/dark setting.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Render it in the "Your Profile" panel**

In `apps/web/src/app/(admin)/settings/page.tsx`, add the import after line 5:

```typescript
import { ThemeSegmentedControl } from '@/components/theme/ThemeSegmentedControl'
```

Add the control inside the profile panel body, after the `ProfileSettingsForm` (after line 43, before the closing `</div>` of the padded body):

```typescript
            <ProfileSettingsForm
              userId={user!.id}
              fullName={profile?.full_name ?? ''}
              phone={profile?.phone ?? ''}
              email={user!.email ?? ''}
            />
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--c-border)' }}>
              <ThemeSegmentedControl />
            </div>
```

- [ ] **Step 3: Verify**

Run the dev server, go to Settings. The Appearance control shows the active mode; clicking Light/Dark/System switches instantly and stays in sync with the header toggle. Reload — selection persists.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/theme/ThemeSegmentedControl.tsx "apps/web/src/app/(admin)/settings/page.tsx"
git commit -m "feat(theme): Settings appearance control"
```

---

## Task 10: E2E coverage (Playwright)

**Files:**
- Create: `apps/web/e2e/tests/NN-theme.spec.ts` (use the next free number prefix in `apps/web/e2e/tests`)

- [ ] **Step 1: Inspect an existing e2e test for setup conventions**

Read `apps/web/e2e/tests/01-dashboard.spec.ts` to copy the project's base URL / auth setup helpers. Reuse them below where `// setup` is noted.

- [ ] **Step 2: Write the theme e2e test**

Create `apps/web/e2e/tests/NN-theme.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test.describe('theme', () => {
  test('explicit dark cookie renders data-theme="dark" on first paint', async ({ context, page }) => {
    await context.addCookies([{ name: 'theme', value: 'dark', url: 'http://localhost:3000' }])
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('explicit light cookie renders data-theme="light"', async ({ context, page }) => {
    await context.addCookies([{ name: 'theme', value: 'light', url: 'http://localhost:3000' }])
    await page.goto('/login')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('system (no cookie) omits the attribute and follows the OS', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' })
    const page = await ctx.newPage()
    await page.goto('/login')
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
    // Light palette is in effect: body background is the warm-paper base, not the dark base.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(bg).not.toBe('rgb(11, 11, 18)') // not --c-base dark
    await ctx.close()
  })
})
```

Adjust the base URL / `url` to match the e2e config from Step 1.

- [ ] **Step 3: Run the test**

Run: `pnpm -C apps/web exec playwright test e2e/tests/NN-theme.spec.ts`
Expected: PASS (3 tests). If auth gating redirects `/login`, keep tests on a public route per Step 1.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/tests/NN-theme.spec.ts
git commit -m "test(theme): e2e coverage for cookie + system resolution"
```

---

# Phase B — Full hardcoded-colour sweep

After Phase A the theme works, but components with hardcoded colours won't adapt. This phase converts them to CSS variables so everything responds to the theme.

## Task 11: Audit hardcoded colours

**Files:**
- Create: `docs/superpowers/notes/theme-colour-audit.md` (working checklist)

- [ ] **Step 1: Generate the audit**

Run from repo root:

```bash
rg -n --no-heading -e '#[0-9a-fA-F]{3,8}\b' -e 'rgba?\(' -e 'hsla?\(' -e '\b(bg|text|border|from|to|via)-(white|black|gray|slate|zinc|neutral|red|green|blue|amber|orange|yellow)-[0-9]{2,3}\b' apps/web/src > /tmp/colour-hits.txt
```

Review `/tmp/colour-hits.txt` and record every hit in `docs/superpowers/notes/theme-colour-audit.md` as a checklist grouped by file, EXCLUDING:
- `apps/web/src/components/GoogleSignInButton.tsx` (Google brand SVG colours — keep).
- The `@media print { … }` block in `globals.css` (intentional white/black for print).
- The `:root`, `:root[data-theme="light"]`, and `@media (prefers-color-scheme: light)` blocks themselves (these are the palette definitions).

- [ ] **Step 2: Commit the audit**

```bash
git add docs/superpowers/notes/theme-colour-audit.md
git commit -m "docs(theme): hardcoded-colour audit checklist"
```

---

## Task 12: Add fill/foreground tokens needed by the sweep

**Files:**
- Modify: `apps/web/src/app/globals.css` (all three palette blocks: `:root`, `:root[data-theme="light"]`, `@media` light)

Some accents are used as solid **fills** (e.g. the primary button background, progress bars) and must stay brand-bright in light mode, while the same `--c-*` name is darkened for foreground text. Add explicit fill tokens.

- [ ] **Step 1: Add tokens to the dark `:root` block**

```css
  /* Accent fills (stay brand-bright in both themes) + on-accent text */
  --c-amber-fill: #E8923A;
  --c-on-amber:   #1A1712;
```

- [ ] **Step 2: Add the same tokens to BOTH light blocks (`:root[data-theme="light"]` and the `@media` block)**

```css
  --c-amber-fill: #E8923A;
  --c-on-amber:   #1A1712;
```

(Identical in light and dark — the amber fill reads well on either base, with dark on-amber text.)

- [ ] **Step 3: Typecheck/build + commit**

Run: `pnpm -C apps/web build`
Expected: no errors.

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(theme): add amber-fill / on-amber tokens for the sweep"
```

---

## Task 13: Convert the known offenders

**Files:**
- Modify: `apps/web/src/components/ui/Button.tsx`
- Modify: `apps/web/src/components/ui/FileUploadWithProgress.tsx`
- Modify: `apps/web/src/components/ui/PhotoPicker.tsx`
- Modify: `apps/web/src/components/markup/ExportMarkupButton.tsx`
- Modify: `apps/web/src/app/(admin)/settings/ProfileSettingsForm.tsx`

Apply these exact replacements (token mapping):

- [ ] **Step 1: Button.tsx** — primary fill + on-amber text; danger border.
  - `background: 'var(--c-amber)'` (primary) → `background: 'var(--c-amber-fill)'`
  - `color: '#0D0B09'` (primary text) → `color: 'var(--c-on-amber)'`
  - `border: '1px solid #6b1e1e'` (danger) → `border: '1px solid var(--c-red)'`

- [ ] **Step 2: FileUploadWithProgress.tsx**
  - `'#4ade80'` (done bar) → `'var(--c-green)'`
  - any in-progress fill `'var(--c-amber)'` used as a bar background → `'var(--c-amber-fill)'`

- [ ] **Step 3: PhotoPicker.tsx**
  - `color: '#fca5a5'` (error) → `color: 'var(--c-red)'`

- [ ] **Step 4: ExportMarkupButton.tsx**
  - `color: '#dc2626'` (error) → `color: 'var(--c-red)'`

- [ ] **Step 5: ProfileSettingsForm.tsx**
  - `color: '#34d399'` (Saved!) → `color: 'var(--c-green)'`

- [ ] **Step 6: Verify both themes**

Run the dev server. In Light and Dark: the primary button stays amber with readable text; upload "done" bar and "Saved!" use theme green; error texts are readable red in both. No dark-on-light artefacts.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/Button.tsx apps/web/src/components/ui/FileUploadWithProgress.tsx apps/web/src/components/ui/PhotoPicker.tsx apps/web/src/components/markup/ExportMarkupButton.tsx "apps/web/src/app/(admin)/settings/ProfileSettingsForm.tsx"
git commit -m "refactor(theme): convert known hardcoded colours to variables"
```

---

## Task 14: Rebuild CloudFolderPicker onto variables

**Files:**
- Modify: `apps/web/src/components/cloud-storage/CloudFolderPicker.tsx`

This component carries an entire duplicate hardcoded dark palette. Map each hardcoded value to the shared token by role.

- [ ] **Step 1: Apply the mapping**

Replace hex values by role (read each usage to classify it):
- modal/page background `#1A1715` → `var(--c-base)`
- card/surface `#221E1A`-ish → `var(--c-panel)`
- elevated/hover surface → `var(--c-elevated)`
- borders `#3A332C`/`#2A...` → `var(--c-border)` (or `--c-border-mid` for stronger lines)
- primary text `#E8E2D8` → `var(--c-text)`
- secondary/muted text `#988877` → `var(--c-text-mid)` (or `--c-text-dim` for the faintest)
- amber accents `#D4A876` → `var(--c-amber)`
- red/error `#F87171` → `var(--c-red)`

For any hex not covered above, pick the closest token by role from `globals.css` and note it in the audit doc.

- [ ] **Step 2: Verify in both themes**

Open the cloud-storage picker in Light and Dark. It now matches the app theme in both — no standalone dark modal on a light app.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/cloud-storage/CloudFolderPicker.tsx
git commit -m "refactor(theme): map CloudFolderPicker palette onto theme variables"
```

---

## Task 15: Sweep remaining audit items + final QA

**Files:**
- Modify: remaining files listed in `docs/superpowers/notes/theme-colour-audit.md`

- [ ] **Step 1: Convert remaining hits**

Work the audit checklist file-by-file. For each hit, replace the hardcoded colour with the token matching its role (surface/border/text/accent), using the mappings from Tasks 13–14. Add a new semantic token to all three palette blocks only if no existing token fits. Tick each item in the audit doc. Commit in small per-area batches:

```bash
git add <files-in-this-area>
git commit -m "refactor(theme): convert <area> colours to variables"
```

- [ ] **Step 2: Confirm the sweep is complete**

Re-run the audit command from Task 11. The only remaining hits should be the documented exclusions (Google SVG, print block, palette definitions).

Run: `rg -n -e '#[0-9a-fA-F]{3,8}\b' apps/web/src --glob '!**/globals.css'`
Expected: only intentional brand/SVG colours remain; everything else uses `var(--c-*)`.

- [ ] **Step 3: Full visual + accessibility QA**

In both Light and Dark, walk the key screens (dashboard, snags, RFI, diary, settings, cloud picker, file upload, markup export). Verify:
- no dark-on-light or light-on-dark artefacts;
- text meets WCAG AA contrast (spot-check `--c-text`/`--c-text-mid` on `--c-base`/`--c-panel`, and accent text on `*-dim` tints); tune accent hexes in `globals.css` if any fail;
- System mode follows a live OS light/dark switch.

- [ ] **Step 4: Run the full check suite**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web exec vitest run && pnpm -C apps/web exec playwright test e2e/tests/NN-theme.spec.ts`
Expected: all green.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "refactor(theme): complete hardcoded-colour sweep + QA fixes"
```

---

## Done / handoff checklist

- [ ] Migration `<next>_add_profiles_theme_preference.sql` applied to prod (per the project migration deploy workflow) **before** shipping the web change.
- [ ] Theme switches Light/Dark/System from header and Settings, instantly, with no flash on reload.
- [ ] System follows the device and live-updates on OS change.
- [ ] An explicit choice persists across devices (set on one, log in on another).
- [ ] Colour audit shows only the documented exclusions remaining.
