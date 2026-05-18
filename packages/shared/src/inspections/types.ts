export type FieldType =
  | 'pass_fail'
  | 'number'
  | 'text'
  | 'textarea'
  | 'dropdown'
  | 'multi_select'
  | 'date'
  | 'photo'
  | 'signature'
  | 'file'
  | 'header'
  | 'computed'
  | 'repeating_group';

export type NodeType = 'board' | 'source' | 'any';
export type DeliverableType = 'coc' | 'inspection_only' | 'factory_test';

export type ConditionalOn =
  | { field_id: string; equals: string | number | boolean }
  | { field_id: string; not_equals: string | number | boolean }
  | { field_id: string; greater_than: number }
  | { field_id: string; less_than: number }
  | { field_id: string; in: (string | number)[] };

export type SignatoryQualification =
  | 'registered_person'
  | 'master_installation_electrician'
  | 'pr_eng'
  | 'witness'
  | 'client';

export interface Field {
  field_id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  unit?: string;
  pass_when?: string;
  options?: string[];
  min_count?: number;
  max_count?: number;
  conditional_on?: ConditionalOn;
  help_text?: string;
  default_value?: string | number | boolean;
  formula?: string;
  sans_ref?: string;
  // Signature fields only: at least one captured signature must claim one of
  // these qualifications (matched heuristically against signatory_title text
  // or registration_number presence) before certify is permitted.
  required_qualifications?: SignatoryQualification[];
  // repeating_group only: the sub-fields that repeat per entry. Storage layer
  // writes entries as sibling responses with synthetic field_id
  // `<group_field_id>[<index>].<inner_field_id>` (e.g. `snags[0].description`).
  // Single level only in v1 — nested repeating_groups rejected by Zod.
  fields?: Field[];
  // repeating_group only: optional template used for the nav/header label of
  // each entry. Supports `{{index}}` and `{{<sub_field_id>}}` placeholders.
  item_label_template?: string;
}

export interface SubSection {
  subsection_id: string;
  title: string;
  fields: Field[];
  conditional_on?: ConditionalOn;
}

export interface Section {
  section_id: string;
  title: string;
  fields: Field[];
  subsections?: SubSection[];
  conditional_on?: ConditionalOn;
}

export interface TemplateBranding {
  // 6-char hex (e.g. "#0a5f4e"). Used as the cover-page top-band background.
  accent_color?: string;
  cover_page?: {
    // Overrides the deliverable-type-driven header label
    title?: string;
    subtitle?: string;
    // Replaces "WM" in the footer
    company_name?: string;
    // Logo URL — v1 ships without renderer support (placeholder for v2)
    logo_url?: string;
  };
}

export interface Template {
  template_id: string;
  name: string;
  version: string;
  applies_to_node_types: NodeType[];
  node_subtypes?: string[];
  sans_reference?: string;
  deliverable_type: DeliverableType;
  requires_separate_verifier?: boolean;
  sections: Section[];
  branding?: TemplateBranding;
}

export interface Response {
  section_id: string;
  field_id: string;
  value_bool?: boolean | null;
  value_number?: number | null;
  value_text?: string | null;
  value_array?: string[] | null;
  value_json?: unknown;
  pass_state?: 'pass' | 'fail' | 'na' | 'not_checked';
  fail_reason?: string | null;
}

export interface EvaluationResult {
  overallResult: 'pass' | 'fail' | 'conditional_pass';
  failedFields: { sectionId: string; fieldId: string; reason: string }[];
  missingRequired: { sectionId: string; fieldId: string }[];
  visibleFieldCount: number;
  answeredFieldCount: number;
}
