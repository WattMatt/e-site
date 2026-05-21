/**
 * Tenant Schedule Excel parser.
 *
 * The tenant schedule is a fixed-format `.xlsx` — one sheet, a header row at
 * row 1, and three logical columns: a shop number, a tenant/shop name, and a
 * gross-lettable-area figure.
 *
 * The exact header *wording* varies between real WM files: the KINGSWALK
 * schedule uses `SHOP NO.` / `Shop name` / `Area (m²)`, while earlier
 * schedules (and this module's first draft) assumed `SHOP NO.` / `TENANT` /
 * `TOTAL GLA`. The header is therefore matched **tolerantly** — case-
 * insensitive, whitespace-normalised, unit-suffix-agnostic, column-order
 * independent — against a set of known aliases per column. There is
 * deliberately no column-mapping UI; the parser just recognises the known
 * header variants.
 *
 * Pipeline:
 *   1. Load workbook from Buffer.
 *   2. Resolve the three column indices from the header row (row 1).
 *   3. Parse each data row into a TenantImportRow, collecting errors inline.
 *      A trailing totals / separator row (no shop number AND no area) is
 *      skipped silently — real schedules end with a `TOTAL GLA` footer.
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
  /** Tenant name from the tenant-name column; `null` when blank; `"VACANT"` when explicitly so. */
  shop_name: string | null;
  /** Gross Lettable Area in m² from the area column. */
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
// Cell coercion helpers
// ---------------------------------------------------------------------------

/** Coerce an exceljs cell value to a trimmed string, or null if empty. */
function cellToString(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // RichText cell — concatenate the runs.
    if ('richText' in value) {
      const text = (value as ExcelJS.CellRichTextValue).richText
        .map((r) => r.text)
        .join('')
        .trim();
      return text.length > 0 ? text : null;
    }
    // Formula cell — fall back to the cached computed result.
    if ('result' in value) {
      return cellToString((value as { result?: ExcelJS.CellValue }).result ?? null);
    }
    // Hyperlink cell — use the display text.
    if ('text' in value) {
      const t = String((value as ExcelJS.CellHyperlinkValue).text ?? '').trim();
      return t.length > 0 ? t : null;
    }
    // Error cell (#REF!, #DIV/0!, …) — treat as empty.
    return null;
  }
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Coerce an exceljs cell value to a number, or null if not parseable. */
function cellToNumber(value: ExcelJS.CellValue): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean' || value instanceof Date) return null;
  if (typeof value === 'object') {
    // Formula cell — fall back to the cached computed result.
    if ('result' in value) {
      return cellToNumber((value as { result?: ExcelJS.CellValue }).result ?? null);
    }
    // RichText / hyperlink — parse via the string form.
    const s = cellToString(value);
    if (s === null) return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  }
  const n = Number(String(value).trim());
  return Number.isNaN(n) ? null : n;
}

/** True when the raw cell holds an Excel formula (e.g. a `=SUM(...)` total). */
function isFormulaCell(value: ExcelJS.CellValue): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('formula' in value || 'sharedFormula' in value)
  );
}

// ---------------------------------------------------------------------------
// Header matching — tolerant column resolution
// ---------------------------------------------------------------------------

/**
 * Normalise a header cell for tolerant matching: lowercase, fold the `²`/`³`
 * superscripts, collapse whitespace, drop a trailing `(…)` unit annotation
 * (so `Area (m²)` → `area`), and drop trailing dots (so `SHOP NO.` → `shop no`).
 */
function normaliseHeader(value: ExcelJS.CellValue): string {
  const raw = cellToString(value);
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\s+/g, ' ')
    .replace(/\s*\([^)]*\)\s*$/, '') // strip a trailing "(...)" unit annotation
    .replace(/[.\s]+$/, '') // strip trailing dots / whitespace
    .trim();
}

/** Known header aliases per logical column (compared against {@link normaliseHeader} output). */
const SHOP_NUMBER_ALIASES = new Set([
  'shop no',
  'shop number',
  'shop',
  'shop #',
  'shopno',
  'unit',
  'unit no',
  'unit number',
  'bay',
  'bay no',
]);
const SHOP_NAME_ALIASES = new Set([
  'tenant',
  'tenant name',
  'shop name',
  'shopname',
  'name',
  'trading name',
]);
const SHOP_AREA_ALIASES = new Set([
  'total gla',
  'gla',
  'area',
  'total area',
  'gla total',
  'extent',
]);

/** Resolved 1-based column indices for the three logical columns. */
interface ColumnMap {
  shopNo: number;
  shopName: number;
  area: number;
}

