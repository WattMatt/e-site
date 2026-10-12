/**
 * Size ceiling for a generated PDF that goes into the `reports` bucket (file_size_limit 50 MiB,
 * migration 00117). 2 MiB of headroom for multipart overhead. Shared by the handoff, the save route
 * and the report renderer's no-appendix fallback.
 */
export const MAX_HANDOFF_PDF_BYTES = 48 * 1024 * 1024
