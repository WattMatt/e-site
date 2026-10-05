import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { ServiceWorkerRegistrar } from './ServiceWorkerRegistrar'

const unregister = vi.fn(async () => true)
const register = vi.fn(async () => ({}))
const cacheDelete = vi.fn(async () => true)

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, getRegistrations: async () => [{ unregister }, { unregister }] },
  })
  vi.stubGlobal('caches', { keys: async () => ['esite-static-v1', 'other-app'], delete: cacheDelete })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const flush = () => new Promise(r => setTimeout(r, 0))

describe('ServiceWorkerRegistrar', () => {
  it('registers /sw.js at the root scope in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    render(<ServiceWorkerRegistrar />)
    await flush()
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
    expect(unregister).not.toHaveBeenCalled()
  })

  it('outside production, removes any leftover worker and its caches instead of registering', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    render(<ServiceWorkerRegistrar />)
    await flush()
    expect(register).not.toHaveBeenCalled()
    expect(unregister).toHaveBeenCalledTimes(2)
    expect(cacheDelete).toHaveBeenCalledWith('esite-static-v1')
    expect(cacheDelete).not.toHaveBeenCalledWith('other-app')
  })

  it('the kill switch unregisters and clears caches even in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SW_DISABLED', 'true')
    render(<ServiceWorkerRegistrar />)
    await flush()
    expect(register).not.toHaveBeenCalled()
    expect(unregister).toHaveBeenCalledTimes(2)
    expect(cacheDelete).toHaveBeenCalledWith('esite-static-v1')
  })
})
