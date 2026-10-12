/**
 * One full navigation, for the moments a tenant plan page needs a fresh server
 * render (a new sheet, a replaced file, a deleted sheet): the new signed URL is
 * minted by the server. A module of its own so tests can mock it.
 */
export function navigateTo(href: string): void {
  window.location.assign(href)
}
