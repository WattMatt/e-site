// apps/mobile/src/lib/powersync/schema.ts
import { column, Schema, Table } from '@powersync/react-native'

const projects = new Table(
  {
    name: column.text,
    status: column.text,
    city: column.text,
    province: column.text,
    organisation_id: column.text,
  },
  { indexes: { org_idx: ['organisation_id'] } }
)

const snags = new Table(
  {
    title: column.text,
    description: column.text,
    status: column.text,
    priority: column.text,
    project_id: column.text,
    organisation_id: column.text,
    assigned_to: column.text,
    raised_by: column.text,
    created_at: column.text,
  },
  { indexes: { project_idx: ['project_id'], org_idx: ['organisation_id'] } }
)

const snag_photos = new Table(
  {
    snag_id: column.text,
    file_path: column.text,
    caption: column.text,
    photo_type: column.text,
    uploaded_by: column.text,
    created_at: column.text,
  },
  { indexes: { snag_idx: ['snag_id'] } }
)

const templates = new Table(
  {
    organisation_id: column.text,
    name: column.text,
    version: column.integer,
    is_active: column.integer,
    schema_json: column.text,
    sans_part: column.text,
    deliverable_type: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { org_idx: ['organisation_id'] } }
)

const inspections = new Table(
  {
    organisation_id: column.text,
    project_id: column.text,
    template_id: column.text,
    template_version: column.integer,
    target_label: column.text,
    target_node_type: column.text,
    target_node_id: column.text,
    status: column.text,
    coc_number: column.text,
    deliverable_type: column.text,
    assigned_to_id: column.text,
    verifier_id: column.text,
    scheduled_at: column.text,
    started_at: column.text,
    completed_at: column.text,
    certified_at: column.text,
    created_by: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    indexes: {
      org_idx: ['organisation_id'],
      project_idx: ['project_id'],
      assigned_idx: ['assigned_to_id'],
    },
  }
)

const responses = new Table(
  {
    inspection_id: column.text,
    section_id: column.text,
    field_id: column.text,
    value_bool: column.integer,
    value_number: column.real,
    value_text: column.text,
    value_array: column.text,
    value_json: column.text,
    pass_state: column.text,
    fail_reason: column.text,
    latest_responded_by: column.text,
    latest_responded_at: column.text,
  },
  {
    indexes: {
      inspection_idx: ['inspection_id'],
      field_lookup: ['inspection_id', 'section_id', 'field_id'],
    },
  }
)

const inspection_photos = new Table(
  {
    inspection_id: column.text,
    section_id: column.text,
    field_id: column.text,
    storage_path: column.text,
    caption: column.text,
    taken_at: column.text,
    gps_lat: column.real,
    gps_lng: column.real,
    uploaded_by: column.text,
    created_at: column.text,
  },
  { indexes: { inspection_idx: ['inspection_id'] } }
)

export const AppSchema = new Schema({
  projects,
  snags,
  snag_photos,
  templates,
  inspections,
  responses,
  inspection_photos,
})

export type Database = (typeof AppSchema)['types']
