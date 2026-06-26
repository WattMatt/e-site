# Light / Dark / System Theme — Design Spec

- **Date:** 2026-06-25
- **Status:** Approved (brainstorm) — ready for implementation planning
- **Author:** Arno Mattheus (with Claude)
- **Scope:** `apps/web` (Next.js App Router) + one Supabase migration

---

## 1. Goal

Add a user-selectable **Light / Dark / System** theme to the web app, which today is
dark-only. Drivers, in priority order:

1. **Outdoor / sunlight readability** — site app (RFI, snags, diary) used on phones/tablets
   in bright daylight. The light theme must be high-contrast and low-glare.
2. **User preference / choice** — quick, friction-free switching.
3. **Accessibility** — target WCAG AA contrast (4.5:1 body text, 3:1 large/UI) for all
   text and meaningful UI in both themes.

**Success criteria**

- A user can switch Light / Dark / System from the header and from Settings.
- `System` follows the device's `prefers-color-scheme` and reacts live when the OS flips.
- An explicit choice persists **across devices** (stored on the profile).
- **No flash of wrong theme** on first paint, in any mode, including logged-out pages.
- Every colour in the app adapts to the active theme (full hardcoded-colour sweep), except
  legitimately fixed colours (brand SVGs, print).

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Modes | **Light / Dark / System** |
| Default (existing + new users) | **System** |
| Persistence of explicit choice | **Cross-device** — `profiles` table, with a cookie mirror |
| Light palette direction | **Warm Paper** (warm off-white, keeps cream + amber identity) |
| Toggle placement | **Header + Settings** |
| Hardcoded-colour cleanup | **Full sweep** — convert all to CSS variables |
| Theme library | **None** — custom CSS-variable + cookie/SSR approach (see §4) |

> **Migration note:** default `System` means that on first load after deploy, existing users
> whose device is set to light will immediately see the new light theme. This is intended;
> the light palette is designed to be production-ready from day one.

## 3. Architecture overview

Three sources, resolved in priority order at render time:

1. **Explicit choice** (`light` / `dark`) — wins.
2. **`system`** (the default) — resolve against the device `prefers-color-scheme`.

The **cookie** (`theme`) is the fast, synchronous, SSR-readable source of truth for first
paint. The **`profiles.theme_preference` column** is the durable, cross-device store. The
cookie is (re)seeded from the DB at login so the server never needs a per-request DB call to
render the correct theme.

### Resolution flow

- **First load, explicit Light/Dark:** cookie=`light` → server layout sets
  `<html data-theme="light">` → CSS `:root[data-theme="light"]` applies → correct first paint.
- **First load, System (default):** cookie=`system`/absent → server renders **no**
  `data-theme` → CSS `@media (prefers-color-scheme) :root:not([data-theme])` picks the palette
  with **zero JS**, no flash, and live-updates when the OS flips. Works on public pages.
- **Toggle:** `setTheme()` updates `<html data-theme>` instantly → writes the `theme` cookie →
  if logged in, updates `profiles.theme_preference`.
- **New-device login:** auth callback reads `profiles.theme_preference` → seeds the `theme`
  cookie → next render is already correct.

## 4. CSS layer (`apps/web/src/app/globals.css`)

The current `:root` block remains the **dark** palette. Add:

```css
:root { /* dark — unchanged defaults */ }

:root[data-theme="dark"] { /* explicit dark — same as :root, so a dark choice
                              overrides a light OS */ }

:root[data-theme="light"] { /* warm-paper light values (table below) */ }

/* System (default): no data-theme attribute present → follow the OS */
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) { /* warm-paper light values */ }
}

/* Native controls / scrollbars / form widgets match the theme */
:root, :root[data-theme="dark"] { color-scheme: dark; }
:root[data-theme="light"] { color-scheme: light; }
@media (prefers-color-scheme: light) { :root:not([data-theme]) { color-scheme: light; } }
```

The light values necessarily appear in two rules — `:root[data-theme="light"]` and the
`@media` block — because plain CSS cannot share a variable block across an attribute selector
and a media query. Keep the two blocks adjacent and comment-linked so they can't drift; the
plan decides whether to factor them via a PostCSS/Sass partial if the build makes that clean.

### Warm-Paper light palette (starting values)

Surfaces, text and borders are final; **accent hexes are starting values, AA-verified during
implementation.**

