import { attachmentKindFromMime, storageKeySegment } from '@esite/shared'
import { detectImageMime } from '@/lib/image/compress'
import type { SupabaseClient } from '@supabase/supabase-js'

/** `accept` for the document file input. Photo/video inputs use `image/*` /
 *  `video/*` so phone browsers surface the camera; the bucket enforces the
 *  real allowed-MIME list on upload. */
export const DIARY_ATTACHMENT_ACCEPT_DOC =
  'application/pdf,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const DIARY_ATTACHMENT_MAX_BYTES = 104857600 // 100 MiB

/** Extension fallback for the non-image types the bucket allows. */
const DOC_EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
}

/**
 * The content type to upload with. `File.type` is blank when the OS doesn't
 * know the extension (e.g. .HEIC on Windows); a blank type uploads as
 * application/octet-stream, which the bucket's MIME allow-list refuses.
 */
async function resolveContentType(file: File, ext: string): Promise<string> {
  if (file.type) return file.type
  return (await detectImageMime(file)) || DOC_EXT_MIME[ext] || ''
}

/**
 * Uploads files to the diary-attachments bucket and inserts attachment rows.
 *
 * `onFileUploaded` fires after each file's row is committed. The caller uses it
 * to drop committed files from its pending list, so a retry after a mid-loop
 * failure resumes with only the not-yet-uploaded files (no duplicate rows).
 */
export async function uploadDiaryAttachments(
  supabase: SupabaseClient,
  opts: { orgId: string; projectId: string; entryId: string; userId: string; files: File[] },
  onFileUploaded?: (file: File) => void,
): Promise<void> {
  const { orgId, projectId, entryId, userId, files } = opts
  // Continue sort_order after any attachments the entry already has. Without this
  // a retry (remaining files only) or an "add more" on an existing entry would
  // restart at 0 and collide with committed rows, scrambling display order.
  const baseSort = await nextSortOrder(supabase, entryId)
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (file.size > DIARY_ATTACHMENT_MAX_BYTES) {
      throw new Error(`"${file.name}" exceeds the 100 MB limit.`)
    }
    const seq = baseSort + i
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
    const contentType = await resolveContentType(file, ext)
    if (!contentType) {
      throw new Error(`"${file.name}" is not a supported file type (photo, video, PDF, Word or Excel).`)
    }
    const path = `${orgId}/${projectId}/${entryId}/${Date.now()}-${seq}.${storageKeySegment(ext)}`
    const { error: upErr } = await supabase.storage
      .from('diary-attachments')
      .upload(path, file, { contentType })
    if (upErr) throw upErr
    const { error: rowErr } = await supabase
      .schema('projects')
      .from('site_diary_attachments')
      .insert({
        diary_entry_id: entryId,
        file_path: path,
        file_name: file.name,
        mime_type: contentType,
        file_size_bytes: file.size,
        kind: attachmentKindFromMime(contentType),
        sort_order: seq,
        uploaded_by: userId,
      })
    if (rowErr) {
      // The object uploaded but the row insert failed — remove the orphan.
      await supabase.storage.from('diary-attachments').remove([path]).catch(() => {})
      throw rowErr
    }
    onFileUploaded?.(file)
  }
}

/** Next free sort_order for an entry (max existing + 1, or 0 when none). */
async function nextSortOrder(supabase: SupabaseClient, entryId: string): Promise<number> {
  const { data } = await supabase
    .schema('projects')
    .from('site_diary_attachments')
    .select('sort_order')
    .eq('diary_entry_id', entryId)
    .order('sort_order', { ascending: false })
    .limit(1)
  return ((data?.[0]?.sort_order as number | undefined) ?? -1) + 1
}
