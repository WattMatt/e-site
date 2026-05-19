'use client';
import type { Field } from '@esite/shared';

interface Props {
  sourceField: Field;
  /** All sibling fields in the same section — used for idempotency check. */
  sectionFields: Field[];
  onInsert: (fields: Field[]) => void;
}

export function PhotoEvidenceSuggestion({ sourceField, sectionFields, onInsert }: Props) {
  const sourceId = sourceField.field_id;
  const isPassFail = sourceField.type === 'pass_fail';
  const isMeasurement =
    sourceField.type === 'number' && Boolean((sourceField as Field & { unit?: string }).unit);

  if (!isPassFail && !isMeasurement) return null;

  // By-convention field_ids — idempotency check
  const passPhotoId = `${sourceId}_pass_photo`;
  const failPhotoId = `${sourceId}_fail_photo`;
  const instrumentPhotoId = `${sourceId}_instrument_photo`;

  const hasPair = isPassFail
    ? sectionFields.some((f) => f.field_id === passPhotoId || f.field_id === failPhotoId)
    : sectionFields.some((f) => f.field_id === instrumentPhotoId);

  if (hasPair) {
    return (
      <p className="text-xs mt-2" style={{ color: 'var(--c-green, #15803d)' }}>
        Paired evidence photo{isPassFail ? 's' : ''} already added.
      </p>
    );
  }

  function handleAdd() {
    if (isPassFail) {
      onInsert([
        {
          field_id: passPhotoId,
          type: 'photo',
          label: 'Pass evidence',
          help_text: 'Optional photo when this item passes.',
        } as Field,
        {
          field_id: failPhotoId,
          type: 'photo',
          label: 'Fail evidence',
          help_text: 'Required when this item fails — circle or annotate the defect.',
          min_count: 1,
          max_count: 4,
          conditional_on: { field_id: sourceId, equals: 'fail' },
        } as Field,
      ]);
    } else {
      onInsert([
        {
          field_id: instrumentPhotoId,
          type: 'photo',
          label: 'Instrument reading photo',
          help_text: 'Photo of the test instrument display showing this reading.',
          min_count: 1,
          max_count: 2,
          required: true,
        } as Field,
      ]);
    }
  }

  return (
    <div
      className="mt-3 p-3 border rounded text-sm"
      style={{
        borderColor: 'var(--c-amber, #f59e0b)',
        background: 'var(--c-amber-50, #fffbeb)',
      }}
    >
      <p className="font-medium" style={{ color: 'var(--c-amber-900, #78350f)' }}>
        {isPassFail
          ? 'Image-evidence pattern recommended.'
          : 'Pair this measurement with an instrument-reading photo?'}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--c-amber-800, #92400e)' }}>
        {isPassFail
          ? `Adds "${passPhotoId}" (pass evidence, optional) + "${failPhotoId}" (fail evidence, required on fail).`
          : `Adds "${instrumentPhotoId}" (required — captures the instrument display reading).`}
      </p>
      <button
        type="button"
        onClick={handleAdd}
        className="mt-2 px-3 py-1 text-sm rounded font-medium"
        style={{
          background: 'var(--c-amber-200, #fde68a)',
          color: 'var(--c-amber-900, #78350f)',
        }}
      >
        {isPassFail ? '+ Add paired evidence photos' : '+ Add instrument photo'}
      </button>
    </div>
  );
}
