'use client';

import type { Field } from '@esite/shared';
import { PassFailFieldEditor }   from './field-editors/PassFailFieldEditor';
import { NumberFieldEditor }     from './field-editors/NumberFieldEditor';
import { TextFieldEditor }       from './field-editors/TextFieldEditor';
import { TextareaFieldEditor }   from './field-editors/TextareaFieldEditor';
import { DateFieldEditor }       from './field-editors/DateFieldEditor';
import { DropdownFieldEditor }   from './field-editors/DropdownFieldEditor';
import { MultiSelectFieldEditor} from './field-editors/MultiSelectFieldEditor';
import { PhotoFieldEditor }      from './field-editors/PhotoFieldEditor';
import { SignatureFieldEditor }  from './field-editors/SignatureFieldEditor';
import { FileFieldEditor }       from './field-editors/FileFieldEditor';
import { ComputedFieldEditor }   from './field-editors/ComputedFieldEditor';

interface Props {
  sectionId: string;
  field: Field;
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

export function FieldEditor({ sectionId, field, onChange, onRemove }: Props) {
  const shared = { sectionId, onChange, onRemove };

  switch (field.type) {
    case 'pass_fail':
      return <PassFailFieldEditor    {...shared} field={field as Field & { type: 'pass_fail' }} />;
    case 'number':
      return <NumberFieldEditor      {...shared} field={field as Field & { type: 'number' }} />;
    case 'text':
      return <TextFieldEditor        {...shared} field={field as Field & { type: 'text' }} />;
    case 'textarea':
      return <TextareaFieldEditor    {...shared} field={field as Field & { type: 'textarea' }} />;
    case 'date':
      return <DateFieldEditor        {...shared} field={field as Field & { type: 'date' }} />;
    case 'dropdown':
      return <DropdownFieldEditor    {...shared} field={field as Field & { type: 'dropdown' }} />;
    case 'multi_select':
      return <MultiSelectFieldEditor {...shared} field={field as Field & { type: 'multi_select' }} />;
    case 'photo':
      return <PhotoFieldEditor       {...shared} field={field as Field & { type: 'photo' }} />;
    case 'signature':
      return <SignatureFieldEditor   {...shared} field={field as Field & { type: 'signature' }} />;
    case 'file':
      return <FileFieldEditor        {...shared} field={field as Field & { type: 'file' }} />;
    case 'computed':
      return <ComputedFieldEditor    {...shared} field={field as Field & { type: 'computed' }} />;

    case 'header':
      // Header fields have no special editor beyond label + help_text.
      return (
        <div className="space-y-3 p-3 border rounded">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Header</span>
            {onRemove && (
              <button type="button" onClick={onRemove} className="text-xs text-red-500 hover:text-red-700">
                Remove
              </button>
            )}
          </div>
          <input
            type="text"
            placeholder="Header text"
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
        </div>
      );

    case 'repeating_group':
      // RepeatingGroupEditor will be wired in Phase C.2.
      return (
        <div
          className="p-3 border rounded text-sm"
          style={{ borderColor: 'var(--c-border, #e5e7eb)', color: 'var(--c-text-dim, #6b7280)' }}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium uppercase tracking-wide">🔁 Repeating group</span>
            {onRemove && (
              <button type="button" onClick={onRemove} className="text-xs text-red-500 hover:text-red-700">
                Remove
              </button>
            )}
          </div>
          <input
            type="text"
            placeholder="Group label"
            value={field.label ?? ''}
            onChange={(e) => onChange({ label: e.target.value })}
            className="border rounded px-3 py-2 w-full text-sm mb-2"
          />
          <p className="text-xs" style={{ color: 'var(--c-text-dim, #6b7280)' }}>
            Sub-field editing for repeating groups arrives in Phase C.2.
          </p>
        </div>
      );

    default: {
      return (
        <div className="p-3 border rounded text-sm text-red-500">
          Unknown field type: {(field as { type: string }).type}
        </div>
      );
    }
  }
}
