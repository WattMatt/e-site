import type { Field, Response } from './types';

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
