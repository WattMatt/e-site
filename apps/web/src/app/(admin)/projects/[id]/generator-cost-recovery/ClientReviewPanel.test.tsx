import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { GcrChangeRequestRow } from '@esite/shared'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const publishMock = vi.fn()
const manageMock = vi.fn()
const resolveMock = vi.fn()
const actionMock = vi.fn()

vi.mock('./gcr-client-review.actions', () => ({
  publishGcrForClientReviewAction: (...a: unknown[]) => publishMock(...a),
  manageClientSiteAccessAction: (...a: unknown[]) => manageMock(...a),
  resolveClientByEmailAction: (...a: unknown[]) => resolveMock(...a),
  actionGcrChangeRequestAction: (...a: unknown[]) => actionMock(...a),
}))

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}))

import { ClientReviewPanel } from './ClientReviewPanel'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'
const CLIENT_ID = '00000000-0000-0000-0000-000000000077'

function makeRequest(overrides: Partial<GcrChangeRequestRow> = {}): GcrChangeRequestRow {
  return {
    id: 'r1',
    project_id: PROJECT_ID,
    organisation_id: 'org-1',
    snapshot_id: 'snap-1',
    node_id: 'node-1',
    client_id: CLIENT_ID,
    field: 'participation',
    old_value: 'shared',
    new_value: 'own',
    comment: 'we generate our own power',
    status: 'open',
    admin_reply: null,
    actioned_by: null,
    actioned_at: null,
    created_at: '2026-06-18T08:00:00Z',
    updated_at: '2026-06-18T08:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  publishMock.mockResolvedValue({ ok: true })
  manageMock.mockResolvedValue({ ok: true })
  resolveMock.mockResolvedValue({ userId: CLIENT_ID })
  actionMock.mockResolvedValue({ ok: true })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ClientReviewPanel — publish', () => {
  it('publish button calls publishGcrForClientReviewAction with the project id', async () => {
    render(
      <ClientReviewPanel projectId={PROJECT_ID} grants={[]} requests={[]} lastPublishedAt={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /publish for client review/i }))
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith(PROJECT_ID))
  })

  it('shows the last-published timestamp when present', () => {
    render(
      <ClientReviewPanel
        projectId={PROJECT_ID}
        grants={[]}
        requests={[]}
        lastPublishedAt="2026-06-18T10:00:00Z"
      />,
    )
    expect(screen.getByText(/last published:/i)).toBeTruthy()
  })

  it('states it has not been published when no timestamp', () => {
    render(
      <ClientReviewPanel projectId={PROJECT_ID} grants={[]} requests={[]} lastPublishedAt={null} />,
    )
    expect(screen.getByText(/not yet published/i)).toBeTruthy()
  })
})

describe('ClientReviewPanel — manage access', () => {
  it('grant resolves the email then grants, surfacing the "invite first" error cleanly', async () => {
    resolveMock.mockResolvedValue({ error: 'No client account for that email — invite them first' })
    render(
      <ClientReviewPanel projectId={PROJECT_ID} grants={[]} requests={[]} lastPublishedAt={null} />,
    )
    fireEvent.change(screen.getByLabelText(/client email to grant/i), {
      target: { value: 'ghost@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /grant access/i }))

    await waitFor(() =>
      expect(resolveMock).toHaveBeenCalledWith(PROJECT_ID, 'ghost@example.com'),
    )
    // grant is NOT attempted when resolution fails
    expect(manageMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/invite them first/i)
  })

  it('grant resolves then calls manageClientSiteAccessAction with grant', async () => {
    render(
      <ClientReviewPanel projectId={PROJECT_ID} grants={[]} requests={[]} lastPublishedAt={null} />,
    )
    fireEvent.change(screen.getByLabelText(/client email to grant/i), {
      target: { value: 'client@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /grant access/i }))

    await waitFor(() => expect(manageMock).toHaveBeenCalledWith(PROJECT_ID, CLIENT_ID, 'grant'))
  })

  it('revoke calls manageClientSiteAccessAction with revoke for the row', async () => {
    render(
      <ClientReviewPanel
        projectId={PROJECT_ID}
        grants={[{ user_id: CLIENT_ID, email: 'client@example.com', full_name: 'Client Co' }]}
        requests={[]}
        lastPublishedAt={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /revoke/i }))
    await waitFor(() => expect(manageMock).toHaveBeenCalledWith(PROJECT_ID, CLIENT_ID, 'revoke'))
  })
})

describe('ClientReviewPanel — requests queue', () => {
  it('renders a request row with old → proposed values and the comment', () => {
    render(
      <ClientReviewPanel
        projectId={PROJECT_ID}
        grants={[]}
        requests={[makeRequest()]}
        lastPublishedAt={null}
      />,
    )
    // field label, old value, and proposed value (in its own <strong>) all visible
    expect(screen.getByText('participation')).toBeTruthy()
    expect(screen.getByText('shared')).toBeTruthy()
    expect(screen.getByText('own')).toBeTruthy()
    // client comment surfaced
    expect(screen.getByText(/we generate our own power/i)).toBeTruthy()
  })

  it('accept calls actionGcrChangeRequestAction with decision accept', async () => {
    render(
      <ClientReviewPanel
        projectId={PROJECT_ID}
        grants={[]}
        requests={[makeRequest()]}
        lastPublishedAt={null}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }))
    await waitFor(() =>
      expect(actionMock).toHaveBeenCalledWith(PROJECT_ID, 'r1', { decision: 'accept' }),
    )
  })

  it('decline requires a reason and passes it as reply', async () => {
    render(
      <ClientReviewPanel
        projectId={PROJECT_ID}
        grants={[]}
        requests={[makeRequest()]}
        lastPublishedAt={null}
      />,
    )
    // declining with no reason is blocked
    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/reason/i))
    expect(actionMock).not.toHaveBeenCalled()

    // with a reason it goes through
    fireEvent.change(screen.getByLabelText('reply-r1'), { target: { value: 'Not feasible' } })
    fireEvent.click(screen.getByRole('button', { name: /^decline$/i }))
    await waitFor(() =>
      expect(actionMock).toHaveBeenCalledWith(PROJECT_ID, 'r1', {
        decision: 'decline',
        reply: 'Not feasible',
      }),
    )
  })

  it('reply passes the thread message as reply', async () => {
    render(
      <ClientReviewPanel
        projectId={PROJECT_ID}
        grants={[]}
        requests={[makeRequest()]}
        lastPublishedAt={null}
      />,
    )
    fireEvent.change(screen.getByLabelText('reply-r1'), { target: { value: 'Looking into it' } })
    fireEvent.click(screen.getByRole('button', { name: /^reply$/i }))
    await waitFor(() =>
      expect(actionMock).toHaveBeenCalledWith(PROJECT_ID, 'r1', {
        decision: 'reply',
        reply: 'Looking into it',
      }),
    )
  })

  it('disables Accept and Decline on an already-actioned request', () => {
    render(
      <ClientReviewPanel
        projectId={PROJECT_ID}
        grants={[]}
        requests={[makeRequest({ status: 'accepted', actioned_by: 'admin1' })]}
        lastPublishedAt={null}
      />,
    )
    const accept = screen.getByRole('button', { name: /^accept$/i }) as HTMLButtonElement
    const decline = screen.getByRole('button', { name: /^decline$/i }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    expect(decline.disabled).toBe(true)
    // Reply stays available on actioned requests (thread continues).
    const reply = screen.getByRole('button', { name: /^reply$/i }) as HTMLButtonElement
    expect(reply.disabled).toBe(false)
  })
})
