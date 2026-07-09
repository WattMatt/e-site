// packages/shared/src/lib/jbcc/letter-values.ts
//
// Single source of truth for the placeholder → value map used to fill a JBCC
// notice template. Both the real generation path and the on-screen preview
// call `buildLetterValues`, so a specimen preview and the issued letter always
// agree. In `specimen` mode any blank renders as a visible `[Label]` marker so
// users can see the shape of the letter BEFORE parties/fields are entered.

export interface RecipientContext {
  name?: string | null
  company?: string | null
  address?: string | null
  partyRole?: string | null
}

export interface SenderContext {
  signatoryName?: string | null
  signatoryTitle?: string | null
  companyName?: string | null
  addressLines?: string[]
}

export interface ManualField {
  placeholder: string
  label: string
}

export interface BuildLetterValuesInput {
  today: string
  recipient?: RecipientContext | null
  sender?: SenderContext | null
  projectName?: string | null
  projectNumber?: string | null
  documentRef?: string | null
  triggerDate?: string | null
  manualValues?: Record<string, string>
  manualFields?: ManualField[]
  /** true → blanks become visible `[Label]` specimen markers. */
  specimen?: boolean
}

/**
 * Build the full [bracket] placeholder map for a JBCC template.
 * Every key the 28 templates may reference is populated. Unknown template tags
 * still render blank via fillTemplate's nullGetter.
 */
export function buildLetterValues(input: BuildLetterValuesInput): Record<string, string> {
  const specimen = input.specimen ?? false
  const v = (real: string | null | undefined, label: string): string => {
    const s = (real ?? '').trim()
    if (s) return s
    return specimen ? `[${label}]` : ''
  }

  const r = input.recipient ?? {}
  const s = input.sender ?? {}
  const senderAddress = (s.addressLines ?? []).filter(Boolean).join(', ')

  const values: Record<string, string> = {
    // --- date ---
    'Insert Date': input.today,
    'Date': input.today,

    // --- controlled document reference ---
    'Reference': v(input.documentRef, 'Document Reference'),
    'Our Reference': v(input.documentRef, 'Document Reference'),
    'Our Ref': v(input.documentRef, 'Document Reference'),
    'Document Reference': v(input.documentRef, 'Document Reference'),

    // --- recipient (address block) ---
    'Name of Recipient': v(r.name, 'Recipient Name'),
    'Recipient Name': v(r.name, 'Recipient Name'),
    'Attention': v(r.name, 'Recipient Name'),
    'Company Name': v(r.company, 'Recipient Company'),
    'Recipient Company Name': v(r.company, 'Recipient Company'),
    'Recipient Company': v(r.company, 'Recipient Company'),
    'Principal Agent': r.partyRole === 'principal_agent' ? v(r.name, 'Recipient Name') : v(null, 'Principal Agent'),
    'Recipient Address': v(r.address, 'Recipient Address'),
    'Street Address': v(r.address, 'Recipient Address'),
    'City, Postal Code': v(null, 'City, Postal Code'),

    // --- sender / signatory (letterhead carries the primary identity) ---
    'Name of Signatory': v(s.signatoryName, 'Your Name'),
    'Sender Name': v(s.signatoryName, 'Your Name'),
    'Signatory Title': v(s.signatoryTitle, 'Your Title'),
    'Project Manager': v(s.signatoryTitle ?? 'Project Manager', 'Your Title'),
    'Sender Company Name': v(s.companyName, 'Your Company'),
    'Sender Address': v(senderAddress, 'Your Address'),

    // --- project ---
    'Project Name': v(input.projectName, 'Project Name'),
    'Project Number': v(input.projectNumber, 'Project Number'),
  }

  // Specimen markers for any manual field left blank.
  if (specimen && input.manualFields) {
    for (const f of input.manualFields) {
      if (!(input.manualValues?.[f.placeholder]?.trim())) {
        values[f.placeholder] = `[${f.label}]`
      }
    }
  }

  // Manual values overlay — the operator's typed input always wins.
  if (input.manualValues) {
    for (const [k, val] of Object.entries(input.manualValues)) {
      if (val != null && val.trim() !== '') values[k] = val
    }
  }

  return values
}
