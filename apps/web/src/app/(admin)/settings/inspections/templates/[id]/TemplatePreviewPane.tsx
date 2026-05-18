'use client'

import type { ParsedTemplate } from '@esite/shared'
import CaptureForm from '@/app/(admin)/projects/[id]/inspections/[inspectionId]/CaptureForm'

/**
 * Template-editor preview pane — renders the inspector capture component
 * in `preview` mode (no autosave, no submit) so authors can see what the
 * form looks like before saving a version.
 *
 * Phase 5 (Task 28): wired to the real CaptureForm component.
 */
export default function TemplatePreviewPane({ template }: { template: ParsedTemplate }) {
  return (
    <div
      style={{
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        background: 'var(--c-panel)',
        padding: 14,
      }}
    >
      <CaptureForm
        inspectionId="preview"
        template={template}
        initialResponses={[]}
        currentUserId={null}
        mode="preview"
        readOnly={false}
      />
    </div>
  )
}
