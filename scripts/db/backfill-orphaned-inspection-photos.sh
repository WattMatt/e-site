#!/usr/bin/env bash
# backfill-orphaned-inspection-photos.sh — recover inspections.photos rows for
# storage objects stranded in the inspection-photos bucket without a metadata
# row.
#
# Why orphans exist: until migration 00159 (2026-07-06), every mobile photo
# metadata insert failed (photos.file_size_bytes missing + uploaded_by had no
# default) AFTER the binary had already been uploaded — see
# apps/mobile/src/inspections/upload-worker.ts. The mobile attachment queue
# gives up after 5 retries, so those objects never get their row back on their
# own. Web direct-to-storage captures (useFieldPhotos.ts) can strand objects
# the same way if the client-side insert fails after upload.
#
# What it recreates, per orphaned primary object (thumb / single upload):
#   inspection_id/section_id/field_id — parsed from the object path
#     (<project>/<inspection>/<section>/<field>/<basename>, both the mobile
#     `<epoch-ms>.jpg` and web `<epoch-ms>-<filename>` basename shapes)
#   original_path/original_size_bytes — the mobile `-original` sibling, if any
#   taken_at      — from the epoch-ms basename prefix (fallback: upload time)
#   uploaded_by   — storage.objects.owner_id (the actual uploader) when
#                   recorded, else the inspection's assignee, else its creator
#   caption       — 'Recovered <date>: …' marker (audit trail + rollback key)
#   created_at    — the storage upload time
#
# Objects it will NOT touch (listed in the dry run as unrecoverable):
#   - parent inspection deleted → the FK target is gone; nothing to attach to
#   - path not 5 segments      → not a capture-flow upload
#   - `-original` variant with no primary sibling and no row
# The inspection-signatures bucket is intentionally out of scope: mobile
# in-form signatures store their path inside the response payload (no
# signatures row by design), so a storage-vs-rows diff over that bucket
# reports false orphans.
#
# Idempotent: only objects with no matching photos row (storage_path OR
# original_path) are candidates — re-running inserts nothing new. Runs via the
# Supabase Management API (scripts/db/mgmt-api.sh) as postgres, which bypasses
# the RLS INSERT policy that pins uploaded_by = auth.uid() for app clients.
# Volume note: single set-based INSERT — fine at the current scale (the
# 2026-07-06 audit found ONE orphan, unrecoverable); batch it if a future gap
# reaches tens of thousands.
#
# Usage:
#   scripts/db/backfill-orphaned-inspection-photos.sh              # dry run
#   APPLY=1    scripts/db/backfill-orphaned-inspection-photos.sh   # insert rows
#   ROLLBACK=1 scripts/db/backfill-orphaned-inspection-photos.sh   # delete rows
#                                                  inserted by a previous APPLY

set -euo pipefail
cd "$(dirname "$0")/../.."
. scripts/db/mgmt-api.sh

# Shared candidate CTEs. `orphan` = objects with no photos row; `recoverable` =
# primary variants whose path parses and whose inspection still exists, joined
# to their -original sibling when present.
CANDIDATE_CTES=$(cat <<'SQL'
WITH orphan AS (
  SELECT ob.name,
         (ob.metadata->>'size')::bigint AS size_bytes,
         ob.created_at AS uploaded_at,
         ob.owner_id::text AS owner_id,
         split_part(ob.name, '/', 2) AS inspection_txt,
         split_part(ob.name, '/', 3) AS section_id,
         split_part(ob.name, '/', 4) AS field_id,
         split_part(ob.name, '/', 5) AS basename
  FROM storage.objects ob
  WHERE ob.bucket_id = 'inspection-photos'
    AND NOT EXISTS (
      SELECT 1 FROM inspections.photos p
      WHERE p.storage_path = ob.name OR p.original_path = ob.name
    )
),
cand AS (
  SELECT o.*,
         sib.name AS original_name,
         (sib.metadata->>'size')::bigint AS original_size,
         (regexp_match(o.basename, '^([0-9]{13})[.-]'))[1] AS ts_ms
  FROM orphan o
  LEFT JOIN storage.objects sib
    ON sib.bucket_id = 'inspection-photos'
   AND sib.name = regexp_replace(o.name, '(\.[^.]+)$', '-original\1')
  WHERE o.name ~ '^[^/]+/[^/]+/[^/]+/[^/]+/[^/]+$'
    AND o.basename !~ '-original\.[A-Za-z0-9]+$'
),
recoverable AS (
  SELECT c.*, i.id AS inspection_id, i.assigned_to_id, i.created_by
  FROM cand c
  JOIN inspections.inspections i ON i.id::text = c.inspection_txt
)
SQL
)

