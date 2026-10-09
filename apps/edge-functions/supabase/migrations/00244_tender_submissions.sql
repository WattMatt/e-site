-- 00244_tender_submissions.sql
-- E5 slice C: priced submissions, documents, declarations, clarifications and
-- addenda — SEALED until the closing time.
--
-- The sealed-bid rule, enforced here and nowhere weaker:
--   * A bidder reads only their own submission, and changes it only through
--     the definer functions below (plus their own declarations and document
--     removals under row security), only while the tender is issued and before
--     closing_at, and only in a session proved by an emailed link (00243).
--   * Owner/admin/PM can see THAT a company has submitted (status, time) at
--     any time. The PRICES (tender_submission_lines) and the DOCUMENTS
--     (tender_submission_documents) of SUBMITTED bids become readable to them
--     only once closing_at has passed. Drafts never become readable, and a
--     cancelled tender is never opened. 00226's guard lets closing_at only
--     move later; tenders_close_guard below stops a tender closing early.
--   * Amounts are computed by trigger from the frozen BOQ quantity × the
--     bidder's rate; status changes only through tender_submit (which re-checks
--     compliance in SQL) and tender_reopen_submission. A REAL change to a
--     submitted bid — a rate, a document, the declarations, or a newly
--     published addendum — returns it to draft. An unchanged save does not.
--
-- No BEGIN/COMMIT: db push and scripts/db/dry-run-migration.sh wrap the file.

-- ── 0. Helpers ─────────────────────────────────────────────────────────────
ALTER TABLE projects.tender_requirements
  ADD CONSTRAINT tender_requirements_tender_id_id_key UNIQUE (tender_id, id);

-- The caller's participant row on a tender (NULL when not a participant, or
-- when the session was not established by an emailed link or code: see
-- projects.session_proves_email in 00243). Every bidder path below goes
-- through this, so a password session on a bidder's address can neither read
-- nor write a submission.
CREATE FUNCTION projects.tender_my_participant_id(p_tender_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT tp.id FROM projects.tender_participants tp
   WHERE tp.tender_id = p_tender_id AND tp.user_id = auth.uid()
     AND projects.session_proves_email()
$$;

-- Open for bidding: issued and before closing.
CREATE FUNCTION projects.tender_is_open(p_tender_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT t.status = 'issued' AND t.closing_at > now()
                     FROM projects.tenders t WHERE t.id = p_tender_id), false)
$$;

-- The seal lifts once closing_at has passed — never for a draft or a cancelled tender.
CREATE FUNCTION projects.tender_seal_lifted(p_tender_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT t.status NOT IN ('draft','cancelled') AND t.closing_at IS NOT NULL AND t.closing_at <= now()
                     FROM projects.tenders t WHERE t.id = p_tender_id), false)
$$;

-- Who at WM may OPEN bids once the seal lifts. Today the same set as
-- user_can_manage_tender (owner/admin/project manager); it is its own function
-- so that the owner's decision on who opens tenders changes exactly one place.
CREATE FUNCTION projects.user_can_open_tender(p_tender_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT projects.user_can_manage_tender(p_tender_id)
$$;

-- ── 1. Submissions (one per participant; no prices on this table) ──────────
CREATE TABLE projects.tender_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id        uuid NOT NULL REFERENCES projects.tenders(id) ON DELETE CASCADE,
  participant_id   uuid NOT NULL REFERENCES projects.tender_participants(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'draft',
  submitted_at     timestamptz,
  submission_count int  NOT NULL DEFAULT 0,
  declarations     uuid[] NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_submissions_status_check CHECK (status IN ('draft','submitted')),
  CONSTRAINT tender_submissions_submitted_consistent CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)),
  CONSTRAINT tender_submissions_participant_key UNIQUE (participant_id),
  CONSTRAINT tender_submissions_id_tender_key UNIQUE (id, tender_id)
);
CREATE INDEX tender_submissions_tender_idx ON projects.tender_submissions(tender_id);

-- ── 2. Lines (the prices — sealed) ─────────────────────────────────────────
CREATE TABLE projects.tender_submission_lines (
  submission_id  uuid NOT NULL,
  tender_id      uuid NOT NULL,
  item_id        uuid NOT NULL,
  rate           numeric(16,4),
  not_priced     boolean NOT NULL DEFAULT false,
  amount         numeric(16,2) NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, item_id),
  CONSTRAINT tender_submission_lines_submission_fk FOREIGN KEY (submission_id, tender_id)
    REFERENCES projects.tender_submissions(id, tender_id) ON DELETE CASCADE,
  CONSTRAINT tender_submission_lines_item_fk FOREIGN KEY (tender_id, item_id)
    REFERENCES projects.tender_boq_items(tender_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_submission_lines_rate_range CHECK (rate IS NULL OR (rate >= 0 AND rate < 100000000000)),
  CONSTRAINT tender_submission_lines_rate_or_not_priced CHECK (NOT (not_priced AND rate IS NOT NULL))
);
CREATE INDEX tender_submission_lines_tender_idx ON projects.tender_submission_lines(tender_id);

