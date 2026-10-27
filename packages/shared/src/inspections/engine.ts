import type { ConditionalOn, Field, Response, Section, SubSection, Template, EvaluationResult, SectionProgress } from './types';
import { RATING_OPTIONS } from './types';

type PassState = 'pass' | 'fail' | 'na' | 'not_checked';

export function evaluateField(field: Field, value: Response): { passState: PassState; reason?: string } {
  switch (field.type) {
    case 'pass_fail':
      if (value.pass_state === 'na') return { passState: 'na' };
      if (value.value_bool === true) return { passState: 'pass' };
      if (value.value_bool === false) return { passState: 'fail', reason: value.fail_reason ?? undefined };
      return { passState: 'not_checked' };

    case 'number':
      if (value.value_number === null || value.value_number === undefined) return { passState: 'not_checked' };
      if (!field.pass_when) return { passState: 'pass' };
      return evaluateNumberThreshold(field.pass_when, value.value_number);

    case 'text':
    case 'textarea':
    case 'dropdown':
    case 'date':
      if (!value.value_text || value.value_text.length === 0) return { passState: 'not_checked' };
      if (verdictFailure(field, value)) return { passState: 'fail', reason: verdictFailure(field, value) ?? undefined };
      if (field.pass_when) return evaluateTextThreshold(field.pass_when, value.value_text);
      return { passState: 'pass' };

    case 'multi_select':
      if (!value.value_array || value.value_array.length === 0) return { passState: 'not_checked' };
      if (verdictFailure(field, value)) return { passState: 'fail', reason: verdictFailure(field, value) ?? undefined };
      if (field.pass_when) return evaluateMultiSelectThreshold(field.pass_when, value.value_array);
      return { passState: 'pass' };

    case 'rating':
      if (!value.value_text) return { passState: 'not_checked' };
      return value.value_text.toLowerCase() === 'poor'
        ? { passState: 'fail', reason: 'rated Poor' }
        : { passState: 'pass' };

    case 'photo':
    case 'signature':
    case 'file':
    case 'header':
    case 'computed':
    case 'repeating_group':
      // repeating_group has no per-row pass/fail of its own — the group is
      // evaluated by iterating entries in evaluateInspection.
      return { passState: 'na' };
  }
}

// Synthetic field_id pattern for repeating_group entries:
//   `<group_field_id>[<index>].<inner_field_id>`
// E.g. `snags[0].description`, `snags[1].risk_level`.
const RG_ENTRY_PATTERN = /^([a-z0-9_]+)\[(\d+)\]\.([a-z0-9_]+)$/;

export function parseRepeatingGroupKey(fieldId: string): { group: string; index: number; sub: string } | null {
  const m = fieldId.match(RG_ENTRY_PATTERN);
  if (!m) return null;
  return { group: m[1], index: parseInt(m[2], 10), sub: m[3] };
}

// Return the synthetic field_id for a single sub-field response within
// a repeating_group entry at the given index.
export function buildRepeatingGroupKey(groupFieldId: string, index: number, subFieldId: string): string {
  return `${groupFieldId}[${index}].${subFieldId}`;
}

// Given the group field plus all responses, return the de-duplicated set
// of entry indices that have at least one sub-field response. Used by the
// renderer to know how many entry blocks to draw, and by evaluateInspection
// to count visible sub-fields. Indices returned in ascending order.
export function listRepeatingGroupEntryIndices(
  groupFieldId: string,
  allResponses: Response[],
): number[] {
  const set = new Set<number>();
  for (const r of allResponses) {
    const parsed = parseRepeatingGroupKey(r.field_id);
    if (parsed && parsed.group === groupFieldId) set.add(parsed.index);
  }
  return [...set].sort((a, b) => a - b);
}

function evaluateNumberThreshold(pw: string, val: number): { passState: PassState; reason?: string } {
  const s = pw.trim();

  const between = s.match(/^between\s+([-+0-9.]+)\s+and\s+([-+0-9.]+)$/i);
  if (between) {
    const a = parseFloat(between[1]); const b = parseFloat(between[2]);
    return val >= Math.min(a, b) && val <= Math.max(a, b)
      ? { passState: 'pass' }
      : { passState: 'fail', reason: `value ${val} not in [${a}, ${b}]` };
  }

  const cmp = s.match(/^(>=|<=|>|<|!=|=)\s*([-+0-9.]+)$/);
  if (cmp) {
    const op = cmp[1]; const target = parseFloat(cmp[2]);
    const ok =
      (op === '>=' && val >= target) ||
      (op === '<=' && val <= target) ||
      (op === '>'  && val >  target) ||
      (op === '<'  && val <  target) ||
      (op === '='  && val === target) ||
      (op === '!=' && val !== target);
    return ok ? { passState: 'pass' } : { passState: 'fail', reason: `value ${val} fails ${op} ${target}` };
  }

  return { passState: 'pass' };
}

