'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  createSiteFormAction,
  listCableScheduleBoardsAction,
} from '@/actions/site-forms.actions'

export interface BoardOption {
  id: string
  code: string
  name: string | null
  kind: string
}

export interface TemplateOption {
  id: string
  name: string
  version: string
}

interface CableScheduleBoard {
  nodeId: string
  code: string
  name: string | null
  downstreamCount: number
}

// Mirrors the structure.nodes kind CHECK. Boards a site electrician would
// actually isolate come first; the rest stay available but out of the way.
const KIND_LABELS: Record<string, string> = {
  main_board: 'Main boards',
  sub_board: 'Sub boards',
  tenant_db: 'Tenant distribution boards',
  common_area_board: 'Common area boards',
  common_area_lighting: 'Common area lighting',
  mini_sub: 'Mini substations',
  rmu: 'Ring main units',
  generator: 'Generators',
  custom: 'Other',
}
const KIND_ORDER = Object.keys(KIND_LABELS)

function boardLabel(b: { code: string; name: string | null }): string {
  return b.name ? `${b.code} — ${b.name}` : b.code
}

export function NewFormForm({
  projectId,
  boards,
  templates,
  hasCableSchedule,
  cableScheduleBoardIds,
}: {
  projectId: string
  boards: BoardOption[]
  templates: TemplateOption[]
  /** False when the project has no cable schedule at all — offer nothing. */
  hasCableSchedule: boolean
  /** Structure nodes already covered by the current cable schedule. */
  cableScheduleBoardIds: string[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [templateRowId, setTemplateRowId] = useState(templates[0]?.id ?? '')
  const [nodeId, setNodeId] = useState('')
  const [useFreeText, setUseFreeText] = useState(false)
  const [boardRef, setBoardRef] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [linkNodeId, setLinkNodeId] = useState('')
  const [csBoards, setCsBoards] = useState<CableScheduleBoard[]>([])
  const [csLoaded, setCsLoaded] = useState(false)

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABELS[kind],
    items: boards.filter((b) => b.kind === kind),
  })).filter((g) => g.items.length > 0)

  const scheduleIds = useMemo(() => new Set(cableScheduleBoardIds), [cableScheduleBoardIds])

  // The offer is relevant only when there is a schedule to pull from AND the
  // board this form is about is not already in it. A board that IS in the
  // schedule gets prefilled on its own and is told nothing.
  const offerRelevant =
    hasCableSchedule && (useFreeText ? true : nodeId !== '' && !scheduleIds.has(nodeId))

  useEffect(() => {
    if (!offerRelevant || csLoaded) return
    let cancelled = false
    void listCableScheduleBoardsAction(projectId).then((res) => {
      if (cancelled) return
      setCsLoaded(true)
      // Narrowed on `boards`, not on `error`: an empty error string is falsy,
      // so the truthiness of `error` does not discriminate the union.
      // A failure here leaves the offer hidden — it is an assist, not a gate.
      if (res.boards) setCsBoards(res.boards)
    })
    return () => {
      cancelled = true
    }
  }, [offerRelevant, csLoaded, projectId])

  // Rendered only once boards are in hand, so nothing flashes in and out while
  // loading and nothing appears at all if the schedule has no feeder boards.
  const showLinkOffer = offerRelevant && csBoards.length > 0

  const selectedBoard = boards.find((b) => b.id === nodeId)
  const subjectLabel = useFreeText
    ? boardRef.trim() || 'This board'
    : selectedBoard
      ? boardLabel(selectedBoard)
      : 'This board'
  const linkedBoard = csBoards.find((b) => b.nodeId === linkNodeId)

  const canSubmit =
    Boolean(templateRowId) && (useFreeText ? boardRef.trim().length > 0 : Boolean(nodeId))

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await createSiteFormAction({
        projectId,
        templateRowId,
        nodeId: useFreeText ? null : nodeId || null,
        boardRef: useFreeText ? boardRef.trim() : null,
        // Only sent while the offer is actually on screen: a stale selection
        // from a board the user has since changed away from must not silently
        // import another board's circuits.
        cableScheduleNodeId: showLinkOffer && linkNodeId ? linkNodeId : null,
      })
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      router.push(`/projects/${projectId}/forms/${res.formId}`)
    })
  }

  if (templates.length === 0) {
    return (
      <div className="card empty-state">
        <h2>No form templates available</h2>
        <p>
          No active form template could be found for this organisation. If this is unexpected,
          the Termination and Making Safe system template may not have been seeded yet.
        </p>
        <Link href={`/projects/${projectId}/forms`} className="btn">
          Back to forms
        </Link>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="form-field">
        <label htmlFor="template">Form type</label>
        <select
          id="template"
          value={templateRowId}
          onChange={(e) => setTemplateRowId(e.target.value)}
          disabled={pending}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} (v{t.version})
            </option>
          ))}
        </select>
      </div>

      <div className="form-field">
        <label htmlFor="board">Board</label>
        {!useFreeText ? (
          <>
            <select
              id="board"
              value={nodeId}
              onChange={(e) => {
                setNodeId(e.target.value)
                // A link chosen for the previous board means nothing for this one.
                setLinkNodeId('')
              }}
              disabled={pending || boards.length === 0}
            >
              <option value="">Select a board…</option>
              {grouped.map((g) => (
                <optgroup key={g.kind} label={g.label}>
                  {g.items.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name ? `${b.code} — ${b.name}` : b.code}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="form-hint">
              {boards.length === 0
                ? 'No boards have been captured in this project yet.'
                : 'Pick the board from the project structure so this record is tracked against it.'}{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setUseFreeText(true)
                  setNodeId('')
                  setLinkNodeId('')
                }}
                disabled={pending}
              >
                The board is not in the list
              </button>
            </p>
          </>
        ) : (
          <>
            <input
              id="board"
              type="text"
              value={boardRef}
              onChange={(e) => setBoardRef(e.target.value)}
              placeholder="e.g. DB-7, first floor plant room"
              maxLength={200}
              disabled={pending}
            />
            <p className="form-hint">
              Record the board reference as it appears on site. This form will not be linked to
              the project structure, so it will not roll up against a board until one is created.{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setUseFreeText(false)
                  setBoardRef('')
                  setLinkNodeId('')
                }}
                disabled={pending}
              >
                Pick from the structure instead
              </button>
            </p>
          </>
        )}
      </div>

      {showLinkOffer && (
        <div className="form-field">
          <label htmlFor="cable-schedule-board">Circuit data (optional)</label>
          <p className="form-hint">
            {subjectLabel} isn’t in the cable schedule, so there are no circuits to fill in
            automatically. Pull circuit data from another board?
          </p>
          <select
            id="cable-schedule-board"
            value={linkNodeId}
            onChange={(e) => setLinkNodeId(e.target.value)}
            disabled={pending}
          >
            <option value="">Don’t pull circuit data</option>
            {csBoards.map((b) => (
              <option key={b.nodeId} value={b.nodeId}>
                {boardLabel(b)} — {b.downstreamCount} circuit
                {b.downstreamCount === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          {linkedBoard ? (
            <p className="form-hint">
              The circuits will be copied from <strong>{boardLabel(linkedBoard)}</strong>. They
              are that board’s circuits, not {subjectLabel}’s — a starting point to edit, nothing
              more. Check every row against the board in front of you and correct or delete
              whatever does not match. This record stays a record of {subjectLabel}.
            </p>
          ) : (
            <p className="form-hint">
              Leave this unset to start with an empty circuit list. Nothing else on the form is
              affected.
            </p>
          )}
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <Link href={`/projects/${projectId}/forms`} className="btn">
          Cancel
        </Link>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={!canSubmit || pending}
        >
          {pending ? 'Creating…' : 'Create form'}
        </button>
      </div>
    </div>
  )
}
