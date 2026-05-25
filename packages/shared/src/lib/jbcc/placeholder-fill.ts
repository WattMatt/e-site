// packages/shared/src/lib/jbcc/placeholder-fill.ts
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'

/**
 * Fill a `.docx` template's [bracketed] placeholders with the supplied values
 * and return the generated `.docx` as a Buffer.
 *
 * docxtemplater handles tags split across <w:r> runs natively. Unknown
 * placeholders render as the empty string (nullGetter below).
 */
export function fillTemplate(
  templateBytes: Buffer,
  values: Record<string, string>,
): Buffer {
  const zip = new PizZip(templateBytes)
  const doc = new Docxtemplater(zip, {
    delimiters:    { start: '[', end: ']' },
    paragraphLoop: true,
    linebreaks:    true,
    nullGetter:    () => '',
  })

  doc.render(values)

  return doc.getZip().generate({ type: 'nodebuffer' }) as Buffer
}