-- ── 3. Documents (sealed) ──────────────────────────────────────────────────
CREATE TABLE projects.tender_submission_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   uuid NOT NULL,
  tender_id       uuid NOT NULL,
  requirement_id  uuid NOT NULL,
  storage_path    text NOT NULL,
  file_name       text NOT NULL,
  size_bytes      bigint NOT NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_submission_documents_submission_fk FOREIGN KEY (submission_id, tender_id)
    REFERENCES projects.tender_submissions(id, tender_id) ON DELETE CASCADE,
  CONSTRAINT tender_submission_documents_requirement_fk FOREIGN KEY (tender_id, requirement_id)
    REFERENCES projects.tender_requirements(tender_id, id) ON DELETE CASCADE,
  CONSTRAINT tender_submission_documents_size CHECK (size_bytes > 0 AND size_bytes <= 52428800),
  CONSTRAINT tender_submission_documents_path CHECK (
    storage_path LIKE tender_id::text || '/' || submission_id::text || '/' || requirement_id::text || '-%'
    AND storage_path NOT LIKE '%..%'),
  CONSTRAINT tender_submission_documents_path_key UNIQUE (storage_path)
);
CREATE INDEX tender_submission_documents_submission_idx ON projects.tender_submission_documents(submission_id);

-- ── 4. Clarifications and addenda ──────────────────────────────────────────
CREATE TABLE projects.tender_clarifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id       uuid NOT NULL REFERENCES projects.tenders(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  participant_id  uuid REFERENCES projects.tender_participants(id) ON DELETE SET NULL,
  title           text NOT NULL,
  body            text NOT NULL,
  answer          text,
  published_at    timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_clarifications_kind_check CHECK (kind IN ('question','addendum')),
  CONSTRAINT tender_clarifications_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT tender_clarifications_body_not_blank CHECK (btrim(body) <> ''),
  -- An addendum comes from WM; a question comes from a bidder.
  CONSTRAINT tender_clarifications_author CHECK ((kind = 'addendum') = (participant_id IS NULL))
);
CREATE INDEX tender_clarifications_tender_idx ON projects.tender_clarifications(tender_id, created_at);

CREATE TABLE projects.tender_addendum_acks (
  clarification_id  uuid NOT NULL REFERENCES projects.tender_clarifications(id) ON DELETE CASCADE,
  participant_id    uuid NOT NULL REFERENCES projects.tender_participants(id) ON DELETE CASCADE,
  acknowledged_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clarification_id, participant_id)
);

-- ── 5. Triggers ────────────────────────────────────────────────────────────

