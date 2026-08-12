/**
 * Plain, serialisable fixtures for the Site Form report document.
 *
 * Deliberately free of Supabase, react-pdf and network access: the 1×1 PNG
 * below is a `data:` URI, so a render never touches the network. That is the
 * same rule the gatherer enforces in production — react-pdf's <Image> fetches
 * URLs server-side with no timeout and fails silently.
 */

import type {
  SiteFormReportData,
  SiteFormAuditEntry,
  SiteFormDefectRow,
  SiteFormGroupTable,
  SiteFormPhotoField,
  SiteFormReportSection,
  SiteFormSignatureBlock,
} from '../site-form-report-data'

/** 1×1 transparent PNG. */
export const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/**
 * Strings that killed the cable-schedule PDF pack for two months: pdf-lib's
 * WinAnsi-only Helvetica threw on Ω and →, and `widthOfTextAtSize` threw on a
 * newline. react-pdf survives all of it; these fixtures keep that honest.
 */
export const HOSTILE_MULTILINE = 'DB-1 Ω → 2,5 mm²\nsecond line\ttabbed'
export const HOSTILE_GLYPHS = '→ Ω ± ° μ « » — – ‘ ’ “ ”'

const circuitsTable: SiteFormGroupTable = {
  fieldId: 'circuits',
  label: 'Circuits acted upon',
  columns: [
    { fieldId: 'way_no', label: 'Way / position no.' },
    { fieldId: 'circuit_ref', label: 'Circuit reference' },
    { fieldId: 'description_as_found', label: 'Circuit description (as found)' },
    { fieldId: 'action_taken', label: 'Action taken' },
    { fieldId: 'conductor_size_phase', label: 'Conductor size (phase)' },
    { fieldId: 'clear_break_made', label: 'Clear break made' },
    { fieldId: 'far_end_made_safe', label: 'Far end made safe' },
    { fieldId: 'way_blanked_off', label: 'Way blanked off' },
    { fieldId: 'circuit_notes', label: 'Notes / deviations' },
  ],
  rows: [
    {
      entryNo: 1,
      cells: [
        '4',
        'C4',
        'Shop 12 ring',
        'Terminated and removed',
        '2,5 mm²',
        'PASS',
        'PASS',
        'PASS',
        HOSTILE_MULTILINE,
      ],
    },
    {
      entryNo: 2,
      cells: [
        '9',
        'C9',
        'Signage feed',
        'Left isolated locked off',
        '4 mm²',
        'PASS',
        'NA',
        'FAIL',
        'Left live pending landlord instruction',
      ],
    },
  ],
}

const crewTable: SiteFormGroupTable = {
  fieldId: 'crew',
  label: 'Other persons on site (crew)',
  columns: [
    { fieldId: 'crew_name', label: 'Name' },
    { fieldId: 'crew_role', label: 'Role' },
  ],
  rows: [
    { entryNo: 1, cells: ['Sipho Ndlovu', 'Assistant'] },
    { entryNo: 2, cells: ['Karel van Zyl', 'Safety observer'] },
  ],
}

