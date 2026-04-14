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
    created_by: column.text,
    created_at: column.text,
  },
  { indexes: { project_idx: ['project_id'], org_idx: ['organisation_id'] } }
)

const snag_photos = new Table(
  {
    snag_id: column.text,
    storage_path: column.text,
    organisation_id: column.text,
    created_at: column.text,
  },
  { indexes: { snag_idx: ['snag_id'] } }
)

export const AppSchema = new Schema({ projects, snags, snag_photos })

export type Database = (typeof AppSchema)['types']
