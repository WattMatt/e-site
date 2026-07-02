import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { parseTenantSchedule } from './tenant-import-parser';
import type { TenantImportRow, TenantImportResult } from './tenant-import-parser';

// ---------------------------------------------------------------------------
// Fixture builder — creates an in-memory workbook mirroring the real file
// shape so no binary asset needs to be committed.
// ---------------------------------------------------------------------------

type FixtureRow = [string, string, number | string | null];

async function buildFixtureWorkbook(rows: FixtureRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['SHOP NO.', 'TENANT', 'TOTAL GLA']);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Flexible builder — caller supplies the exact header row and data rows.
 * Used to exercise tolerant header matching and footer-row handling.
 */
async function buildWorkbook(
  header: (string | null)[],
  dataRows: (string | number | null)[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(header);
  for (const r of dataRows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ---------------------------------------------------------------------------
// Baseline fixture — mirrors key rows from the real TENANT SCHEDULE.xlsx
// ---------------------------------------------------------------------------

let baseBuffer: Buffer;

beforeAll(async () => {
  baseBuffer = await buildFixtureWorkbook([
    ['SHOP 1/2', 'BUTCHERY', 1000],      // slash shop number
    ['SHOP 3', 'VACANT', 250],            // VACANT tenant
    ['SHOP 4', 'HUNGRY LION', 185],       // normal row
    ['SHOP 4A', "ATM'S", 16],             // alphanumeric suffix
    ['SHOP 5', 'VACANT', 32],             // another VACANT
    ['SHOP 11', 'GAME', 3100],            // normal
    ['SHOP 11A', 'VACANT', 77],           // alpha suffix + VACANT
    ['SHOP 23/24', 'FASHION', 164],       // double-number slash
    ['SHOP 29 ', 'DISCHEM', 1200],        // trailing space in shop number
    ['SHOP 61/61A', 'SPUR', 285],         // complex slash variant
  ]);
});

// ---------------------------------------------------------------------------
// parseTenantSchedule — happy path
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — happy path', () => {
  it('returns a result with the correct row count', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    expect(result.rows).toHaveLength(10);
    expect(result.errors).toHaveLength(0);
  });

  it('parses a normal row correctly', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    const row = result.rows.find((r) => r.shop_number === 'SHOP 4');
    expect(row).toBeDefined();
    expect(row!.shop_name).toBe('HUNGRY LION');
    expect(row!.shop_area_m2).toBe(185);
    expect(row!.source_row).toBe(4); // header=1, SHOP 1/2=2, SHOP 3=3, SHOP 4=4
  });

  it('handles SHOP 1/2 (slash in shop number)', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    const row = result.rows.find((r) => r.shop_number === 'SHOP 1/2');
    expect(row).toBeDefined();
    expect(row!.shop_area_m2).toBe(1000);
  });

  it('handles SHOP 23/24 (double-number slash)', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    const row = result.rows.find((r) => r.shop_number === 'SHOP 23/24');
    expect(row).toBeDefined();
  });

  it('handles SHOP 61/61A (complex slash variant)', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    const row = result.rows.find((r) => r.shop_number === 'SHOP 61/61A');
    expect(row).toBeDefined();
  });

  it('handles SHOP 4A (alphanumeric suffix)', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    const row = result.rows.find((r) => r.shop_number === 'SHOP 4A');
    expect(row).toBeDefined();
  });

  it('handles SHOP 11A with VACANT tenant', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    const row = result.rows.find((r) => r.shop_number === 'SHOP 11A');
    expect(row).toBeDefined();
    expect(row!.shop_name).toBe('VACANT');
  });

  it('keeps VACANT as the shop_name (not null, not error)', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    const vacantRows = result.rows.filter((r) => r.shop_name === 'VACANT');
    expect(vacantRows.length).toBeGreaterThanOrEqual(3);
    // VACANT rows are valid rows — they appear in result.rows, not result.errors
    for (const vr of vacantRows) {
      expect(vr.shop_number).toBeTruthy();
      expect(vr.shop_area_m2).toBeGreaterThan(0);
    }
  });

  it('trims trailing whitespace from SHOP NO. cell (SHOP 29 )', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    // The fixture has 'SHOP 29 ' with trailing space
    const row = result.rows.find((r) => r.shop_number === 'SHOP 29');
    expect(row).toBeDefined();
    // Should NOT be stored with trailing space
    expect(row!.shop_number).toBe('SHOP 29');
  });

  it('sets source_row to the 1-based row number in the workbook', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    // header=1, first data row=2
    expect(result.rows[0].source_row).toBe(2);
    expect(result.rows[1].source_row).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Validation — missing / invalid SHOP NO.
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — validation errors', () => {
  it('rejects a row with empty SHOP NO.', async () => {
    const buf = await buildFixtureWorkbook([
      ['SHOP 1', 'TENANT A', 100],
      ['', 'TENANT B', 200],
    ]);
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source_row).toBe(3);
    expect(result.errors[0].message).toMatch(/shop no/i);
  });

  it('rejects a row with null SHOP NO. cell', async () => {
    const buf = await buildFixtureWorkbook([
      ['SHOP 1', 'TENANT A', 100],
      [null as any, 'TENANT B', 200],
    ]);
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('rejects a row where TOTAL GLA is non-numeric', async () => {
    const buf = await buildFixtureWorkbook([
      ['SHOP 1', 'TENANT A', 'not-a-number' as any],
    ]);
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/gla|numeric/i);
  });

  it('accepts a row where TOTAL GLA is negative (numeric, no positivity requirement)', async () => {
    const buf = await buildFixtureWorkbook([['SHOP 1', 'TENANT A', -5]]);
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].shop_area_m2).toBe(-5);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a row where TOTAL GLA is zero (numeric, no positivity requirement)', async () => {
    const buf = await buildFixtureWorkbook([['SHOP 1', 'TENANT A', 0]]);
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].shop_area_m2).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects duplicate SHOP NO. within the same file', async () => {
    const buf = await buildFixtureWorkbook([
      ['SHOP 1', 'TENANT A', 100],
      ['SHOP 2', 'TENANT B', 200],
      ['SHOP 1', 'TENANT C', 300], // duplicate
    ]);
    const result = await parseTenantSchedule(buf);
    // First occurrence is valid; duplicate is an error
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/duplicate|unique/i);
  });

  it('treats blank TENANT as null shop_name (not an error)', async () => {
    const buf = await buildFixtureWorkbook([['SHOP 1', '', 100]]);
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].shop_name).toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it('rejects the file when header row is missing expected columns', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['WRONG COL', 'TENANT', 'TOTAL GLA']);
    ws.addRow(['SHOP 1', 'TENANT A', 100]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/header|SHOP NO/i);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: empty / header-only workbook (Fix 2)
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — empty / header-only workbook', () => {
  it('returns empty rows and no errors for a header-only workbook', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['SHOP NO.', 'TENANT', 'TOTAL GLA']); // header only, no data rows
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('returns a clean error result for a workbook with no sheets', async () => {
    // ExcelJS requires at least one sheet, so build one, write it, then test the
    // no-sheet branch indirectly via the corrupt-buffer path which also returns
    // a clean error. To reach the ws===undefined branch we use a genuine empty wb.
    const wb = new ExcelJS.Workbook();
    // Do not add any worksheet — wb.worksheets will be [].
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseTenantSchedule(buf);
    // Either: empty sheet list → clean error, or parse-error → clean error.
    // Either way: no throw, rows empty, at least one error.
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Corrupt buffer (Fix 1 + Fix 4 test)
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — corrupt buffer', () => {
  it('returns a clean error result for a corrupt buffer (not a zip)', async () => {
    const buf = Buffer.from('not a zip');
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source_row).toBe(1);
    expect(result.errors[0].message).toMatch(/readable|xlsx|workbook/i);
  });
});

