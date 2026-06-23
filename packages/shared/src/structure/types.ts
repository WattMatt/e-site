export type NodeKind =
  | 'tenant_db'
  | 'main_board'
  | 'common_area_board'
  | 'common_area_lighting'
  | 'rmu'
  | 'mini_sub'
  | 'generator'
  | 'custom'
  | 'sub_board';

export type NodeStatus = 'active' | 'decommissioned';

export interface Node {
  // Server-generated
  id: string;
  created_at: string;
  updated_at: string;
  // Core
  project_id: string;
  organisation_id: string;
  kind: NodeKind;
  /** Set only when kind === 'custom' — the user-defined equipment type name. */
  custom_kind_label: string | null;
  code: string;
  name: string | null;
  coc_required: boolean;
  status: NodeStatus;
  /** Soft-delete marker (recycle bin, migration 00123) — NULL = not deleted. */
  deleted_at: string | null;
  /** Who soft-deleted the node (migration 00123); NULL when not deleted. */
  deleted_by: string | null;
  /** Containment parent — the board this node sits under; null for a root/lease (migration 00116). */
  parent_node_id: string | null;
  // Tenant facet
  shop_number: string | null;
  shop_name: string | null;
  shop_area_m2: number | null;
  // Electrical facet
  breaker_rating_a: number | null;
  pole_config: string | null;
  section: string | null;
  rating_kva: number | null;
  voltage_v: number | null;
  // Derived incoming-supply electrical (migration 00144) — persisted by recompute
  incomer_breaker_a: number | null;
  incomer_pole_config: string | null;
  incomer_load_a: number | null;
  incomer_capacity_a: number | null;
  incomer_under_protected: boolean;
  incomer_multiple_feeds: boolean;
  incomer_source_revision_id: string | null;
  incomer_computed_at: string | null;
  // General
  notes: string | null;
  decommission_reason: string | null;
  created_by: string | null;
}
