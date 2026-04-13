'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createSnagSchema, type CreateSnagInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import Link from 'next/link'

const CATEGORIES = ['general', 'electrical', 'mechanical', 'civil', 'safety', 'quality', 'documentation']
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

interface Props { params: Promise<{ id: string }> }

export default function NewSnagPage({ params }: Props) {
  const { id: projectId } = use(params)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<any[]>([])
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateSnagInput>({
    resolver: zodResolver(createSnagSchema),
    defaultValues: { projectId, priority: 'medium', category: 'general' },
  })

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
      // Create snag
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

      // Upload photos
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
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href={`/projects/${projectId}`} className="text-slate-400 hover:text-white text-sm">← Project</Link>
      </div>
      <PageHeader title="Raise Snag" />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Card>
          <CardBody className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Title <span className="text-red-400">*</span></label>
              <input {...register('title')} autoFocus
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Describe the issue…" />
              {errors.title && <p className="text-red-400 text-xs mt-1">{errors.title.message}</p>}
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-1">Description</label>
              <textarea {...register('description')} rows={3} className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Location</label>
                <input {...register('location')} className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. DB Room, Level 2" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Category</label>
                <select {...register('category')} className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Priority</label>
                <div className="flex gap-2">
                  {PRIORITIES.map(p => {
                    const colours: Record<string, string> = { low: 'border-slate-600 text-slate-400', medium: 'border-blue-600 text-blue-400', high: 'border-amber-600 text-amber-400', critical: 'border-red-600 text-red-400' }
                    return (
                      <label key={p} className="flex-1 cursor-pointer">
                        <input {...register('priority')} type="radio" value={p} className="sr-only" />
                        <div className={`text-center text-xs py-2 rounded border ${colours[p]} hover:bg-slate-700 transition-colors`}>{p}</div>
                      </label>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Assign to</label>
                <select {...register('assignedTo')} className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Unassigned</option>
                  {members.map((m: any) => (
                    <option key={m.user_id} value={m.user_id}>{(m.profile as any)?.full_name}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Photo upload */}
        <Card>
          <CardBody>
            <label className="block text-sm font-medium text-white mb-3">Evidence Photos</label>
            <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-xl p-8 cursor-pointer transition-colors">
              <input type="file" accept="image/*" multiple className="sr-only"
                onChange={e => setPhotoFiles(Array.from(e.target.files ?? []))} />
              <span className="text-2xl">📷</span>
              <span className="text-slate-400 text-sm">Click to select photos</span>
            </label>
            {photoFiles.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {photoFiles.map((f, i) => (
                  <div key={i} className="relative">
                    <img src={URL.createObjectURL(f)} alt="" className="w-20 h-20 object-cover rounded-lg border border-slate-700" />
                    <button type="button" onClick={() => setPhotoFiles(fs => fs.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 rounded-full text-white text-xs flex items-center justify-center">×</button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {error && <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>}

        <div className="flex gap-3">
          <Button type="submit" isLoading={isSubmitting || uploading}>
            {uploading ? 'Uploading photos…' : 'Raise Snag'}
          </Button>
          <Link href={`/projects/${projectId}`}><Button variant="ghost" type="button">Cancel</Button></Link>
        </div>
      </form>
    </div>
  )
}
