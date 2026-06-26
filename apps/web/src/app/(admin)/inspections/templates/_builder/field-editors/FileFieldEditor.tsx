'use client';

import { useId, useState } from 'react';
import type { Field } from '@esite/shared';

interface Props {
  sectionId: string;
  field: Field & { type: 'file' };
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

// The schema has no accepted_mime_types property — MIME filters are stored
// in the field's `options` array (string[] available on all field types).
// Format: comma-separated in the input, split into the options array on change.

function parseMimes(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function FileFieldEditor({ field, onChange, onRemove }: Props) {
  const labelId = useId();

  // Keep the raw text input in local state so the user can type freely;
  // flush to `options` on blur.
  const [mimeRaw, setMimeRaw] = useState<string>(
    (field.options ?? []).join(', '),
  );

  function flushMimes(raw: string) {
    const mimes = parseMimes(raw);
    onChange({ options: mimes.length > 0 ? mimes : undefined });
  }

  function handleMinChange(raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return;
    onChange({ min_count: n });
  }

  function handleMaxChange(raw: string) {
    if (!raw) {
      onChange({ max_count: undefined });
      return;
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return;
    onChange({ max_count: n });
  }

  const previewMimes = parseMimes(mimeRaw);

  return (
    <div className="space-y-3 p-3 border rounded">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--c-text-mid)] uppercase tracking-wide">File upload</span>
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

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs text-[var(--c-text-mid)] block mb-1">Minimum files (optional)</label>
          <input
            type="number"
            min={1}
            value={field.min_count ?? ''}
            onChange={(e) => handleMinChange(e.target.value)}
            placeholder="No minimum"
            className="border rounded px-3 py-1.5 w-full text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-[var(--c-text-mid)] block mb-1">Maximum files (optional)</label>
          <input
            type="number"
            min={field.min_count ?? 1}
            value={field.max_count ?? ''}
            onChange={(e) => handleMaxChange(e.target.value)}
            placeholder="No limit"
            className="border rounded px-3 py-1.5 w-full text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--c-text-mid)] block">
          Accepted MIME types{' '}
          <span className="text-[var(--c-text-dim)] font-normal">(comma-separated, stored in options[ ])</span>
        </label>
        <input
          type="text"
          placeholder="e.g. application/pdf, image/jpeg, image/png"
          value={mimeRaw}
          onChange={(e) => setMimeRaw(e.target.value)}
          onBlur={(e) => flushMimes(e.target.value)}
          className="border rounded px-3 py-2 w-full text-sm"
        />

        {/* Chip preview of parsed MIMEs */}
        {previewMimes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {previewMimes.map((mime) => (
              <span
                key={mime}
                className="inline-flex items-center bg-[var(--c-surface)] text-[var(--c-text-mid)] text-xs rounded px-2 py-0.5 font-mono"
              >
                {mime}
              </span>
            ))}
          </div>
        )}
        {previewMimes.length === 0 && (
          <p className="text-xs text-[var(--c-text-dim)]">Leave blank to accept any file type.</p>
        )}
      </div>
    </div>
  );
}