if [[ "${ROLLBACK:-0}" == "1" ]]; then
  echo "── ROLLBACK: deleting rows inserted by this script ──"
  mgmt_query "
    DELETE FROM inspections.photos
    WHERE caption LIKE 'Recovered %: metadata backfilled from orphaned storage object%'
    RETURNING id, storage_path;"
  exit 0
fi

echo "── Orphan summary ──"
mgmt_query "${CANDIDATE_CTES}
SELECT
  (SELECT count(*) FROM orphan)      AS orphaned_objects,
  (SELECT count(*) FROM recoverable) AS recoverable_rows,
  (SELECT count(*) FROM recoverable WHERE original_name IS NOT NULL) AS with_original_sibling;"

echo "── Recoverable (would insert) ──"
mgmt_query "${CANDIDATE_CTES}
SELECT r.name AS storage_path, r.inspection_id, r.section_id, r.field_id,
       r.original_name IS NOT NULL AS has_original,
       CASE WHEN r.owner_id ~ '^[0-9a-f-]{36}$' THEN 'storage owner'
            WHEN r.assigned_to_id IS NOT NULL   THEN 'inspection assignee'
            ELSE 'inspection creator' END AS attribution_source,
       r.size_bytes, r.uploaded_at
FROM recoverable r
ORDER BY r.uploaded_at;"

echo "── Unrecoverable (needs human decision; left untouched) ──"
mgmt_query "${CANDIDATE_CTES}
SELECT o.name, o.size_bytes, o.uploaded_at,
       CASE
         WHEN o.name !~ '^[^/]+/[^/]+/[^/]+/[^/]+/[^/]+$' THEN 'path is not the 5-segment capture shape'
         WHEN o.basename ~ '-original\.[A-Za-z0-9]+$'
          AND NOT EXISTS (SELECT 1 FROM recoverable r WHERE r.original_name = o.name)
              THEN '-original variant with no recoverable primary sibling'
         ELSE 'parent inspection deleted or never synced'
       END AS reason
FROM orphan o
WHERE NOT EXISTS (SELECT 1 FROM recoverable r WHERE r.name = o.name)
  AND NOT EXISTS (SELECT 1 FROM recoverable r WHERE r.original_name = o.name)
ORDER BY o.uploaded_at;"

if [[ "${APPLY:-0}" != "1" ]]; then
  echo
  echo "Dry run only. Re-run with APPLY=1 to insert the recoverable rows."
  exit 0
fi

echo "── APPLY: inserting recoverable photos rows ──"
mgmt_query "${CANDIDATE_CTES}
INSERT INTO inspections.photos
  (inspection_id, section_id, field_id, storage_path, file_size_bytes,
   original_path, original_size_bytes, taken_at, uploaded_by, caption, created_at)
SELECT r.inspection_id, r.section_id, r.field_id, r.name, r.size_bytes,
       r.original_name, r.original_size,
       CASE WHEN r.ts_ms IS NOT NULL THEN to_timestamp(r.ts_ms::bigint / 1000.0)
            ELSE r.uploaded_at END,
       COALESCE(
         CASE WHEN r.owner_id ~ '^[0-9a-f-]{36}$' THEN r.owner_id::uuid END,
         r.assigned_to_id, r.created_by),
       'Recovered ' || to_char(now(), 'YYYY-MM-DD')
         || ': metadata backfilled from orphaned storage object ('
         || CASE WHEN r.owner_id ~ '^[0-9a-f-]{36}$' THEN 'uploader from storage owner'
                 WHEN r.assigned_to_id IS NOT NULL   THEN 'uploader inferred from inspection assignee'
                 ELSE 'uploader inferred from inspection creator' END
         || ')',
       r.uploaded_at
FROM recoverable r
RETURNING id, storage_path;"

echo "── Verification: remaining orphans (should be unrecoverable-only) ──"
mgmt_query "${CANDIDATE_CTES}
SELECT (SELECT count(*) FROM orphan) AS orphaned_objects_remaining,
       (SELECT count(*) FROM recoverable) AS still_recoverable;"
