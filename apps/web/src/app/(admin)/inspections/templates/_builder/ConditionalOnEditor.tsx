'use client';

import { useId } from 'react';
import type { Field } from '@esite/shared';

// All 5 operators the schema accepts on conditional_on.
type Operator = 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'in';

// Derive the value type from Field so this stays in sync with the schema.
type ConditionalOn = NonNullable<Field['conditional_on']>;

const OPERATOR_LABELS: Record<Operator, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  greater_than: 'greater than',
  less_than: 'less than',
  in: 'is one of (comma list)',
};

// Numeric-only operators.
const NUMERIC_OPERATORS: Operator[] = ['greater_than', 'less_than'];

function getOperator(cond: ConditionalOn): Operator {
  if ('equals' in cond) return 'equals';
  if ('not_equals' in cond) return 'not_equals';
  if ('greater_than' in cond) return 'greater_than';
  if ('less_than' in cond) return 'less_than';
  return 'in';
}

function getRawValue(cond: ConditionalOn): string {
  if ('equals' in cond) return String(cond.equals);
  if ('not_equals' in cond) return String(cond.not_equals);
  if ('greater_than' in cond) return String(cond.greater_than);
  if ('less_than' in cond) return String(cond.less_than);
  if ('in' in cond) return cond.in.join(', ');
  return '';
}

function buildConditionalOn(
  fieldId: string,
  operator: Operator,
  rawValue: string,
): ConditionalOn | undefined {
  const trimmed = rawValue.trim();
  if (!fieldId || !trimmed) return undefined;

  if (operator === 'greater_than' || operator === 'less_than') {
    const n = parseFloat(trimmed);
    if (!Number.isFinite(n)) return undefined;
    return operator === 'greater_than'
      ? { field_id: fieldId, greater_than: n }
      : { field_id: fieldId, less_than: n };
  }

  if (operator === 'in') {
    const items = trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return undefined;
    return { field_id: fieldId, in: items };
  }

  // equals / not_equals — keep as string
  return operator === 'equals'
    ? { field_id: fieldId, equals: trimmed }
    : { field_id: fieldId, not_equals: trimmed };
}

interface Props {
  /** Sibling fields in the same section — the source for the field_id dropdown. */
  sectionFields: Field[];
  /** The field being edited — excluded from its own dropdown. */
  currentFieldId: string;
  value: Field['conditional_on'];
  onChange: (next: Field['conditional_on']) => void;
}

export function ConditionalOnEditor({ sectionFields, currentFieldId, value, onChange }: Props) {
  const toggleId = useId();
  const isOn = value !== undefined;

  const candidates = sectionFields.filter((f) => f.field_id !== currentFieldId);

  // Derive controlled values from `value` prop (no local state for operator/fieldId/rawValue —
  // they're always derived from the parent-owned `value` so round-trips stay clean).
  const selectedFieldId = value?.field_id ?? (candidates[0]?.field_id ?? '');
  const operator: Operator = value ? getOperator(value) : 'equals';
  const rawValue: string = value ? getRawValue(value) : '';

  function handleToggle(checked: boolean) {
    if (!checked) {
      onChange(undefined);
      return;
    }
    // Turn on: build a default cond so value is non-undefined immediately.
    if (candidates.length === 0) return; // nothing to reference
    const fid = candidates[0].field_id;
    onChange({ field_id: fid, equals: '' });
  }

  function handleFieldIdChange(fid: string) {
    const next = buildConditionalOn(fid, operator, rawValue);
    onChange(next ?? { field_id: fid, equals: '' });
  }

  function handleOperatorChange(op: Operator) {
    const fid = selectedFieldId;
    if (!fid) return;
    // Reset raw value when switching to/from numeric operators to avoid NaN.
    const newRaw =
      (NUMERIC_OPERATORS.includes(op) && !NUMERIC_OPERATORS.includes(operator)) ||
      (!NUMERIC_OPERATORS.includes(op) && NUMERIC_OPERATORS.includes(operator))
        ? ''
        : rawValue;
    onChange(buildConditionalOn(fid, op, newRaw) ?? { field_id: fid, equals: '' });
  }

  function handleValueChange(raw: string) {
    const fid = selectedFieldId;
    if (!fid) return;
    const next = buildConditionalOn(fid, operator, raw);
    // Keep value in sync even while the user is mid-typing (undefined = invalid → leave current).
    if (next) onChange(next);
    else {
      // Still update so the input stays responsive — store partial as equals: raw string.
      if (operator === 'greater_than' || operator === 'less_than') {
        // Don't stomp with invalid numeric — leave existing value until valid.
        return;
      }
      onChange(
        operator === 'equals'
          ? { field_id: fid, equals: raw }
          : operator === 'not_equals'
          ? { field_id: fid, not_equals: raw }
          : { field_id: fid, in: raw.split(',').map((s) => s.trim()).filter(Boolean) },
      );
    }
  }

  return (
    <div className="space-y-2 pt-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          id={toggleId}
          type="checkbox"
          checked={isOn}
          disabled={candidates.length === 0}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        <span style={{ color: candidates.length === 0 ? 'var(--c-text-dim, #6b7280)' : undefined }}>
          Show this field only when…
        </span>
        {candidates.length === 0 && (
          <span className="text-xs" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
            (add sibling fields first)
          </span>
        )}
      </label>

      {isOn && candidates.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center pl-5">
          {/* Field selector */}
          <select
            value={selectedFieldId}
            onChange={(e) => handleFieldIdChange(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            {candidates.map((f) => (
              <option key={f.field_id} value={f.field_id}>
                {f.label || f.field_id}
              </option>
            ))}
          </select>

          {/* Operator selector */}
          <select
            value={operator}
            onChange={(e) => handleOperatorChange(e.target.value as Operator)}
            className="border rounded px-2 py-1 text-sm"
          >
            {(Object.keys(OPERATOR_LABELS) as Operator[]).map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABELS[op]}
              </option>
            ))}
          </select>

          {/* Value input */}
          <input
            type={NUMERIC_OPERATORS.includes(operator) ? 'number' : 'text'}
            value={rawValue}
            onChange={(e) => handleValueChange(e.target.value)}
            placeholder={
              operator === 'in'
                ? 'pass, fail, n_a'
                : NUMERIC_OPERATORS.includes(operator)
                ? '0'
                : 'value'
            }
            className="border rounded px-2 py-1 text-sm w-40"
          />
        </div>
      )}
    </div>
  );
}