// ---------------------------------------------------------------------------
// Blank row between data rows (Fix 3)
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — blank row skipping', () => {
  it('parses both data rows when a blank row sits between them, preserving real row numbers', async () => {
    // Build workbook manually so we can insert a genuine blank row at row 3.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['SHOP NO.', 'TENANT', 'TOTAL GLA']); // row 1 — header
    ws.addRow(['SHOP 1', 'BUTCHERY', 100]);           // row 2 — data
    ws.addRow([null, null, null]);                     // row 3 — blank (eachRow skips)
    ws.addRow(['SHOP 2', 'DISCHEM', 200]);             // row 4 — data
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].source_row).toBe(2);
    expect(result.rows[1].source_row).toBe(4); // gap: row 3 was blank, skipped
  });
});

// ---------------------------------------------------------------------------
// Extra columns ignored (Fix 4 test)
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — extra columns', () => {
  it('ignores a 4th column and still parses the 3 known columns correctly', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['SHOP NO.', 'TENANT', 'TOTAL GLA', 'NOTES']); // 4th col in header
    ws.addRow(['SHOP 1', 'WOOLWORTHS', 500, 'anchor tenant']); // 4th col in data
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].shop_number).toBe('SHOP 1');
    expect(result.rows[0].shop_name).toBe('WOOLWORTHS');
    expect(result.rows[0].shop_area_m2).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