-- Return a submitted bid to draft (it must be re-submitted).
CREATE FUNCTION projects.tender_submission_to_draft(p_submission_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE projects.tender_submissions SET status = 'draft', submitted_at = NULL
   WHERE id = p_submission_id AND status = 'submitted'
$$;

-- BEFORE, no side effects: the amount is the frozen quantity × the bidder's
-- rate, rounded to the cent; rate-only rows and fixed sums carry no bidder
-- amount, and a fixed sum cannot be priced.
CREATE FUNCTION projects.tender_submission_lines_compute() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_qty  numeric;
  v_type text;
BEGIN
  SELECT i.quantity, i.rate_cell_type INTO v_qty, v_type
    FROM projects.tender_boq_items i
   WHERE i.id = NEW.item_id AND i.tender_id = NEW.tender_id AND i.kind = 'item';
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'that row is not a priceable item of this tender' USING ERRCODE = '23514';
  END IF;
  IF v_type = 'fixed' AND NEW.rate IS NOT NULL THEN
    RAISE EXCEPTION 'a fixed sum cannot be priced' USING ERRCODE = '23514';
  END IF;
  NEW.amount := CASE WHEN v_type = 'priced' AND NEW.rate IS NOT NULL AND v_qty IS NOT NULL
                     THEN round(v_qty * NEW.rate, 2) ELSE 0 END;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER tender_submission_lines_compute BEFORE INSERT OR UPDATE ON projects.tender_submission_lines
  FOR EACH ROW EXECUTE FUNCTION projects.tender_submission_lines_compute();

-- AFTER, and only on a REAL change. An INSERT … ON CONFLICT whose DO UPDATE is
-- skipped by its WHERE fires the BEFORE INSERT trigger for the proposed row but
-- neither AFTER INSERT nor any UPDATE trigger — which is why the revert lives
-- here and not in the BEFORE trigger (where an unchanged re-save used to
-- withdraw a submitted bid).
CREATE FUNCTION projects.tender_submission_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM projects.tender_submission_to_draft(CASE WHEN TG_OP = 'DELETE' THEN OLD.submission_id ELSE NEW.submission_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER tender_submission_lines_changed AFTER INSERT ON projects.tender_submission_lines
  FOR EACH ROW WHEN (NEW.rate IS NOT NULL OR NEW.not_priced)
  EXECUTE FUNCTION projects.tender_submission_changed();
CREATE TRIGGER tender_submission_lines_changed_del AFTER DELETE ON projects.tender_submission_lines
  FOR EACH ROW EXECUTE FUNCTION projects.tender_submission_changed();
CREATE TRIGGER tender_submission_lines_changed_upd AFTER UPDATE ON projects.tender_submission_lines
  FOR EACH ROW WHEN (OLD.rate IS DISTINCT FROM NEW.rate OR OLD.not_priced IS DISTINCT FROM NEW.not_priced)
  EXECUTE FUNCTION projects.tender_submission_changed();
CREATE TRIGGER tender_submission_documents_changed AFTER INSERT OR DELETE ON projects.tender_submission_documents
  FOR EACH ROW EXECUTE FUNCTION projects.tender_submission_changed();

-- Submissions: participant and tender fixed; declarations must be this
-- tender's declaration requirements; a change to them reopens a submitted bid.
CREATE FUNCTION projects.tender_submissions_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.tender_id IS DISTINCT FROM OLD.tender_id OR NEW.participant_id IS DISTINCT FROM OLD.participant_id) THEN
    RAISE EXCEPTION 'a submission cannot be moved' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.declarations) d
              WHERE NOT EXISTS (SELECT 1 FROM projects.tender_requirements r
                                 WHERE r.id = d AND r.tender_id = NEW.tender_id AND r.kind = 'declaration')) THEN
    RAISE EXCEPTION 'a declaration does not belong to this tender' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'submitted' AND NEW.status = 'submitted'
     AND NEW.declarations IS DISTINCT FROM OLD.declarations THEN
    NEW.status := 'draft';
    NEW.submitted_at := NULL;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER tender_submissions_guard BEFORE INSERT OR UPDATE ON projects.tender_submissions
  FOR EACH ROW EXECUTE FUNCTION projects.tender_submissions_guard();

-- A tender closes only once its closing time has passed (closing early would
-- shut bidders out mid-tender). And once the closing time HAS passed it is
-- final as soon as any bid was submitted: extending it then would reopen
-- bidding after the seal lifted, i.e. after WM could have read the rates. With
-- no submitted bid there is nothing WM could have read, so an issued tender
-- that received none may still be extended ("no bids received, extend").
CREATE FUNCTION projects.tenders_close_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed'
     AND (NEW.closing_at IS NULL OR NEW.closing_at > now()) THEN
    RAISE EXCEPTION 'a tender can be closed only after its closing time' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'draft' AND OLD.closing_at IS NOT NULL AND OLD.closing_at <= now()
     AND NEW.closing_at IS DISTINCT FROM OLD.closing_at
     AND (OLD.status <> 'issued'
          OR EXISTS (SELECT 1 FROM projects.tender_submissions s WHERE s.tender_id = OLD.id AND s.status = 'submitted')) THEN
    RAISE EXCEPTION 'the closing time has passed and can no longer be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenders_close_guard BEFORE UPDATE OF status, closing_at ON projects.tenders
  FOR EACH ROW EXECUTE FUNCTION projects.tenders_close_guard();

-- Clarifications: authorship is stamped, never supplied; identity is fixed; a
-- published addendum is final (amend it with another addendum).
CREATE FUNCTION projects.tender_clarifications_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Publishing anything is stamped by the database, and an addendum can only be
  -- published while the tender is open: after closing it would return every
  -- submitted bid to draft with no way to re-submit. The tender row is locked
  -- so a publish and a bidder's submit (which takes FOR SHARE) never interleave.
  IF NEW.published_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.published_at IS NULL) THEN
    NEW.published_at := now();
    IF NEW.kind = 'addendum' THEN
      PERFORM 1 FROM projects.tenders t WHERE t.id = NEW.tender_id FOR UPDATE;
      IF NOT projects.tender_is_open(NEW.tender_id) THEN
        RAISE EXCEPTION 'an addendum can only be published while the tender is open' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := now();
  ELSE
    IF NEW.tender_id IS DISTINCT FROM OLD.tender_id OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.participant_id IS DISTINCT FROM OLD.participant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'a clarification cannot be re-pointed' USING ERRCODE = '55000';
    END IF;
    -- Whatever every bidder has been shown is final: a published addendum, and
    -- a published answer (neither rewritten nor withdrawn). Amend with an addendum.
    IF OLD.published_at IS NOT NULL
       AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
            OR NEW.answer IS DISTINCT FROM OLD.answer OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
      RAISE EXCEPTION 'published to every bidder, so it is final; publish an addendum instead' USING ERRCODE = '55000';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER tender_clarifications_guard BEFORE INSERT OR UPDATE ON projects.tender_clarifications
  FOR EACH ROW EXECUTE FUNCTION projects.tender_clarifications_guard();