| Token | Dark (current) | Light (Warm Paper) | Role |
|---|---|---|---|
| `--c-base` | `#0B0B12` | `#ECE7DD` | app background |
| `--c-surface` | `#13131E` | `#F2EEE6` | recessed surface |
| `--c-panel` | `#1C1C2A` | `#FBF8F2` | cards / panels |
| `--c-elevated` | `#25253A` | `#FFFFFF` | popovers / menus |
| `--c-border` | `#2C2C40` | `#DAD2C4` | default border |
| `--c-border-mid` | `#3A3A52` | `#C7BDA9` | mid border |
| `--c-border-hi` | `#505070` | `#A99E88` | strong border |
| `--c-text` | `#EDE8DF` | `#1C1814` | primary text |
| `--c-text-mid` | `#9098B0` | `#5E574A` | secondary text |
| `--c-text-dim` | `#5C6478` | `#938A78` | muted text |
| `--c-amber` | `#E8923A` | `#B5670F` | accent foreground (text/icon/link) |
| `--c-green` | `#3DB882` | `#1F7A52` | success foreground |
| `--c-red` | `#E85555` | `#B5362A` | error foreground |
| `--c-blue` | `#5B9CF6` | `#1F58C0` | info foreground |
| `--c-amber-dim` | `#2E1A08` | `#FBEAD6` | accent tint bg |
| `--c-green-dim` | `#0A2E1C` | `#DCF3E8` | success tint bg |
| `--c-red-dim` | `#2E0E0E` | `#FBE3E0` | error tint bg |
| `--c-blue-dim` | `#0C2040` | `#E2ECFB` | info tint bg |

**Accent fill vs. foreground.** The brand amber **fill** (e.g. the primary button background)
stays `#E8923A` in both themes (it reads well as a fill against either base). Where an accent
is used as *foreground* (text/icons/links on a same-tone surface) it uses the darker light
value above. A small set of semantic tokens (`--c-on-amber` for button text, etc.) is settled
in the implementation plan; all final pairs are contrast-checked to AA.

## 5. Persistence & SSR seam

### 5.1 Database

New migration under `apps/edge-functions/supabase/migrations/`:

```sql
alter table public.profiles
  add column theme_preference text not null default 'system'
  check (theme_preference in ('light','dark','system'));
```

Dedicated column (not the `notification_preferences` JSONB) — theming is a distinct concern
and benefits from the check constraint. Existing RLS on `profiles` already allows a user to
update their own row; no new policy needed (verified during build).

### 5.2 Cookie

- Name: `theme`; values `light | dark | system`.
- Attributes: `Path=/`, `SameSite=Lax`, ~1-year `Max-Age`, **not** `HttpOnly` (the client
  provider reads/writes it for instant switching).
- Read on the server via `cookies()` from `next/headers`; the existing Supabase cookie adapter
  pattern in [`lib/supabase/server.ts`](../../../apps/web/src/lib/supabase/server.ts) is the
  reference for set/get.

### 5.3 Root layout — [`src/app/layout.tsx`](../../../apps/web/src/app/layout.tsx)

- Read the `theme` cookie (server).
- `light`/`dark` → render `<html data-theme="...">`; `system`/absent → render `<html>` with no
  `data-theme`.
- Add `suppressHydrationWarning` to `<html>`.
- Pass the resolved cookie value to `ThemeProvider` as its initial state (no hydration
  mismatch — provider initial === server value).

### 5.4 Cookie seeding from DB

- **Login / auth callback** — [`src/app/(auth)/auth/callback/route.ts`](../../../apps/web/src/app/(auth)/auth/callback/route.ts):
  after `exchangeCodeForSession` succeeds (next to the existing `auditLogin` call), read
  `profiles.theme_preference` for the user and set the `theme` cookie before redirect.
- **Middleware** — [`src/middleware.ts`](../../../apps/web/src/middleware.ts) (via
  `updateSession`): if a session exists but the `theme` cookie is missing, set it from the
  profile so the next render is correct even when a user arrives without going through the
  callback. Keep this cheap; skip when the cookie is already present.

## 6. Components

Each unit has one purpose and a clear interface.

1. **`ThemeProvider`** (client context, new — e.g. `src/components/providers/ThemeProvider.tsx`)
   - State: `mode: 'light' | 'dark' | 'system'`, initialised from the server-passed cookie value.
   - `setTheme(mode)`:
     1. set/remove `<html data-theme>` immediately (instant switch);
     2. write the `theme` cookie;
     3. if authenticated, update `profiles.theme_preference` via the browser Supabase client.
   - Exposes `{ mode, resolvedTheme, setTheme }`. `resolvedTheme` resolves `system` via
     `matchMedia('(prefers-color-scheme: dark)')` for UI state (e.g. showing the active icon),
     and subscribes to OS changes.
   - Wired into the provider stack in the layout alongside the existing
     `AnalyticsProvider` / `ErrorBoundary`.

2. **Header control** — added to the `portal-header` in
   [`src/app/(admin)/layout.tsx`](../../../apps/web/src/app/(admin)/layout.tsx), next to
   `NotificationCentre`. Compact (icon button → small menu, or 3-segment) for quick on-site
   switching.

