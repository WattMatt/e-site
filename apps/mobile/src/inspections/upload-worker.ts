// apps/mobile/src/inspections/upload-worker.ts
//
// Background loop that drains the attachment_uploads queue. Started
// once on app boot from app/_layout.tsx via startUploadWorker(); call
// stopUploadWorker() during teardown to break the loop cleanly.
//
// Per-iteration flow:
//   1. nextPending()  — fetch the oldest pending/retryable row
//   2. read the local file from disk (expo-file-system)
//   3. resolve the project_id placeholder in remote_path (lookupProjectId)
//   4. upload the binary to the right Supabase Storage bucket
//   5. insert the corresponding row in inspections.photos or inspections.signatures
//   6. delete the local file (idempotent)
//   7. markDone() — flip status to 'done'
//
// On failure: markFailed() increments retry_count + records last_error,
// then we sleep 10s before retrying. Rows hit the 5-retry cap inside
// nextPending() — at that point they stop being retried automatically;
// a future settings screen can surface them for manual intervention.

import * as FileSystem from 'expo-file-system'
import {
  type PendingAttachment,
  lookupProjectId,
  markDone,
  markFailed,
  nextPending,
} from './attachment-queue'
import { supabase } from '../lib/supabase'

let running = false

export async function startUploadWorker(): Promise<void> {
  if (running) return
  running = true
  while (running) {
    try {
      const item = await nextPending()
      if (!item) {
        await sleep(5000)
        continue
      }
      await processOne(item)
    } catch (loopErr) {
      // Defensive: never let the loop itself die. Log + sleep + carry on.
      // eslint-disable-next-line no-console
      console.warn('[upload-worker] loop error', loopErr)
      await sleep(10_000)
    }
  }
}

export function stopUploadWorker(): void {
  running = false
}

async function processOne(item: PendingAttachment): Promise<void> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(item.local_path)
    if (!fileInfo.exists) {
      throw new Error('Local file vanished before upload')
    }

    // Resolve the __placeholder__ segment to the real project_id (if present).
    // Photo paths from the capture screen use the shape:
    //   __placeholder__/<inspection_id>/<section_id>/<field_id>/<ts>.jpg
    let remotePath = item.remote_path
    if (remotePath.startsWith('__placeholder__/')) {
      const projectId = await lookupProjectId(item.inspection_id)
      if (!projectId) {
        throw new Error(
          `Cannot resolve project_id for inspection ${item.inspection_id} — local inspections table missing or not synced yet`,
        )
      }
      remotePath = projectId + remotePath.slice('__placeholder__'.length)
    }

    const base64 = await FileSystem.readAsStringAsync(item.local_path, {
      encoding: FileSystem.EncodingType.Base64,
    })
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const contentType =
      item.bucket === 'inspection-signatures' ? 'image/png' : 'image/jpeg'

    const { error: upErr } = await supabase.storage
      .from(item.bucket)
      .upload(remotePath, bytes, { contentType, upsert: false })
    if (upErr) throw upErr

    // The generated Database type doesn't enumerate the `inspections` schema
    // yet (it isn't in packages/db/src/types.ts at the time of this commit),
    // so we cast to any here. Regenerating Database types in a follow-up will
    // let us drop the cast.
    const supa = supabase as unknown as {
      schema: (s: string) => {
        from: (t: string) => {
          insert: (payload: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
        }
      }
    }

    if (item.bucket === 'inspection-photos') {
      const { error: insErr } = await supa.schema('inspections').from('photos').insert({
        inspection_id: item.inspection_id,
        section_id: item.section_id,
        field_id: item.field_id,
        storage_path: remotePath,
        caption: item.caption,
      })
      if (insErr) throw new Error(insErr.message)
    } else if (item.bucket === 'inspection-signatures') {
      const { error: insErr } = await supa.schema('inspections').from('signatures').insert({
        inspection_id: item.inspection_id,
        role: item.signature_role,
        signatory_name: item.signatory_name,
        signatory_title: item.signatory_title,
        registration_number: item.registration_number,
        storage_path: remotePath,
      })
      if (insErr) throw new Error(insErr.message)
    }
    // 'inspection-attachments' bucket: upload only, no metadata row in v1.

    await FileSystem.deleteAsync(item.local_path, { idempotent: true })
    await markDone(item.id)
  } catch (e) {
    await markFailed(item.id, (e as Error).message ?? String(e))
    await sleep(10_000)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
