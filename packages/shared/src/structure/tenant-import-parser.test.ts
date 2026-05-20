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
