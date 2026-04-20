'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createSnagSchema, type CreateSnagInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const CATEGORIES = ['general', 'electrical', 'mechanical', 'civil', 'safety', 'quality', 'documentation']
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

const priorityStyle = (p: string, selected: boolean): React.CSSProperties => {
  const palette: Record<string, { fg: string; bg: string; border: string }> = {
    low:      { fg: 'var(--c-text-dim)', bg: 'var(--c-panel)',         border: 'var(--c-border)' },
    medium:   { fg: '#60a5fa',           bg: 'rgba(37,99,235,0.15)',   border: '#1d4ed8' },
    high:     { fg: 'var(--c-amber)',    bg: 'var(--c-amber-dim)',     border: 'var(--c-amber-mid)' },
    critical: { fg: 'var(--c-red)',      bg: 'var(--c-red-dim)',       border: '#6b1e1e' },
  }
  const c = palette[p] ?? palette.low
  return {
    flex: 1, padding: '9px 12px', borderRadius: 6, textAlign: 'center',
    fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    cursor: 'pointer', transition: 'all 0.12s',
    border: `1px solid ${selected ? c.border : 'var(--c-border)'}`,
    background: selected ? c.bg : 'var(--c-panel)',
    color: selected ? c.fg : 'var(--c-text-dim)',
  }
}

interface Props { params: Promise<{ id: string }> }

export default function NewSnagPage({ params }: Props) {
  const { id: projectId } = use(params)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<any[]>([])
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<CreateSnagInput>({
    resolver: zodResolver(createSnagSchema),
    defaultValues: { projectId, priority: 'medium', category: 'general' },
  })

  const currentPriority = watch('priority') ?? 'medium'

  useEffect(() => {
    const supabase = createClient()
    supabase.schema('projects').from('project_members')
      .select('user_id, role, profile:profiles(id, full_name)')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .then(({ data }) => setMembers(data ?? []))
  }, [projectId])

  async function onSubmit(input: CreateSnagInput) {
    setError(null)
    setUploading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: membership } = await supabase
      .from('user_organisations').select('organisation_id')
      .eq('user_id', user.id).eq('is_active', true).limit(1).single()
    if (!membership) { setError('No organisation found'); setUploading(false); return }

    const orgId = membership.organisation_id

    try {
      const { data: snag, error: snagErr } = await supabase.schema('field').from('snags').insert({
        project_id: input.projectId,
        organisation_id: orgId,
        raised_by: user.id,
        title: input.title,
        description: input.description,
        location: input.location,
        category: input.category,
        priority: input.priority,
        assigned_to: input.assignedTo || null,
      }).select().single()
      if (snagErr) throw snagErr

      if (photoFiles.length > 0) {
        await Promise.all(photoFiles.map(async (file, i) => {
          const ext = file.name.split('.').pop() ?? 'jpg'
          const path = `${orgId}/${projectId}/${snag.id}/${Date.now()}-${i}.${ext}`
          const { error: upErr } = await supabase.storage.from('snag-photos').upload(path, file, { contentType: file.type })
          if (upErr) throw upErr
          await supabase.schema('field').from('snag_photos').insert({
            snag_id: snag.id,
            file_path: path,
            caption: file.name,
            photo_type: 'evidence',
            sort_order: i,
            uploaded_by: user.id,
          })
        }))
      }

      router.push(`/snags/${snag.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create snag')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Project
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Raise Snag</h1>
          <p className="page-subtitle">Log an issue to track, assign and sign off</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Issue</span>
          </div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="ob-label">Title *</label>
              <input className="ob-input" {...register('title')} autoFocus placeholder="Describe the issue…" />
              {errors.title && <p className="ob-error">{errors.title.message}</p>}
            </div>
            <div>
              <label className="ob-label">Description</label>
              <textarea className="ob-input" rows={3} style={{ resize: 'none' }} {...register('description')} placeholder="Details, context, what should be done…" />
              {errors.description && <p className="ob-error">{errors.description.message}</p>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="ob-label">Location</label>
                <input className="ob-input" {...register('location')} placeholder="e.g. DB Room, Level 2" />
                {errors.location && <p className="ob-error">{errors.location.message}</p>}
              </div>
              <div>
                <label className="ob-label">Category</label>
                <select className="ob-select" {...register('category')}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {errors.category && <p className="ob-error">{errors.category.message}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Priority &amp; Assignment</span>
          </div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="ob-label">Priority</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {PRIORITIES.map(p => (
                  <label key={p} style={priorityStyle(p, currentPriority === p)}>
                    <input {...register('priority')} type="radio" value={p} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                    {p}
                  </label>
                ))}
              </div>
              {errors.priority && <p className="ob-error">{errors.priority.message}</p>}
            </div>
            <div>
              <label className="ob-label">Assign to</label>
              <select className="ob-select" {...register('assignedTo')}>
                <option value="">Unassigned</option>
                {members.map((m: any) => (
                  <option key={m.user_id} value={m.user_id}>{(m.profile as any)?.full_name}</option>
                ))}
              </select>
              {errors.assignedTo && <p className="ob-error">{errors.assignedTo.message}</p>}
            </div>
          </div>
        </div>

        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Evidence Photos</span>
            {photoFiles.length > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                {photoFiles.length} selected
              </span>
            )}
          </div>
          <div style={{ padding: '16px 18px' }}>
            <label
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                padding: '28px 18px', border: '1px dashed var(--c-border)', borderRadius: 8,
                background: 'var(--c-base)', cursor: 'pointer', transition: 'border-color 0.15s',
              }}
            >
              <input
                type="file" accept="image/*" multiple style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
                onChange={e => setPhotoFiles(Array.from(e.target.files ?? []))}
              />
              <span style={{ fontSize: 20 }} aria-hidden="true">📷</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.06em' }}>
                Click to select photos
              </span>
            </label>
            {photoFiles.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {photoFiles.map((f, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img
                      src={URL.createObjectURL(f)}
                      alt=""
                      style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--c-border)' }}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setPhotoFiles(fs => fs.filter((_, j) => j !== i))}
                      style={{
                        position: 'absolute', top: -4, right: -4, width: 20, height: 20,
                        background: 'var(--c-red)', color: '#fff', border: 'none', borderRadius: '50%',
                        fontSize: 11, lineHeight: 1, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <p className="ob-error" role="alert">{error}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="btn-primary-amber" style={{ flex: 1 }} disabled={isSubmitting || uploading}>
            {uploading ? 'Uploading photos…' : isSubmitting ? 'Saving…' : 'Raise Snag'}
          </button>
          <Link
            href={`/projects/${projectId}`}
            className="btn-primary-amber"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 16px',
            }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
