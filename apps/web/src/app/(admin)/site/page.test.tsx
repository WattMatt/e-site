import { describe, it, expect, vi } from 'vitest'

const redirect = vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) })
const permanentRedirect = vi.fn()
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u), permanentRedirect: (u: string) => permanentRedirect(u) }))

import SiteRedirectPage from './page'

describe('/site', () => {
  it('sends old links and bookmarks to the project list with a temporary redirect', () => {
    expect(() => SiteRedirectPage()).toThrow('NEXT_REDIRECT /projects')
    expect(redirect).toHaveBeenCalledWith('/projects')
    expect(permanentRedirect).not.toHaveBeenCalled()
  })
})