-- Publishing an addendum returns every submitted bid to draft: each bidder must
-- acknowledge it and re-submit (tender_submit refuses until they have).
CREATE FUNCTION projects.tender_addendum_published() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind = 'addendum' AND NEW.published_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.published_at IS NULL) THEN
    UPDATE projects.tender_submissions SET status = 'draft', submitted_at = NULL
     WHERE tender_id = NEW.tender_id AND status = 'submitted';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER tender_addendum_published AFTER INSERT OR UPDATE OF published_at ON projects.tender_clarifications
  FOR EACH ROW EXECUTE FUNCTION projects.tender_addendum_published();

-- ── 6. The bidder's write path (definer, one gate each) ────────────────────

-- The caller's submission, locked FOR UPDATE and created if missing. Every
-- bidder write takes this lock first, so a save, an upload and a submit for
-- the same bid never interleave (a submit cannot validate a state that a
-- concurrent save is changing underneath it).
CREATE FUNCTION projects.tender_lock_my_submission(p_tender_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_part uuid := projects.tender_my_participant_id(p_tender_id);
  v_sub  uuid;
BEGIN
  IF v_part IS NULL THEN
    RAISE EXCEPTION 'not a participant in this tender' USING ERRCODE = '42501';
  END IF;
  -- FOR SHARE on the tender: an addendum publish (FOR UPDATE) waits for this
  -- transaction, or this one sees the addendum. Bidders do not block each other.
  PERFORM 1 FROM projects.tenders t WHERE t.id = p_tender_id FOR SHARE;
  IF NOT projects.tender_is_open(p_tender_id) THEN
    RAISE EXCEPTION 'this tender is not open for submissions' USING ERRCODE = '55000';
  END IF;
  INSERT INTO projects.tender_submissions (tender_id, participant_id) VALUES (p_tender_id, v_part)
  ON CONFLICT (participant_id) DO NOTHING;
  SELECT s.id INTO v_sub FROM projects.tender_submissions s WHERE s.participant_id = v_part FOR UPDATE;
  RETURN v_sub;
END $$;

-- Saving rates in bulk: one INSERT … ON CONFLICT that writes only rate and
-- not_priced, and only where they changed. The line triggers compute every
-- amount and revert a submitted bid only on a real change. DEFINER for the same
-- reason as tender_replace_boq: per-row row security on thousands of rows
-- approaches the 8 s statement timeout.
CREATE FUNCTION projects.tender_save_rates(p_tender_id uuid, p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sub uuid := projects.tender_lock_my_submission(p_tender_id);
  v_n   integer;
BEGIN
  INSERT INTO projects.tender_submission_lines AS l (submission_id, tender_id, item_id, rate, not_priced)
  SELECT v_sub, p_tender_id, r.item_id, r.rate, COALESCE(r.not_priced, false)
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(item_id uuid, rate numeric, not_priced boolean)
  ON CONFLICT (submission_id, item_id) DO UPDATE
     SET rate = EXCLUDED.rate, not_priced = EXCLUDED.not_priced
   WHERE l.rate IS DISTINCT FROM EXCLUDED.rate OR l.not_priced IS DISTINCT FROM EXCLUDED.not_priced;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Record an uploaded document. The requirement must be a document requirement
-- of this tender; the object must exist in the private bucket at the bidder's
-- own path for that requirement; its size is read from storage, never taken
-- from the caller.
CREATE FUNCTION projects.tender_record_document(p_tender_id uuid, p_requirement_id uuid, p_path text, p_file_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sub  uuid := projects.tender_lock_my_submission(p_tender_id);
  v_size bigint;
  v_id   uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects.tender_requirements r
                  WHERE r.id = p_requirement_id AND r.tender_id = p_tender_id AND r.kind = 'document') THEN
    RAISE EXCEPTION 'that is not a document requirement of this tender' USING ERRCODE = '23514';
  END IF;
  IF p_path IS NULL OR p_path NOT LIKE p_tender_id::text || '/' || v_sub::text || '/' || p_requirement_id::text || '-%'
     OR p_path LIKE '%..%' THEN
    RAISE EXCEPTION 'that upload does not belong to this submission' USING ERRCODE = '42501';
  END IF;
  SELECT (o.metadata ->> 'size')::bigint INTO v_size
    FROM storage.objects o WHERE o.bucket_id = 'tender-submissions' AND o.name = p_path;
  IF v_size IS NULL OR v_size <= 0 THEN
    RAISE EXCEPTION 'the upload did not arrive' USING ERRCODE = '23514';
  END IF;
  INSERT INTO projects.tender_submission_documents (submission_id, tender_id, requirement_id, storage_path, file_name, size_bytes)
  VALUES (v_sub, p_tender_id, p_requirement_id, p_path,
          left(COALESCE(NULLIF(btrim(p_file_name), ''), 'document'), 200), v_size)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Submit: re-checks compliance in SQL (the browser's check is a convenience,
-- this is the gate). Returns the sealed total (Σ priced amounts + fixed sums)
-- to the bidder alone.
CREATE FUNCTION projects.tender_submit(p_tender_id uuid)
RETURNS TABLE (submitted_at timestamptz, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sub     uuid := projects.tender_lock_my_submission(p_tender_id);
  v_part    uuid := projects.tender_my_participant_id(p_tender_id);
  v_decl    uuid[];
  v_missing int;
  v_at      timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects.tender_participants tp WHERE tp.id = v_part AND tp.profile_completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'complete your company details first' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_missing
    FROM projects.tender_boq_items i
    LEFT JOIN projects.tender_submission_lines l ON l.submission_id = v_sub AND l.item_id = i.id
   WHERE i.tender_id = p_tender_id AND i.kind = 'item'
     AND i.rate_cell_type IN ('priced','rate_only')
     AND l.rate IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% item(s) still need a rate', v_missing USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_missing
    FROM projects.tender_requirements r
   WHERE r.tender_id = p_tender_id AND r.mandatory AND r.kind = 'document'
     AND NOT EXISTS (SELECT 1 FROM projects.tender_submission_documents d
                      WHERE d.submission_id = v_sub AND d.requirement_id = r.id);
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% required document(s) not uploaded', v_missing USING ERRCODE = '23514';
  END IF;
  SELECT s.declarations INTO v_decl FROM projects.tender_submissions s WHERE s.id = v_sub;
  SELECT count(*) INTO v_missing
    FROM projects.tender_requirements r
   WHERE r.tender_id = p_tender_id AND r.mandatory AND r.kind = 'declaration'
     AND NOT (r.id = ANY (v_decl));
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% declaration(s) not accepted', v_missing USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO v_missing
    FROM projects.tender_clarifications c
   WHERE c.tender_id = p_tender_id AND c.kind = 'addendum' AND c.published_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM projects.tender_addendum_acks a
                      WHERE a.clarification_id = c.id AND a.participant_id = v_part);
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% addendum/addenda not acknowledged', v_missing USING ERRCODE = '23514';
  END IF;

  v_at := now();
  UPDATE projects.tender_submissions
     SET status = 'submitted', submitted_at = v_at, submission_count = submission_count + 1
   WHERE id = v_sub;

  RETURN QUERY
  SELECT v_at,
         COALESCE((SELECT sum(l.amount) FROM projects.tender_submission_lines l WHERE l.submission_id = v_sub), 0)
       + COALESCE((SELECT sum(i.fixed_amount) FROM projects.tender_boq_items i
                    WHERE i.tender_id = p_tender_id AND i.kind = 'item' AND i.rate_cell_type = 'fixed'), 0);
END $$;

-- Acknowledge a published addendum (for the caller's own company only).
CREATE FUNCTION projects.tender_acknowledge_addendum(p_tender_id uuid, p_clarification_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sub  uuid := projects.tender_lock_my_submission(p_tender_id);
  v_part uuid := projects.tender_my_participant_id(p_tender_id);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects.tender_clarifications c
                  WHERE c.id = p_clarification_id AND c.tender_id = p_tender_id
                    AND c.kind = 'addendum' AND c.published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'that is not a published addendum of this tender' USING ERRCODE = '23514';
  END IF;
  INSERT INTO projects.tender_addendum_acks (clarification_id, participant_id)
  VALUES (p_clarification_id, v_part) ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION projects.tender_reopen_submission(p_tender_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM projects.tender_submission_to_draft(projects.tender_lock_my_submission(p_tender_id));
END $$;

-- Clarifications as a bidder sees them: published ones and their own
-- questions. Never returns participant_id or created_by, so a bidder cannot
-- learn who else asked or who else is bidding.
CREATE FUNCTION projects.tender_portal_clarifications(p_tender_id uuid)
RETURNS TABLE (id uuid, kind text, title text, body text, answer text, published_at timestamptz,
               created_at timestamptz, mine boolean, acknowledged boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH me AS (SELECT projects.tender_my_participant_id(p_tender_id) AS pid)
  SELECT c.id, c.kind, c.title, c.body, c.answer, c.published_at, c.created_at,
         c.kind = 'question' AND c.participant_id = me.pid,
         EXISTS (SELECT 1 FROM projects.tender_addendum_acks a
                  WHERE a.clarification_id = c.id AND a.participant_id = me.pid)
    FROM projects.tender_clarifications c, me
   WHERE c.tender_id = p_tender_id AND me.pid IS NOT NULL
     AND (c.published_at IS NOT NULL OR c.participant_id = me.pid)
   ORDER BY c.created_at
$$;

-- ── 7. Row security ────────────────────────────────────────────────────────
ALTER TABLE projects.tender_submissions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_submission_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_submission_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_clarifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_addendum_acks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_submissions          FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_submission_lines     FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_submission_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_clarifications       FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_addendum_acks        FORCE ROW LEVEL SECURITY;

-- Submissions: the bidder's own row; WM sees that a company submitted (no prices here).
CREATE POLICY tender_submissions_select ON projects.tender_submissions FOR SELECT TO authenticated
  USING (participant_id = projects.tender_my_participant_id(tender_id) OR projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_submissions_update ON projects.tender_submissions FOR UPDATE TO authenticated
  USING (participant_id = projects.tender_my_participant_id(tender_id) AND projects.tender_is_open(tender_id))
  WITH CHECK (participant_id = projects.tender_my_participant_id(tender_id) AND projects.tender_is_open(tender_id));

-- Lines: SEALED. The bidder's own; WM only SUBMITTED bids, only once the seal lifts.
CREATE POLICY tender_submission_lines_select ON projects.tender_submission_lines FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM projects.tender_submissions s
             WHERE s.id = submission_id AND s.participant_id = projects.tender_my_participant_id(tender_id))
    OR (projects.user_can_open_tender(tender_id) AND projects.tender_seal_lifted(tender_id)
        AND EXISTS (SELECT 1 FROM projects.tender_submissions s WHERE s.id = submission_id AND s.status = 'submitted'))
  );

-- Documents: SEALED, same shape. A bidder may remove their own while open.
CREATE POLICY tender_submission_documents_select ON projects.tender_submission_documents FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM projects.tender_submissions s
             WHERE s.id = submission_id AND s.participant_id = projects.tender_my_participant_id(tender_id))
    OR (projects.user_can_open_tender(tender_id) AND projects.tender_seal_lifted(tender_id)
        AND EXISTS (SELECT 1 FROM projects.tender_submissions s WHERE s.id = submission_id AND s.status = 'submitted'))
  );
CREATE POLICY tender_submission_documents_delete ON projects.tender_submission_documents FOR DELETE TO authenticated
  USING (projects.tender_is_open(tender_id) AND EXISTS (
    SELECT 1 FROM projects.tender_submissions s
     WHERE s.id = submission_id AND s.participant_id = projects.tender_my_participant_id(tender_id)));

-- Clarifications: WM reads and manages them. Bidders read through
-- tender_portal_clarifications (no asker identity) and may ask while open.
CREATE POLICY tender_clarifications_select ON projects.tender_clarifications FOR SELECT TO authenticated
  USING (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_clarifications_insert_wm ON projects.tender_clarifications FOR INSERT TO authenticated
  WITH CHECK (projects.user_can_manage_tender(tender_id) AND kind = 'addendum');
CREATE POLICY tender_clarifications_insert_bidder ON projects.tender_clarifications FOR INSERT TO authenticated
  WITH CHECK (kind = 'question' AND participant_id = projects.tender_my_participant_id(tender_id)
              AND projects.tender_is_open(tender_id) AND answer IS NULL AND published_at IS NULL);
CREATE POLICY tender_clarifications_update_wm ON projects.tender_clarifications FOR UPDATE TO authenticated
  USING (projects.user_can_manage_tender(tender_id)) WITH CHECK (projects.user_can_manage_tender(tender_id));

-- Acks: WM reads them. A bidder acknowledges through tender_acknowledge_addendum
-- and reads their own through tender_portal_clarifications.
CREATE POLICY tender_addendum_acks_select ON projects.tender_addendum_acks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM projects.tender_clarifications c
                  WHERE c.id = clarification_id AND projects.user_can_manage_tender(c.tender_id)));

-- Site scope (00238). Every row follows the caller's access to the tender's
-- project. The tables a tenderer touches directly (their submission, its lines
-- and documents, and the questions they ask) carry a second arm for the
-- participant's OWN rows (never another bidder's), because a tenderer is never
-- a project member. The arm matches the permissive bidder arm exactly, so even
-- a participant who is also a lapsed project PM cannot read a rival's prices.
-- RESTRICTIVE policies only narrow, so neither arm can open what the
-- permissive policies above (and the seal) do not: WM still reads prices only
-- after closing, and a participant still reads only their own submission.
-- scripts/db/assert-site-scope-coverage.sql requires a policy by this name.
CREATE FUNCTION public.site_project_of_tender_clarification(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off'
AS $f$ SELECT public.site_project_of_tender(tender_id) FROM projects.tender_clarifications WHERE id = p_id $f$;

CREATE POLICY site_scope ON projects.tender_submissions AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_tender(tender_id)) OR participant_id = projects.tender_my_participant_id(tender_id))
  WITH CHECK (public.user_has_project_access(public.site_project_of_tender(tender_id)) OR participant_id = projects.tender_my_participant_id(tender_id));
