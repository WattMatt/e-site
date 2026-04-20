'use server'

/**
 * POPIA §23 data subject request handler.
 *
 * Spec: spec-v2.md §19.
 *
 * The form on /privacy/request POSTs to this action. We forward the request
 * via the send-email Edge Function to the Information Officer's inbox and
 * return a confirmation. Phase 1 uses the inbox itself as the audit log —
 * Phase 2 may graduate to a dedicated public.data_subject_requests table if
 * volumes justify it.
 */

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

const schema = z.object({
  name:        z.string().min(2, 'Please enter your full name.'),
  email:       z.string().email('Please enter a valid email address.'),
  requestType: z.enum(['access', 'correction', 'deletion', 'complaint', 'other'], {
    message: 'Please select a request type.',
  }),
  description: z.string().min(10, 'Please describe your request in a few sentences.'),
})

export type DataRequestInput = z.infer<typeof schema>

const INFO_OFFICER_EMAIL = 'arno@watsonmattheus.com'

const LABELS: Record<DataRequestInput['requestType'], string> = {
  access:     'Access request (POPIA §23)',
  correction: 'Correction request (POPIA §24)',
  deletion:   'Deletion request (POPIA §24)',
  complaint:  'Complaint',
  other:      'Other',
}

export async function submitDataRequestAction(formData: FormData): Promise<{
  ok: boolean
  error?: string
}> {
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!rateLimit(`data-request:${ip}`, 3, 60_000)) {
    return { ok: false, error: 'Too many requests. Please wait a minute and try again.' }
  }

  const parsed = schema.safeParse({
    name:        formData.get('name'),
    email:       formData.get('email'),
    requestType: formData.get('requestType'),
    description: formData.get('description'),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const { name, email, requestType, description } = parsed.data
  const label = LABELS[requestType]
  const receivedAt = new Date().toISOString()

  const supabase = await createClient()

  const { error } = await supabase.functions.invoke('send-email', {
    body: {
      type: 'data-subject-request',
      payload: {
        to:        INFO_OFFICER_EMAIL,
        subject:   `[POPIA] ${label} from ${name}`,
        requester: { name, email },
        requestType,
        requestTypeLabel: label,
        description,
        receivedAt,
      },
    },
  })

  if (error) {
    // Don't expose the internal error to the user — but make sure we don't
    // silently swallow it either. Log and return a generic failure so they
    // can retry or fall back to emailing the Information Officer directly.
    console.error('data-request: send-email failed', error)
    return {
      ok: false,
      error: `We couldn't submit your request automatically. Please email ${INFO_OFFICER_EMAIL} directly.`,
    }
  }

  return { ok: true }
}
