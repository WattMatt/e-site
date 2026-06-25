import { attachmentKindFromMime } from '@esite/shared'

/** A locally-selected file awaiting upload. */
export interface PendingAttachment {
  uri: string
  name: string
  mimeType: string
  size: number
}

export const DIARY_ATTACHMENT_MAX_BYTES = 104857600 // 100 MiB — matches the bucket + web

/**
 * Uploads pending attachments to the diary-attachments bucket and inserts rows.
 *
 * `onItemUploaded` fires after each item's row commits, so the caller can drop
 * committed items and a retry after a mid-batch failure resumes with only what's
 * left (no duplicate rows) — mirroring the web uploader.
 */
export async function uploadDiaryAttachments(
  client: any,
  opts: { orgId: string; projectId: string; entryId: string; userId: string; items: PendingAttachment[] },
  onItemUploaded?: (item: PendingAttachment) => void,
): Promise<void> {
  const { orgId, projectId, entryId, userId, items } = opts
  // Continue sort_order after any rows the entry already has (retry / add-more).
  const baseSort = await nextSortOrder(client, entryId)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.size > DIARY_ATTACHMENT_MAX_BYTES) {
      throw new Error(`"${item.name}" exceeds the 100 MB limit.`)
    }
    const seq = baseSort + i
    const ext = item.name.split('.').pop() ?? 'bin'
    const path = `${orgId}/${projectId}/${entryId}/${Date.now()}-${seq}.${ext}`
    const blob = await fetch(item.uri).then(r => r.blob())
    const { error: upErr } = await client.storage
      .from('diary-attachments')
      .upload(path, blob, { contentType: item.mimeType })
    if (upErr) throw upErr
    const { error: rowErr } = await client
      .schema('projects')
      .from('site_diary_attachments')
      .insert({
        diary_entry_id: entryId,
        file_path: path,
        file_name: item.name,
        mime_type: item.mimeType,
        file_size_bytes: item.size,
        kind: attachmentKindFromMime(item.mimeType),
        sort_order: seq,
        uploaded_by: userId,
      })
    if (rowErr) {
      // The object uploaded but the row insert failed — remove the orphan.
      await client.storage.from('diary-attachments').remove([path]).catch(() => {})
      throw rowErr
    }
    onItemUploaded?.(item)
  }
}

/** Next free sort_order for an entry (max existing + 1, or 0 when none). */
async function nextSortOrder(client: any, entryId: string): Promise<number> {
  const { data } = await client
    .schema('projects')
    .from('site_diary_attachments')
    .select('sort_order')
    .eq('diary_entry_id', entryId)
    .order('sort_order', { ascending: false })
    .limit(1)
  return ((data?.[0]?.sort_order as number | undefined) ?? -1) + 1
}