CREATE POLICY site_scope ON projects.tender_submission_lines AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_tender(tender_id))
         OR EXISTS (SELECT 1 FROM projects.tender_submissions s
                     WHERE s.id = submission_id AND s.participant_id = projects.tender_my_participant_id(tender_id)))
  WITH CHECK (public.user_has_project_access(public.site_project_of_tender(tender_id))
         OR EXISTS (SELECT 1 FROM projects.tender_submissions s
                     WHERE s.id = submission_id AND s.participant_id = projects.tender_my_participant_id(tender_id)));
CREATE POLICY site_scope ON projects.tender_submission_documents AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_tender(tender_id))
         OR EXISTS (SELECT 1 FROM projects.tender_submissions s
                     WHERE s.id = submission_id AND s.participant_id = projects.tender_my_participant_id(tender_id)))
  WITH CHECK (public.user_has_project_access(public.site_project_of_tender(tender_id))
         OR EXISTS (SELECT 1 FROM projects.tender_submissions s
                     WHERE s.id = submission_id AND s.participant_id = projects.tender_my_participant_id(tender_id)));
CREATE POLICY site_scope ON projects.tender_clarifications AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_tender(tender_id)) OR participant_id = projects.tender_my_participant_id(tender_id))
  WITH CHECK (public.user_has_project_access(public.site_project_of_tender(tender_id)) OR participant_id = projects.tender_my_participant_id(tender_id));
