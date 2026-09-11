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
import { createServiceClient } from '@/lib/supabase/server'
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

  // SERVICE-ROLE, not the SSR anon client.
  //
  // `data-subject-request` is the only type send-email accepts without a
  // service-role credential, and that exemption is exactly what made the
  // function an unauthenticated relay (audit 2026-09-10). This action is the
  // one legitimate anonymous caller, so it stops being anonymous here: the
  // exemption can then be withdrawn, and the form keeps working when the
  // Supabase gateway is switched to verifying JWTs (dropping --no-verify-jwt).
  // The visitor is still unauthenticated — the elevation is server-side only,
  // and the input has already been schema-validated and rate-limited above.
  const supabase = createServiceClient()

  const { error } = await supabase.functions.invoke('send-email', {
    body: {
      type: 'data-subject-request',
      payload: {
        // The hardened function IGNORES `to`, `subject`, `requestTypeLabel`
        // and `receivedAt` — it hardcodes the Information Officer and builds
        // the subject and timestamp itself, so a caller controls nothing that
        // reaches the wire. They are still sent because the edge function is
        // deployed MANUALLY: between merging this and redeploying send-email,
        // the currently-live handler still reads them, and dropping them now
        // would send `to: undefined` and break the published privacy notice's
        // request form. Remove them once the hardened function is live.
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
