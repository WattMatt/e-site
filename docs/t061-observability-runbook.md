# T-061 — Sentry + PostHog Observability Runbook

What this covers: turning on error monitoring (Sentry) and product analytics (PostHog) across web and mobile for production cutover.

---

## 1. Code status

| Surface | File | Status |
|---|---|---|
| Web — server-side Sentry | [`apps/web/src/instrumentation.ts`](../apps/web/src/instrumentation.ts) | ✅ Wired; loads on first server request |
| Web — client-side Sentry | [`apps/web/src/lib/sentry.ts`](../apps/web/src/lib/sentry.ts) + [`SentryBoot.tsx`](../apps/web/src/components/providers/SentryBoot.tsx) | ✅ Wired in `layout.tsx` |
| Web — PostHog | [`apps/web/src/components/providers/AnalyticsProvider.tsx`](../apps/web/src/components/providers/AnalyticsProvider.tsx) | ✅ Wired, POPIA-safe (`autocapture: false`, `maskAllInputs: true`) |
| Web — event catalogue | [`apps/web/src/lib/analytics.ts`](../apps/web/src/lib/analytics.ts) | ✅ `ANALYTICS_EVENTS` defined |
| Web — health check | [`apps/web/src/app/api/health/route.ts`](../apps/web/src/app/api/health/route.ts) | Pre-existing (spot check before launch) |
| Mobile — Sentry | [`apps/mobile/src/lib/sentry.ts`](../apps/mobile/src/lib/sentry.ts) + [`ObservabilityBoot.tsx`](../apps/mobile/src/components/ObservabilityBoot.tsx) | ⚠️ Code ready, needs `pnpm add` |
| Mobile — PostHog | [`apps/mobile/src/lib/analytics.ts`](../apps/mobile/src/lib/analytics.ts) | ⚠️ Code ready, needs `pnpm add` |

Both mobile libs use dynamic `import()` wrapped in try/catch. Missing package == silent no-op, so the app still boots before the install.

---

## 2. One-time install

```bash
# Mobile deps — run from the repo root
pnpm add @sentry/react-native --filter @esite/mobile
pnpm add posthog-react-native --filter @esite/mobile
pnpm add expo-application expo-device expo-localization --filter @esite/mobile
# posthog-react-native peers ^

# Expo config plugin (required for Sentry sourcemap upload on EAS builds)
npx @sentry/wizard@latest -s -i reactNative
# ...this updates app.config.ts and adds sentry.properties
```

Web deps are already in `apps/web/package.json` — no install step.

---

## 3. Required environment variables

### Web (`apps/web/.env.production`)

```
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
NEXT_PUBLIC_POSTHOG_KEY=phc_<key>
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com  # or https://eu.posthog.com
```

Add both to Vercel → Project Settings → Environment Variables (scope: Production + Preview).

### Mobile (EAS secrets)

```bash
eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN  --value "https://..."
eas secret:create --scope project --name EXPO_PUBLIC_POSTHOG_KEY --value "phc_..."
eas secret:create --scope project --name EXPO_PUBLIC_POSTHOG_HOST --value "https://app.posthog.com"
```

---

## 4. Sentry configuration (dashboard steps)

After the DSN is wired:

1. Sentry → Projects → _(your project)_ → Alerts → **Create Alert Rule**.
2. Rule: `When: event.level is error`  ·  `If: count > 10 in 1 hour`  ·  `Then: notify #eng-alerts`. (AC from T-061.)
3. Enable **Release Tracking**: set `release: <git sha>` in the `Sentry.init` call OR configure the Vercel Sentry integration to auto-inject it.
4. Confirm **PII scrubbing** is on (default). The `beforeSend` hooks in `instrumentation.ts` and `sentry.ts` already strip `access_token=` and `token=` from URLs.

---

## 5. PostHog configuration (dashboard steps)

1. PostHog → Project → Feature Flags → (skip for launch; revisit in Phase 2 per `spec-v2.md`).
2. Build the activation funnel:
   - `signup_started` → `signup_completed` → `onboarding_completed` → `coc_uploaded` → `marketplace_order_placed`.
   - Save as `Activation funnel v1`.
3. Set a weekly report on the funnel (PostHog → Insights → Schedule).
4. Confirm the following events fire on smoke-test:
   - Visit `/signup` on staging → dispatch `signup_started` via form submit handler.
   - Complete signup → `signup_completed`.
   - Upload a COC → `coc_uploaded`.
   - Place a marketplace order → `marketplace_order_placed`.

Event names come from `ANALYTICS_EVENTS` in `apps/web/src/lib/analytics.ts` (and the mobile mirror). If you rename an event, rename it in both files in the same commit.

---

## 6. Smoke test

After deploying to staging with DSNs set:

- [ ] `window.__SENTRY__` defined in the browser console on any staging page.
- [ ] Throw a test error from `/api/health?throw=1` (or similar) — appears in Sentry within 30 s.
- [ ] PostHog Live Events shows a `$pageview` within 10 s of a staging page load.
- [ ] Mobile: trigger a handled exception → appears in Sentry project under `@esite/mobile`.
- [ ] Mobile: open the app on a clean device → PostHog Live Events shows the automatic session event.

---

## 7. Sign-off

| Step | Owner | Date |
|---|---|---|
| DSNs added to Vercel |  |  |
| DSNs added to EAS secrets |  |  |
| Mobile deps installed + EAS build green |  |  |
| Smoke test passed |  |  |
| Alert rule (>10 errors/h) created |  |  |
| Activation funnel saved in PostHog |  |  |
| T-061 signed off (Arno) |  |  |