CREATE POLICY site_scope ON projects.tender_addendum_acks AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_tender_clarification(clarification_id)))
  WITH CHECK (public.user_has_project_access(public.site_project_of_tender_clarification(clarification_id)));

-- ── 8. Grants: lines and documents are written only through the functions ──
REVOKE ALL ON projects.tender_submissions, projects.tender_submission_lines, projects.tender_submission_documents,
              projects.tender_clarifications, projects.tender_addendum_acks FROM anon, authenticated;
GRANT SELECT ON projects.tender_submissions TO authenticated;
GRANT UPDATE (declarations) ON projects.tender_submissions TO authenticated;
GRANT SELECT ON projects.tender_submission_lines TO authenticated;
GRANT SELECT, DELETE ON projects.tender_submission_documents TO authenticated;
GRANT SELECT ON projects.tender_clarifications TO authenticated;
GRANT INSERT (tender_id, kind, participant_id, title, body, published_at) ON projects.tender_clarifications TO authenticated;
GRANT UPDATE (answer, published_at) ON projects.tender_clarifications TO authenticated;
GRANT SELECT ON projects.tender_addendum_acks TO authenticated;
GRANT ALL ON projects.tender_submissions, projects.tender_submission_lines, projects.tender_submission_documents,
             projects.tender_clarifications, projects.tender_addendum_acks TO service_role;

