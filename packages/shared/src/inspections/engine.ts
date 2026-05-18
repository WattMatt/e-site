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
      if (value.value_text && value.value_text.length > 0) return { passState: 'pass' };
      return { passState: 'not_checked' };

    case 'multi_select':
      if (value.value_array && value.value_array.length > 0) return { passState: 'pass' };
      return { passState: 'not_checked' };

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

export function isFieldVisible(field: Field, allResponses: Response[]): boolean {
  if (!field.conditional_on) return true;
  const trigger = allResponses.find(r => r.field_id === field.conditional_on!.field_id);
  if (!trigger) return false;
  const target = field.conditional_on.equals;
  if (typeof target === 'boolean') return trigger.value_bool === target;
  if (typeof target === 'number') return trigger.value_number === target;
  return trigger.value_text === target;
}

export function evaluateInspection(template: Template, responses: Response[]): EvaluationResult {
  const failedFields: { sectionId: string; fieldId: string; reason: string }[] = [];
  const missingRequired: { sectionId: string; fieldId: string }[] = [];
  let visibleFieldCount = 0;
  let answeredFieldCount = 0;

  for (const section of template.sections) {
    for (const field of section.fields) {
      if (field.type === 'header' || field.type === 'computed') continue;
      if (!isFieldVisible(field, responses)) continue;

      visibleFieldCount++;
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