describe('TenantImportRow shape', () => {
  it('has all required fields on a valid row', async () => {
    const buf = await buildFixtureWorkbook([['SHOP 7', 'SHOPRITE', 2000]]);
    const { rows } = await parseTenantSchedule(buf);
    const row = rows[0];
    // Required fields
    expect(typeof row.source_row).toBe('number');
    expect(typeof row.shop_number).toBe('string');
    expect(typeof row.shop_area_m2).toBe('number');
    // shop_name may be string or null
    expect(row.shop_name === null || typeof row.shop_name === 'string').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tolerant header matching — real-file header wording
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — tolerant header matching', () => {
  it('parses the real KINGSWALK headers ("SHOP NO." / "Shop name" / "Area (m²)")', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'Shop name', 'Area (m²)'],
      [
        ['01', 'VACANT', 131.66],
        ['01A', 'WATLOO BUTCHERY', 802.34],
        ['K01', 'KIOSK', 15.9],
      ],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({ shop_number: '01', shop_name: 'VACANT', shop_area_m2: 131.66 });
    expect(result.rows[1]).toMatchObject({
      shop_number: '01A',
      shop_name: 'WATLOO BUTCHERY',
      shop_area_m2: 802.34,
    });
  });

  it('matches headers case-insensitively', async () => {
    const buf = await buildWorkbook(['shop no.', 'tenant', 'gla'], [['1', 'BOXER', 1809.27]]);
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
  });

  it('matches an ASCII "Area (m2)" header (no superscript)', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'Shop name', 'Area (m2)'],
      [['1', 'PEP', 501.52]],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].shop_area_m2).toBe(501.52);
  });

  it('resolves columns by header, not by position (reordered columns)', async () => {
    const buf = await buildWorkbook(
      ['Area (m²)', 'SHOP NO.', 'Shop name'],
      [[250, '03', 'MAX BOX']],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      shop_number: '03',
      shop_name: 'MAX BOX',
      shop_area_m2: 250,
    });
  });

  it('parses colon-suffixed headers ("SHOP NO:" / "SHOP NAME:" / "AREA:")', async () => {
    // Real client file (2026-06-11): label-style headers with trailing colons.
    const buf = await buildWorkbook(
      ['SHOP NO:', 'SHOP NAME:', 'AREA:'],
      [
        ['01', 'VACANT', 131.66],
        ['02', 'SLEEPMASTERS', 150.49],
      ],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      shop_number: '01',
      shop_name: 'VACANT',
      shop_area_m2: 131.66,
    });
  });

  it('parses a unit annotation followed by a colon ("AREA (m²):")', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO:', 'SHOP NAME:', 'AREA (m²):'],
      [['1', 'PEP', 501.52]],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].shop_area_m2).toBe(501.52);
  });

  it('still accepts the legacy "TENANT" / "TOTAL GLA" wording', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'TENANT', 'TOTAL GLA'],
      [['1', 'WOOLWORTHS', 577.4]],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
  });

  it('errors with a clear message when the area column is absent', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'Shop name', 'NOTES'],
      [['1', 'CLICKS', 'anchor']],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source_row).toBe(1);
    expect(result.errors[0].message).toMatch(/area|gla/i);
  });
});

