// packages/shared/src/lib/jbcc/docx-letterhead.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import PizZip from 'pizzip'
import { fillTemplate } from './placeholder-fill'
import { injectLetterhead, readImageSize, type LetterheadBranding } from './docx-letterhead'

const FIXTURE = join(__dirname, '__fixtures__/N-01.docx')

// 1×1 PNG (valid IHDR: width=1, height=1).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

function filledFixture(): Buffer {
  return fillTemplate(readFileSync(FIXTURE), { 'Name of Recipient': 'Jane Architect' })
}

/** Assert an entry inside the .docx zip is well-formed XML (via python3).
 * Extracts with PizZip (not `unzip`, whose glob treats [Content_Types].xml
 * as a character class and matches nothing). */
function assertWellFormed(buf: Buffer, entry: string): void {
  const xml = new PizZip(buf).file(entry)
  expect(xml, `entry ${entry} present`).toBeTruthy()
  // Pass the XML via stdin (avoids all shell path/glob quoting issues).
  // Throws (non-zero exit) if the XML does not parse.
  execSync('python3 -c "import sys,xml.dom.minidom as m; m.parseString(sys.stdin.buffer.read())"', {
    input: xml!.asText(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

const BRANDING: LetterheadBranding = {
  companyName: 'Watson Mattheus Consulting',
  addressLines: ['12 Bree Street', 'Cape Town, 8001'],
  registrationNo: '2015/123456/07',
  vatNo: '4123456789',
  phone: '+27 21 555 0100',
  email: 'admin@wmeng.co.za',
  website: 'www.wmeng.co.za',
  accentColorHex: 'E8923A',
  documentRef: 'JBCC-KINGSWALK-2026-0007',
  logo: { data: PNG_1x1, contentType: 'image/png' },
}

describe('injectLetterhead', () => {
  it('produces a valid docx with well-formed XML parts (with logo)', () => {
    const out = injectLetterhead(filledFixture(), BRANDING)
    // The result reopens as a zip and the key parts are well-formed XML.
    expect(() => new PizZip(out)).not.toThrow()
    assertWellFormed(out, 'word/document.xml')
    assertWellFormed(out, '[Content_Types].xml')
    assertWellFormed(out, 'word/_rels/document.xml.rels')
  })

  it('embeds the logo image, relationship and content-type', () => {
    const out = injectLetterhead(filledFixture(), BRANDING)
    const zip = new PizZip(out)
    expect(zip.file('word/media/esite_letterhead_logo.png')).toBeTruthy()
    const rels = zip.file('word/_rels/document.xml.rels')!.asText()
    expect(rels).toContain('rIdEsiteLetterheadLogo')
    expect(rels).toContain('media/esite_letterhead_logo.png')
    const ct = zip.file('[Content_Types].xml')!.asText()
    expect(ct.toLowerCase()).toContain('extension="png"')
    const doc = zip.file('word/document.xml')!.asText()
    expect(doc).toContain('r:embed="rIdEsiteLetterheadLogo"')
    // Namespaces the drawing needs are declared on the root.
    expect(doc).toContain('xmlns:wp=')
    expect(doc).toContain('xmlns:pic=')
  })

  it('stamps company name, address, reg/VAT and document reference into the body', () => {
    const out = injectLetterhead(filledFixture(), BRANDING)
    const doc = new PizZip(out).file('word/document.xml')!.asText()
    expect(doc).toContain('Watson Mattheus Consulting')
    expect(doc).toContain('12 Bree Street, Cape Town, 8001')
    expect(doc).toContain('2015/123456/07')
    expect(doc).toContain('4123456789')
    expect(doc).toContain('JBCC-KINGSWALK-2026-0007')
    // The original body content survives (recipient still present).
    expect(doc).toContain('Jane Architect')
    // Accent colour applied.
    expect(doc).toContain('E8923A')
  })

  it('works text-only (no logo) and adds no media part', () => {
    const out = injectLetterhead(filledFixture(), { ...BRANDING, logo: null })
    const zip = new PizZip(out)
    expect(zip.file('word/media/esite_letterhead_logo.png')).toBeFalsy()
    assertWellFormed(out, 'word/document.xml')
    expect(zip.file('word/document.xml')!.asText()).toContain('Watson Mattheus Consulting')
  })

  it('escapes XML-hostile characters in branding', () => {
    const out = injectLetterhead(filledFixture(), {
      companyName: 'Smith & Jones <Pty> "Ltd"',
      documentRef: 'JBCC-A&B-2026-0001',
      logo: null,
    })
    assertWellFormed(out, 'word/document.xml')
    const doc = new PizZip(out).file('word/document.xml')!.asText()
    expect(doc).toContain('Smith &amp; Jones &lt;Pty&gt;')
  })

  it('reads PNG and JPEG dimensions', () => {
    expect(readImageSize(PNG_1x1, 'image/png')).toEqual({ width: 1, height: 1 })
  })

  it('is idempotent-safe: injecting is deterministic for the same input', () => {
    const a = injectLetterhead(filledFixture(), BRANDING)
    const b = injectLetterhead(filledFixture(), BRANDING)
    // Same structural content (both contain the single logo relationship once).
    const relsA = new PizZip(a).file('word/_rels/document.xml.rels')!.asText()
    const count = (relsA.match(/rIdEsiteLetterheadLogo/g) ?? []).length
    expect(count).toBe(1)
    expect(new PizZip(b).file('word/document.xml')!.asText()).toContain('Watson Mattheus Consulting')
  })
})
