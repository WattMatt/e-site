// LEGAL_ENTITY — single source of truth for the operating company's CIPC /
// SARS details. Surfaces in the public-site footer, the legal pages, and the
// Paystack KYC response pack. When the company restructures or the address
// changes, update this file only.
//
// Spec: SPEC DOCS/paystack/00-master-spec.md §2 D7.
// Spec: SPEC DOCS/paystack/01-kyc-response-pack.md §1.

export const LEGAL_ENTITY = {
  // Trading name of the product
  tradingName:      'E-Site',
  // Operating company (CIPC-registered legal entity)
  registeredName:   'Lenchen Engineering (Pty) Ltd',
  registrationNo:   '1997/008488/07',
  vatNo:            '4070166279',
  // Registered office per CIPC
  address: {
    line1:    '716 Toermalyn Street',
    suburb:   'Moreleta Park',
    city:     'Pretoria',
    postcode: '0167',
    country:  'South Africa',
  },
  // POPIA Information Officer and general contact
  infoOfficer:      'Arno Mattheus',
  infoOfficerEmail: 'arno@watsonmattheus.com',
  contactEmail:     'support@e-site.live',
} as const

// One-line postal address for footers + invoices.
export function formatAddressOneLine(): string {
  const a = LEGAL_ENTITY.address
  return `${a.line1}, ${a.suburb}, ${a.city}, ${a.postcode}`
}