3. **Settings control** — added to the "Your Profile" section of
   [`src/app/(admin)/settings/page.tsx`](../../../apps/web/src/app/(admin)/settings/page.tsx),
   a labelled 3-way segmented control (Light / Dark / System).

4. **Resolver helper** (pure, new — e.g. `src/lib/theme/resolve.ts`): maps
   `(preference, cookie)` → the `data-theme` attribute value (or none). Pure and unit-tested.

Both toggle UIs are thin views over `ThemeProvider`.

## 7. Full colour sweep

1. **Audit** — exhaustive search across `apps/web/src` for: `#[0-9a-fA-F]{3,8}`, `rgb(` /
   `rgba(`, `hsl(`, Tailwind literal colours (`bg-white`, `text-black`, `bg-gray-*`, etc.).
   Produce a checklist of every hit.
2. **Convert** — replace each with the appropriate `var(--c-*)`. Where no token fits, add a
   semantic token with **both** a light and dark value (e.g. a real `--c-green` for
   [`FileUploadWithProgress`](../../../apps/web/src/components/ui/FileUploadWithProgress.tsx)'s
   `#4ade80`).
3. **Rebuild private palettes** — [`CloudFolderPicker`](../../../apps/web/src/components/cloud-storage/CloudFolderPicker.tsx)
   carries an entire duplicate hardcoded dark palette; re-map it onto the shared variables.
   Also: [`Button`](../../../apps/web/src/components/ui/Button.tsx) (`#0D0B09`, `#6b1e1e`),
   [`PhotoPicker`](../../../apps/web/src/components/ui/PhotoPicker.tsx) (`#fca5a5`),
   [`ExportMarkupButton`](../../../apps/web/src/components/markup/ExportMarkupButton.tsx)
   (`#dc2626`).
4. **Exclusions (intentionally fixed):** Google brand-SVG colours in
   [`GoogleSignInButton`](../../../apps/web/src/components/GoogleSignInButton.tsx); the print
   `@media` white/black override in `globals.css`.

## 8. Error handling & edge cases

- **DB write fails** on `setTheme` → non-fatal: the cookie + DOM are already updated, so the
  theme still works on this device; log the error (Sentry). Cross-device sync simply lags until
  the next successful write.
- **Public / logged-out pages** → no DB; the toggle writes cookie + DOM only; `system` is
  handled by the CSS media query regardless of auth.
- **Live OS change while on `system`** → handled by CSS (no JS); the provider's `matchMedia`
  listener keeps `resolvedTheme` (and the active-icon UI) in sync.
- **Hydration** → server attribute and provider initial state both derive from the same cookie
  value; `suppressHydrationWarning` covers the `system` (no-attribute) case.

## 9. Testing / verification

- **Unit (Vitest, `*.test.ts`)** — the pure resolver in §6.4: every `(preference, cookie)`
  combination → expected `data-theme`. Pattern matches existing
  [`lib/boq/parse-sheet.test.ts`](../../../apps/web/src/lib/boq/parse-sheet.test.ts).
- **Component (Vitest + Testing Library)** — toggling the control updates `<html data-theme>`,
  writes the cookie, and calls the Supabase profile update.
- **E2E (Playwright, `e2e/tests/*.spec.ts`)** — assert `<html data-theme>` for each cookie
  scenario; reload shows no flash; emulate `prefers-color-scheme` (Playwright
  `colorScheme`) to verify `system`.
- **Manual matrix** — for each mode: reload = no flash; OS flip live-updates under `system`;
  set on one logged-in browser, log in on another → matches; spot-check converted components
  (CloudFolderPicker, PhotoPicker, upload progress) in both themes; contrast spot-check to AA.

## 10. Out of scope (non-goals)

- Per-org or admin-forced themes; scheduled/auto day-night switching.
- Theming the marketing/public site beyond what the shared globals already cover.
- A configurable multi-theme system beyond the two palettes (light + dark).
- Reworking the print stylesheet.

## 11. Affected files (anchors)

- `apps/web/src/app/globals.css` — palette layer (§4)
- `apps/edge-functions/supabase/migrations/<n>_theme_preference.sql` — new column (§5.1)
- `apps/web/src/app/layout.tsx` — cookie read → `<html data-theme>` + provider (§5.3)
- `apps/web/src/app/(auth)/auth/callback/route.ts` — seed cookie from profile (§5.4)
- `apps/web/src/middleware.ts` — seed cookie when missing (§5.4)
- `apps/web/src/components/providers/ThemeProvider.tsx` — new (§6.1)
- `apps/web/src/lib/theme/resolve.ts` — new pure resolver (§6.4)
- `apps/web/src/app/(admin)/layout.tsx` — header control (§6.2)
- `apps/web/src/app/(admin)/settings/page.tsx` — settings control (§6.3)
- Colour-sweep targets across `apps/web/src` (§7)
