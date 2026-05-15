/**
 * Folder-template definitions for the Handover Documents module.
 *
 * Source-of-truth for what "Initialize folder structure" produces in each
 * of the 13 SANS-aligned categories. Pure data — no DB, no I/O — so this
 * file can be used from both server actions (init-from-template) and
 * client UI (preview the tree before commit).
 *
 * Adapted from the WM_Office_Web port prompt's FolderTemplates.ts. Re-
 * usable across web + (future) mobile because it's just nested labels.
 *
 * Each top-level entry under a category becomes a folder directly under
 * the category root. Children become subfolders, and so on recursively.
 * Leaf folders are the ones the user uploads INTO; non-leaf folders are
 * organisational.
 */

export type HandoverCategory =
  | 'generators'
  | 'transformers'
  | 'main_boards'
  | 'switchgear'
  | 'earthing_bonding'
  | 'surge_protection'
  | 'cable_installation'
  | 'emergency_systems'
  | 'lighting'
  | 'metering'
  | 'test_certificates'
  | 'commissioning_docs'
  | 'compliance_certs'

export interface FolderTemplateNode {
  name: string
  children?: FolderTemplateNode[]
}

/**
 * Human label for each category — drives the tab text + the "Initialize
 * {category}" wording. Order here is the tab order in the UI.
 */
export const CATEGORY_LABELS: Record<HandoverCategory, string> = {
  generators:          'Generators',
  transformers:        'Transformers',
  main_boards:         'Main Boards',
  switchgear:          'Switchgear',
  earthing_bonding:    'Earthing & Bonding',
  surge_protection:    'Surge Protection',
  cable_installation:  'Cable Installation',
  emergency_systems:   'Emergency Systems',
  lighting:            'Lighting',
  metering:            'Metering',
  test_certificates:   'Test Certificates',
  commissioning_docs:  'Commissioning',
  compliance_certs:    'Compliance Certificates',
}

export const ALL_CATEGORIES: HandoverCategory[] = [
  'generators', 'transformers', 'main_boards', 'switchgear',
  'earthing_bonding', 'surge_protection', 'cable_installation',
  'emergency_systems', 'lighting', 'metering',
  'test_certificates', 'commissioning_docs', 'compliance_certs',
]

/**
 * Equipment-style template — used by generators / transformers / main
 * boards / switchgear / lighting / metering / emergency_systems / surge_
 * protection. Same shape, lightly differentiated by sub-tree labels.
 */
function equipmentTemplate(extras: FolderTemplateNode[] = []): FolderTemplateNode[] {
  return [
    {
      name: 'Drawings',
      children: [
        { name: 'Layout Drawings' },
        { name: 'Schematic Diagrams' },
        { name: 'Wiring Diagrams' },
        { name: 'As-Built Drawings' },
      ],
    },
    {
      name: 'Test Certificates',
      children: [
        { name: 'Factory Acceptance Tests' },
        { name: 'Site Acceptance Tests' },
        { name: 'Type Test Certificates' },
        { name: 'Routine Test Certificates' },
      ],
    },
    {
      name: 'Commissioning',
      children: [
        { name: 'Procedures' },
        { name: 'Reports' },
        { name: 'Witness Signatures' },
      ],
    },
    { name: 'O&M Manuals' },
    { name: 'Spares Lists' },
    { name: 'Warranty Documents' },
    ...extras,
  ]
}

export const FOLDER_TEMPLATES: Record<HandoverCategory, FolderTemplateNode[]> = {
  generators: equipmentTemplate([
    { name: 'Fuel System Documentation' },
    { name: 'Control Panel Documentation' },
  ]),

  transformers: equipmentTemplate([
    { name: 'Oil Analysis Reports' },
    { name: 'Protection Settings' },
    { name: 'Thermal Imaging Reports' },
  ]),

  main_boards: equipmentTemplate([
    { name: 'Single-Line Diagrams' },
    { name: 'Protection Coordination Studies' },
  ]),

  switchgear: equipmentTemplate([
    { name: 'Operation & Maintenance Procedures' },
    { name: 'SF6 / Vacuum Test Records' },
  ]),

  earthing_bonding: [
    { name: 'Earth Mat Drawings' },
    { name: 'Earth Resistance Test Reports' },
    { name: 'Bonding Schedule' },
    { name: 'Step & Touch Potential Calculations' },
    { name: 'Certificates of Compliance' },
  ],

  surge_protection: equipmentTemplate([
    { name: 'SPD Coordination Study' },
    { name: 'Replacement Records' },
  ]),

  cable_installation: [
    {
      name: 'Cable Schedule',
      children: [
        { name: 'As-Built Cable Schedule' },
        { name: 'Cable Routing Drawings' },
      ],
    },
    {
      name: 'Cable Test Records',
      children: [
        { name: 'Insulation Resistance' },
        { name: 'Continuity' },
        { name: 'High Voltage Tests' },
      ],
    },
    { name: 'Cable Tray & Containment Drawings' },
    { name: 'Pulling Tension Calculations' },
    { name: 'Manufacturer Datasheets' },
  ],

  emergency_systems: equipmentTemplate([
    { name: 'UPS Battery Test Records' },
    { name: 'Emergency Lighting Schedule' },
    { name: 'Smoke & Fire Detection Integration' },
  ]),

  lighting: equipmentTemplate([
    { name: 'Lighting Calculations' },
    { name: 'Lux Level Surveys' },
  ]),

  metering: equipmentTemplate([
    { name: 'Meter Calibration Certificates' },
    { name: 'Meter Reading Logs' },
  ]),

  test_certificates: [
    { name: 'Insulation Resistance Tests' },
    { name: 'Continuity Tests' },
    { name: 'Earth Resistance Tests' },
    { name: 'High Voltage Tests' },
    { name: 'Functional Tests' },
    { name: 'Witness Test Records' },
  ],

  commissioning_docs: [
    { name: 'Commissioning Plan' },
    { name: 'Commissioning Procedures' },
    { name: 'Commissioning Reports' },
    { name: 'Punch Lists' },
    { name: 'Handover Acceptance Records' },
  ],

  compliance_certs: [
    {
      name: 'SANS 10142 Part 1',
      children: [
        { name: 'Certificate of Compliance (CoC)' },
        { name: 'Test Reports' },
        { name: 'Inspection Reports' },
      ],
    },
    {
      name: 'SANS 10142 Part 2',
      children: [
        { name: 'Medium Voltage CoC' },
        { name: 'High Voltage Test Reports' },
      ],
    },
    { name: 'Municipal Approvals' },
    { name: 'ECSA Certificates' },
    { name: 'Occupancy Certificates' },
    { name: 'Fire Clearance Certificates' },
  ],
}

/**
 * Flatten a template into [folderPath, depth, parentPath] tuples for
 * straight-line INSERT. The category root itself is created as path
 * '/category/'; this function produces the children under it.
 */
export interface FlattenedFolder {
  /** Display name. */
  name: string
  /** 0-indexed depth — 0 means immediate child of the category root. */
  depth: number
  /** Slash-joined parent path WITHOUT leading slash, e.g. 'Drawings/Layout Drawings' */
  parentPath: string
}

export function flattenTemplate(
  nodes: FolderTemplateNode[],
  parentPath = '',
  depth = 0,
): FlattenedFolder[] {
  const out: FlattenedFolder[] = []
  for (const node of nodes) {
    out.push({ name: node.name, depth, parentPath })
    if (node.children?.length) {
      const childParent = parentPath ? `${parentPath}/${node.name}` : node.name
      out.push(...flattenTemplate(node.children, childParent, depth + 1))
    }
  }
  return out
}
