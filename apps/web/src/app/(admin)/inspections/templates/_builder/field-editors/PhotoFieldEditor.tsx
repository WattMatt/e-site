'use client';

import { useId } from 'react';
import type { Field } from '@esite/shared';

interface Props {
  sectionId: string;
  field: Field & { type: 'photo' };
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

// min_count is z.number().int().positive() — zero is not valid.
// "Optional photos" means omitting min_count entirely.
type CountMode = 'optional' | 'minimum' | 'exact';

function getCountMode(field: Field): CountMode {
  if (field.min_count === undefined) return 'optional';
  if (field.max_count !== undefined && field.min_count === field.max_count) return 'exact';
  return 'minimum';
}

export function PhotoFieldEditor({ field, onChange, onRemove }: Props) {
  const labelId = useId();
  const countMode = getCountMode(field);

  function setCountMode(mode: CountMode) {
    if (mode === 'optional') {
      onChange({ min_count: undefined, max_count: undefined });
    } else if (mode === 'minimum') {
      onChange({ min_count: 1, max_count: undefined });
    } else {
      // exact — min === max
      const n = field.min_count ?? 1;
      onChange({ min_count: n, max_count: n });
    }
  }

  function handleMinChange(raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (countMode === 'exact') {
      onChange({ min_count: n, max_count: n });
    } else {
      onChange({ min_count: n });
    }
  }

  function handleMaxChange(raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return;
    onChange({ max_count: n });
  }

  return (
    <div className="space-y-3 p-3 border rounded">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Photo</span>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-xs text-red-500 hover:text-red-700">
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

      {/* Count mode — 3-state radio. Never sets min_count: 0. */}
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-gray-600">Photo count requirement</legend>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name={`${labelId}-count`}
            checked={countMode === 'optional'}
            onChange={() => setCountMode('optional')}
          />
          Optional (no minimum)
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name={`${labelId}-count`}
            checked={countMode === 'minimum'}
            onChange={() => setCountMode('minimum')}
          />
          Required minimum N
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name={`${labelId}-count`}
            checked={countMode === 'exact'}
            onChange={() => setCountMode('exact')}
          />
          Exact count required
        </label>
      </fieldset>

      {countMode !== 'optional' && (
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">
              {countMode === 'exact' ? 'Exact count' : 'Minimum count'}
            </label>
            <input
              type="number"
              min={1}
              value={field.min_count ?? 1}
              onChange={(e) => handleMinChange(e.target.value)}
              className="border rounded px-3 py-1.5 w-full text-sm"
            />
          </div>
          {countMode === 'minimum' && (
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Maximum count (optional)</label>
              <input
                type="number"
                min={field.min_count ?? 1}
                value={field.max_count ?? ''}
                onChange={(e) => handleMaxChange(e.target.value)}
                placeholder="No limit"
                className="border rounded px-3 py-1.5 w-full text-sm"
              />
            </div>
          )}
        </div>
      )}

    </div>
  );
}
