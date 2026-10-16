'use client'

import { createContext, useContext } from 'react'

export interface CapturedSignature {
  section_id: string
  field_id: string
  signatory_name: string | null
  signed_at: string | null
}

/**
 * Lets every photo, file and signature field tell the capture page when an upload lands or is
 * removed, and lets a signature field show who has already signed.
 *
 * The page evaluates the inspection (section progress, "Required missing", the Submit check)
 * against attachments loaded on the server. Without these reports that list went stale the
 * moment someone uploaded: the section rail kept reading 0/4 and Submit kept pointing at a
 * field whose photo was already there, until the page was reloaded. Signatures were never
 * loaded at all, so a required signature field could never count as done.
 */
export interface PhotoTally {
  added: (sectionId: string, fieldId: string) => void
  removed: (sectionId: string, fieldId: string) => void
  signatures: CapturedSignature[]
  signed: (signature: CapturedSignature) => void
}

const noop: PhotoTally = {
  added: () => undefined,
  removed: () => undefined,
  signatures: [],
  signed: () => undefined,
}

export const PhotoTallyContext = createContext<PhotoTally>(noop)

export function usePhotoTally(): PhotoTally {
  return useContext(PhotoTallyContext)
}
