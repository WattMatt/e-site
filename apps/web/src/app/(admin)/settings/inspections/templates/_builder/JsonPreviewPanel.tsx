'use client';
import { useState } from 'react';

interface Props { draft: unknown; }

export function JsonPreviewPanel({ draft }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="border rounded">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full text-left p-2 bg-gray-50 text-sm font-mono hover:bg-gray-100"
      >
        {collapsed ? '▶' : '▼'} schema_json preview
      </button>
      {!collapsed && (
        <pre className="p-3 text-xs overflow-x-auto max-h-96 bg-white">
          {JSON.stringify(draft, null, 2)}
        </pre>
      )}
    </div>
  );
}