const sections: SiteFormReportSection[] = [
  {
    sectionId: 'db_identification',
    title: '2. Distribution board / equipment identification',
    rows: [
      { fieldId: 'db_reference', label: 'DB reference / code', kind: 'value', value: 'DB-1' },
      {
        fieldId: 'db_description',
        label: 'DB description / name on nameplate (as found)',
        kind: 'value',
        value: HOSTILE_GLYPHS,
      },
      {
        fieldId: 'earth_leakage_tripping_current',
        label: 'Rated earth leakage tripping current I∆n',
        kind: 'value',
        value: '30 mA',
      },
      {
        fieldId: 'db_above_10ka',
        label: 'DB short-circuit rating greater than 10 kA?',
        kind: 'result',
        pass: 'fail',
        failReason: 'Rated 6 kA only — Ω measurement attached',
        sansRef: 'SANS 10142-1 6.7.3',
      },
      {
        fieldId: 'alternative_supply_details',
        label: 'Alternative supply details',
        kind: 'paragraph',
        value: HOSTILE_MULTILINE,
      },
      {
        fieldId: 'alternative_supplies',
        label: 'Alternative / secondary supplies present?',
        kind: 'list',
        value: 'Generator, UPS',
      },
    ],
    groups: [],
  },
  {
    sectionId: 'personnel',
    title: '3. Date, time and personnel',
    rows: [
      { fieldId: 'date_of_work', label: 'Date of work', kind: 'value', value: '2026-08-11' },
      {
        fieldId: 'electrician_name',
        label: 'Electrician — full name',
        kind: 'value',
        value: 'Thandi Mokoena',
      },
      {
        fieldId: 'ppe_confirmed',
        label: 'PPE confirmed appropriate and serviceable',
        kind: 'result',
        pass: 'pass',
        failReason: null,
      },
      { fieldId: 'unanswered_field', label: 'Time work completed', kind: 'value', value: '' },
    ],
    groups: [crewTable],
  },
  {
    sectionId: 'circuits_affected',
    title: '5. Circuits affected',
    rows: [
      {
        fieldId: 'circuits_header',
        label: 'Each circuit acted upon is recorded below.',
        kind: 'subheading',
      },
    ],
    groups: [circuitsTable],
  },
  {
    sectionId: 'handover_status',
    title: '12. Handover status',
    rows: [
      {
        fieldId: 'as_left_status',
        label: 'As-left status of this board',
        kind: 'value',
        value: 'Made safe — de-energised',
      },
      {
        fieldId: 'not_checked_item',
        label: 'Temporary earths removed',
        kind: 'result',
        pass: null,
        failReason: null,
      },
    ],
    groups: [],
  },
]

const photoFields: SiteFormPhotoField[] = [
  {
    sectionId: 'db_identification',
    fieldId: 'photo_db_nameplate',
    label: '2. Distribution board / equipment identification — Photo — DB nameplate (as found)',
    photos: [
      { id: 'ph-1', dataUri: PNG_DATA_URI, caption: `Nameplate ${HOSTILE_GLYPHS}` },
      { id: 'ph-2', dataUri: PNG_DATA_URI, caption: '2026-08-11, 09:14 · -26.10412, 28.05613 · by Thandi Mokoena' },
    ],
    omittedCount: 0,
  },
  {
    sectionId: 'circuits_affected',
    fieldId: 'circuits[0].photo_circuit_termination',
    label: '5. Circuits affected — Circuits acted upon [1] · Photo — circuit termination',
    photos: [{ id: 'ph-3', dataUri: PNG_DATA_URI, caption: '' }],
    omittedCount: 7,
  },
]

const defects: SiteFormDefectRow[] = [
  {
    entryNo: 1,
    description: 'Exposed live conductor behind trunking lid',
    location: 'Riser, level 2',
    classification: 'C1',
    isC1: true,
    regulationReference: 'SANS 10142-1 6.1.2',
    actionTaken: 'Circuit isolated and locked off; supply left disconnected',
    actionBy: 'Thandi Mokoena',
    targetDate: '2026-08-12',
  },
  {
    entryNo: 2,
    description: `Missing blanking plate ${HOSTILE_GLYPHS}`,
    location: 'DB-1 way 9',
    classification: 'C3',
    isC1: false,
    regulationReference: 'SANS 10142-1 6.4',
    actionTaken: 'Reported to landlord',
    actionBy: 'Site supervisor',
    targetDate: '',
  },
]

const signatures: SiteFormSignatureBlock[] = [
  {
    blockId: 'electrician',
    blockLabel: 'Electrician',
    signatoryName: 'Thandi Mokoena',
    signatoryRole: 'Installation electrician',
    registrationCategory: 'installation_electrician',
    registrationNumber: 'IE-2019-114873',
    signedAt: '2026-08-11T15:42:00.000Z',
    imageDataUri: PNG_DATA_URI,
  },
  {
    blockId: 'registered_person',
    blockLabel: 'Registered person (general control)',
    signatoryName: 'A. Mattheus',
    signatoryRole: null,
    registrationCategory: 'master_installation_electrician',
    registrationNumber: 'MIE-2011-004421',
    signedAt: '2026-08-11T16:03:00.000Z',
    imageDataUri: null,
  },
]

