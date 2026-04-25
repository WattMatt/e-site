'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { respondToRfiAction } from '@/actions/rfi.actions'
import { Button } from '@/components/ui/Button'
import { AttachmentStaging } from '@/components/attachments/AttachmentStaging'
import { commitStagedAttachments } from '@/components/attachments/commit'
import type { StagedAttachment } from '@/components/attachments/types'

export function RfiRespondForm({ rfiId }: { rfiId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)

  // Fetch the parent RFI's project + org so the attachment staging knows
  // which floor plans to list and where to write the storage path.
  useEffect(() => {
    const supabase = createClient()
    supabase
      .schema('projects')
      .from('rfis')
      .select('project_id, organisation_id')
      .eq('id', rfiId)
      .single()
      .then(({ data }) => {
        if (data) {
          setProjectId(data.project_id as string)
          setOrgId(data.organisation_id as string)
        }
      })
  }, [rfiId])

  async function submit() {
    if (body.trim().length < 10) { setError('Response must be at least 10 characters'); return }
    setSaving(true)
    setError(null)

    // Server action handles the insert + status flip + raiser/assignee
    // notification; attachments stay client-side because they need the
    // browser File flow.
    const result = await respondToRfiAction({ rfiId, body: body.trim() })
    if (result.error || !result.responseId) {
      setError(result.error ?? 'Could not save response')
      setSaving(false)
      return
    }

    if (attachments.length > 0 && projectId && orgId) {
      try {
        const supabase = createClient()
        await commitStagedAttachments({
          supabase,
          staged: attachments,
          orgId,
          projectId,
          entityType: 'rfi_response',
          entityId: result.responseId,
          rfiId,
          userId: (await supabase.auth.getUser()).data.user!.id,
        })
      } catch (attErr) {
        setError(attErr instanceof Error ? attErr.message : 'Attachment upload failed')
      }
    }

    setBody('')
    setAttachments([])
    router.refresh()
    setSaving(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={4}
        placeholder="Type your response…"
        className="ob-input"
        style={{ resize: 'vertical' }}
      />
      <AttachmentStaging
        projectId={projectId}
        value={attachments}
        onChange={setAttachments}
        allowFloorPlan={!!projectId}
      />
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}
      <div>
        <Button size="sm" onClick={submit} isLoading={saving} disabled={!body.trim()}>
          Submit Response
        </Button>
      </div>
    </div>
  )
}
