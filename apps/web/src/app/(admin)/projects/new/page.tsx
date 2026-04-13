'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createProjectSchema, type CreateProjectInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import Link from 'next/link'

const PROVINCES = [
  'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
  'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
]

export default function NewProjectPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateProjectInput>({ resolver: zodResolver(createProjectSchema) })

  async function onSubmit(input: CreateProjectInput) {
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: membership } = await supabase
      .from('user_organisations')
      .select('organisation_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (!membership) { setError('No organisation found'); return }

    const { data: project, error: err } = await supabase
      .schema('projects')
      .from('projects')
      .insert({
        organisation_id: membership.organisation_id,
        created_by: user.id,
        name: input.name,
        description: input.description,
        address: input.address,
        city: input.city,
        province: input.province,
        status: input.status,
        start_date: input.startDate,
        end_date: input.endDate,
        contract_value: input.contractValue,
        client_name: input.clientName,
        client_contact: input.clientContact,
      })
      .select()
      .single()

    if (err) { setError(err.message); return }

    // Add creator as PM
    await supabase.schema('projects').from('project_members').insert({
      project_id: project.id,
      user_id: user.id,
      organisation_id: membership.organisation_id,
      role: 'project_manager',
    })

    router.push(`/projects/${project.id}`)
  }

  const field = (label: string, name: keyof CreateProjectInput, type = 'text', required = false) => (
    <div>
      <label className="block text-sm text-slate-400 mb-1">
        {label}{required && <span className="text-red-400 ml-1">*</span>}
      </label>
      <input
        {...register(name)}
        type={type}
        className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {errors[name] && <p className="text-red-400 text-xs mt-1">{errors[name]?.message as string}</p>}
    </div>
  )

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/projects" className="text-slate-400 hover:text-white text-sm">← Projects</Link>
      </div>
      <PageHeader title="New Project" />

      <form onSubmit={handleSubmit(onSubmit)}>
        <Card>
          <CardBody className="space-y-4">
            <h3 className="font-semibold text-white">Basic Info</h3>
            {field('Project Name', 'name', 'text', true)}
            <div>
              <label className="block text-sm text-slate-400 mb-1">Description</label>
              <textarea
                {...register('description')}
                rows={3}
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardBody className="space-y-4">
            <h3 className="font-semibold text-white">Location</h3>
            {field('Address', 'address')}
            <div className="grid grid-cols-2 gap-4">
              {field('City', 'city')}
              <div>
                <label className="block text-sm text-slate-400 mb-1">Province</label>
                <select
                  {...register('province')}
                  className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select…</option>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="mt-4">
          <CardBody className="space-y-4">
            <h3 className="font-semibold text-white">Client & Contract</h3>
            {field('Client Name', 'clientName')}
            {field('Client Contact', 'clientContact')}
            <div className="grid grid-cols-3 gap-4">
              {field('Contract Value (R)', 'contractValue', 'number')}
              {field('Start Date', 'startDate', 'date')}
              {field('End Date', 'endDate', 'date')}
            </div>
          </CardBody>
        </Card>

        {error && (
          <div className="mt-4 bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
        )}

        <div className="mt-6 flex gap-3">
          <Button type="submit" isLoading={isSubmitting}>Create Project</Button>
          <Link href="/projects">
            <Button variant="ghost" type="button">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
