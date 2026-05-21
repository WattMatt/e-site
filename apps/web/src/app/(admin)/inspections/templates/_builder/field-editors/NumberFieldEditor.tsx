'use client';

import { useState } from 'react';
import type { Field } from '@esite/shared';

interface Props {
  sectionId: string;
  field: Field & { type: 'number' };
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

export function NumberFieldEditor({ field, onChange, onRemove }: Props) {
  const [quickA, setQuickA] = useState('');
  const [quickB, setQuickB] = useState('');

  function applyGte() {
    const n = parseFloat(quickA);
    if (!isNaN(n)) onChange({ pass_when: `>= ${n}` });
  }

  function applyLte() {
    const n = parseFloat(quickA);
    if (!isNaN(n)) onChange({ pass_when: `<= ${n}` });
  }

  function applyBetween() {
    const a = parseFloat(quickA);
    const b = parseFloat(quickB);
    if (!isNaN(a) && !isNaN(b)) onChange({ pass_when: `between ${a} and ${b}` });
  }

  return (
    <div className="space-y-3 p-3 border rounded">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Number</span>
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

      <input
        type="text"
        placeholder="Unit (optional, e.g. Ω, V, A, m)"
        value={field.unit ?? ''}
        onChange={(e) => onChange({ unit: e.target.value || undefined })}
        className="border rounded px-3 py-2 w-full text-sm"
      />

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-600">Pass-when condition</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number"
            placeholder="N"
            value={quickA}
            onChange={(e) => setQuickA(e.target.value)}
            className="border rounded px-2 py-1.5 w-20 text-sm"
          />
          <input
            type="number"
            placeholder="M (for between)"
            value={quickB}
            onChange={(e) => setQuickB(e.target.value)}
            className="border rounded px-2 py-1.5 w-28 text-sm"
          />
          <button type="button" onClick={applyGte} className="text-xs border rounded px-2 py-1.5 hover:bg-gray-50">
            &gt;= N
          </button>
          <button type="button" onClick={applyLte} className="text-xs border rounded px-2 py-1.5 hover:bg-gray-50">
            &lt;= N
          </button>
          <button type="button" onClick={applyBetween} className="text-xs border rounded px-2 py-1.5 hover:bg-gray-50">
            between N and M
          </button>
        </div>
        <input
          type="text"
          placeholder="pass_when expression (raw)"
          value={field.pass_when ?? ''}
          onChange={(e) => onChange({ pass_when: e.target.value || undefined })}
          className="border rounded px-3 py-2 w-full text-sm font-mono"
        />
        <p className="text-xs text-gray-400">
          Examples: {'>='} 1.0 &nbsp;|&nbsp; {'<='} 5.0 &nbsp;|&nbsp; between 207 and 253 &nbsp;|&nbsp; in [1.0, 2.0]
        </p>
      </div>

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
    </div>
  );
}
