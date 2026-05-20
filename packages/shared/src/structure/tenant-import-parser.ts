/**
 * Tenant Schedule Excel parser.
 *
 * Fixed-format: one sheet, header row 1, exactly three columns:
 *   SHOP NO. | TENANT | TOTAL GLA
 *
 * Pipeline:
 *   1. Load workbook from Buffer.
 *   2. Locate the first sheet and verify the header row.
 *   3. Parse each data row into a TenantImportRow, collecting errors inline.
 *   4. Deduplicate check: duplicate SHOP NO. within the file is an error.
 *   5. Return TenantImportResult — valid rows + per-row errors.
 *
 * Pure function: no DB, no network, no React.
 */

import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A successfully parsed data row from the tenant schedule workbook. */
export interface TenantImportRow {
  /** 1-based row number in the source workbook (including header row 1). */
  source_row: number;
  /** Raw shop identifier from the `SHOP NO.` column (trimmed). */
  shop_number: string;
  /** Auto-derived DB code: strip leading "SHOP " (case-insensitive), prefix "DB-". */
  derived_code: string;
  /** Tenant name from the `TENANT` column; `null` when blank; `"VACANT"` when explicitly so. */
  shop_name: string | null;
  /** Gross Lettable Area in m² from the `TOTAL GLA` column (positive number). */
  shop_area_m2: number;
}

/** A per-row parse or validation error. */
export interface TenantImportError {
  /** 1-based row number in the source workbook. */
  source_row: number;
  /** Human-readable description of the problem. */
  message: string;
}

/** The result returned by {@link parseTenantSchedule}. */
export interface TenantImportResult {
  /** All valid, deduplicated rows ready for preview/commit. */
  rows: TenantImportRow[];
  /** One entry per row that failed validation, including duplicates. */
  errors: TenantImportError[];
}

// ---------------------------------------------------------------------------
// Header constants — exact strings from the real file
// ---------------------------------------------------------------------------

const EXPECTED_HEADERS = ['SHOP NO.', 'TENANT', 'TOTAL GLA'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip leading "SHOP " (case-insensitive) and trim; prefix "DB-". */
function deriveCode(shopNumber: string): string {
  const stripped = shopNumber.replace(/^shop\s+/i, '').trim();
  return `DB-${stripped}`;
}

/** Coerce an exceljs cell value to a trimmed string, or null if empty. */
function cellToString(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && 'richText' in (value as object)) {
    // RichText cell
    const richText = (value as ExcelJS.CellRichTextValue).richText;
    const text = richText.map((r) => r.text).join('').trim();
    return text.length > 0 ? text : null;
  }
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Coerce an exceljs cell value to a number, or null if not parseable. */
function cellToNumber(value: ExcelJS.CellValue): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const n = Number(String(value).trim());
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse a fixed-format tenant schedule `.xlsx` from a Buffer.
 *
 * @param buffer - Raw bytes of the `.xlsx` file.
 * @returns {@link TenantImportResult} — valid rows + per-row errors.
 */
export async function parseTenantSchedule(buffer: Buffer): Promise<TenantImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const rows: TenantImportRow[] = [];
  const errors: TenantImportError[] = [];

  const ws = wb.worksheets[0];
  if (!ws) {
    errors.push({ source_row: 1, message: 'Workbook contains no sheets.' });
    return { rows, errors };
  }

  // -------------------------------------------------------------------------
  // 1. Verify header row
  // -------------------------------------------------------------------------

  const headerRow = ws.getRow(1);
  const h1 = cellToString(headerRow.getCell(1).value);
  const h2 = cellToString(headerRow.getCell(2).value);
  const h3 = cellToString(headerRow.getCell(3).value);

  if (h1 !== EXPECTED_HEADERS[0] || h2 !== EXPECTED_HEADERS[1] || h3 !== EXPECTED_HEADERS[2]) {
    errors.push({
      source_row: 1,
      message:
        `Expected header row to be ["SHOP NO.", "TENANT", "TOTAL GLA"] but got ` +
        `[${JSON.stringify(h1)}, ${JSON.stringify(h2)}, ${JSON.stringify(h3)}].`,
    });
    return { rows, errors };
  }

  // -------------------------------------------------------------------------
  // 2. Parse data rows
  // -------------------------------------------------------------------------

  const seenShopNumbers = new Map<string, number>(); // shop_number → first source_row

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const rawShopNo = row.getCell(1).value;
    const rawTenant = row.getCell(2).value;
    const rawGla = row.getCell(3).value;

    // --- SHOP NO. ---
    const shopNumberStr = cellToString(rawShopNo);
    if (!shopNumberStr) {
      errors.push({
        source_row: rowNumber,
        message: `Row ${rowNumber}: SHOP NO. is required and must not be blank.`,
      });
      return;
    }
    const shop_number = shopNumberStr; // already trimmed by cellToString

    // --- Duplicate check ---
    const existingRow = seenShopNumbers.get(shop_number);
    if (existingRow !== undefined) {
      errors.push({
        source_row: rowNumber,
        message:
          `Row ${rowNumber}: duplicate SHOP NO. "${shop_number}" (first seen on row ${existingRow}). ` +
          `SHOP NO. must be unique within the file.`,
      });
      return;
    }
    seenShopNumbers.set(shop_number, rowNumber);

    // --- TOTAL GLA ---
    const gla = cellToNumber(rawGla);
    if (gla === null) {
      errors.push({
        source_row: rowNumber,
        message: `Row ${rowNumber}: TOTAL GLA must be numeric but got ${JSON.stringify(rawGla)}.`,
      });
      return;
    }
    if (gla <= 0) {
      errors.push({
        source_row: rowNumber,
        message: `Row ${rowNumber}: TOTAL GLA must be a positive number (got ${gla}).`,
      });
      return;
    }

    // --- TENANT (blank → null; "VACANT" → kept as-is) ---
    const tenantStr = cellToString(rawTenant);
    const shop_name = tenantStr && tenantStr.length > 0 ? tenantStr : null;

    // --- Derived code ---
    const derived_code = deriveCode(shop_number);

    rows.push({
      source_row: rowNumber,
      shop_number,
      derived_code,
      shop_name,
      shop_area_m2: gla,
    });
  });

  return { rows, errors };
}