const audit: SiteFormAuditEntry[] = [
  {
    at: '2026-08-11T09:02:11.000Z',
    sectionTitle: '2. Distribution board / equipment identification',
    fieldLabel: 'DB reference / code',
    value: 'DB-1',
    by: 'Thandi Mokoena',
  },
  {
    at: '2026-08-11T09:04:52.000Z',
    sectionTitle: '5. Circuits affected',
    fieldLabel: 'Circuits acted upon [1] · Notes / deviations',
    value: HOSTILE_MULTILINE,
    by: 'Thandi Mokoena',
  },
  {
    at: null,
    sectionTitle: '12. Handover status',
    fieldLabel: 'As-left status of this board',
    value: 'Made safe — de-energised',
    by: '—',
  },
]

/** A full, realistic, hostile-unicode-laden site form report payload. */
export const siteFormReportFixture: SiteFormReportData = {
  formId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  organisationId: '33333333-3333-4333-8333-333333333333',
  branding: {
    accent: '#E69500',
    issuer: { wordmark: 'Watson Mattheus Consulting' },
    parties: [],
    title: 'Termination and Making Safe',
    kicker: 'TERMINATION & MAKING-SAFE RECORD',
    projectLine: `Kingswalk Mall — TMS-KING-2026-0007 · ${HOSTILE_GLYPHS}`,
    footerStamp: 'Generated 2026-08-11 · e-site.live',
  },
  summary: {
    formNo: 'TMS-KING-2026-0007',
    status: 'distributed',
    projectName: 'Kingswalk Mall',
    projectCode: 'KING',
    templateName: 'Termination and Making Safe',
    templateVersion: '1.0',
    boardLabel: HOSTILE_GLYPHS,
    boardRef: 'DB-1',
    asLeftStatus: 'made_safe_de_energised',
    asLeftStatusText: 'Made safe — de-energised',
    dateOfWork: '2026-08-11',
    electricianName: 'Thandi Mokoena',
    registeredPersonName: 'A. Mattheus',
    circuitsLeftTemporary: 1,
    circuitCount: 2,
    defectCount: 2,
    c1Count: 1,
    createdByName: 'Thandi Mokoena',
    submittedByName: 'Thandi Mokoena',
    submittedAt: '2026-08-11T16:10:00.000Z',
    distributedByName: 'A. Mattheus',
    distributedAt: '2026-08-11T16:25:00.000Z',
  },
  sections,
  photoFields,
  defects,
  signatures,
  audit,
  auditOmittedCount: 3,
}

/**
 * The empty-draft preview case: a form created seconds ago, with zero
 * responses, zero photos and zero signatures. A real user hits this on their
 * very first click of "Preview", so it must render rather than throw.
 */
export const emptySiteFormReportFixture: SiteFormReportData = {
  formId: '44444444-4444-4444-8444-444444444444',
  projectId: '22222222-2222-4222-8222-222222222222',
  organisationId: '33333333-3333-4333-8333-333333333333',
  branding: {
    accent: '#E69500',
    issuer: { wordmark: 'Watson Mattheus Consulting' },
    parties: [],
    title: 'Termination and Making Safe',
    kicker: 'TERMINATION & MAKING-SAFE RECORD',
    projectLine: 'Kingswalk Mall — — unnumbered draft — · DB-9',
    footerStamp: 'Generated 2026-08-12 · e-site.live',
  },
  summary: {
    formNo: '— unnumbered draft —',
    status: 'draft',
    projectName: 'Kingswalk Mall',
    projectCode: null,
    templateName: 'Termination and Making Safe',
    templateVersion: null,
    boardLabel: 'DB-9',
    boardRef: null,
    asLeftStatus: null,
    asLeftStatusText: 'Not recorded',
    dateOfWork: null,
    electricianName: null,
    registeredPersonName: null,
    circuitsLeftTemporary: 0,
    circuitCount: 0,
    defectCount: 0,
    c1Count: 0,
    createdByName: null,
    submittedByName: null,
    submittedAt: null,
    distributedByName: null,
    distributedAt: null,
  },
  sections: [],
  photoFields: [],
  defects: [],
  signatures: [],
  audit: [],
  auditOmittedCount: 0,
}
