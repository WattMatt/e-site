'use client'

/**
 * Distribution, preview and void controls for one site form.
 *
 * These three actions existed server-side with NO caller anywhere in the app:
 * a form could reach `submitted` and stop there forever — no report filed, no
 * email sent, no way to withdraw a wrong record. This file is the route a real
 * user walks, reached by navigation (Sidebar → Forms → the form), never by a
 * typed URL. That is the PR #159 lesson: a control nobody can reach is a
 * control that does not exist.
 *
 * Two exports:
 *  - `PreviewReportButton` — every status (including draft) and every project
 *    role. An electrician must be able to read the document before submitting.
 *  - `DistributePanel` — the management half: recipient preview, distribute /
 *    re-distribute, the filed-report list, and void. Rendered only for
 *    ORG_WRITE_ROLES on a `submitted` or `distributed` record.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { asLeftStatusLabel } from '@esite/shared'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import {
  distributeSiteFormAction,
  previewFormRecipientsAction,
} from '@/actions/site-forms-distribute.actions'
import { voidSiteFormAction } from '@/actions/site-forms.actions'

/** How long an armed two-step confirmation stays armed. */
const CONFIRM_WINDOW_MS = 4000

/** The server enforces this too; the UI states it before spending a round-trip. */
const MIN_VOID_REASON = 5

type Recipient = { name: string | null; email: string }

// ─── Preview ─────────────────────────────────────────────────────────────────

export interface PreviewReportButtonProps {
  projectId: string
  formId: string
  /** Only used for the wording — the button is enabled on every status. */
  status: string
}

/**
 * Open the inline PDF preview of this record.
 *
 * The tab is opened SYNCHRONOUSLY inside the click handler. The route renders
 * the PDF server-side and can take a second or two; a `window.open()` after any
 * `await` is silently swallowed by Safari's popup blocker (and by Chrome once
 * the user-activation window lapses) — the click just appears to do nothing.
 * Nothing is awaited here, so there is nothing to race.
 *
 * The route persists nothing: previewing a draft does not file a report and
 * does not distribute anything.
 */
export function PreviewReportButton({ projectId, formId, status }: PreviewReportButtonProps) {
  const isDraft = status === 'draft'
  return (
    <button
      type="button"
      className="btn"
      title={
        isDraft
          ? 'Preview the PDF of this draft. Nothing is filed or sent — this is a working copy, not a record.'
          : 'Preview the PDF of this record. Nothing is filed or sent.'
      }
      onClick={() => {
        const tab = window.open(
          `/api/projects/${projectId}/forms/${formId}/report`,
          '_blank',
          'noopener,noreferrer',
        )
        if (tab) tab.opener = null
      }}
      style={{ minHeight: 40, whiteSpace: 'nowrap' }}
    >
      ⬇ Preview PDF{isDraft ? ' (draft)' : ''}
    </button>
  )
}

// ─── Distribute / void ───────────────────────────────────────────────────────

export interface DistributePanelProps {
  projectId: string
  formId: string
  /** `submitted` or `distributed` — the host renders nothing for other statuses. */
  status: string
  /** What state the board was left in, so the reviewer sees what they announce. */
  asLeftStatus: string | null
  /** Highest issued report version for this form, if one has ever been filed. */
  currentVersion: number | null
  distributedAt: string | null
  distributedByName: string | null
}

