// @vitest-environment node
import { describe, it, expect } from 'vitest'
// posthog-js's own router — the thing that decides which host each request goes
// to. Asserting against it (not a hand-written list) is what lets these tests
// fail when posthog-js or our config changes the hosts it calls.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { RequestRouter } = require('posthog-js/lib/src/utils/request-router') as {
  RequestRouter: new (instance: { config: { api_host: string; ui_host?: string } }) => {
    endpointFor(target: 'api' | 'flags' | 'assets' | 'ui', path?: string): string
  }
}
import { buildContentSecurityPolicy } from '../security/csp'
import { posthogClientOptions } from './posthog-client-options'
import { DEFAULT_POSTHOG_API_HOST, posthogHosts, resolvePostHogHosts, type PostHogHosts } from './posthog-hosts'

function directive(policy: string, name: string): string[] {
  const found = policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' '))
  return found ? found.split(/\s+/).slice(1) : []
}

/** Origins posthog-js will request when initialised with these hosts. */
function originsPostHogCalls(hosts: PostHogHosts) {
  const router = new RequestRouter({ config: { api_host: hosts.apiHost, ui_host: hosts.uiHost } })
  const origin = (u: string) => new URL(u).origin
  return {
    events: origin(router.endpointFor('api', '/e/')),
    flags: origin(router.endpointFor('flags', '/flags/')),
    config: origin(router.endpointFor('assets', '/array/phc_x/config')),
    scripts: origin(router.endpointFor('assets', '/static/surveys.js')),
  }
}

describe('PostHog hosts and the CSP agree', () => {
  const cases: Array<[string, string | undefined]> = [
    ['unset (production today)', undefined],
    ['the old EU UI host', 'https://eu.posthog.com'],
    ['the legacy US alias', 'https://app.posthog.com'],
    ['a reverse proxy', 'https://e.e-site.live/'],
  ]

  it.each(cases)('every request posthog-js makes is allowed — %s', (_label, env) => {
    const hosts = resolvePostHogHosts(env)
    const policy = buildContentSecurityPolicy({ dev: false, posthog: hosts })
    const calls = originsPostHogCalls(hosts)
    const connect = directive(policy, 'connect-src')
    expect(connect).toContain(calls.events)
    expect(connect).toContain(calls.flags)
    expect(connect).toContain(calls.config)
    expect(directive(policy, 'script-src')).toContain(calls.scripts)
  })

  it('the shipped policy allows exactly the hosts the shipped client calls', () => {
    // Route through the options posthog.init really receives, not the resolver.
    const calls = originsPostHogCalls({
      apiHost: posthogClientOptions.api_host!,
      uiHost: posthogClientOptions.ui_host!,
      assetsHost: '',
    })
    const policy = buildContentSecurityPolicy({ dev: false })
    const posthogIn = (d: string) => directive(policy, d).filter((s) => s.includes('posthog'))
    expect(new Set(posthogIn('connect-src'))).toEqual(new Set([calls.events, calls.flags, calls.config]))
    expect(posthogIn('script-src')).toEqual([calls.scripts])
  })

  it('defaults to the EU region (the project is in the EU — /legal/privacy)', () => {
    expect(DEFAULT_POSTHOG_API_HOST).toBe('https://eu.i.posthog.com')
    expect(resolvePostHogHosts(undefined)).toEqual({
      apiHost: 'https://eu.i.posthog.com',
      uiHost: 'https://eu.posthog.com',
      assetsHost: 'https://eu-assets.i.posthog.com',
    })
    expect(resolvePostHogHosts('')).toEqual(resolvePostHogHosts(undefined))
  })

  it('the 2026-10-06 regression: the EU hosts the browser called are no longer refused', () => {
    // Exactly the three origins production refused before this change.
    const policy = buildContentSecurityPolicy({ dev: false })
    const connect = directive(policy, 'connect-src')
    expect(connect).toContain('https://eu.i.posthog.com')
    expect(connect).toContain('https://eu-assets.i.posthog.com')
    // eu.posthog.com was only called because api_host pointed at the UI host;
    // with api_host on the ingestion host, flags go to eu.i.posthog.com instead.
    expect(originsPostHogCalls(posthogHosts).flags).toBe('https://eu.i.posthog.com')
    expect(posthogClientOptions.api_host).toBe('https://eu.i.posthog.com')
  })
})

describe('client options stay within /legal/privacy and /cookies (no consent banner)', () => {
  it('sets no cookie and creates no person profiles from the browser', () => {
    expect(posthogClientOptions.persistence).toBe('localStorage')
    expect(posthogClientOptions.person_profiles).toBe('identified_only')
  })

  it('pins off every capture the notice rules out, whatever the PostHog project settings say', () => {
    expect(posthogClientOptions).toMatchObject({
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      disable_session_recording: true,
      disable_surveys: true,
      capture_exceptions: false,
      capture_performance: false,
    })
  })
})
