import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const nav = vi.hoisted(() => ({ pathname: '/dashboard', params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.params,
}))
vi.mock('./SolarNavItem', () => ({ SolarNavItem: () => null }))
vi.mock('@/components/theme/ThemeToggle', () => ({ ThemeToggle: () => <button type="button">Theme</button> }))

const db = vi.hoisted(() => ({
  projects: [] as { id: string; name: string }[],
  notifications: [] as unknown[],
}))

// A thenable query builder: every chained call returns itself; awaiting it
// resolves with the table's rows (maybeSingle → the first row).
function query(rows: () => unknown[]) {
  let single = false
  let idFilter: string | null = null
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'limit', 'update']) q[m] = () => q
  q.eq = (col: string, val: string) => { if (col === 'id') idFilter = val; return q }
  q.maybeSingle = () => { single = true; return q }
  q.then = (resolve: (v: unknown) => void) => {
    let data = rows() as { id?: string }[]
    if (idFilter) data = data.filter(r => r.id === idFilter)
    resolve({ data: single ? data[0] ?? null : data, error: null })
  }
  return q
}
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    schema: () => ({ from: () => query(() => db.projects) }),
    from: () => query(() => db.notifications),
    channel: () => ({ on() { return this }, subscribe() { return this } }),
    removeChannel: () => {},
  }),
}))

import { MobileTabBar } from './MobileTabBar'
import { NotificationsProvider } from '@/components/ui/NotificationCentre'

function renderBar(role: Parameters<typeof MobileTabBar>[0]['role'] = 'contractor', tariffAdmin = false) {
  return render(
    <NotificationsProvider>
      <MobileTabBar role={role} tariffAdmin={tariffAdmin} />
    </NotificationsProvider>,
  )
}

beforeEach(() => {
  nav.pathname = '/dashboard'
  nav.params = new URLSearchParams()
  db.projects = [{ id: 'p1', name: 'KINGSWALK' }, { id: 'p2', name: 'ITONKA' }]
  db.notifications = []
  // This jsdom build exposes no localStorage; give the "last used" path a store.
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  })
})

describe('MobileTabBar', () => {
  it('offers the four tabs, with Projects as a plain link', () => {
    renderBar()
    const bar = screen.getByRole('navigation', { name: 'Phone navigation' })
    expect(within(bar).getByRole('link', { name: 'Projects' }).getAttribute('href')).toBe('/projects')
    for (const name of ['Capture', 'Inbox', 'More']) expect(within(bar).getByRole('button', { name })).toBeTruthy()
  })

  it('inside a project, Capture offers that project’s verbs without asking which project', async () => {
    nav.pathname = '/projects/p1/snags'
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    const sheet = screen.getByRole('dialog', { name: 'Capture' })
    const hrefs = within(sheet).getAllByRole('link').map(a => a.getAttribute('href'))
    expect(hrefs).toEqual([
      '/projects/p1/diary?new=1',
      '/projects/p1/snags/new',
      '/projects/p1/forms/new',
      '/projects/p1/inspections/new',
      '/rfis/new?projectId=p1',
    ])
    await waitFor(() => expect(within(sheet).getByText('KINGSWALK')).toBeTruthy())
    expect(within(sheet).queryByRole('button', { name: 'Change' })).toBeNull()
  })

  it('outside a project, Capture asks for the project first, then scopes the verbs to it', async () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    const sheet = screen.getByRole('dialog', { name: 'Capture' })
    fireEvent.click(await within(sheet).findByRole('button', { name: /ITONKA/ }))
    expect(within(sheet).getAllByRole('link')[1].getAttribute('href')).toBe('/projects/p2/snags/new')
    // The choice is remembered and listed first next time.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Change' }))
    const rows = await within(sheet).findAllByRole('button', { name: /KINGSWALK|ITONKA/ })
    expect(rows[0].textContent).toContain('ITONKA')
    expect(rows[0].textContent).toContain('Last used')
  })

  it('treats /projects/new as outside a project', async () => {
    nav.pathname = '/projects/new'
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    expect(await screen.findByText('Which project is this for?')).toBeTruthy()
  })

  it('More hides owner/admin-only entries from a contractor and shows them to an admin', () => {
    const { unmount } = renderBar('contractor')
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    let sheet = screen.getByRole('dialog', { name: 'More' })
    expect(within(sheet).queryByRole('link', { name: /Settings/ })).toBeNull()
    expect(within(sheet).queryByRole('link', { name: /Inspection Templates/ })).toBeNull()
    expect(within(sheet).getByRole('link', { name: /Dashboard/ })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: /Sign out/ }).closest('form')?.getAttribute('action')).toBe('/auth/signout')
    unmount()

    renderBar('admin', true)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    sheet = screen.getByRole('dialog', { name: 'More' })
    expect(within(sheet).getByRole('link', { name: /Settings/ }).getAttribute('href')).toBe('/settings')
    expect(within(sheet).getByRole('link', { name: /Tariff library/ })).toBeTruthy()
  })

  it('Inbox shows the unread count on the tab and the notifications in the sheet', async () => {
    db.notifications = [
      { id: 'n1', title: 'Snag assigned', body: null, is_read: false, created_at: new Date().toISOString(), action_url: null },
      { id: 'n2', title: 'Diary posted', body: null, is_read: true, created_at: new Date().toISOString(), action_url: null },
    ]
    renderBar()
    expect(await screen.findByRole('button', { name: 'Inbox, 1 unread' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Inbox, 1 unread' }))
    const sheet = screen.getByRole('dialog', { name: 'Inbox' })
    expect(within(sheet).getByText('Snag assigned')).toBeTruthy()
    expect(within(sheet).getByText('Diary posted')).toBeTruthy()
  })

  it('a link to the page you are already on still closes the sheet', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('link', { name: /Dashboard/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is modal: the page behind is inert while open, restored after, and focus returns to the opener on dismiss', () => {
    renderBar()
    const opener = screen.getByRole('button', { name: 'More' })
    const pageRoot = opener.closest('body > *') as HTMLElement
    opener.focus()
    fireEvent.click(opener)
    const sheet = screen.getByRole('dialog', { name: 'More' })
    expect(pageRoot.hasAttribute('inert')).toBe(true)
    expect(sheet.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(pageRoot.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('does not pull focus back to the tab bar when a sheet link navigates', () => {
    renderBar()
    const opener = screen.getByRole('button', { name: 'More' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('link', { name: /Projects/ }))
    expect(document.activeElement).not.toBe(opener)
  })

  it('a sheet closes on Escape and on the close button', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
