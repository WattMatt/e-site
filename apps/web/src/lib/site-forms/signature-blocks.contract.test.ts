import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  SITE_FORM_SIGNATURE_BLOCKS,
  SITE_FORM_SIGNATURE_FIELD_BLOCKS,
} from '@esite/shared'
// Relative, not a deep package import: @esite/shared does not expose the
// templates directory through its exports map. Matches template-seed.contract.
import template from '../../../../../packages/shared/src/site-forms/templates/termination-and-making-safe.json'

/**
 * The set of signature blocks is declared in four places: the DB CHECK, the
 * shared constant, the PDF renderer's sort order, and the template's own
 * signature fields. They must agree.
 *
 * This mirrors the snag `photo_type` contract test, which caught a live bug
 * where app code wrote a literal that had never been a legal CHECK value —
 * every insert failed after its storage upload had already succeeded.
 *
 * The specific failures guarded here:
 *  - a block in the DB but not in the PDF order sorts to indexOf -1 and jumps
 *    ahead of the electrician's declaration, labelled with a raw token;
 *  - a template signature field with no block mapping is captured nowhere;
 *  - two fields mapped to one block silently overwrite each other, because
 *    form_signatures is UNIQUE (form_id, block_id).
 */

function repoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'apps/edge-functions/supabase/migrations'))) return dir
    dir = dirname(dir)
  }
  throw new Error('Could not locate the repo root from ' + process.cwd())
}

const ROOT = repoRoot()

/** Strip SQL comments so a token inside a comment cannot satisfy a match. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, '')
}

function dbBlockIds(): string[] {
  const sql = stripSqlComments(
    readFileSync(join(ROOT, 'apps/edge-functions/supabase/migrations/00179_site_forms.sql'), 'utf8'),
  )
  const m = sql.match(/block_id\s+TEXT\s+NOT\s+NULL\s*CHECK\s*\(\s*block_id\s+IN\s*\(([\s\S]*?)\)\s*\)/i)
  if (!m) throw new Error('Could not find the block_id CHECK in migration 00179')
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
}

function pdfBlockOrder(): string[] {
  const src = readFileSync(join(ROOT, 'apps/web/src/lib/reports/site-form-report-data.ts'), 'utf8')
  const m = src.match(/SIGNATURE_BLOCK_ORDER\s*=\s*\[([\s\S]*?)\]/)
  if (!m) throw new Error('Could not find SIGNATURE_BLOCK_ORDER in the report gatherer')
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
}

function pdfBlockLabels(): string[] {
  const src = readFileSync(join(ROOT, 'apps/web/src/lib/reports/site-form-report-data.ts'), 'utf8')
  const m = src.match(/SIGNATURE_BLOCK_LABELS[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!m) throw new Error('Could not find SIGNATURE_BLOCK_LABELS in the report gatherer')
  return [...m[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((x) => x[1]).sort()
}

function templateSignatureFieldIds(): string[] {
  const ids: string[] = []
  for (const s of (template as { sections: { fields?: { field_id: string; type: string }[] }[] })
    .sections) {
    for (const f of s.fields ?? []) if (f.type === 'signature') ids.push(f.field_id)
  }
  return ids.sort()
}

describe('signature block contract', () => {
  it('the shared constant matches the database CHECK exactly', () => {
    expect([...SITE_FORM_SIGNATURE_BLOCKS].sort()).toEqual(dbBlockIds())
  })

  it('the PDF sort order covers every block in the CHECK', () => {
    // An uncovered block sorts to indexOf -1, i.e. ahead of everything.
    expect([...pdfBlockOrder()].sort()).toEqual(dbBlockIds())
  })

  it('the PDF has a human label for every block', () => {
    expect(pdfBlockLabels()).toEqual(dbBlockIds())
  })

  it('every template signature field maps to a block', () => {
    const unmapped = templateSignatureFieldIds().filter(
      (id) => !(id in SITE_FORM_SIGNATURE_FIELD_BLOCKS),
    )
    expect(unmapped).toEqual([])
  })

  it('maps every signature field to a DISTINCT block', () => {
    // form_signatures is UNIQUE (form_id, block_id): two fields sharing a block
    // means the second signatory silently overwrites the first.
    const blocks = Object.values(SITE_FORM_SIGNATURE_FIELD_BLOCKS)
    expect(blocks.length).toBe(new Set(blocks).size)
  })

  it('maps only to blocks the CHECK permits', () => {
    const allowed = new Set(dbBlockIds())
    const bad = Object.entries(SITE_FORM_SIGNATURE_FIELD_BLOCKS)
      .filter(([, block]) => !allowed.has(block))
      .map(([field, block]) => `${field} -> ${block}`)
    expect(bad).toEqual([])
  })

  it('has a block for every signature the template declares, and no orphans', () => {
    expect(Object.keys(SITE_FORM_SIGNATURE_FIELD_BLOCKS).sort()).toEqual(
      templateSignatureFieldIds(),
    )
  })
})
