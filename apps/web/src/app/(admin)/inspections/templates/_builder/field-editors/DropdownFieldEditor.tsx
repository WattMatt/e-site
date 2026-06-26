'use client';

import { useId } from 'react';
import type { Field } from '@esite/shared';

interface Props {
  sectionId: string;
  field: Field & { type: 'dropdown' };
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

export function DropdownFieldEditor({ field, onChange, onRemove }: Props) {
  const labelId = useId();
  const options = field.options ?? [];

  function updateOption(index: number, value: string) {
    const next = [...options];
    next[index] = value;
    onChange({ options: next });
  }

  function removeOption(index: number) {
    const next = options.filter((_: string, i: number) => i !== index);
    onChange({ options: next.length > 0 ? next : [] });
  }

  function addOption() {
    onChange({ options: [...options, ''] });
  }

  const hasNoOptions = options.length === 0;

  return (
    <div className="space-y-3 p-3 border rounded">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--c-text-mid)] uppercase tracking-wide">Dropdown</span>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-xs text-[var(--c-red)] hover:text-[var(--c-red)]">
            Remove
          </button>
        )}
      </div>

      <input
        id={labelId}
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={field.required ?? false}
          onChange={(e) => onChange({ required: e.target.checked || undefined })}
        />
        Required
      </label>

      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--c-text-mid)]">
          Options{' '}
          {hasNoOptions && (
            <span className="text-[var(--c-red)] font-normal">(at least one required)</span>
          )}
        </p>
        {options.map((opt: string, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              className="border rounded px-3 py-1.5 flex-1 text-sm"
            />
            <button
              type="button"
              onClick={() => removeOption(i)}
              className="text-[var(--c-text-dim)] hover:text-[var(--c-red)] text-lg leading-none px-1"
              aria-label="Remove option"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          className="text-xs text-[var(--c-blue)] hover:text-[var(--c-blue)] border border-[var(--c-blue)] rounded px-3 py-1.5"
        >
          + Add option
        </button>
      </div>
    </div>
  );
}
