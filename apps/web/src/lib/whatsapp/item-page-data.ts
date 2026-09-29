// apps/web/src/lib/whatsapp/item-page-data.ts
export function noteText(n: { body: string; redacted_at: string | null }): string {
  return n.redacted_at ? '[message withdrawn]' : n.body
}

export interface LogRow { id: string; at: string; direction: 'out' | 'in'; label: string; status: string; detail: string | null }

export function logRows(
  outbox: Array<{ id: string; trigger: string; status: string; error_text: string | null; created_at: string; sent_at: string | null }>,
  inbound: Array<{ id: string; kind: string; outcome: string; outcome_reason: string | null; received_at: string }>,
): LogRow[] {
  return [
    ...outbox.map((o) => ({ id: o.id, at: o.sent_at ?? o.created_at, direction: 'out' as const, label: o.trigger, status: o.status, detail: o.error_text })),
    ...inbound.map((i) => ({ id: i.id, at: i.received_at, direction: 'in' as const, label: i.kind, status: i.outcome, detail: i.outcome_reason })),
  ].sort((a, b) => a.at.localeCompare(b.at))
}
