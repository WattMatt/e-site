'use client'

/**
 * ClientReviewPanel — admin half of the GCR client-review flow (Phase 2b).
 *
 * Three sections, all gated server-side by the consumed actions (ORG_WRITE_ROLES
 * for mutations, COST_VIEW_ROLES for reads); the page only renders this tab for
 * users past the GCR cost-view + seat gate:
 *
 *  1. Publish for client review — snapshots the CURRENT outputs-only figures
 *     into an immutable review snapshot for granted clients. Shows the last
 *     published time.
 *  2. Manage client access — list granted clients, grant by email (with the
 *     "invite them first" error surfaced when no account exists), revoke.
 *  3. Client requests queue — per-tenant captured proposals (old → proposed +
 *     comment). Accept APPLIES the change to the live schedule; Decline records
 *     a reason; Reply adds to the thread. Accept/Decline disable once actioned.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { GcrChangeRequestRow } from '@esite/shared'
import {
  publishGcrForClientReviewAction,
  manageClientSiteAccessAction,
  resolveClientByEmailAction,
  actionGcrChangeRequestAction,
  type ClientSiteAccessRow,
} from './gcr-client-review.actions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('en-ZA', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  grants: ClientSiteAccessRow[]
  requests: GcrChangeRequestRow[]
  /** ISO timestamp of the latest published snapshot, or null if never published. */
  lastPublishedAt: string | null
}

// ─── ClientReviewPanel ──────────────────────────────────────────────────────────

