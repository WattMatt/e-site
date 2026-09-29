'use client'
/** Browser → the gated run/cancel routes. Returns the server's sentence verbatim (spec §0.4 rule 5). */
export async function postRun(projectId: string, caseId: string): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/projects/${projectId}/solar/cases/${caseId}/run`, { method: 'POST' })
    const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string }
    return res.ok ? { ok: true, runId: String(body.runId ?? '') } : { ok: false, error: body.error ?? 'The run failed — try again.' }
  } catch {
    return { ok: false, error: 'The server could not be reached — check your connection and try again.' }
  }
}

export async function postCancel(projectId: string, caseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/projects/${projectId}/solar/cases/${caseId}/cancel`, { method: 'POST' })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    return res.ok ? { ok: true } : { ok: false, error: body.error ?? 'The run could not be cancelled.' }
  } catch {
    return { ok: false, error: 'The server could not be reached.' }
  }
}