-- Explicit statements (not a DO loop): the static anon-EXECUTE guard reads migration text.
REVOKE ALL ON FUNCTION projects.tender_my_participant_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_my_participant_id(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.site_project_of_tender_clarification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_project_of_tender_clarification(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.user_can_open_tender(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.user_can_open_tender(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_is_open(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_is_open(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_seal_lifted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_seal_lifted(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_lock_my_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_lock_my_submission(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_save_rates(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_save_rates(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_record_document(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_record_document(uuid, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_submit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_submit(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_acknowledge_addendum(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_acknowledge_addendum(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_reopen_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_reopen_submission(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_portal_clarifications(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_portal_clarifications(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_submission_to_draft(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION projects.tender_submission_lines_compute() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION projects.tender_submission_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION projects.tender_submissions_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION projects.tenders_close_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION projects.tender_clarifications_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION projects.tender_addendum_published() FROM PUBLIC, anon, authenticated;

-- Private bucket for submitted documents; no client storage policies. The
-- server mints upload URLs for the bidder, and download URLs for WM only once
-- the seal lifts.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('tender-submissions', 'tender-submissions', false, 52428800)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- table: projects.tender_submissions
-- table: projects.tender_submission_lines
-- table: projects.tender_submission_documents
-- table: projects.tender_clarifications
-- table: projects.tender_addendum_acks
-- constraint: tender_submissions_participant_key ON projects.tender_submissions
-- constraint: tender_submission_lines_item_fk ON projects.tender_submission_lines
-- constraint: tender_submission_documents_path ON projects.tender_submission_documents
-- constraint: tender_requirements_tender_id_id_key ON projects.tender_requirements
-- function: projects.tender_my_participant_id(uuid)
-- function: projects.tender_is_open(uuid)
-- function: projects.tender_seal_lifted(uuid)
-- function: projects.user_can_open_tender(uuid)
-- function: public.site_project_of_tender_clarification(uuid)
-- policy: site_scope ON projects.tender_submissions RESTRICTIVE
-- policy: site_scope ON projects.tender_submission_lines RESTRICTIVE
-- policy: site_scope ON projects.tender_submission_documents RESTRICTIVE
-- policy: site_scope ON projects.tender_clarifications RESTRICTIVE
-- policy: site_scope ON projects.tender_addendum_acks RESTRICTIVE
-- sql: (SELECT NOT has_function_privilege('anon', 'public.site_project_of_tender_clarification(uuid)', 'EXECUTE'))
-- function: projects.tender_submission_to_draft(uuid)
-- function: projects.tender_submission_lines_compute()
-- function: projects.tender_submission_changed()
-- function: projects.tender_submissions_guard()
-- function: projects.tenders_close_guard()
-- function: projects.tender_clarifications_guard()
-- function: projects.tender_addendum_published()
-- function: projects.tender_lock_my_submission(uuid)
-- function: projects.tender_save_rates(uuid, jsonb)
-- function: projects.tender_record_document(uuid, uuid, text, text)
-- function: projects.tender_submit(uuid)
-- function: projects.tender_acknowledge_addendum(uuid, uuid)
-- function: projects.tender_reopen_submission(uuid)
-- function: projects.tender_portal_clarifications(uuid)
-- trigger: tender_submission_lines_compute ON projects.tender_submission_lines
-- trigger: tender_submission_lines_changed ON projects.tender_submission_lines
-- trigger: tender_submission_lines_changed_upd ON projects.tender_submission_lines
-- trigger: tender_submission_lines_changed_del ON projects.tender_submission_lines
-- trigger: tender_submission_documents_changed ON projects.tender_submission_documents
-- trigger: tender_clarifications_guard ON projects.tender_clarifications
-- trigger: tender_submissions_guard ON projects.tender_submissions
-- trigger: tenders_close_guard ON projects.tenders
-- trigger: tender_addendum_published ON projects.tender_clarifications
-- policy: tender_submission_lines_select ON projects.tender_submission_lines
-- policy: tender_submission_documents_select ON projects.tender_submission_documents
-- policy: tender_clarifications_insert_wm ON projects.tender_clarifications
-- policy: tender_clarifications_insert_bidder ON projects.tender_clarifications
-- policy: tender_clarifications_update_wm ON projects.tender_clarifications
-- sql: (SELECT qual LIKE '%user_can_open_tender%' FROM pg_policies WHERE schemaname = 'projects' AND policyname = 'tender_submission_lines_select')
-- grant_absent: anon SELECT ON projects.tender_submission_lines
-- grant_absent: anon EXECUTE ON projects.tender_submit(uuid)
-- grant_absent: anon EXECUTE ON projects.tender_save_rates(uuid, jsonb)
-- grant_absent: authenticated INSERT ON projects.tender_addendum_acks
-- sql: (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('projects.tender_submissions'::regclass, 'projects.tender_submission_lines'::regclass, 'projects.tender_submission_documents'::regclass, 'projects.tender_clarifications'::regclass, 'projects.tender_addendum_acks'::regclass))
-- sql: (SELECT qual LIKE '%tender_seal_lifted%' AND qual LIKE '%submitted%' FROM pg_policies WHERE schemaname = 'projects' AND policyname = 'tender_submission_lines_select')
-- sql: (SELECT qual LIKE '%tender_seal_lifted%' AND qual LIKE '%submitted%' FROM pg_policies WHERE schemaname = 'projects' AND policyname = 'tender_submission_documents_select')
-- sql: (SELECT count(*) = 1 FROM pg_policies WHERE schemaname = 'projects' AND tablename = 'tender_submission_lines' AND policyname <> 'site_scope')
-- sql: (SELECT NOT has_table_privilege('authenticated', 'projects.tender_submission_lines', 'INSERT') AND NOT has_table_privilege('authenticated', 'projects.tender_submission_lines', 'UPDATE') AND NOT has_table_privilege('authenticated', 'projects.tender_submission_documents', 'INSERT'))
-- sql: (SELECT NOT has_column_privilege('authenticated', 'projects.tender_submission_lines', 'rate', 'UPDATE') AND NOT has_column_privilege('authenticated', 'projects.tender_submission_documents', 'size_bytes', 'INSERT'))
-- sql: (SELECT NOT has_column_privilege('authenticated', 'projects.tender_submissions', 'status', 'UPDATE') AND NOT has_column_privilege('authenticated', 'projects.tender_submissions', 'submitted_at', 'UPDATE'))
-- sql: (SELECT NOT public FROM storage.buckets WHERE id = 'tender-submissions')
-- @verify:end
