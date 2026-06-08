/**
 * Browser helpers for opening / downloading a file that lives behind a
 * short-lived signed URL fetched via a server action.
 *
 * The popup-block trap: a browser only lets `window.open()` spawn a tab while a
 * user gesture (the click) is still on the call stack. Awaiting the signed-URL
 * round-trip first loses that context, so a `window.open()` afterwards is
 * silently blocked — the click appears to do nothing. The fix is to open a
 * blank tab *synchronously* inside the click handler, then redirect it once the
 * URL resolves.
 */

type SignedUrlResult = { url: string } | { error: string }

/**
 * Preview a file in a new tab without tripping the popup blocker.
 * Pass a thunk that resolves the signed URL; it is awaited only AFTER the tab
 * has been opened in the gesture.
 */
export async function previewViaSignedUrl(
  fetchUrl: () => Promise<SignedUrlResult>,
): Promise<{ error?: string }> {
  // Open synchronously, inside the gesture, BEFORE awaiting anything.
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null
  if (tab) tab.opener = null

  const res = await fetchUrl()
  if ('error' in res) {
    tab?.close()
    return { error: res.error }
  }

  if (tab) tab.location.href = res.url
  else if (typeof window !== 'undefined') window.location.href = res.url // blocked → fall back to same tab
  return {}
}

/**
 * Force a download via a transient anchor. The URL must already carry
 * `Content-Disposition: attachment` (set server-side through createSignedUrl's
 * `download` option) — the HTML `download` attribute is ignored for
 * cross-origin signed URLs.
 */
export function triggerDownload(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
