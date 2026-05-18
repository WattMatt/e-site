import type { Field, Response, Template, EvaluationResult } from './types';

type PassState = 'pass' | 'fail' | 'na' | 'not_checked';

export function evaluateField(field: Field, value: Response): { passState: PassState; reason?: string } {
  switch (field.type) {
    case 'pass_fail':
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
      if (field.pass_when) return evaluateTextThreshold(field.pass_when, value.value_text);
      return { passState: 'pass' };

    case 'multi_select':
      if (!value.value_array || value.value_array.length === 0) return { passState: 'not_checked' };
      if (field.pass_when) return evaluateMultiSelectThreshold(field.pass_when, value.value_array);
      return { passState: 'pass' };

    case 'photo':
    case 'signature':
    case 'file':
    case 'header':
    case 'computed':
      return { passState: 'na' };
  }
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

export function isFieldVisible(field: Field, allResponses: Response[]): boolean {
  if (!field.conditional_on) return true;
  const cond = field.conditional_on;
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

export interface InspectionAttachments {
  photos?: { section_id: string; field_id: string }[];
  signatures?: { section_id?: string; field_id?: string }[];
}

export function evaluateInspection(
  template: Template,
  responses: Response[],
  attachments?: InspectionAttachments,
): EvaluationResult {
  const failedFields: { sectionId: string; fieldId: string; reason: string }[] = [];
  const missingRequired: { sectionId: string; fieldId: string }[] = [];
  let visibleFieldCount = 0;
  let answeredFieldCount = 0;

  for (const section of template.sections) {
    for (const field of section.fields) {
      if (field.type === 'header' || field.type === 'computed') continue;
      if (!isFieldVisible(field, responses)) continue;

      visibleFieldCount++;

      // Attachment-backed field types (photo/signature/file) — count uploads instead of response values
      if (field.type === 'photo' || field.type === 'file' || field.type === 'signature') {
        if (attachments === undefined) {
          // Backwards-compat: no attachments info → engine assumes legacy pass (no validation)
          if (!field.required) continue;
          // Count as answered for visibility metrics — legacy callers don't surface min_count
          answeredFieldCount++;
          continue;
        }

        const collection =
          field.type === 'signature'
            ? (attachments.signatures ?? []).filter(s => s.field_id === field.field_id && s.section_id === section.section_id)
            : (attachments.photos ?? []).filter(p => p.field_id === field.field_id && p.section_id === section.section_id);
        const count = collection.length;
        const minRequired = field.required ? Math.max(field.min_count ?? 1, 1) : (field.min_count ?? 0);

        if (count > 0) answeredFieldCount++;

        if (field.required && count < minRequired) {
          missingRequired.push({ sectionId: section.section_id, fieldId: field.field_id });
          if (minRequired > 1) {
            const noun = field.type === 'signature' ? 'signatures' : field.type === 'file' ? 'files' : 'photos';
            failedFields.push({
              sectionId: section.section_id,
              fieldId: field.field_id,
              reason: `only ${count} of ${minRequired} required ${noun} uploaded`,
            });
          }
        }
        continue;
      }

      const response = responses.find(r => r.section_id === section.section_id && r.field_id === field.field_id);
      const hasAnswer = !!response && (
        (response.value_bool !== undefined && response.value_bool !== null) ||
        (response.value_number !== undefined && response.value_number !== null) ||
        (!!response.value_text && response.value_text.length > 0) ||
        (!!response.value_array && response.value_array.length > 0)
      );

      if (hasAnswer) answeredFieldCount++;

      if (field.required && !hasAnswer) {
        missingRequired.push({ sectionId: section.section_id, fieldId: field.field_id });
        continue;
      }

      if (response) {
        const ev = evaluateField(field, response);
        if (ev.passState === 'fail') {
          failedFields.push({ sectionId: section.section_id, fieldId: field.field_id, reason: ev.reason ?? 'failed' });
        }
      }
    }
  }

  let overallResult: EvaluationResult['overallResult'];
  if (missingRequired.length > 0) {
    overallResult = 'fail';
  } else {
    const requiredFailed = failedFields.some(ff =>
      template.sections.some(s =>
        s.section_id === ff.sectionId &&
        s.fields.some(f => f.field_id === ff.fieldId && f.required)
      )
    );
    if (requiredFailed) overallResult = 'fail';
    else if (failedFields.length > 0) overallResult = 'conditional_pass';
    else overallResult = 'pass';
  }

  return { overallResult, failedFields, missingRequired, visibleFieldCount, answeredFieldCount };
}

// v1: computed fields carry a plain-English formula. We don't evaluate them yet;
// the renderer shows the formula text as a tooltip. v2 adds a real evaluator.
export function computeDerivedField(_field: Field, _allResponses: Response[]): unknown {
  return null;
}
