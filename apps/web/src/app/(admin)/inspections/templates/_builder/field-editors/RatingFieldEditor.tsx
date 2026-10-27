'use client';

import { useId } from 'react';
import type { Field } from '@esite/shared';

interface Props {
  sectionId: string;
  field: Field & { type: 'rating' };
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

/** Good / Fair / Poor. A Poor rating is one of the two answers that fail an inspection. */
export function RatingFieldEditor({ field, onChange, onRemove }: Props) {
  const labelId = useId();

  return (
    <div className="space-y-3 p-3 border rounded">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--c-text-mid)] uppercase tracking-wide">Rating</span>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-xs text-[var(--c-red)] hover:text-[var(--c-red)]">
            Remove
          </button>
        )}
      </div>

      <input
        id={labelId}
        type="text"
        placeholder="Label (e.g. Enclosure condition)"
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

      <p className="text-xs text-[var(--c-text-dim)]">
        The inspector rates Good, Fair or Poor. <strong>Poor fails the inspection.</strong>
      </p>
    </div>
  );
}
