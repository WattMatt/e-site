/** Adds a `storage` fake (and captures) to a fakeSupabase client, for service-client tests. */
import { vi } from 'vitest'

export function withStorage<T extends { client: Record<string, unknown> }>(fake: T, over: Partial<Record<'upload' | 'remove' | 'download' | 'createSignedUrl', unknown>> = {}) {
  const bucket = {
    upload: vi.fn(async () => ({ error: null })),
    remove: vi.fn(async () => ({ error: null })),
    download: vi.fn(async () => ({ data: null, error: { message: 'not found' } })),
    createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null })),
    ...over,
  }
  const from = vi.fn(() => bucket)
  return { ...fake, client: { ...fake.client, storage: { from } }, bucket, storageFrom: from }
}
