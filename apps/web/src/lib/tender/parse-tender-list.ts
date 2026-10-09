import ExcelJS from 'exceljs'

/**
 * Parse WM's SUB-CONTRACTORS TENDER LIST.xlsx.
 *
 * Trade sheets (ELECTRICAL, GENERATOR, MINI_SUB, …) list COMPANY NAME | CONTACT
 * PERSON | CELL | EMAIL; a row with a blank company adds a contact to the company
 * above. The per-project TENDER LIST sheet numbers the bidders chosen for this
 * tender. Email cells are messy (several addresses, "Name <a@b>", quotes, a stray
 * '>'), so addresses are extracted and validated; anything unusable is reported,
 * never guessed — an invitation must reach the person it names.
 */

export interface TenderListContact {
  name: string | null
  phone: string | null
  emails: string[]
}
export interface TenderListCompany {
  companyName: string
  row: number
  contacts: TenderListContact[]
}
export interface TenderListTrade {
  trade: string
  companies: TenderListCompany[]
}
export interface SelectedBidder {
  number: number
  companyName: string
  contactName: string | null
  phone: string | null
  emails: string[]
}
export interface TenderListProblem {
  sheet: string
  row: number
  company: string
  problem: string
}
export interface ParsedTenderList {
  trades: TenderListTrade[]
  selected: SelectedBidder[]
  problems: TenderListProblem[]
}

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

export function splitEmails(raw: string | null | undefined): { valid: string[]; invalid: string[] } {
  if (!raw) return { valid: [], invalid: [] }
  const valid: string[] = []
  const invalid: string[] = []
  // An address with a space inside the domain ("x@energy .co.za") is not two tokens.
  const brokenSpace = /\S+@\S*\s+\.\S+/g
  let text = raw
  for (const m of raw.match(brokenSpace) ?? []) {
    invalid.push(m.trim())
    text = text.replace(m, ' ')
  }
  const tokens = text
    .replace(/[<>"]/g, ' ')
    .split(/[\s,;/]+/)
    .map((t) => t.replace(/^'+|'+$/g, '').trim().toLowerCase())
    .filter((t) => t.includes('@'))
  for (const t of tokens) {
    if (EMAIL_RE.test(t)) {
      if (!valid.includes(t)) valid.push(t)
    } else invalid.push(t)
  }
  return { valid, invalid }
}

const text = (v: ExcelJS.CellValue | undefined): string => {
  if (v == null) return ''
  if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text ?? '').trim()
  if (typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '').trim()
  if (typeof v === 'object' && 'richText' in (v as object))
    return ((v as { richText: { text: string }[] }).richText ?? []).map((r) => r.text).join('').trim()
  return String(v).trim()
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

function headerColumns(ws: ExcelJS.Worksheet): { row: number; company: number; contact: number; cell: number; email: number } | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const row = ws.getRow(r)
    let company = -1, contact = -1, cell = -1, email = -1
    for (let c = 1; c <= row.cellCount; c++) {
      const h = text(row.getCell(c).value).toUpperCase()
      if (h === 'COMPANY NAME') company = c
      else if (h === 'CONTACT PERSON') contact = c
      else if (h === 'CELL' || h === 'TEL' || h === 'PHONE') cell = c
      else if (h === 'EMAIL' || h === 'E-MAIL') email = c
    }
    if (company > 0 && email > 0) return { row: r, company, contact, cell, email }
  }
  return null
}

export async function parseTenderList(buffer: Buffer | Uint8Array): Promise<ParsedTenderList> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  const trades: TenderListTrade[] = []
  const selected: SelectedBidder[] = []
  const problems: TenderListProblem[] = []

  for (const ws of wb.worksheets) {
    const h = headerColumns(ws)
    if (!h) continue
    const isSelection = /TENDER\s*LIST/i.test(ws.name)
    const companies: TenderListCompany[] = []
    for (let r = h.row + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const company = clean(text(row.getCell(h.company).value))
      const contactName = h.contact > 0 ? clean(text(row.getCell(h.contact).value)) || null : null
      const phone = h.cell > 0 ? clean(text(row.getCell(h.cell).value)) || null : null
      const emailRaw = text(row.getCell(h.email).value)
      const { valid, invalid } = splitEmails(emailRaw)

      if (isSelection) {
        const n = Number(text(row.getCell(1).value))
        if (!company || !Number.isInteger(n) || n <= 0) continue
        selected.push({ number: n, companyName: company, contactName, phone, emails: valid })
        if (valid.length === 0) problems.push({ sheet: ws.name, row: r, company, problem: invalid.length ? `invalid email "${invalid[0]}"` : 'no email address' })
        continue
      }

      if (!company && !contactName && !emailRaw) continue
      const contact = { name: contactName, phone, emails: valid }
      if (company) {
        companies.push({ companyName: company, row: r, contacts: [contact] })
      } else if (companies.length) {
        companies[companies.length - 1].contacts.push(contact)
      } else continue
      if (invalid.length) {
        problems.push({ sheet: ws.name, row: r, company: company || companies[companies.length - 1].companyName, problem: `invalid email "${invalid[0]}"` })
      } else if (valid.length === 0 && company) {
        problems.push({ sheet: ws.name, row: r, company, problem: 'no email address' })
      }
    }
    if (!isSelection && companies.length) trades.push({ trade: clean(ws.name), companies })
  }
  return { trades, selected, problems }
}