// ---------------------------------------------------------------------------
// Trailing total / separator rows
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — trailing total / separator rows', () => {
  it('skips a "TOTAL GLA" footer row (blank shop no. + blank area) silently', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'Shop name', 'Area (m²)'],
      [
        ['01', 'VACANT', 131.66],
        ['02', 'SLEEPMASTERS', 150.49],
        [null, 'TOTAL GLA', null], // footer row — must be skipped, not an error
      ],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
  });

  it('skips a footer row whose area is a SUM formula (real KINGSWALK shape)', async () => {
    // Mirrors the real file's row 109: [blank, "TOTAL GLA", =SUM(C2:C3)].
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['SHOP NO.', 'Shop name', 'Area (m²)']);
    ws.addRow(['01', 'VACANT', 131.66]);
    ws.addRow(['02', 'SLEEPMASTERS', 150.49]);
    ws.addRow([null, 'TOTAL GLA', { formula: 'SUM(C2:C3)', result: 282.15 }]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
  });

  it('still errors on a row with a blank SHOP NO. but a present (literal) area', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'Shop name', 'Area (m²)'],
      [
        ['01', 'VACANT', 131.66],
        [null, 'MYSTERY TENANT', 200], // real mistake — literal area present, shop no. missing
      ],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source_row).toBe(3);
    expect(result.errors[0].message).toMatch(/shop no/i);
  });

  it('skips a labelled "TOTAL" summary row (shop no. filled in, literal area) — the ITONKA case', async () => {
    // The real ITONKA file ended with a grand-total line whose SHOP NO. cell was
    // filled in as "TOTAL" (tenant "TOTAL", area = Σ of all shops). The blank-
    // shop-number guard didn't catch it, so it imported as a phantom tenant whose
    // area double-counted the whole schedule (report showed 2× the real GLA).
    const buf = await buildWorkbook(
      ['SHOP NO.', 'Shop name', 'Area (m²)'],
      [
        ['01', 'VACANT', 131.66],
        ['02', 'SLEEPMASTERS', 150.49],
        ['TOTAL', 'TOTAL', 282.15], // labelled grand-total — must be skipped, not imported
      ],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((r) => r.shop_number === 'TOTAL')).toBeUndefined();
  });

  it('skips SUBTOTAL / GRAND TOTAL labelled summary rows too', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'Shop name', 'Area (m²)'],
      [
        ['01', 'VACANT', 131.66],
        ['SUBTOTAL', '', 131.66],
        ['GRAND TOTAL', 'TOTAL', 263.32],
      ],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].shop_number).toBe('01');
  });

  it('does NOT skip a real shop whose tenant name merely contains "total"', async () => {
    // The skip keys on the SHOP NO. column only — a real shop with a tenant like
    // "TOTALSPORTS" must still import.
    const buf = await buildWorkbook(
      ['SHOP NO.', 'Shop name', 'Area (m²)'],
      [['S12', 'TOTALSPORTS', 450]],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ shop_number: 'S12', shop_name: 'TOTALSPORTS', shop_area_m2: 450 });
  });
});

