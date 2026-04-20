import type { TypedSupabaseClient } from '@esite/db'

type Bucket = 'snag-photos' | 'coc-documents' | 'drawings' | 'avatars' | 'rfi-attachments'

export const storageService = {
  /** Upload a File (web) or Blob to a bucket. Returns the storage path. */
  async upload(
    client: TypedSupabaseClient,
    bucket: Bucket,
    path: string,
    file: File | Blob,
    contentType?: string
  ): Promise<string> {
    const { data, error } = await client.storage
      .from(bucket)
      .upload(path, file, {
        contentType: contentType ?? (file instanceof File ? file.type : 'application/octet-stream'),
        upsert: false,
      })
    if (error) throw error
    return data.path
  },

  /** Upload from a URI (React Native / Expo). Returns the storage path. */
  async uploadFromUri(
    client: TypedSupabaseClient,
    bucket: Bucket,
    path: string,
    uri: string,
    contentType: string = 'image/jpeg'
  ): Promise<string> {
    const response = await fetch(uri)
    const blob = await response.blob()
    return this.upload(client, bucket, path, blob, contentType)
  },

  /** Get a signed URL valid for 1 hour. */
  async signedUrl(client: TypedSupabaseClient, bucket: Bucket, path: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn)
    if (error) throw error
    return data.signedUrl
  },

  /** Get public URL (only works for public buckets like avatars). */
  publicUrl(client: TypedSupabaseClient, bucket: Bucket, path: string): string {
    const { data } = client.storage.from(bucket).getPublicUrl(path)
    return data.publicUrl
  },

  /** Delete a file from storage. */
  async remove(client: TypedSupabaseClient, bucket: Bucket, paths: string[]): Promise<void> {
    const { error } = await client.storage.from(bucket).remove(paths)
    if (error) throw error
  },

  // ─── Path builders ─────────────────────────────────────────────────────────

  snagPhotoPath(orgId: string, projectId: string, snagId: string, filename: string) {
    return `${orgId}/${projectId}/${snagId}/${filename}`
  },

  cocDocPath(orgId: string, siteId: string, subsectionId: string, filename: string) {
    return `${orgId}/${siteId}/${subsectionId}/${filename}`
  },

  drawingPath(orgId: string, projectId: string, filename: string) {
    return `${orgId}/${projectId}/${filename}`
  },

  avatarPath(userId: string, filename: string) {
    return `${userId}/${filename}`
  },

  /** Path convention for the rfi-attachments bucket. Mirrors web migration 00029. */
  rfiAttachmentPath(orgId: string, projectId: string, rfiId: string, filename: string) {
    return `${orgId}/${projectId}/${rfiId}/${filename}`
  },
}
