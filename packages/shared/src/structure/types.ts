export type NodeKind =
  | 'tenant_db'
  | 'main_board'
  | 'common_area_board'
  | 'common_area_lighting'
  | 'rmu'
  | 'mini_sub'
  | 'generator'
  | 'custom';

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
  // General
  notes: string | null;
  decommission_reason: string | null;
  created_by: string | null;
}