/**
 * Resolve the three column indices from the header row. On success returns
 * `{ columns }`; on failure returns `{ missing, foundHeaders }` describing
 * which logical columns could not be matched and what row 1 actually held.
 */
function resolveColumns(
  headerRow: ExcelJS.Row,
): { columns: ColumnMap } | { missing: string[]; foundHeaders: string[] } {
  let shopNo = -1;
  let shopName = -1;
  let area = -1;
  const foundHeaders: string[] = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const raw = cellToString(cell.value);
    if (raw) foundHeaders.push(raw);
    const norm = normaliseHeader(cell.value);
    if (!norm) return;
    if (shopNo === -1 && SHOP_NUMBER_ALIASES.has(norm)) {
      shopNo = colNumber;
    } else if (shopName === -1 && SHOP_NAME_ALIASES.has(norm)) {
      shopName = colNumber;
    } else if (area === -1 && SHOP_AREA_ALIASES.has(norm)) {
      area = colNumber;
    }
  });

  const missing: string[] = [];
  if (shopNo === -1) missing.push('a shop-number column (e.g. "SHOP NO.")');
  if (shopName === -1) missing.push('a tenant-name column (e.g. "Shop name" or "TENANT")');
  if (area === -1) missing.push('an area column (e.g. "Area (m²)" or "TOTAL GLA")');

  if (missing.length > 0) return { missing, foundHeaders };
  return { columns: { shopNo, shopName, area } };
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
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return {
      rows: [],
      errors: [{ source_row: 1, message: 'File is not a readable .xlsx workbook.' }],
    };
  }

  const rows: TenantImportRow[] = [];
  const errors: TenantImportError[] = [];

  const ws = wb.worksheets[0];
  if (!ws) {
    errors.push({ source_row: 1, message: 'Workbook contains no sheets.' });
    return { rows, errors };
  }

  // -------------------------------------------------------------------------
  // 1. Resolve the three columns from the header row (row 1)
  // -------------------------------------------------------------------------

  const resolved = resolveColumns(ws.getRow(1));
  if ('missing' in resolved) {
    const headerList = resolved.foundHeaders.length
      ? resolved.foundHeaders.map((h) => JSON.stringify(h)).join(', ')
      : '(no header cells found)';
    errors.push({
      source_row: 1,
      message:
        `Could not recognise the tenant-schedule header row. Missing: ${resolved.missing.join('; ')}. ` +
        `Row 1 contained: ${headerList}. The file needs a header row 1 with a shop-number column, ` +
        `a tenant-name column, and an area/GLA column (column order and exact wording are flexible).`,
    });
    return { rows, errors };
  }
  const col = resolved.columns;

  // -------------------------------------------------------------------------
  // 2. Parse data rows
  // -------------------------------------------------------------------------

  const seenShopNumbers = new Map<string, number>(); // shop_number → first source_row

  // eachRow skips fully-blank rows by default, so source_row numbers may have
  // gaps when the sheet contains blank rows between data rows — expected.
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const rawShopNo = row.getCell(col.shopNo).value;
    const rawTenant = row.getCell(col.shopName).value;
    const rawGla = row.getCell(col.area).value;

    const shopNumberStr = cellToString(rawShopNo);
    const gla = cellToNumber(rawGla);

    // --- Non-data row: a totals / separator / section row. It has no shop
    //     number, and its area cell is empty or a formula — never a literal
    //     typed-in area. The real KINGSWALK schedule ends with a
    //     [blank, "TOTAL GLA", =SUM(C2:C108)] footer. Skip it silently.
    //     A blank-shop-number row with a *literal* area is treated as a real
    //     data-entry mistake below (errored, not skipped).
    if (!shopNumberStr && (gla === null || isFormulaCell(rawGla))) {
      return;
    }

    // --- SHOP NO. required. A row that carries an area but no shop number is
    //     a genuine data-entry mistake — surface it as an error.
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

    // --- Area / TOTAL GLA ---
    if (gla === null) {
      errors.push({
        source_row: rowNumber,
        message: `Row ${rowNumber}: area / TOTAL GLA must be numeric but got ${JSON.stringify(rawGla)}.`,
      });
      return;
    }

    // --- Tenant name (blank → null; "VACANT" → kept as-is) ---
    const shop_name = cellToString(rawTenant);

    rows.push({
      source_row: rowNumber,
      shop_number,
      shop_name,
      shop_area_m2: gla,
    });
  });

  return { rows, errors };
}
