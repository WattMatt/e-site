'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createRfiSchema, type CreateRfiInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { FormField, TextInput, Select, Textarea } from '@/components/ui/FormField'
import Link from 'next/link'
import { Suspense } from 'react'

const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
const CATEGORIES = ['design', 'materials', 'site-condition', 'specification', 'health-safety', 'general']

function NewRfiForm() {
  const router = useRouter()
  const params = useSearchParams()
  const defaultProjectId = params.get('projectId') ?? ''
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<CreateRfiInput>({
    resolver: zodResolver(createRfiSchema),
    defaultValues: { projectId: defaultProjectId, priority: 'medium' },
  })

  const projectId = watch('projectId')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data: mem } = await supabase.from('user_organisations').select('organisation_id').eq('user_id', user.id).eq('is_active', true).limit(1).single()
      if (!mem) return
      const { data: projs } = await supabase.schema('projects').from('projects').select('id, name').eq('organisation_id', mem.organisation_id).eq('status', 'active').order('name')
      setProjects(projs ?? [])
    })
  }, [])

  useEffect(() => {
    if (!projectId) return
    const supabase = createClient()
    supabase.schema('projects').from('project_members')
      .select('user_id, profile:profiles(id, full_name)')
      .eq('project_id', projectId).eq('is_active', true)
      .then(({ data }) => setMembers(data ?? []))
  }, [projectId])

  async function onSubmit(input: CreateRfiInput) {
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: mem } = await supabase.from('user_organisations').select('organisation_id').eq('user_id', user.id).eq('is_active', true).limit(1).single()
    if (!mem) return

    try {
      const { data: rfi, error: err } = await supabase.schema('projects').from('rfis').insert({
        project_id: input.projectId,
        organisation_id: mem.organisation_id,
        raised_by: user.id,
        subject: input.subject,
        description: input.description,
        priority: input.priority,
        category: input.category,
        due_date: input.dueDate || null,
        assigned_to: input.assignedTo || null,
        status: 'open',
      }).select().single()
      if (err) throw err
      router.push(`/rfis/${rfi.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create RFI')
    }
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/rfis"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← RFIs
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">New RFI</h1>
          <p className="page-subtitle">Raise a request for information against a project.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="data-panel">
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <FormField label="Project" required error={errors.projectId?.message}>
              <Select {...register('projectId')} invalid={!!errors.projectId}>
                <option value="">Select project…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormField>

            <FormField label="Subject" required error={errors.subject?.message}>
              <TextInput {...register('subject')} autoFocus invalid={!!errors.subject} placeholder="Describe the query…" />
            </FormField>

            <FormField label="Description" required error={errors.description?.message}>
              <Textarea {...register('description')} rows={4} invalid={!!errors.description} placeholder="Provide full context, reference drawings, standards, etc." style={{ minHeight: 100 }} />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Category" error={errors.category?.message}>
                <Select {...register('category')} invalid={!!errors.category}>
                  <option value="">Select…</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/-/g, ' ')}</option>)}
                </Select>
              </FormField>
              <FormField label="Priority" error={errors.priority?.message}>
                <Select {...register('priority')} invalid={!!errors.priority}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Assign to" error={errors.assignedTo?.message}>
                <Select {...register('assignedTo')} invalid={!!errors.assignedTo}>
                  <option value="">Unassigned</option>
                  {members.map((m: any) => <option key={m.user_id} value={m.user_id}>{(m.profile as any)?.full_name}</option>)}
                </Select>
              </FormField>
              <FormField label="Due date" error={errors.dueDate?.message}>
                <TextInput {...register('dueDate')} type="date" invalid={!!errors.dueDate} />
              </FormField>
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              background: 'var(--c-red-dim)',
              border: '1px solid rgba(127,29,29,0.6)',
              color: '#fca5a5',
              borderRadius: 6,
              padding: '10px 14px',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <Button type="submit" isLoading={isSubmitting}>Submit RFI</Button>
          <Link
            href="/rfis"
            className="btn-primary-amber"
            style={{
              padding: '9px 18px',
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}

export default function NewRfiPage() {
  return <Suspense fallback={null}><NewRfiForm /></Suspense>
}