// Parse 'in [a, b, c]' or 'in ["a","b","c"]' into the list of allowed values.
// Returns null if the pass_when isn't an `in [...]` expression.
function parseInList(pw: string): string[] | null {
  const m = pw.trim().match(/^in\s*\[(.*)\]$/i);
  if (!m) return null;
  return m[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(s => s.length > 0);
}

// Parse 'matches /regex/' or 'matches /regex/i' into a RegExp.
// Returns null if the pass_when isn't a `matches /.../` expression OR the regex doesn't compile.
function parseMatchesRegex(pw: string): RegExp | null {
  const m = pw.trim().match(/^matches\s+\/(.+)\/([gimsuy]*)$/i);
  if (!m) return null;
  try { return new RegExp(m[1], m[2]); } catch { return null; }
}

function evaluateTextThreshold(pw: string, val: string): { passState: PassState; reason?: string } {
  const list = parseInList(pw);
  if (list) {
    const ok = list.some(item => item.toLowerCase() === val.toLowerCase());
    return ok ? { passState: 'pass' } : { passState: 'fail', reason: `value "${val}" not in [${list.join(', ')}]` };
  }
  const re = parseMatchesRegex(pw);
  if (re) {
    return re.test(val)
      ? { passState: 'pass' }
      : { passState: 'fail', reason: `value "${val}" does not match ${re.toString()}` };
  }
  // Unparseable pass_when on a filled text field → advisory pass (consistent with numeric path)
  return { passState: 'pass' };
}

function evaluateMultiSelectThreshold(pw: string, vals: string[]): { passState: PassState; reason?: string } {
  const list = parseInList(pw);
  if (list) {
    const allowed = new Set(list.map(s => s.toLowerCase()));
    const offending = vals.filter(v => !allowed.has(v.toLowerCase()));
    return offending.length === 0
      ? { passState: 'pass' }
      : { passState: 'fail', reason: `values [${offending.join(', ')}] not in [${list.join(', ')}]` };
  }
  return { passState: 'pass' };
}

// Shared condition matcher — used for fields, subsections, and sections.
// Returns true iff the conditional_on rule is satisfied by some response.
function checkCondition(cond: ConditionalOn, allResponses: Response[]): boolean {
  const trigger = allResponses.find(r => r.field_id === cond.field_id);
  if (!trigger) return false;

  if ('equals' in cond) {
    const target = cond.equals;
    if (typeof target === 'boolean') return trigger.value_bool === target;
    if (typeof target === 'number') return trigger.value_number === target;
    return trigger.value_text === target;
  }
  if ('not_equals' in cond) {
    const target = cond.not_equals;
    if (typeof target === 'boolean') return trigger.value_bool !== target;
    if (typeof target === 'number') return trigger.value_number !== target;
    return trigger.value_text !== target;
  }
  if ('greater_than' in cond) {
    return typeof trigger.value_number === 'number' && trigger.value_number > cond.greater_than;
  }
  if ('less_than' in cond) {
    return typeof trigger.value_number === 'number' && trigger.value_number < cond.less_than;
  }
  if ('in' in cond) {
    return cond.in.some(item =>
      (typeof item === 'number' && trigger.value_number === item) ||
      (typeof item === 'string' && trigger.value_text === item)
    );
  }
  return false;
}

// Visibility precedence (most-distal → most-local):
//   section.conditional_on  →  subsection.conditional_on  →  field.conditional_on
// A field is visible iff EVERY ancestor in the chain that has conditional_on
// passes its check, AND the field's own conditional_on (if any) passes.
// `parent` is optional so existing callers (passing just field + responses)
// continue to work — only section/subsection-level conditions are skipped in
// that case (which is fine: the renderer is responsible for passing the parent).
export function isFieldVisible(
  field: Field,
  allResponses: Response[],
  parent?: { section?: Section; subsection?: SubSection },
): boolean {
  if (parent?.section?.conditional_on && !checkCondition(parent.section.conditional_on, allResponses)) return false;
  if (parent?.subsection?.conditional_on && !checkCondition(parent.subsection.conditional_on, allResponses)) return false;
  if (!field.conditional_on) return true;
  return checkCondition(field.conditional_on, allResponses);
}

// Iterate every field across both direct section.fields and section.subsections[].fields.
// Yields the field along with its section + optional subsection so callers can
// reason about visibility precedence and locate the field for error reporting.
function* iterateAllFields(template: Template): Generator<{
  section: Section;
  subsection?: SubSection;
  field: Field;
}> {
  for (const section of template.sections) {
    for (const field of section.fields ?? []) yield { section, field };
    for (const subsection of section.subsections ?? []) {
      for (const field of subsection.fields) yield { section, subsection, field };
    }
  }
}

export interface InspectionAttachments {
  photos?: { section_id: string; field_id: string }[];
  signatures?: { section_id?: string; field_id?: string }[];
}

/**
 * The verdict rule. An answer fails the INSPECTION only when it is
 *   • a rating of 'poor', or
 *   • one of its dropdown / multi_select field's `fail_values` (e.g. snag risk 'high').
 * Returns the reason, or null. Everything else evaluateField can call 'fail' (a pass_fail
 * ticked Fail, a reading outside pass_when) is a recorded observation, not a failure.
 */
export function verdictFailure(field: Field, value: Response): string | null {
  if (field.type === 'photo') {
    if (!field.assess || assessedResult(value) !== 'fail') return null;
    const comment = value.value_text?.trim();
    return comment ? `marked Fail: ${comment}` : 'marked Fail';
  }
  if (field.type === 'rating') {
    const v = value.value_text?.toLowerCase();
    return v === 'poor' ? 'rated Poor' : null;
  }
  const fails = (field.fail_values ?? []).map((f) => f.toLowerCase());
  if (fails.length === 0) return null;
  if (field.type === 'dropdown') {
    const v = value.value_text?.toLowerCase();
    return v && fails.includes(v) ? `${value.value_text} recorded` : null;
  }
  if (field.type === 'multi_select') {
    const hit = (value.value_array ?? []).filter((x) => fails.includes(x.toLowerCase()));
    return hit.length > 0 ? `${hit.join(', ')} recorded` : null;
  }
  return null;
}

/** An assessed photo item's result, or null when none is marked yet. */
export function assessedResult(r: Response | undefined): 'pass' | 'fail' | 'na' | null {
  if (!r) return null;
  if (r.pass_state === 'na') return 'na';
  if (r.pass_state === 'fail' || r.value_bool === false) return 'fail';
  if (r.pass_state === 'pass' || r.value_bool === true) return 'pass';
  return null;
}

/** An answer exists. An explicit N/A is a deliberate answer, at top level and in groups alike. */
function isAnswered(r: Response | undefined): boolean {
  return !!r && (
    (r.value_bool !== undefined && r.value_bool !== null) ||
    (r.value_number !== undefined && r.value_number !== null) ||
    (!!r.value_text && r.value_text.length > 0) ||
    (!!r.value_array && r.value_array.length > 0) ||
    r.pass_state === 'na'
  );
}

/**
 * The responses a repeating-group entry's sub-field conditions are judged against: the entry's
 * own answers re-keyed to their bare sub-field ids (so `conditional_on: { field_id: 'kind' }`
 * finds the SIBLING in the same entry), ahead of every other response.
 */
function entryScopedResponses(groupFieldId: string, index: number, responses: Response[]): Response[] {
  const own: Response[] = [];
  for (const r of responses) {
    const k = parseRepeatingGroupKey(r.field_id);
    if (k && k.group === groupFieldId && k.index === index) own.push({ ...r, field_id: k.sub });
  }
  return [...own, ...responses];
}

/** A required photo field's missing-photo reason, stored as value_text on that field's response. */
export function photoMissingReason(r: Response | undefined): string | null {
  const t = r?.value_text?.trim();
  return t ? t : null;
}

export function evaluateInspection(
  template: Template,
  responses: Response[],
  attachments?: InspectionAttachments,
): EvaluationResult {
  const failedFields: EvaluationResult['failedFields'] = [];
  const flaggedFields: EvaluationResult['flaggedFields'] = [];
  const missingRequired: EvaluationResult['missingRequired'] = [];
  const missingPhotos: EvaluationResult['missingPhotos'] = [];
  let visibleFieldCount = 0;
  let answeredFieldCount = 0;
  // Per-section progress, counted by the same rules as the totals above, so a section made
  // only of photo fields reads 4/4 once its photos are in.
  const sectionStats: Record<string, SectionProgress> = {};
  const tally = (sectionId: string): SectionProgress =>
    (sectionStats[sectionId] ??= { answered: 0, total: 0, missing: 0 });
  for (const s of template.sections) tally(s.section_id);
  const answered = (sectionId: string) => {
    answeredFieldCount++;
    tally(sectionId).answered++;
  };

  const photoGaps = new Set<{ sectionId: string; fieldId: string }>();

  const findResponse = (sectionId: string, fieldId: string) =>
    responses.find((r) => r.section_id === sectionId && r.field_id === fieldId);

  // Judge one answered (or unanswered) value field. Verdict failures and observations are
  // separate lists; a field is one or the other, never both.
  const judge = (sectionId: string, fieldId: string, field: Field, r: Response | undefined) => {
    if (!r) return;
    const fail = verdictFailure(field, r);
    if (fail) {
      failedFields.push({ sectionId, fieldId, reason: fail });
      return;
    }
    const ev = evaluateField(field, r);
    if (ev.passState === 'fail') flaggedFields.push({ sectionId, fieldId, reason: ev.reason ?? 'failed' });
  };

  // photo / signature / file fields count uploads, not response values.
  const judgeAttachment = (sectionId: string, fieldId: string, field: Field) => {
    if (attachments === undefined) {
      // Backwards-compat: no attachments info → treat as answered, no validation.
      if (field.required) answered(sectionId);
      return;
    }
    const collection =
      field.type === 'signature'
        ? (attachments.signatures ?? []).filter((x) => x.field_id === fieldId && x.section_id === sectionId)
        : (attachments.photos ?? []).filter((x) => x.field_id === fieldId && x.section_id === sectionId);
    const count = collection.length;
    const assessed = field.type === 'photo' && !!field.assess;
    if (assessed) {
      // The item's result is its answer; a Fail fails the inspection; on a required item the
      // result (not the photo) is required.
      const r = findResponse(sectionId, fieldId);
      const result = assessedResult(r);
      if (result) answered(sectionId);
      else if (field.required) missingRequired.push({ sectionId, fieldId, kind: 'result' });
      const fail = r ? verdictFailure(field, r) : null;
      if (fail) failedFields.push({ sectionId, fieldId, reason: fail });
    } else if (count > 0) answered(sectionId);
    if (!field.required) return;
    const minRequired = Math.max(field.min_count ?? 1, 1);
    if (count >= minRequired) return;
    const photoGap = { sectionId, fieldId };
    missingRequired.push(photoGap);
    if (field.type === 'photo') {
      // Never blocks or fails an inspection: listed with the inspector's reason, if any.
      photoGaps.add(photoGap);
      missingPhotos.push({ sectionId, fieldId, reason: photoMissingReason(findResponse(sectionId, fieldId)) });
    }
    if (count > 0) {
      const noun = field.type === 'signature' ? 'signatures' : field.type === 'file' ? 'files' : 'photos';
      flaggedFields.push({ sectionId, fieldId, reason: `only ${count} of ${minRequired} required ${noun} uploaded` });
    }
  };

  for (const { section, subsection, field } of iterateAllFields(template)) {
    if (field.type === 'header' || field.type === 'computed') continue;
    if (!isFieldVisible(field, responses, { section, subsection })) continue;

    // repeating_group: iterate entries, evaluate each sub-field with the synthetic field_id
    // `<group>[<i>].<sub>`. Counts entries against min_count/max_count.
    if (field.type === 'repeating_group') {
      const subFields = field.fields ?? [];
      const indices = listRepeatingGroupEntryIndices(field.field_id, responses);
      const entryCount = indices.length;

      if (field.required || (field.min_count ?? 0) > 0) {
        const minEntries = Math.max(field.min_count ?? (field.required ? 1 : 0), field.required ? 1 : 0);
        if (entryCount < minEntries) missingRequired.push({ sectionId: section.section_id, fieldId: field.field_id });
      }
      if (field.max_count != null && entryCount > field.max_count) {
        flaggedFields.push({
          sectionId: section.section_id,
          fieldId: field.field_id,
          reason: `${entryCount} entries exceeds max_count ${field.max_count}`,
        });
      }

      for (const i of indices) {
        const scoped = entryScopedResponses(field.field_id, i, responses);
        for (const sub of subFields) {
          if (sub.type === 'header' || sub.type === 'computed') continue;
          if (!isFieldVisible(sub, scoped)) continue;
          visibleFieldCount++;
          tally(section.section_id).total++;
          const syntheticId = buildRepeatingGroupKey(field.field_id, i, sub.field_id);
          if (sub.type === 'photo' || sub.type === 'signature' || sub.type === 'file') {
            judgeAttachment(section.section_id, syntheticId, sub);
            continue;
          }
          const r = findResponse(section.section_id, syntheticId);
          if (isAnswered(r)) answered(section.section_id);
          else if (sub.required) missingRequired.push({ sectionId: section.section_id, fieldId: syntheticId });
          judge(section.section_id, syntheticId, sub, r);
        }
      }
      continue;
    }

    visibleFieldCount++;
    tally(section.section_id).total++;

    if (field.type === 'photo' || field.type === 'file' || field.type === 'signature') {
      judgeAttachment(section.section_id, field.field_id, field);
      continue;
    }

    const response = findResponse(section.section_id, field.field_id);
    if (isAnswered(response)) answered(section.section_id);
    else if (field.required) missingRequired.push({ sectionId: section.section_id, fieldId: field.field_id });
    judge(section.section_id, field.field_id, field, response);
  }

  // The photo gaps themselves (by identity: an assessed item can also miss its result, which DOES block).
  const blockingMissing = missingRequired.filter((m) => !photoGaps.has(m));
  // A section's "missing" is what blocks submit; a missing photo never does.
  for (const m of blockingMissing) tally(m.sectionId).missing++;

  return {
    overallResult: failedFields.length > 0 ? 'fail' : 'pass',
    failedFields,
    flaggedFields,
    missingRequired,
    blockingMissing,
    missingPhotos,
    visibleFieldCount,
    answeredFieldCount,
    sectionStats,
  };
}

// Declarative computed-field formulas. v1 covers the patterns the inspections-catalogue
// templates actually use; unknown kinds return null so the renderer shows a fallback.
//
// Legacy plain-English formulas (the `formula` string field) are returned as-is so the
// renderer can display them verbatim. Wire a real string-evaluator in v2 if templates
// need it; for now templates use the structured `formula_kind`/`formula_args` shape.
export type ComputedFormulaKind =
  | 'count_visible_answered'
  | 'count_visible'
  | 'count_failed';

interface ComputedFormulaField extends Field {
  formula_kind?: ComputedFormulaKind;
}

const KNOWN_COMPUTED_KINDS: readonly ComputedFormulaKind[] = ['count_visible_answered', 'count_visible', 'count_failed'];

export function computeDerivedField(field: Field, allResponses: Response[], template?: Template): unknown {
  const cf = field as ComputedFormulaField;

  if (cf.formula_kind && template) {
    if (!KNOWN_COMPUTED_KINDS.includes(cf.formula_kind)) return null;
    return evaluateComputedKind(cf.formula_kind, allResponses, template);
  }

  // Legacy plain-English formula passthrough — renderer displays the string.
  if (typeof field.formula === 'string' && field.formula.length > 0) {
    return field.formula;
  }

  return null;
}

function evaluateComputedKind(kind: ComputedFormulaKind, responses: Response[], template: Template): number {
  let visible = 0, answered = 0, failed = 0;

  for (const { section, subsection, field: f } of iterateAllFields(template)) {
    if (f.type === 'header' || f.type === 'computed') continue;
    if (!isFieldVisible(f, responses, { section, subsection })) continue;
    visible++;

    const r = responses.find(x => x.section_id === section.section_id && x.field_id === f.field_id);
    const hasAnswer = !!r && (
      (r.value_bool !== undefined && r.value_bool !== null) ||
      (r.value_number !== undefined && r.value_number !== null) ||
      (!!r.value_text && r.value_text.length > 0) ||
      (!!r.value_array && r.value_array.length > 0)
    );
    if (hasAnswer) answered++;

    if (r && hasAnswer) {
      const ev = evaluateField(f, r);
      if (ev.passState === 'fail') failed++;
    }
  }

  switch (kind) {
    case 'count_visible_answered': return answered;
    case 'count_visible': return visible;
    case 'count_failed': return failed;
  }
}
