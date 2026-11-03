import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMigrations, allNumericColumns, MASK_NAME, NUMERIC_TYPES } from './mask-candidates'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mask-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
const write = (name: string, sql: string) => writeFileSync(join(dir, name), sql)

describe('readMigrations', () => {
  it('finds numeric columns matching the name pattern, follows add/drop/rename and drop table, and records project_id and organisation_id', () => {
    write('00001_a.sql', `CREATE TABLE projects.a (id uuid, project_id uuid, rate numeric, name text, total_count integer);
      ALTER TABLE projects.a ADD COLUMN unit_price numeric(12,2); ALTER TABLE projects.a DROP COLUMN total_count;
      CREATE TABLE public.b (id uuid, amount integer); DROP TABLE public.b; CREATE TABLE auth.c (amount integer);
      CREATE TABLE d (id uuid, organisation_id uuid, value numeric); ALTER TABLE d RENAME COLUMN value TO reading_value;`)
    const { candidates, tables } = readMigrations(dir)
    expect(candidates).toEqual([
      { schema: 'projects', table: 'a', column: 'rate' }, { schema: 'projects', table: 'a', column: 'unit_price' },
      { schema: 'public', table: 'd', column: 'reading_value' },
    ])
    expect(tables['projects.a']).toEqual({ hasProjectId: true, hasOrganisationId: false })
    expect(tables['public.d']).toEqual({ hasProjectId: false, hasOrganisationId: true })
    expect(tables['public.b']).toBeUndefined()
    expect(tables['auth.c']).toBeUndefined()
  })

  it('ignores text columns and constraint lines', () => {
    write('00001_a.sql', `CREATE TABLE IF NOT EXISTS projects.a (
        id uuid PRIMARY KEY,
        rate text,
        total numeric(10, 2) NOT NULL DEFAULT 0,
        CONSTRAINT total_check CHECK (total >= 0),
        UNIQUE (id, rate),
        CHECK (total < 1000),
        FOREIGN KEY (id) REFERENCES projects.x (id)
      );`)
    const { candidates } = readMigrations(dir)
    expect(candidates).toEqual([{ schema: 'projects', table: 'a', column: 'total' }])
  })

  it('follows a column type change and a table rename, and ignores comments and dollar-quoted bodies', () => {
    write('00001_a.sql', `-- CREATE TABLE projects.ghost (rate numeric);
      CREATE TABLE projects.a (id uuid, rate text, line_total double precision);
      CREATE FUNCTION projects.f() RETURNS void AS $$ BEGIN CREATE TABLE projects.inner_t (rate numeric); END $$ LANGUAGE plpgsql;
      /* ALTER TABLE projects.a DROP COLUMN line_total; */`)
    write('00002_b.sql', `ALTER TABLE projects.a ALTER COLUMN rate TYPE numeric(12,2);
      ALTER TABLE IF EXISTS ONLY projects.a ADD COLUMN IF NOT EXISTS cost_total bigint, ADD COLUMN project_id uuid;
      ALTER TABLE projects.a RENAME TO a2;`)
    const { candidates, tables } = readMigrations(dir)
    expect(candidates).toEqual([
      { schema: 'projects', table: 'a2', column: 'cost_total' },
      { schema: 'projects', table: 'a2', column: 'line_total' },
      { schema: 'projects', table: 'a2', column: 'rate' },
    ])
    expect(tables['projects.a2']).toEqual({ hasProjectId: true, hasOrganisationId: false })
    expect(tables['projects.a']).toBeUndefined()
    expect(tables['projects.inner_t']).toBeUndefined()
    expect(tables['projects.ghost']).toBeUndefined()
  })

  it('reads files in name order, so a later migration wins', () => {
    write('00002_b.sql', `ALTER TABLE projects.a DROP COLUMN rate;`)
    write('00001_a.sql', `CREATE TABLE projects.a (id uuid, rate numeric);`)
    expect(readMigrations(dir).candidates).toEqual([])
  })

  it('handles quoted identifiers and a type written on the next line', () => {
    write('00001_a.sql', `CREATE TABLE projects."a" ("rate" numeric, "name" text, amount
        integer);`)
    expect(readMigrations(dir).candidates).toEqual([
      { schema: 'projects', table: 'a', column: 'amount' }, { schema: 'projects', table: 'a', column: 'rate' },
    ])
  })
})

describe('views', () => {
  it('a view that selects every column of one table has that table\'s columns', () => {
    write('00001_a.sql', `CREATE TABLE public.obs (id uuid, project_id uuid, rate numeric, kind text);
      CREATE VIEW public.obs_active WITH (security_invoker = true) AS
        SELECT o.* FROM public.obs o WHERE o.kind = 'observation' AND NOT EXISTS (SELECT 1 FROM public.obs n WHERE n.id = o.id);
      CREATE VIEW public.other AS SELECT id, rate * 2 AS rate FROM public.obs;`)
    const { candidates, tables } = readMigrations(dir)
    expect(candidates).toEqual([{ schema: 'public', table: 'obs', column: 'rate' }, { schema: 'public', table: 'obs_active', column: 'rate' }])
    expect(tables['public.obs_active']).toEqual({ hasProjectId: true, hasOrganisationId: false })
    expect(tables['public.other']).toBeUndefined()
  })
})

describe('patterns', () => {
  it('MASK_NAME matches whole words between underscores only', () => {
    for (const n of ['rate', 'unit_price', 'total_ex_vat', 'value_to_date', 'retention_pct', 'estimated_unit_cost', 'gross_to_date', 'net_change', 'stated_vat', 'stated_subtotal', 'commission_kobo', 'credit_limit', 'contingency_pct', 'due_incl_vat', 'previous_net', 'payout_kobo', 'markup_pct', 'margin', 'fee_total', 'budget_amount']) expect(MASK_NAME.test(n), n).toBe(true)
    for (const n of ['rated_by', 'valuer', 'totally', 'prices_id', 'name', 'network', 'nett', 'dueling', 'feet', 'limitless', 'vatican']) expect(MASK_NAME.test(n), n).toBe(false)
  })
  it('NUMERIC_TYPES matches numeric types and not text', () => {
    for (const t of ['numeric(12,2)', 'integer', 'int4', 'bigint', 'double precision', 'money', 'DECIMAL(5,2)', 'float4', 'float8', 'int2', 'float']) expect(NUMERIC_TYPES.test(t), t).toBe(true)
    for (const t of ['text', 'interval', 'uuid', 'point']) expect(NUMERIC_TYPES.test(t), t).toBe(false)
  })
})

describe('allNumericColumns', () => {
  it('lists every numeric column of the exposed schemas whatever its name', () => {
    write('00001_a.sql', `CREATE TABLE projects.a (id uuid, sort_order int, rate numeric(10,2), name text, size_mm2 float8);
      CREATE TABLE auth.c (amount integer);`)
    expect(allNumericColumns(dir).map(c => `${c.schema}.${c.table}.${c.column}`)).toEqual([
      'projects.a.rate', 'projects.a.size_mm2', 'projects.a.sort_order',
    ])
  })
})
