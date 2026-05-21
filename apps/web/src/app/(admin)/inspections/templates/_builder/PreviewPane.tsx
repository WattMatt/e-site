'use client';
import { Component, type ReactNode } from 'react';
import CaptureForm from '@/app/(admin)/projects/[id]/inspections/[inspectionId]/CaptureForm';
import type { ParsedTemplate } from '@esite/shared';

interface PreviewPaneProps {
  draft: unknown;
}

class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded">
          <p className="font-medium">Preview unavailable</p>
          <p className="text-xs mt-1">
            Fix validation issues in the SavePanel to render the live preview. Detail:{' '}
            {this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PreviewPane({ draft }: PreviewPaneProps) {
  return (
    <div
      style={{
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        background: 'var(--c-panel)',
        padding: 14,
      }}
    >
      <PreviewErrorBoundary>
        <CaptureForm
          inspectionId="preview"
          template={draft as ParsedTemplate}
          initialResponses={[]}
          currentUserId={null}
          mode="preview"
          readOnly={false}
        />
      </PreviewErrorBoundary>
    </div>
  );
}
