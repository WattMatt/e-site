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
  | 'computed';

export type NodeType = 'board' | 'source' | 'any';
export type DeliverableType = 'coc' | 'inspection_only' | 'factory_test';

export type ConditionalOn =
  | { field_id: string; equals: string | number | boolean }
  | { field_id: string; not_equals: string | number | boolean }
  | { field_id: string; greater_than: number }
  | { field_id: string; less_than: number }
  | { field_id: string; in: (string | number)[] };

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
