'use client';

import type { Field } from '@esite/shared';

// The engine supports these formula kinds (Wave 2, CLAUDE.md).
// They are stored flat on field.formula — e.g. "count_visible_answered",
// "count_visible", "count_failed", or a literal expression string.
const FORMULA_KINDS = [
  { value: 'count_visible_answered', label: 'Count answered (visible fields)' },
  { value: 'count_visible', label: 'Count visible fields' },
  { value: 'count_failed', label: 'Count failed fields' },
  { value: 'literal_formula', label: 'Literal formula expression…' },
] as const;

type FormulaKind = (typeof FORMULA_KINDS)[number]['value'];

function detectKind(formula: string | undefined): FormulaKind {
  if (!formula) return 'count_visible_answered';
  if (formula === 'count_visible_answered') return 'count_visible_answered';
  if (formula === 'count_visible') return 'count_visible';
  if (formula === 'count_failed') return 'count_failed';
  return 'literal_formula';
}

interface Props {
  sectionId: string;
  field: Field & { type: 'computed' };
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

export function ComputedFieldEditor({ field, onChange, onRemove }: Props) {
  const kind = detectKind(field.formula);

  function handleKindChange(newKind: FormulaKind) {
    if (newKind === 'literal_formula') {
      // Seed with empty expression so the textarea shows immediately.
      onChange({ formula: '' });
    } else {
      onChange({ formula: newKind });
    }
  }

  return (
    <div className="space-y-3 p-3 border rounded">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">🧮 Computed</span>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-xs text-red-500 hover:text-red-700">
            Remove
          </button>
        )}
      </div>

      <input
        type="text"
        placeholder="Label"
        value={field.label ?? ''}
        onChange={(e) => onChange({ label: e.target.value })}
        className="border rounded px-3 py-2 w-full text-sm"
      />

      <textarea
        placeholder="Help text (optional)"
        value={field.help_text ?? ''}
        onChange={(e) => onChange({ help_text: e.target.value || undefined })}
        className="border rounded px-3 py-2 w-full text-sm resize-none"
        rows={2}
      />

      <input
        type="text"
        placeholder="SANS reference (optional)"
        value={field.sans_ref ?? ''}
        onChange={(e) => onChange({ sans_ref: e.target.value || undefined })}
        className="border rounded px-3 py-2 w-full text-sm"
      />

      {/* Formula kind picker */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Formula
        </label>
        <select
          value={kind}
          onChange={(e) => handleKindChange(e.target.value as FormulaKind)}
          className="border rounded px-3 py-2 text-sm"
        >
          {FORMULA_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>

        {kind === 'literal_formula' && (
          <textarea
            placeholder="e.g. count_failed / count_visible * 100"
            value={field.formula === 'literal_formula' ? '' : (field.formula ?? '')}
            onChange={(e) => onChange({ formula: e.target.value || undefined })}
            className="border rounded px-3 py-2 w-full text-sm font-mono resize-none mt-1"
            rows={2}
          />
        )}

        <p className="text-xs text-gray-400 mt-0.5">
          Computed fields derive their value at capture time; they are read-only for inspectors.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={field.required ?? false}
          onChange={(e) => onChange({ required: e.target.checked || undefined })}
        />
        Required
      </label>
    </div>
  );
}
