/**
 * IndexedDB draft persistence for anything drawn on a sheet.
 *
 * A tiny local store so a crash, a tab close or a spell offline does not lose
 * work in progress. Keys are the caller's business (the markup canvas keys per
 * drawing + annotation; the route canvas per drawing + run + page).
 *
 * The database and store names are the ones `MarkupCanvas` used before this
 * module existed, so drafts saved before the extraction are still found.
 *
 * Every function degrades silently: IndexedDB is unavailable in private mode
 * and under quota pressure, and a draft is a convenience, never the record.
 */

const DRAFT_DB = 'esite-markup-drafts'
const DRAFT_STORE = 'drafts'

function openDraftDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DRAFT_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(DRAFT_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getDraft<T>(key: string): Promise<T | null> {
  try {
    const db = await openDraftDB()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readonly')
      const req = tx.objectStore(DRAFT_STORE).get(key)
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function setDraft<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDraftDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      tx.objectStore(DRAFT_STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* IDB unavailable (private mode, quota): degrade silently. */
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    const db = await openDraftDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite')
      tx.objectStore(DRAFT_STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* swallow */
  }
}
