'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createRfiSchema, type CreateRfiInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
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
    <div className="max-w-2xl">
      <div className="mb-6"><Link href="/rfis" className="text-slate-400 hover:text-white text-sm">← RFIs</Link></div>
      <PageHeader title="New RFI" />
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardBody className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Project <span className="text-red-400">*</span></label>
              <select {...register('projectId')} className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select project…</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {errors.projectId && <p className="text-red-400 text-xs mt-1">{errors.projectId.message}</p>}
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">Subject <span className="text-red-400">*</span></label>
              <input {...register('subject')} autoFocus className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Describe the query…" />
              {errors.subject && <p className="text-red-400 text-xs mt-1">{errors.subject.message}</p>}
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">Description <span className="text-red-400">*</span></label>
              <textarea {...register('description')} rows={4} className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder="Provide full context, reference drawings, standards, etc." />
              {errors.description && <p className="text-red-400 text-xs mt-1">{errors.description.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Category</label>
                <select {...register('category')} className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select…</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/-/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Priority</label>
                <select {...register('priority')} className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Assign to</label>
                <select {...register('assignedTo')} className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Unassigned</option>
                  {members.map((m: any) => <option key={m.user_id} value={m.user_id}>{(m.profile as any)?.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Due date</label>
                <input {...register('dueDate')} type="date" className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </CardBody>
        </Card>

        {error && <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>}

        <div className="flex gap-3">
          <Button type="submit" isLoading={isSubmitting}>Submit RFI</Button>
          <Link href="/rfis"><Button variant="ghost" type="button">Cancel</Button></Link>
        </div>
      </form>
    </div>
  )
}

export default function NewRfiPage() {
  return <Suspense fallback={null}><NewRfiForm /></Suspense>
}
