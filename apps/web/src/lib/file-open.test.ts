import { describe, it, expect, vi, afterEach } from 'vitest'
import { previewViaSignedUrl, triggerDownload } from './file-open'

afterEach(() => vi.restoreAllMocks())

describe('previewViaSignedUrl', () => {
  it('opens the tab synchronously — before the signed URL resolves (defeats the popup blocker)', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)

    let resolveUrl!: (v: { url: string }) => void
    const pending = new Promise<{ url: string }>((r) => {
      resolveUrl = r
    })

    const done = previewViaSignedUrl(() => pending)
    // The tab must already be open here — the click gesture is still on the
    // stack. This is the whole point: opening AFTER the await would be blocked.
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.location.href).toBe('')

    resolveUrl({ url: 'https://signed.example/doc.pdf' })
    await done
    expect(tab.location.href).toBe('https://signed.example/doc.pdf')
    expect(tab.close).not.toHaveBeenCalled()
  })

  it('closes the pre-opened tab and surfaces the error when the URL fails', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)

    const res = await previewViaSignedUrl(async () => ({ error: 'Access denied' }))
    expect(res.error).toBe('Access denied')
    expect(tab.close).toHaveBeenCalledTimes(1)
    expect(tab.location.href).toBe('')
  })
})

describe('triggerDownload', () => {
  it('clicks a transient anchor to trigger the browser download', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    triggerDownload('https://signed.example/doc.pdf?download')
    expect(click).toHaveBeenCalledTimes(1)
  })
})