export function ClientReviewPanel({ projectId, grants, requests, lastPublishedAt }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Publish
  const [publishedNotice, setPublishedNotice] = useState<string | null>(null)

  // Grant-by-email
  const [grantEmail, setGrantEmail] = useState('')

  // Per-request decline reason / reply draft, keyed by request id.
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})

  /** Run a server action inside a transition; on success refresh the tab data. */
  function run(
    fn: () => Promise<{ ok: true } | { error: string }>,
    onOk?: () => void,
  ) {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if ('error' in res) {
        setError(res.error)
      } else {
        onOk?.()
        router.refresh()
      }
    })
  }

  // ── Publish ───────────────────────────────────────────────────────────────

  function handlePublish() {
    setPublishedNotice(null)
    run(
      () => publishGcrForClientReviewAction(projectId),
      () => setPublishedNotice('Published — granted clients now see the current figures.'),
    )
  }

  // ── Grant (resolve email → id, then grant) ──────────────────────────────────

  function handleGrant() {
    const email = grantEmail.trim()
    if (!email) {
      setError('Enter a client email address')
      return
    }
    setError(null)
    startTransition(async () => {
      const resolved = await resolveClientByEmailAction(projectId, email)
      if ('error' in resolved) {
        setError(resolved.error)
        return
      }
      const granted = await manageClientSiteAccessAction(projectId, resolved.userId, 'grant')
      if ('error' in granted) {
        setError(granted.error)
        return
      }
      setGrantEmail('')
      router.refresh()
    })
  }

  // ── Request actions ─────────────────────────────────────────────────────────

  function handleAccept(req: GcrChangeRequestRow) {
    run(() => actionGcrChangeRequestAction(projectId, req.id, { decision: 'accept' }))
  }

  function handleDecline(req: GcrChangeRequestRow) {
    const reason = (replyDrafts[req.id] ?? '').trim()
    if (!reason) {
      setError('Add a reason before declining this request.')
      return
    }
    run(
      () => actionGcrChangeRequestAction(projectId, req.id, { decision: 'decline', reply: reason }),
      () => setReplyDrafts((p) => ({ ...p, [req.id]: '' })),
    )
  }

  function handleReply(req: GcrChangeRequestRow) {
    const reply = (replyDrafts[req.id] ?? '').trim()
    if (!reply) {
      setError('Write a reply before sending.')
      return
    }
    run(
      () => actionGcrChangeRequestAction(projectId, req.id, { decision: 'reply', reply }),
      () => setReplyDrafts((p) => ({ ...p, [req.id]: '' })),
    )
  }

  const lastPublished = formatDateTime(lastPublishedAt)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <p role="alert" style={{ color: 'var(--c-red)', fontSize: 12, margin: 0 }}>
          {error}
        </p>
      )}

      {/* ── 1. Publish for client review ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Publish for client review
          </span>
        </CardHeader>
        <CardBody>
          <Button
            variant="primary"
            size="sm"
            isLoading={pending}
            disabled={pending}
            onClick={handlePublish}
          >
            Publish for client review
          </Button>
          <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 8, marginBottom: 0 }}>
            Snapshots the current cost-recovery figures (outputs only — no contractor
            costs) into a frozen review that granted clients can see and comment on.
          </p>
          {lastPublished && (
            <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6, marginBottom: 0 }}>
              Last published: <strong>{lastPublished}</strong>
            </p>
          )}
          {!lastPublished && (
            <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6, marginBottom: 0 }}>
              Not yet published for client review.
            </p>
          )}
          {publishedNotice && (
            <p style={{ fontSize: 11, color: 'var(--c-amber)', marginTop: 6, marginBottom: 0 }}>
              {publishedNotice}
            </p>
          )}
        </CardBody>
      </Card>

      {/* ── 2. Manage client access ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Manage client access
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="email"
              aria-label="Client email to grant"
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              placeholder="client@example.com"
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: 12,
                background: 'var(--c-bg)',
                color: 'var(--c-text)',
                border: '1px solid var(--c-border)',
                borderRadius: 6,
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={pending || !grantEmail.trim()}
              onClick={handleGrant}
            >
              Grant access
            </Button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 0, marginBottom: 12 }}>
            The client must already have an account. If they don&apos;t, invite them
            first from the Command Centre.
          </p>

          {grants.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>
              No clients have been granted access to this site yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {grants.map((g) => (
                <div
                  key={g.user_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderTop: '1px solid var(--c-border)',
                  }}
                >
                  <div style={{ fontSize: 12, color: 'var(--c-text)' }}>
                    {g.full_name ?? g.email ?? g.user_id}
                    {g.full_name && g.email && (
                      <span style={{ color: 'var(--c-text-dim)', marginLeft: 6 }}>
                        {g.email}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() => manageClientSiteAccessAction(projectId, g.user_id, 'revoke'))
                    }
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── 3. Client requests queue ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Client requests
          </span>
        </CardHeader>
        <CardBody>
          {requests.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>
              No client change requests yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {requests.map((r) => {
                const actioned = r.status !== 'open'
                const draft = replyDrafts[r.id] ?? ''
                return (
                  <div
                    key={r.id}
                    style={{ borderTop: '1px solid var(--c-border)', padding: '12px 0' }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--c-text)' }}>
                      <span style={{ color: 'var(--c-text-dim)' }}>Tenant</span>{' '}
                      <code style={{ fontSize: 11 }}>{r.node_id}</code>
                      {' · '}
                      <strong>{r.field}</strong>: <span>{r.old_value ?? '—'}</span> →{' '}
                      <strong>{r.new_value ?? '—'}</strong>
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          color:
                            r.status === 'accepted'
                              ? 'var(--c-amber)'
                              : r.status === 'declined'
                              ? 'var(--c-red)'
                              : 'var(--c-text-dim)',
                        }}
                      >
                        ({r.status})
                      </span>
                    </div>

                    {r.comment && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--c-text-dim)',
                          marginTop: 4,
                          fontStyle: 'italic',
                        }}
                      >
                        &ldquo;{r.comment}&rdquo;
                      </div>
                    )}

                    {r.admin_reply && (
                      <div style={{ fontSize: 11, color: 'var(--c-text-mid)', marginTop: 4 }}>
                        <span style={{ color: 'var(--c-text-dim)' }}>Reply:</span>{' '}
                        {r.admin_reply}
                      </div>
                    )}

                    {/* Reason / reply input — used by Decline and Reply. */}
                    <input
                      aria-label={`reply-${r.id}`}
                      value={draft}
                      onChange={(e) =>
                        setReplyDrafts((p) => ({ ...p, [r.id]: e.target.value }))
                      }
                      placeholder={actioned ? 'Reply to the client…' : 'Reason / reply…'}
                      style={{
                        width: '100%',
                        marginTop: 8,
                        padding: '6px 10px',
                        fontSize: 12,
                        background: 'var(--c-bg)',
                        color: 'var(--c-text)',
                        border: '1px solid var(--c-border)',
                        borderRadius: 6,
                      }}
                    />

                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={pending || actioned}
                        onClick={() => handleAccept(r)}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={pending || actioned}
                        onClick={() => handleDecline(r)}
                      >
                        Decline
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => handleReply(r)}
                      >
                        Reply
                      </Button>
                    </div>

                    {!actioned && (
                      <p
                        style={{
                          fontSize: 10,
                          color: 'var(--c-text-dim)',
                          marginTop: 6,
                          marginBottom: 0,
                        }}
                      >
                        Accepting applies this change to the live schedule.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
