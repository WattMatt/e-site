/**
 * Pure rule for auto-advancing a node order's status when a document is uploaded.
 * An order-instruction document on a still-`required` order means the order has
 * been placed → advance to `ordered`. Quotes never advance; orders past `required`
 * (`ordered`/`received`) and tenant-supplied (`by_tenant`) orders are never touched.
 * One-way — deleting the document does not revert (see spec).
 */
export type NodeOrderDocType = 'quote' | 'order_instruction'
export type NodeOrderStatus = 'by_tenant' | 'required' | 'ordered' | 'received'

export function shouldAdvanceToOrdered(
  docType: NodeOrderDocType,
  currentStatus: NodeOrderStatus,
): boolean {
  return docType === 'order_instruction' && currentStatus === 'required'
}
