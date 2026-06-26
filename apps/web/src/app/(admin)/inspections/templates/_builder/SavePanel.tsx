'use client';
import { useMemo, useTransition } from 'react';
import { templateSchema } from '@esite/shared';

interface Props {
  draft: unknown;
  onSave?: (validatedDraft: unknown) => Promise<{ ok: boolean; error?: string }>;
}

export function SavePanel({ draft, onSave }: Props) {
  const validation = useMemo(() => templateSchema.safeParse(draft), [draft]);
  const [isPending, startTransition] = useTransition();

  // Section / field counts — derived only when validation succeeds
  const counts = useMemo(() => {
    if (!validation.success) return null;
    const sections = validation.data.sections;
    let total = 0;
    let photos = 0;
    let measurements = 0;
    let signatures = 0;
    for (const s of sections) {
      const fields = s.fields ?? [];
      total += fields.length;
      photos += fields.filter(f => f.type === 'photo').length;
      measurements += fields.filter(f => f.type === 'number' && (f as { unit?: string }).unit != null).length;
      signatures += fields.filter(f => f.type === 'signature').length;
      // count inside subsections as well
      for (const sub of s.subsections ?? []) {
        total += sub.fields.length;
        photos += sub.fields.filter(f => f.type === 'photo').length;
        measurements += sub.fields.filter(f => f.type === 'number' && (f as { unit?: string }).unit != null).length;
        signatures += sub.fields.filter(f => f.type === 'signature').length;
      }
    }
    return { sections: sections.length, total, photos, measurements, signatures };
  }, [validation]);

  const showSignatureReminder = validation.success && counts !== null && counts.signatures === 0;
  const canSave = validation.success && !!onSave && !isPending;

  return (
    <footer className="sticky bottom-0 border-t bg-[var(--c-panel)] p-3 flex items-center gap-3 flex-wrap">
      {validation.success ? (
        <span className="text-[var(--c-green)] text-sm">✓ Valid</span>
      ) : (
        <details className="text-[var(--c-red)] text-sm">
          <summary className="cursor-pointer">
            ✗ {validation.error.issues.length} issue{validation.error.issues.length === 1 ? '' : 's'}
          </summary>
          <ul className="ml-4 mt-1 text-xs">
            {validation.error.issues.slice(0, 10).map((issue, i) => (
              <li key={i}>{issue.path.join('.') || '(root)'}: {issue.message}</li>
            ))}
            {validation.error.issues.length > 10 && (
              <li>... and {validation.error.issues.length - 10} more</li>
            )}
          </ul>
        </details>
      )}

      {counts !== null && (
        <span className="text-xs text-[var(--c-text-dim)] ml-2">
          {counts.sections} section{counts.sections === 1 ? '' : 's'} · {counts.total} field{counts.total === 1 ? '' : 's'} · {counts.photos} photo{counts.photos === 1 ? '' : 's'} · {counts.measurements} measurement{counts.measurements === 1 ? '' : 's'} · {counts.signatures} sig{counts.signatures === 1 ? '' : 's'}
        </span>
      )}

      {showSignatureReminder && (
        <span className="text-[var(--c-amber)] text-xs ml-2">
          ⚠ Reminder: add at least one signature field for certification.
        </span>
      )}

      {!onSave && (
        <span className="text-[var(--c-text-dim)] text-xs ml-2" title="Save handler not wired (Phase E.1 wires this)">
          Save not wired
        </span>
      )}

      <div className="flex-1" />

      <button
        type="button"
        disabled={!canSave}
        title={!onSave ? 'Save handler not wired (Phase E.1 wires this)' : undefined}
        onClick={() => {
          if (!validation.success || !onSave) return;
          startTransition(async () => {
            const result = await onSave(validation.data);
            if (!result.ok) {
              alert(`Save failed: ${result.error ?? 'unknown error'}`);
            }
            // redirect handled by caller on success
          });
        }}
        className="bg-[var(--c-blue)] text-[var(--c-text)] px-4 py-2 rounded disabled:opacity-40"
      >
        {isPending ? 'Saving…' : 'Save template'}
      </button>
    </footer>
  );
}
