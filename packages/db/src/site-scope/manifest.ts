// packages/db/src/site-scope/manifest.ts
// The reviewed source for the site_scope migration. Generated SQL must never be
// edited by hand: change this file and re-run scripts/db/site-scope/emit.ts.

/** A SECURITY DEFINER lookup: id of a row in `table` -> its project id. */
export interface Resolver {
  /** function name, created as public.site_project_of_<name>(uuid) */
  name: string
  table: string
  /** how the project is found from that row: its own project_id, or another resolver over one of its columns */
  via: { column: 'project_id' } | { column: string; resolver: string }
}

export interface Gated {
  table: string
  /** SQL expression yielding the row's project id */
  project: { column: string } | { resolver: string; column: string }
}

export const RESOLVERS: Resolver[] = [
  { name: 'site_diary_entry', table: 'projects.site_diary_entries', via: { column: 'project_id' } },
  { name: 'jbcc_letter',      table: 'projects.jbcc_letters',       via: { column: 'project_id' } },
  { name: 'node',             table: 'structure.nodes',             via: { column: 'project_id' } },
  { name: 'node_order',       table: 'structure.node_orders',       via: { column: 'project_id' } },
  { name: 'work_item',        table: 'projects.work_items',         via: { column: 'project_id' } },
  { name: 'boq_import',       table: 'projects.boq_imports',        via: { column: 'project_id' } },
  { name: 'boq_section',      table: 'projects.boq_sections',       via: { column: 'import_id', resolver: 'boq_import' } },
  { name: 'rfi',              table: 'projects.rfis',               via: { column: 'project_id' } },
  { name: 'gcr_zone',         table: 'gcr.zones',                   via: { column: 'project_id' } },
  { name: 'snag',             table: 'field.snags',                 via: { column: 'project_id' } },
  { name: 'floor_plan',       table: 'tenants.floor_plans',         via: { column: 'project_id' } },
  { name: 'variation_order',  table: 'projects.variation_orders',   via: { column: 'project_id' } },
  { name: 'valuation',        table: 'projects.valuations',         via: { column: 'project_id' } },
  { name: 'qc_report',        table: 'projects.qc_reports',         via: { column: 'project_id' } },
  { name: 'revision',         table: 'cable_schedule.revisions',    via: { column: 'project_id' } },
  { name: 'supply_route',     table: 'cable_schedule.supply_routes', via: { column: 'revision_id', resolver: 'revision' } },
  { name: 'cable',            table: 'cable_schedule.cables',       via: { column: 'revision_id', resolver: 'revision' } },
  { name: 'inspection',       table: 'inspections.inspections',     via: { column: 'project_id' } },
  { name: 'site_form',        table: 'field.site_forms',            via: { column: 'project_id' } },
  { name: 'tender',           table: 'projects.tenders',            via: { column: 'project_id' } },
]

const direct = (table: string): Gated => ({ table, project: { column: 'project_id' } })
const child = (table: string, resolver: string, column: string): Gated => ({ table, project: { resolver, column } })

export const GATED: Gated[] = [
  // ── direct project_id ──
  ...[
    'projects.jbcc_letters', 'projects.reports', 'field.snag_visits', 'gcr.settings', 'projects.project_members',
    'projects.rfis', 'projects.drawings', 'projects.contacts', 'projects.handover_checklist', 'gcr.zones',
    'gcr.tenant_assignments', 'projects.site_diary_entries', 'field.cables', 'field.inspection_milestones',
    'field.inspection_requests', 'projects.jbcc_parties', 'field.snags', 'gcr.report_revisions',
    'projects.variation_orders', 'tenants.handover_folders', 'projects.project_settings_history',
    'tenants.documents', 'structure.nodes', 'projects.work_item_events', 'tenants.floor_plans',
    'cable_schedule.sans_overrides', 'tenants.floor_plan_versions', 'structure.node_orders', 'projects.qc_entries',
    'projects.valuations', 'projects.qc_reports', 'projects.qc_entry_photos', 'projects.work_item_notes',
    'projects.work_item_attachments', 'projects.boq_imports', 'tenants.cloud_sync_runs', 'cable_schedule.revisions',
    'field.site_forms', 'inspections.inspections', 'tenants.floor_plan_markups', 'projects.load_profiles',
    'projects.load_profile_sources', 'projects.work_items', 'projects.tenders', 'projects.project_settings',
  ].map(direct),
  // ── children ──
  child('projects.site_diary_attachments', 'site_diary_entry', 'diary_entry_id'),
  child('projects.jbcc_letter_events', 'jbcc_letter', 'letter_id'),
  child('projects.jbcc_letter_recipients', 'jbcc_letter', 'letter_id'),
  child('projects.jbcc_letter_attachments', 'jbcc_letter', 'letter_id'),
  child('structure.tenant_documents', 'node', 'node_id'),
  child('structure.tenant_document_revisions', 'node', 'node_id'),
  child('structure.tenant_units', 'node', 'node_id'),
  child('structure.tenant_scope_items', 'node', 'node_id'),
  child('structure.tenant_details', 'node', 'node_id'),
  child('structure.node_circuits', 'node', 'node_id'),
  child('structure.node_order_documents', 'node_order', 'node_order_id'),
  child('structure.node_order_shop_drawings', 'node_order', 'node_order_id'),
  child('projects.work_item_watchers', 'work_item', 'work_item_id'),
  child('projects.boq_sections', 'boq_import', 'import_id'),
  child('projects.boq_items', 'boq_section', 'section_id'),
  child('projects.rfi_responses', 'rfi', 'rfi_id'),
  child('public.rfi_annotations', 'rfi', 'rfi_id'),
  child('gcr.zone_generators', 'gcr_zone', 'zone_id'),
  child('field.snag_photos', 'snag', 'snag_id'),
  child('tenants.floor_plan_zones', 'floor_plan', 'floor_plan_id'),
  child('tenants.floor_plan_page_scales', 'floor_plan', 'floor_plan_id'),
  child('projects.variation_lines', 'variation_order', 'variation_order_id'),
  child('projects.valuation_lines', 'valuation', 'valuation_id'),
  child('projects.qc_comments', 'qc_report', 'report_id'),
  ...['route_history', 'mv_study_settings', 'fault_sources', 'protection_devices', 'cables', 'change_log',
      'fault_results', 'cost_lines', 'discrimination_checks', 'mv_study_signoff', 'supply_routes', 'sources', 'supplies']
    .map((t) => child(`cable_schedule.${t}`, 'revision', 'revision_id')),
  child('cable_schedule.route_segments', 'supply_route', 'route_id'),
  child('cable_schedule.terminations', 'cable', 'cable_id'),
  child('cable_schedule.cable_tags', 'cable', 'cable_id'),
  ...['response_history', 'signatures', 'coc_validations', 'certificates', 'responses', 'photos']
    .map((t) => child(`inspections.${t}`, 'inspection', 'inspection_id')),
  ...['form_photos', 'form_signatures', 'form_responses', 'form_response_history']
    .map((t) => child(`field.${t}`, 'site_form', 'form_id')),
  child('projects.tender_boq_items', 'tender', 'tender_id'),
  child('projects.tender_requirements', 'tender', 'tender_id'),
  child('projects.tender_estimate_lines', 'tender', 'tender_id'),
]
