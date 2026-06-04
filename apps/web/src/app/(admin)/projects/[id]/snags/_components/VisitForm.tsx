'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { type CreateSnagVisitInput, type UpdateSnagVisitInput } from '@esite/shared'
import { createSnagVisitAction, updateSnagVisitAction } from '@/actions/snag-visit.actions'
import { Button } from '@/components/ui/Button'

// ─── Types ───────────────────────────────────────────────────────────────────

type Member = { user_id: string; full_name: string | null; email: string | null }

interface CreateProps {
  mode: 'create'
  projectId: string
  currentUserId: string
  members: Member[]
  onClose: () => void
}

interface EditProps {
  mode: 'edit'
  projectId: string
  visitId: string
  currentUserId: string
  members: Member[]
  defaultValues: {
    visitDate: string
    conductedBy?: string
    attendees?: Array<{ name: string; company?: string }>
    title?: string
    notes?: string
  }
  onClose: () => void
}

type Props = CreateProps | EditProps

// ─── Form-local schema (no projectId / visitId — those come from props) ──────

const formSchema = z.object({
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  conductedBy: z.string().uuid().optional().or(z.literal('')),
  attendees: z
    .array(
      z.object({
        name: z.string().min(1, 'Name required').max(200),
        company: z.string().max(200).optional().default(''),
      }),
    )
    .max(50)
    .default([]),
  title: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
})

type FormValues = z.infer<typeof formSchema>

// ─── Inline field styles (match existing app patterns) ───────────────────────

const FIELD_LABEL: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--c-text-dim)',
  letterSpacing: '0.06em',
  marginBottom: 6,
  textTransform: 'uppercase',
}

const FIELD_INPUT: React.CSSProperties = {
  width: '100%',
  background: 'var(--c-panel-deep)',
  border: '1px solid var(--c-border)',
  borderRadius: 6,
  padding: '9px 12px',
  color: 'var(--c-text)',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const FIELD_TEXTAREA: React.CSSProperties = {
  ...FIELD_INPUT,
  resize: 'vertical',
  minHeight: 72,
}

const FIELD_ERROR: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--c-red)',
  marginTop: 4,
}

const labelFor = (m: Member) => m.full_name ?? m.email ?? m.user_id.slice(0, 8)

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VisitForm(props: Props) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const isEdit = props.mode === 'edit'

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: isEdit
      ? {
          visitDate: (props as EditProps).defaultValues.visitDate,
          conductedBy: (props as EditProps).defaultValues.conductedBy ?? props.currentUserId,
          attendees: (props as EditProps).defaultValues.attendees ?? [],
          title: (props as EditProps).defaultValues.title ?? '',
          notes: (props as EditProps).defaultValues.notes ?? '',
        }
      : {
          visitDate: todayISO(),
          conductedBy: props.currentUserId,
          attendees: [],
          title: '',
          notes: '',
        },
  })

  const { fields: attendeeFields, append, remove } = useFieldArray({
    control,
    name: 'attendees',
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    let result: { error?: string }

    // Normalise conductedBy: empty string → undefined
    const conductedBy = values.conductedBy || undefined

    if (isEdit) {
      const editProps = props as EditProps
      const patch: UpdateSnagVisitInput & { projectId: string } = {
        visitId: editProps.visitId,
        projectId: editProps.projectId,
        visitDate: values.visitDate,
        conductedBy,
        attendees: values.attendees,
        title: values.title,
        notes: values.notes,
      }
      result = await updateSnagVisitAction(patch)
    } else {
      const input: CreateSnagVisitInput = {
        projectId: props.projectId,
        visitDate: values.visitDate,
        conductedBy,
        attendees: values.attendees,
        title: values.title,
        notes: values.notes,
      }
      result = await createSnagVisitAction(input)
    }

    if (result.error) {
      setServerError(result.error)
      return
    }

    router.refresh()
    props.onClose()
  }

  return (
    <div
      style={{
        background: 'var(--c-panel)',
        border: '1px solid var(--c-border-mid)',
        borderRadius: 8,
        padding: '20px 24px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--c-text-mid)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {isEdit ? 'Edit site visit' : 'Start site visit'}
        </span>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 16, padding: 4, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {/* Visit Date */}
          <div style={{ flex: '1 1 160px' }}>
            <label style={FIELD_LABEL} htmlFor="vf_visit_date">Visit date</label>
            <input
              id="vf_visit_date"
              type="date"
              style={FIELD_INPUT}
              {...register('visitDate')}
            />
            {errors.visitDate && <p style={FIELD_ERROR}>{errors.visitDate.message as string}</p>}
          </div>

          {/* Conducted By */}
          <div style={{ flex: '2 1 200px' }}>
            <label style={FIELD_LABEL} htmlFor="vf_conducted_by">Conducted by</label>
            <select id="vf_conducted_by" style={FIELD_INPUT} {...register('conductedBy')}>
              <option value="">— unassigned —</option>
              {props.members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {labelFor(m)}
                </option>
              ))}
            </select>
            {errors.conductedBy && <p style={FIELD_ERROR}>{errors.conductedBy.message as string}</p>}
          </div>
        </div>

        {/* Title (optional) */}
        <div style={{ marginTop: 14 }}>
          <label style={FIELD_LABEL} htmlFor="vf_title">Title (optional)</label>
          <input
            id="vf_title"
            type="text"
            style={FIELD_INPUT}
            placeholder="e.g. Practical completion inspection"
            {...register('title')}
          />
          {errors.title && <p style={FIELD_ERROR}>{errors.title.message as string}</p>}
        </div>

        {/* Notes (optional) */}
        <div style={{ marginTop: 14 }}>
          <label style={FIELD_LABEL} htmlFor="vf_notes">Notes (optional)</label>
          <textarea
            id="vf_notes"
            style={FIELD_TEXTAREA}
            placeholder="General observations, weather, access conditions…"
            {...register('notes')}
          />
          {errors.notes && <p style={FIELD_ERROR}>{errors.notes.message as string}</p>}
        </div>

        {/* Attendees repeater */}
        <div style={{ marginTop: 14 }}>
          <label style={FIELD_LABEL}>Attendees</label>
          {attendeeFields.map((field, idx) => (
            <div
              key={field.id}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}
            >
              <input
                type="text"
                placeholder="Name"
                style={{ ...FIELD_INPUT, flex: 2 }}
                {...register(`attendees.${idx}.name` as any)}
              />
              <input
                type="text"
                placeholder="Company (optional)"
                style={{ ...FIELD_INPUT, flex: 2 }}
                {...register(`attendees.${idx}.company` as any)}
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label="Remove attendee"
                style={{
                  background: 'var(--c-red-dim)',
                  border: '1px solid #6b1e1e',
                  borderRadius: 6,
                  color: 'var(--c-red)',
                  cursor: 'pointer',
                  padding: '8px 12px',
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => append({ name: '', company: '' })}
            style={{
              background: 'none',
              border: '1px dashed var(--c-border)',
              borderRadius: 6,
              color: 'var(--c-text-dim)',
              cursor: 'pointer',
              padding: '6px 14px',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
              marginTop: 2,
            }}
          >
            + Add attendee
          </button>
        </div>

        {serverError && (
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--c-red)', background: 'var(--c-red-dim)', border: '1px solid #6b1e1e', borderRadius: 6, padding: '8px 12px' }}>
            {serverError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Start visit'}
          </Button>
        </div>
      </form>
    </div>
  )
}
