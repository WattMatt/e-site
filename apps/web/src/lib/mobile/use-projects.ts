'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface ProjectRef { id: string; name: string }

// Names do not change during a session often enough to matter; caching them
// stops every navigation inside a project re-reading the same row.
const nameCache = new Map<string, string>()

/** The project's display name, read through the caller's own RLS. Null until known. */
export function useProjectName(projectId: string | null): string | null {
  const [name, setName] = useState<string | null>(projectId ? nameCache.get(projectId) ?? null : null)
  useEffect(() => {
    if (!projectId) { setName(null); return }
    const cached = nameCache.get(projectId)
    if (cached) { setName(cached); return }
    setName(null)
    let live = true
    createClient()
      .schema('projects')
      .from('projects')
      .select('name')
      .eq('id', projectId)
      .maybeSingle()
      .then(({ data }) => {
        const n = (data as { name?: string } | null)?.name
        if (n) nameCache.set(projectId, n)
        if (live) setName(n ?? null)
      })
    return () => { live = false }
  }, [projectId])
  return name
}

/** Active projects the caller can see (RLS decides), loaded only when `enabled`. */
export function useActiveProjects(enabled: boolean): { projects: ProjectRef[] | null; error: boolean } {
  const [projects, setProjects] = useState<ProjectRef[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!enabled || projects) return
    let live = true
    createClient()
      .schema('projects')
      .from('projects')
      .select('id, name')
      .eq('status', 'active')
      .order('name')
      .limit(100)
      .then(({ data, error: e }) => {
        if (!live) return
        if (e) { setError(true); return }
        const list = (data ?? []) as ProjectRef[]
        for (const p of list) nameCache.set(p.id, p.name)
        setProjects(list)
      })
    return () => { live = false }
  }, [enabled, projects])
  return { projects, error }
}
