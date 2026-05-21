import { attachmentKindFromMime } from '@esite/shared'

/** A locally-selected file awaiting upload. */
export interface PendingAttachment {
  uri: string
  name: string
  mimeType: string
  size: number
}

/** Uploads pending attachments to the diary-attachments bucket and inserts rows. */
export async function uploadDiaryAttachments(
  client: any,
  opts: { orgId: string; projectId: string; entryId: string; userId: string; items: PendingAttachment[] },
): Promise<void> {
  const { orgId, projectId, entryId, userId, items } = opts
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const ext = item.name.split('.').pop() ?? 'bin'
    const path = `${orgId}/${projectId}/${entryId}/${Date.now()}-${i}.${ext}`
    const arraybuffer = await fetch(item.uri).then(r => r.arrayBuffer())
    const { error: upErr } = await client.storage
      .from('diary-attachments')
      .upload(path, arraybuffer, { contentType: item.mimeType })
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
        sort_order: i,
        uploaded_by: userId,
      })
    if (rowErr) {
      // The object uploaded but the row insert failed — remove the orphan.
      await client.storage.from('diary-attachments').remove([path]).catch(() => {})
      throw rowErr
    }
  }
}