// ---------------------------------------------------------------------------
// Blank area — pending-area import (PNP FAERIE GLEN shop 23 / PEP HOME case)
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — blank area (pending)', () => {
  it('imports a row whose area cell is blank with shop_area_m2 null + a warning', async () => {
    // Real case: 2026.06.26 PNP FAERIE GLEN schedule row 26 — shop 23 PEP HOME
    // has no AREA yet (GLA not finalised). The tenant exists; dropping the whole
    // row loses the entry. It must import with a pending (null) area instead.
    const buf = await buildFixtureWorkbook([
      ['SHOP 22', 'BEAUTY SERVICES', 141],
      ['SHOP 23', 'PEP HOME', null], // area not yet known — import, don't drop
      ['SHOP 24', 'LINE SHOP', 172],
    ]);
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(3);
    const pep = result.rows.find((r) => r.shop_number === 'SHOP 23');
    expect(pep).toBeDefined();
    expect(pep!.shop_area_m2).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].source_row).toBe(3);
    expect(result.warnings[0].message).toMatch(/blank|no area/i);
  });

  it('treats a whitespace-only area cell as blank (warning, not error)', async () => {
    const buf = await buildFixtureWorkbook([['SHOP 23', 'PEP HOME', '   ']]);
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].shop_area_m2).toBeNull();
    expect(result.warnings).toHaveLength(1);
  });

  it('still rejects a non-blank, non-numeric area (e.g. "TBC")', async () => {
    const buf = await buildFixtureWorkbook([['SHOP 23', 'PEP HOME', 'TBC']]);
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/numeric/i);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns an empty warnings array on a fully-clean file', async () => {
    const result = await parseTenantSchedule(baseBuffer);
    expect(result.warnings).toEqual([]);
  });

  it('does not warn for skipped footer/summary rows (blank area there is expected)', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'Shop name', 'Area (m²)'],
      [
        ['01', 'VACANT', 131.66],
        [null, 'TOTAL GLA', null], // footer — silent skip, no warning
      ],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Duplicate SHOP NO. across mall sections (PNP FAERIE GLEN restaurant deck)
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — duplicate shop numbers across sections', () => {
  it('explains the section-prefix remedy in the duplicate error message', async () => {
    // Real case: the Faerie Glen schedule's restaurant deck restarts numbering
    // at 1–19 (its own "R1A & R1B" / "R7A" rows show the section is really
    // R-prefixed), colliding with main-mall shops 1–19. The error must tell the
    // user how to fix the file, not just that a duplicate exists.
    const buf = await buildFixtureWorkbook([
      ['1', 'LINE SHOP', 221], // main mall
      ['2', 'LINE SHOP', 120],
      ['1', 'LUPA', 295], // restaurant deck — really R1
      ['2', 'NIGHT TRADE', 347], // really R2
    ]);
    const result = await parseTenantSchedule(buf);
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
    for (const err of result.errors) {
      expect(err.message).toMatch(/duplicate/i);
      expect(err.message).toMatch(/section/i);
      expect(err.message).toMatch(/"R1"/);
    }
  });
});

// ---------------------------------------------------------------------------
// shop_category column parsing
// ---------------------------------------------------------------------------

describe('parseTenantSchedule — shop_category column', () => {
  it('parses a "Category" column and coerces values to enum', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'TENANT', 'TOTAL GLA', 'Category'],
      [
        ['S001', 'PnP', 500, 'national'],
        ['S002', 'Steers', 120, 'fast_food'],
        ['S003', 'Spur', 200, 'fast food'],  // alias
        ['S004', 'Checkers', 400, 'standard'],
        ['S005', 'Nandos', 180, 'restaurant'],
        ['S006', 'Other Co', 90, 'other'],
      ],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(6);
    expect(result.rows.find((r) => r.shop_number === 'S001')!.shop_category).toBe('national');
    expect(result.rows.find((r) => r.shop_number === 'S002')!.shop_category).toBe('fast_food');
    expect(result.rows.find((r) => r.shop_number === 'S003')!.shop_category).toBe('fast_food');
    expect(result.rows.find((r) => r.shop_number === 'S004')!.shop_category).toBe('standard');
    expect(result.rows.find((r) => r.shop_number === 'S005')!.shop_category).toBe('restaurant');
    expect(result.rows.find((r) => r.shop_number === 'S006')!.shop_category).toBe('other');
  });

  it('coerces an unknown category value to null', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'TENANT', 'TOTAL GLA', 'Category'],
      [['S001', 'Woolworths', 300, 'supermarket']],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].shop_category).toBeNull();
  });

  it('sets shop_category to null when the category cell is blank', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'TENANT', 'TOTAL GLA', 'Category'],
      [['S001', 'Woolworths', 300, null]],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].shop_category).toBeNull();
  });

  it('sets shop_category to null when no Category column is present in the file', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'TENANT', 'TOTAL GLA'],
      [['S001', 'Woolworths', 300]],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].shop_category).toBeNull();
  });

  it('recognises "Tenant Type" as a category column header alias', async () => {
    const buf = await buildWorkbook(
      ['SHOP NO.', 'TENANT', 'TOTAL GLA', 'Tenant Type'],
      [['S001', 'PnP', 500, 'national']],
    );
    const result = await parseTenantSchedule(buf);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].shop_category).toBe('national');
  });
});
