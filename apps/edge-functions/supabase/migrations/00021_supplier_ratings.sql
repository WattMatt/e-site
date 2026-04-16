-- ---------------------------------------------------------------------------
-- Migration 00021: Supplier ratings
-- ---------------------------------------------------------------------------

CREATE TABLE marketplace.supplier_ratings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id         UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
    order_id            UUID NOT NULL REFERENCES marketplace.orders(id) ON DELETE CASCADE,
    contractor_org_id   UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    rated_by            UUID NOT NULL REFERENCES public.profiles(id),
    delivery_score      SMALLINT NOT NULL CHECK (delivery_score BETWEEN 1 AND 5),
    quality_score       SMALLINT NOT NULL CHECK (quality_score BETWEEN 1 AND 5),
    communication_score SMALLINT NOT NULL CHECK (communication_score BETWEEN 1 AND 5),
    pricing_score       SMALLINT NOT NULL CHECK (pricing_score BETWEEN 1 AND 5),
    comment             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, rated_by)
);

CREATE INDEX idx_supplier_ratings_supplier ON marketplace.supplier_ratings (supplier_id);
CREATE INDEX idx_supplier_ratings_order    ON marketplace.supplier_ratings (order_id);

-- Materialised view for aggregate ratings per supplier
CREATE MATERIALIZED VIEW marketplace.supplier_rating_summary AS
SELECT
    supplier_id,
    COUNT(*)                                                        AS rating_count,
    ROUND(AVG(delivery_score), 1)                                  AS avg_delivery,
    ROUND(AVG(quality_score), 1)                                   AS avg_quality,
    ROUND(AVG(communication_score), 1)                             AS avg_communication,
    ROUND(AVG(pricing_score), 1)                                   AS avg_pricing,
    ROUND(AVG((delivery_score + quality_score + communication_score + pricing_score)::NUMERIC / 4), 1) AS avg_overall
FROM marketplace.supplier_ratings
GROUP BY supplier_id;

CREATE UNIQUE INDEX ON marketplace.supplier_rating_summary (supplier_id);

-- RLS: anyone in a linked org can read; only the rater can write
ALTER TABLE marketplace.supplier_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ratings_read" ON marketplace.supplier_ratings
    FOR SELECT USING (TRUE);

CREATE POLICY "ratings_insert" ON marketplace.supplier_ratings
    FOR INSERT WITH CHECK (rated_by = auth.uid());
