'use client';

import { useId } from 'react';
import type { Field } from '@esite/shared';

interface Props {
  sectionId: string;
  field: Field & { type: 'signature' };
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

type Qualification =
  | 'registered_person'
  | 'master_installation_electrician'
  | 'pr_eng'
  | 'witness'
  | 'client';

const QUALS: { value: Qualification; label: string }[] = [
  { value: 'registered_person', label: 'Registered Person' },
  { value: 'master_installation_electrician', label: 'Master Installation Electrician' },
  { value: 'pr_eng', label: 'Pr.Eng' },
  { value: 'witness', label: 'Witness' },
  { value: 'client', label: 'Client' },
];

export function SignatureFieldEditor({ field, onChange, onRemove }: Props) {
  const labelId = useId();
  const quals: Qualification[] = (field.required_qualifications as Qualification[]) ?? [];

  function toggleQual(value: Qualification) {
    const next = quals.includes(value)
      ? quals.filter((q) => q !== value)
      : [...quals, value];
    onChange({ required_qualifications: next.length > 0 ? next : undefined });
  }

  return (
    <div className="space-y-3 p-3 border rounded">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Signature</span>
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

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-gray-600">
          Required qualifications{' '}
          <span className="text-gray-400 font-normal">(optional — leave unchecked to accept any signatory)</span>
        </legend>
        {QUALS.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={quals.includes(value)}
              onChange={() => toggleQual(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
