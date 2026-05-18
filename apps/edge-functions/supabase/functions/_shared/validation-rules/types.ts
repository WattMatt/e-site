// Shared types for the validate-inspection rule-set dispatcher.
// Each deliverable-type's rule file exports a RuleRunner conforming to this interface.

export interface ResponseRow {
  section_id: string
  field_id: string
  value_bool?: boolean | null
  value_number?: number | null
  value_text?: string | null
  value_array?: string[] | null
  // deno-lint-ignore no-explicit-any
  value_json?: any
  pass_state?: 'pass' | 'fail' | 'na' | 'not_checked' | null
  fail_reason?: string | null
}

export interface RuleContext {
  /** keyed by `${section_id}.${field_id}` */
  responses: Map<string, ResponseRow>
  // deno-lint-ignore no-explicit-any
  template: any
  // deno-lint-ignore no-explicit-any
  inspection: any
  // deno-lint-ignore no-explicit-any
  signatures?: any[]
}

export interface RuleResult {
  rule_code: string
  sans_clause: string
  rule_label: string
  result: 'pass' | 'fail' | 'not_applicable' | 'insufficient_data'
  measured_value?: string
  threshold?: string
  failure_reason?: string
}

/** A named set of rules for a deliverable type. */
export type RuleRunner = (ctx: RuleContext) => RuleResult[]
