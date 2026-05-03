'use server'

/**
 * Markup PDF flatten export — Slice 4.5.
 *
 * Wraps the already-rasterised markup PNG (captured at native source-page
 * dimensions by stage.toDataURL on save) into a single-page PDF the user
 * can download or attach to email/RFI exports. The PNG already contains
 * the source page raster + every shape baked on top, so this action's
 * job is just the PNG → PDF wrap.
 *
 * v1 limitation: single-page export. If the scene graph has shapes on
 * multiple pages, only the page captured at save time gets flattened.
 * Multi-page flatten is a follow-up that needs server-side rasterisation
 * per-page (re-running pdfjs in Node) or per-page PNGs sent from client.
 */

import { z } from 'zod'
import { PDFDocument } from 'pdf-lib'
import { createClient } from '@/lib/supabase/server'

const ExportSchema = z.object({
  annotationId: z.string().uuid(),
})

export async function exportRfiMarkupPdfAction(
  input: z.infer<typeof ExportSchema>,
): Promise<{ pdfBase64?: string; fileName?: string; error?: string }> {
  const parsed = ExportSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // 1) Annotation row → attachment id + (optional) source floor plan id
  const { data: ann, error: annErr } = await (supabase as any)
    .from('rfi_annotations')
    .select('id, rfi_id, attachment_id')
    .eq('id', parsed.data.annotationId)
    .single()
  if (annErr || !ann) return { error: 'Annotation not found' }

  // 2) Attachment file path
  const { data: att, error: attErr } = await (supabase as any)
    .from('attachments')
    .select('file_path, file_name')
    .eq('id', ann.attachment_id)
    .single()
  if (attErr || !att) return { error: 'Attachment row missing' }

  // 3) Download the markup PNG
  const { data: pngBlob, error: pngErr } = await supabase.storage
    .from('rfi-attachments')
    .download(att.file_path)
  if (pngErr || !pngBlob) {
    return { error: `Markup PNG download failed: ${pngErr?.message ?? 'unknown'}` }
  }
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())

  // 4) Wrap in a single-page PDF sized to the PNG's native dimensions
  try {
    const pdfDoc = await PDFDocument.create()
    const png = await pdfDoc.embedPng(pngBytes)
    const page = pdfDoc.addPage([png.width, png.height])
    page.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height })

    pdfDoc.setTitle(`E-Site Markup — ${ann.id.slice(0, 8)}`)
    pdfDoc.setProducer('E-Site (pdf-lib)')
    pdfDoc.setCreationDate(new Date())

    const pdfBytes = await pdfDoc.save()
    const pdfBase64 = Buffer.from(pdfBytes).toString('base64')
    const fileName = `markup-${ann.id.slice(0, 8)}.pdf`
    return { pdfBase64, fileName }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'PDF flatten failed' }
  }
}
