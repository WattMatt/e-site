'use client';

import { useEffect } from 'react';
import type { Field } from '@esite/shared';

type FieldType = Field['type'];

interface FieldTypeCard {
  type: FieldType;
  icon: string;
  name: string;
  description: string;
}

const FIELD_TYPE_CARDS: FieldTypeCard[] = [
  { type: 'pass_fail',       icon: '✓',  name: 'Pass / Fail',     description: 'Inspector marks pass, fail, or N/A' },
  { type: 'number',          icon: '🔢', name: 'Number',          description: 'Numeric measurement with optional unit + threshold' },
  { type: 'text',            icon: '📝', name: 'Text',            description: 'Single-line free text' },
  { type: 'textarea',        icon: '📝', name: 'Textarea',        description: 'Multi-line free text or notes' },
  { type: 'date',            icon: '📅', name: 'Date',            description: 'Date picker' },
  { type: 'dropdown',        icon: '📋', name: 'Dropdown',        description: 'Select one option from a list' },
  { type: 'multi_select',    icon: '📋', name: 'Multi-select',    description: 'Select one or more options from a list' },
  { type: 'photo',           icon: '📸', name: 'Photo',           description: 'One or more photos with EXIF evidence stamp' },
  { type: 'signature',       icon: '✍️',  name: 'Signature',       description: 'Captured signature with name, title, and reg #' },
  { type: 'file',            icon: '📎', name: 'File',            description: 'Document or attachment upload' },
  { type: 'computed',        icon: '🧮', name: 'Computed',        description: 'Auto-calculated from other field values' },
  { type: 'repeating_group', icon: '🔁', name: 'Repeating group', description: 'Repeated set of sub-fields (e.g. snag list entries)' },
];

interface Props {
  onSelect: (type: FieldType) => void;
  onClose: () => void;
  disableRepeatingGroup?: boolean;
}

export function FieldTypePicker({ onSelect, onClose, disableRepeatingGroup }: Props) {
  // Close on ESC
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => {
        // Close when clicking the backdrop (not the modal itself)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-2xl rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--c-surface-1, #fff)', border: '1px solid var(--c-border, #e5e7eb)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--c-border, #e5e7eb)' }}
        >
          <div>
            <h2 className="text-sm font-semibold">Add field</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
              Choose a field type to add to this section.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-2 py-1 rounded hover:bg-[var(--c-elevated)]"
            style={{ color: 'var(--c-text-dim, #6b7280)' }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Grid */}
        <div className="p-5 grid grid-cols-2 gap-3 max-h-[70vh] overflow-y-auto">
          {FIELD_TYPE_CARDS.map((card) => {
            const disabled = card.type === 'repeating_group' && disableRepeatingGroup;
            return (
              <button
                key={card.type}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelect(card.type);
                  onClose();
                }}
                className={[
                  'flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                  disabled
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:border-[var(--c-blue)] hover:bg-[var(--c-blue-dim)] cursor-pointer',
                ].join(' ')}
                style={{
                  borderColor: 'var(--c-border, #e5e7eb)',
                  background: disabled ? 'var(--c-surface-2, #f3f4f6)' : undefined,
                }}
                title={disabled ? 'Repeating groups cannot be nested' : undefined}
              >
                <span className="text-xl leading-none mt-0.5 shrink-0">{card.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{card.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
                    {card.description}
                  </div>
                  {disabled && (
                    <div className="text-xs mt-1 text-[var(--c-amber)]">Not allowed inside a repeating group</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
