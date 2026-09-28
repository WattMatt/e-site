'use server'
/** Replaced in Task 13 by the real export. */
export async function exportLayoutSheetAction(_: { projectId: string; layoutId: string; jpegBase64: string; crop: { x: number; y: number; w: number; h: number } }):
  Promise<{ ok: true; version: number; reportId: string } | { error: string }> {
  return { error: 'Export is not available in this build.' }
}