export default function DistributePanel(props: DistributePanelProps) {
  const { projectId, formId, status } = props
  const router = useRouter()

  const isRedistribution = status === 'distributed'

  // ── Recipient preview: the safety control for the whole feature ────────────
  // `project_notification_recipients()` resolves the full site roster — on a
  // WM-Consulting project that is about a dozen real wmeng.co.za people. Nothing
  // may be sent before that exact list and count has been shown, so Distribute
  // stays disabled until this resolves.
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [recipientsError, setRecipientsError] = useState<string | null>(null)
  const [loadingRecipients, setLoadingRecipients] = useState(true)
  const [rosterOpen, setRosterOpen] = useState(false)

  const loadRecipients = useCallback(async () => {
    setLoadingRecipients(true)
    setRecipientsError(null)
    try {
      const res = await previewFormRecipientsAction(projectId)
      // `!== undefined`, not truthiness: the error variant types `error` as a
      // plain string, so a falsy '' would not narrow the union and `recipients`
      // would stay possibly-undefined.
      if (res.error !== undefined) {
        setRecipients(null)
        setRecipientsError(res.error)
        return
      }
      setRecipients(res.recipients)
      setEmailEnabled(res.emailEnabled)
    } catch (e) {
      setRecipients(null)
      setRecipientsError((e as Error).message)
    } finally {
      setLoadingRecipients(false)
    }
  }, [projectId])

  useEffect(() => {
    void loadRecipients()
  }, [loadRecipients])

  // ── Two-step confirmations ────────────────────────────────────────────────
  // window.confirm() is silently suppressed by Safari on this app (proven when
  // photo delete shipped), so both destructive controls arm in place instead.
  const [confirmDistribute, setConfirmDistribute] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const distributeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const voidTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (distributeTimer.current) clearTimeout(distributeTimer.current)
      if (voidTimer.current) clearTimeout(voidTimer.current)
    },
    [],
  )

  // ── Distribute ────────────────────────────────────────────────────────────
  const [distributing, setDistributing] = useState(false)
  const [distributeError, setDistributeError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ version: number; warning?: string } | null>(null)
  const [reportsKey, setReportsKey] = useState(0)

  const recipientCount = recipients?.length ?? 0
  const canSend = !loadingRecipients && recipients !== null && !recipientsError

  const onDistribute = async () => {
    if (!canSend) return

    if (!confirmDistribute) {
      setConfirmDistribute(true)
      if (distributeTimer.current) clearTimeout(distributeTimer.current)
      distributeTimer.current = setTimeout(() => setConfirmDistribute(false), CONFIRM_WINDOW_MS)
      return
    }

    if (distributeTimer.current) clearTimeout(distributeTimer.current)
    setConfirmDistribute(false)
    setDistributing(true)
    setDistributeError(null)
    setOutcome(null)
    try {
      const res = await distributeSiteFormAction(formId, projectId)
      if (res.error !== undefined) {
        // Never claim success on an error path — the record may be untouched.
        setDistributeError(res.error)
        return
      }
      setOutcome({ version: res.version, warning: res.warning })
      setReportsKey((k) => k + 1)
      router.refresh()
    } catch (e) {
      setDistributeError((e as Error).message)
    } finally {
      setDistributing(false)
    }
  }

  // ── Void ──────────────────────────────────────────────────────────────────
  const [voidOpen, setVoidOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  const onVoid = async () => {
    const trimmed = reason.trim()
    if (trimmed.length < MIN_VOID_REASON) {
      setReasonError(
        `Give a reason of at least ${MIN_VOID_REASON} characters. It is stored on the record permanently and shown to everyone who opens it.`,
      )
      setConfirmVoid(false)
      if (voidTimer.current) clearTimeout(voidTimer.current)
      return
    }
    setReasonError(null)

    if (!confirmVoid) {
      setConfirmVoid(true)
      if (voidTimer.current) clearTimeout(voidTimer.current)
      voidTimer.current = setTimeout(() => setConfirmVoid(false), CONFIRM_WINDOW_MS)
      return
    }

    if (voidTimer.current) clearTimeout(voidTimer.current)
    setConfirmVoid(false)
    setVoiding(true)
    setVoidError(null)
    try {
      const res = await voidSiteFormAction(formId, projectId, trimmed)
      if (res.error !== undefined) {
        setVoidError(res.error)
        return
      }
      router.refresh()
    } catch (e) {
      setVoidError((e as Error).message)
    } finally {
      setVoiding(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const accent = isRedistribution ? 'var(--c-amber)' : 'var(--c-green)'
  const nextVersion = (props.currentVersion ?? 0) + 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
      <section
        className="card"
        style={{
          border: '1px solid var(--c-border)',
          borderLeft: `3px solid ${accent}`,
          borderRadius: 8,
          background: 'var(--c-panel)',
          padding: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
            {isRedistribution ? 'Re-distribute this record' : 'Distribute this record'}
          </h2>
          {props.asLeftStatus && (
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
              As left: <strong style={{ color: 'var(--c-text-mid)' }}>{asLeftStatusLabel(props.asLeftStatus)}</strong>
            </span>
          )}
        </div>

        {isRedistribution ? (
          <div
            style={{
              margin: '10px 0 0',
              borderLeft: '3px solid var(--c-amber)',
              background: 'var(--c-surface)',
              borderRadius: 4,
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--c-text-mid)',
            }}
          >
            <strong style={{ color: 'var(--c-amber)' }}>Already distributed.</strong>{' '}
            {props.distributedAt
              ? `Issued ${new Date(props.distributedAt).toLocaleString()}`
              : 'Issued previously'}
            {props.distributedByName ? ` by ${props.distributedByName}` : ''}
            {props.currentVersion != null ? ` as version ${props.currentVersion}` : ''}.
            <p style={{ margin: '6px 0 0' }}>
              Re-distributing issues a <strong>new version (v{nextVersion})</strong> of the report and{' '}
              <strong>re-emails every recipient below</strong>. The previous version is superseded,
              not deleted — it stays on record. Re-distribute only after the underlying record has
              genuinely changed.
            </p>
          </div>
        ) : (
          <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--c-text-mid)' }}>
            Distributing files the branded PDF as version {nextVersion} against this project, stamps
            the record as distributed, and puts it in front of the whole project team.
          </p>
        )}

        {/* ── Recipient preview ───────────────────────────────────────────── */}
        <div
          style={{
            marginTop: 12,
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            background: 'var(--c-surface)',
            padding: 12,
          }}
        >
          {loadingRecipients && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)' }}>
              Resolving who would receive this…
            </p>
          )}

          {!loadingRecipients && recipientsError && (
            <div>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--c-red)' }}>
                The recipient list could not be resolved: {recipientsError}
              </p>
              <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--c-text-mid)' }}>
                Distribution stays disabled until it loads — nothing is sent to a list nobody has
                seen.
              </p>
              <button type="button" className="btn" onClick={() => void loadRecipients()}>
                Retry
              </button>
            </div>
          )}

          {!loadingRecipients && !recipientsError && recipients && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <strong style={{ fontSize: 13, color: 'var(--c-text)' }}>
                  {recipientCount === 0
                    ? 'No addressable recipients on this project'
                    : `${recipientCount} ${recipientCount === 1 ? 'recipient' : 'recipients'} on this project`}
                </strong>
                {recipientCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setRosterOpen((v) => !v)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      color: 'var(--c-amber)',
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: 'underline',
                      cursor: 'pointer',
                    }}
                  >
                    {rosterOpen ? 'Hide the list' : 'Show the list'}
                  </button>
                )}
              </div>

              {/* The full roster, never a summary. A mistaken send goes company-wide. */}
              {rosterOpen && recipientCount > 0 && (
                <ul
                  style={{
                    margin: '8px 0 0',
                    padding: 0,
                    listStyle: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    maxHeight: 220,
                    overflowY: 'auto',
                  }}
                >
                  {recipients.map((r) => (
                    <li
                      key={r.email}
                      style={{ fontSize: 12, color: 'var(--c-text-mid)', lineHeight: 1.45 }}
                    >
                      {r.name ? `${r.name} — ` : ''}
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{r.email}</span>
                    </li>
                  ))}
                </ul>
              )}

              {!emailEnabled && (
                <p
                  style={{
                    margin: '8px 0 0',
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: 'var(--c-text-mid)',
                    borderLeft: '3px solid var(--c-amber)',
                    paddingLeft: 10,
                  }}
                >
                  <strong style={{ color: 'var(--c-amber)' }}>Email is off for this project.</strong>{' '}
                  The report will be filed and the record stamped as distributed, and the team will
                  see it in-app — but <strong>no email will be sent</strong>. Turn on form
                  notifications in project settings if you want it mailed.
                </p>
              )}

              {emailEnabled && recipientCount > 0 && (
                <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--c-text-dim)' }}>
                  Every person listed above will be emailed.
                </p>
              )}
            </>
          )}
        </div>

        {/* ── The button ──────────────────────────────────────────────────── */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={distributing || !canSend}
            onClick={() => void onDistribute()}
            style={{
              minHeight: 44,
              padding: '10px 18px',
              borderRadius: 6,
              border: 'none',
              background: confirmDistribute ? 'var(--c-amber)' : accent,
              color: confirmDistribute ? 'var(--c-on-amber)' : 'var(--c-on-green, #05130d)',
              fontWeight: 600,
              fontSize: 14,
              cursor: distributing || !canSend ? 'not-allowed' : 'pointer',
              opacity: distributing || !canSend ? 0.6 : 1,
              transition: 'all 0.12s',
            }}
          >
            {distributing
              ? isRedistribution
                ? 'Re-distributing…'
                : 'Distributing…'
              : confirmDistribute
                ? emailEnabled
                  ? `Confirm — email ${recipientCount} ${recipientCount === 1 ? 'recipient' : 'recipients'}?`
                  : 'Confirm — file the report? (no email)'
                : isRedistribution
                  ? `↻ Re-distribute (issues v${nextVersion})`
                  : '✓ Distribute to the project team'}
          </button>
          {confirmDistribute && (
            <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
              Tap again to send. This cancels itself in a few seconds.
            </span>
          )}
        </div>

        {distributeError && (
          <p className="form-error" style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--c-red)' }}>
            Not distributed: {distributeError}
          </p>
        )}

        {outcome && (
          <div
            style={{
              margin: '10px 0 0',
              borderLeft: '3px solid var(--c-green)',
              background: 'var(--c-surface)',
              borderRadius: 4,
              padding: '10px 12px',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--c-text-mid)',
            }}
          >
            <strong style={{ color: 'var(--c-green)' }}>Version {outcome.version} issued.</strong>{' '}
            The report is filed below
            {emailEnabled && recipientCount > 0
              ? ` and ${recipientCount} ${recipientCount === 1 ? 'recipient was' : 'recipients were'} notified.`
              : ' and the project team was notified in-app.'}
            {outcome.warning && (
              <p style={{ margin: '6px 0 0', color: 'var(--c-amber)' }}>{outcome.warning}</p>
            )}
          </div>
        )}
      </section>

      {/* ── The filed reports (the link to what was actually issued) ───────── */}
      <SavedReportsPanel
        projectId={projectId}
        kind="site_form"
        source={{ table: 'site_forms', id: formId }}
        reloadKey={reportsKey}
        title="Filed reports"
      />

      {/* ── Void ───────────────────────────────────────────────────────────── */}
      <section
        className="card"
        style={{
          border: '1px solid var(--c-border)',
          borderLeft: '3px solid var(--c-red)',
          borderRadius: 8,
          background: 'var(--c-panel)',
          padding: 14,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
          Void this record
        </h2>
        <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--c-text-mid)' }}>
          A submitted or distributed record is <strong>never reopened and never amended</strong>. If
          it is wrong, it is voided with a reason and a new form is issued in its place — the same
          discipline as EIR regulation 9(5): a certificate is not corrected, it is reissued. The
          voided record stays on the project permanently, with your reason attached, so the audit
          trail shows what was withdrawn and why.
        </p>

        {!voidOpen ? (
          <button
            type="button"
            className="btn"
            onClick={() => setVoidOpen(true)}
            style={{ marginTop: 12, minHeight: 40, color: 'var(--c-red)' }}
          >
            Void this record…
          </button>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label
              htmlFor="void-reason"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-mid)' }}
            >
              Reason for voiding (at least {MIN_VOID_REASON} characters)
            </label>
            <textarea
              id="void-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                if (reasonError) setReasonError(null)
                // Any edit disarms the confirmation — the armed button must
                // always refer to the text the reviewer just read.
                setConfirmVoid(false)
              }}
              rows={3}
              placeholder="e.g. Board reference wrong — record reissued as TMS-014 against DB-03."
              style={{
                width: '100%',
                minHeight: 72,
                padding: 10,
                borderRadius: 6,
                border: `1px solid ${reasonError ? 'var(--c-red)' : 'var(--c-border-mid)'}`,
                background: 'var(--c-surface)',
                color: 'var(--c-text)',
                fontSize: 13,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
            {reasonError && (
              <p className="form-error" style={{ margin: 0, fontSize: 12, color: 'var(--c-red)' }}>
                {reasonError}
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={voiding}
                onClick={() => void onVoid()}
                style={{
                  minHeight: 44,
                  padding: '10px 18px',
                  borderRadius: 6,
                  border: 'none',
                  background: confirmVoid ? 'var(--c-red)' : 'var(--c-elevated)',
                  color: confirmVoid ? 'var(--c-on-red, #fff)' : 'var(--c-red)',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: voiding ? 'not-allowed' : 'pointer',
                  opacity: voiding ? 0.6 : 1,
                  transition: 'all 0.12s',
                }}
              >
                {voiding
                  ? 'Voiding…'
                  : confirmVoid
                    ? 'Confirm — void this record permanently?'
                    : 'Void this record'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={voiding}
                onClick={() => {
                  setVoidOpen(false)
                  setConfirmVoid(false)
                  setReasonError(null)
                  setVoidError(null)
                }}
              >
                Cancel
              </button>
              {confirmVoid && (
                <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                  Tap again to void. This cancels itself in a few seconds.
                </span>
              )}
            </div>
            {voidError && (
              <p className="form-error" style={{ margin: 0, fontSize: 12, color: 'var(--c-red)' }}>
                Not voided: {voidError}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
