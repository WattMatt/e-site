/** "Probe Mall": invented rows for the tenant facts tests. No client data. */
import type { FakeTables } from './fake-tables-client'

export const PROBE_PROJECT = {
  id: 'p-1',
  name: 'Probe Mall',
  organisation_id: 'org-1',
  opening_date: '2026-09-01',
}

export const PROBE_TABLES: FakeTables = {
  'structure.nodes': [
    {
      id: 'n-1', project_id: 'p-1', kind: 'tenant_db', code: 'ZZ01', shop_number: 'ZZ01', shop_name: 'Lantern Books',
      name: null, shop_area_m2: 120, status: 'active', breaker_rating_a: null, pole_config: null,
      incomer_breaker_a: 63, incomer_pole_config: 'TP', incomer_load_a: 48,
    },
    {
      id: 'n-2', project_id: 'p-1', kind: 'tenant_db', code: 'ZZ02', shop_number: 'ZZ02', shop_name: 'Copper Kettle',
      name: null, shop_area_m2: 80, status: 'active', breaker_rating_a: 40, pole_config: 'SP',
      incomer_breaker_a: null, incomer_pole_config: null, incomer_load_a: null,
    },
    {
      id: 'n-3', project_id: 'p-1', kind: 'tenant_db', code: 'ZZ03', shop_number: 'ZZ03', shop_name: 'Old Lamp Co',
      name: null, shop_area_m2: 55, status: 'decommissioned', breaker_rating_a: null, pole_config: null,
      incomer_breaker_a: null, incomer_pole_config: null, incomer_load_a: null,
    },
  ],
  'structure.scope_item_types': [
    { id: 'tdb', key: 'db' },
    { id: 'tlt', key: 'lighting' },
    { id: 'tx', key: 'signage' },
  ],
  'structure.tenant_details': [
    { node_id: 'n-1', scope_status: 'received', scope_not_required: false, layout_status: 'issued', bo_period_days: 30, bo_date_override: null },
    { node_id: 'n-2', scope_status: null, scope_not_required: true, layout_status: 'pending', bo_period_days: null, bo_date_override: '2026-06-01' },
  ],
  'structure.node_orders': [
    { node_id: 'n-1', scope_item_type_id: 'tdb', status: 'received' },
    { node_id: 'n-1', scope_item_type_id: 'tlt', status: 'by_tenant' },
    { node_id: 'n-2', scope_item_type_id: 'tdb', status: 'ordered' },
  ],
  'projects.projects': [
    { name: 'Probe Mall', client_logo_url: null, project_logo_url: null, report_accent_color: '#123456' },
  ],
  'public.organisations': [
    { name: 'Probe Org', logo_url: null, report_accent_color: null },
  ],
}
