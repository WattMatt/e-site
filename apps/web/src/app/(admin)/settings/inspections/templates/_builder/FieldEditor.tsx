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
import { RepeatingGroupEditor }  from './field-editors/RepeatingGroupEditor';
import { ConditionalOnEditor }   from './ConditionalOnEditor';

interface Props {
  sectionId: string;
  field: Field;
  /** All fields in the same section — used by ConditionalOnEditor for the field_id dropdown. */
  sectionFields: Field[];
  onChange: (patch: Partial<Field>) => void;
  onRemove?: () => void;
}

/** Wraps the per-type editor with a shared "Conditional visibility" collapsible section. */
function withConditionalWrapper(
  editor: React.ReactNode,
  field: Field,
  sectionFields: Field[],
  onChange: (patch: Partial<Field>) => void,
): React.ReactNode {
  return (
    <div className="space-y-3">
      {editor}
      <details className="border-t pt-2">
        <summary
          className="text-sm cursor-pointer select-none"
          style={{ color: 'var(--c-text-dim, #6b7280)' }}
        >
          Conditional visibility
          {field.conditional_on && (
            <span className="ml-2 text-xs font-medium" style={{ color: 'var(--c-amber, #f59e0b)' }}>
              ● active
            </span>
          )}
        </summary>
        <div className="mt-2">
          <ConditionalOnEditor
            sectionFields={sectionFields}
            currentFieldId={field.field_id}
            value={field.conditional_on}
            onChange={(next) => onChange({ conditional_on: next })}
          />
        </div>
      </details>
    </div>
  );
}

export function FieldEditor({ sectionId, field, sectionFields, onChange, onRemove }: Props) {
  const shared = { sectionId, onChange, onRemove };

  let editor: React.ReactNode;

  switch (field.type) {
    case 'pass_fail':
      editor = <PassFailFieldEditor    {...shared} field={field as Field & { type: 'pass_fail' }} />;
      break;
    case 'number':
      editor = <NumberFieldEditor      {...shared} field={field as Field & { type: 'number' }} />;
      break;
    case 'text':
      editor = <TextFieldEditor        {...shared} field={field as Field & { type: 'text' }} />;
      break;
    case 'textarea':
      editor = <TextareaFieldEditor    {...shared} field={field as Field & { type: 'textarea' }} />;
      break;
    case 'date':
      editor = <DateFieldEditor        {...shared} field={field as Field & { type: 'date' }} />;
      break;
    case 'dropdown':
      editor = <DropdownFieldEditor    {...shared} field={field as Field & { type: 'dropdown' }} />;
      break;
    case 'multi_select':
      editor = <MultiSelectFieldEditor {...shared} field={field as Field & { type: 'multi_select' }} />;
      break;
    case 'photo':
      editor = <PhotoFieldEditor       {...shared} field={field as Field & { type: 'photo' }} />;
      break;
    case 'signature':
      editor = <SignatureFieldEditor   {...shared} field={field as Field & { type: 'signature' }} />;
      break;
    case 'file':
      editor = <FileFieldEditor        {...shared} field={field as Field & { type: 'file' }} />;
      break;
    case 'computed':
      editor = <ComputedFieldEditor    {...shared} field={field as Field & { type: 'computed' }} />;
      break;

    case 'header':
      // Header fields have no special editor beyond label + help_text.
      editor = (
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
      break;

    case 'repeating_group':
      editor = (
        <RepeatingGroupEditor
          sectionId={sectionId}
          field={field as Field & { type: 'repeating_group'; fields: Field[] }}
          onChange={onChange}
          onRemove={onRemove}
        />
      );
      break;

    default: {
      return (
        <div className="p-3 border rounded text-sm text-red-500">
          Unknown field type: {(field as { type: string }).type}
        </div>
      );
    }
  }

  return withConditionalWrapper(editor, field, sectionFields, onChange);
}
