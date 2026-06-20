-- =============================================================================
-- Migration 00142 — backfill: order-instruction present ⇒ order 'ordered'
-- =============================================================================
-- The forward auto-advance (PR #90) only fires on a NEW order-instruction upload.
-- This one-time backfill catches up orders whose order-instruction was uploaded
-- BEFORE that shipped: any `required` order that already has ≥1 order_instruction
-- document is advanced to `ordered`, with `ordered_at` = the EARLIEST such
-- document's upload date (truthful to "the date it was uploaded").
--
-- Only `required` orders are touched — `by_tenant` / `ordered` / `received` are
-- left alone. Idempotent: once advanced, an order is no longer `required`, so a
-- re-run matches nothing.
-- =============================================================================

UPDATE structure.node_orders AS o
   SET status     = 'ordered',
       ordered_at = d.first_instruction_date
  FROM (
        SELECT node_order_id,
               MIN(created_at)::date AS first_instruction_date
          FROM structure.node_order_documents
         WHERE doc_type = 'order_instruction'
         GROUP BY node_order_id
       ) AS d
 WHERE o.id = d.node_order_id
   AND o.status = 'required';
