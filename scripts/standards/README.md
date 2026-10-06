# Standards reference pipeline

Run by WM staff on a machine that holds the standards library. The PDFs are licensed and this
repository is public: **datasets and reports carry values and must stay outside the repo** — every
script refuses an output path inside it.

```
LIB="<…>/CORRESPONDENCE/004. SANS REFERENCE BOOKS"
pnpm --filter @esite/shared exec tsx ../../scripts/standards/extract.ts --library "$LIB" --out ~/standards-dataset.json
pnpm --filter @esite/shared exec tsx ../../scripts/standards/audit.ts --dataset ~/standards-dataset.json --library "$LIB" --out ~/sans-audit.md --json ~/sans-audit.json
pnpm --filter @esite/shared exec tsx ../../scripts/standards/load.ts --dataset ~/standards-dataset.json --audit ~/sans-audit.json          # dry run
pnpm --filter @esite/shared exec tsx ../../scripts/standards/load.ts --dataset ~/standards-dataset.json --audit ~/sans-audit.json --apply
```

- Needs poppler (`brew install poppler`) and the Supabase Management API token (keychain
  "Supabase CLI", or `SUPABASE_ACCESS_TOKEN`).
- Dropbox online-only files read as 0 bytes; open each PDF once so Dropbox downloads it.
- To add a table: add a spec to the group file under `packages/shared/src/standards/specs-*.ts`
  (structure only), extract, audit, load. Every extracted table is loaded. The database refuses
  any row without a citation and any extracted table without a topic and cited conditions.
- Pages whose text layer is broken (values stacked one per line, digits split) cannot be read by
  position; the extractor refuses them and the table stays unloaded rather than guessed.
- Design: `docs/superpowers/specs/2026-10-05-standards-reference-design.md`.
