-- 00230_tender_invitations.sql
-- E5 slice B: invitations, tender-scoped participants, and the tenderer read path.
--
-- A tenderer is an auth user with NO organisation membership. Nothing in 00226
-- is opened to them: they get no SELECT policy on tenders / tender_boq_items /
-- tender_requirements, and never any path to tender_estimate_lines. Instead two
-- SECURITY DEFINER functions return exactly the columns a tenderer may see, for
-- the one tender they accepted an invitation to, and only while it is issued or
-- later. (A row policy on projects.tenders would have exposed every column —
-- including the reconciliation jsonb, which carries WM's internal estimate
-- totals.)
--
-- The forward-only status machine and the issue-time checks live in 00226
-- (tenders_status_guard).
--
-- No BEGIN/COMMIT: db push and scripts/db/dry-run-migration.sh wrap the file.

-- ── 0. Email-proved sessions ───────────────────────────────────────────────
-- Production signs new accounts up with GoTrue's mailer_autoconfirm ON, so a
-- password account for ANY address is "confirmed" at once without anyone
-- proving they read that mailbox. A bidder's identity is their mailbox, so
-- everything a bidder does requires a session established by an emailed link
-- or code (amr method otp / magiclink / recovery / invite). A password session
-- on the same address — whoever set that password — sees and does nothing.
CREATE FUNCTION projects.session_proves_email() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) AS e
     WHERE e ->> 'method' IN ('otp', 'magiclink', 'recovery', 'invite'))
$$;
REVOKE ALL ON FUNCTION projects.session_proves_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projects.session_proves_email() TO authenticated, service_role;

-- ── 1. Invitations ─────────────────────────────────────────────────────────
CREATE TABLE projects.tender_invitations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id         uuid NOT NULL REFERENCES projects.tenders(id) ON DELETE CASCADE,
  company_name      text NOT NULL,
  contact_name      text,
  email             text NOT NULL,
  phone             text,
  source            text NOT NULL DEFAULT 'manual',
  status            text NOT NULL DEFAULT 'prepared',
  token_hash        text,
  token_expires_at  timestamptz,
  sent_at           timestamptz,
  accepted_at       timestamptz,
  accepted_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_invitations_company_not_blank CHECK (btrim(company_name) <> ''),
  CONSTRAINT tender_invitations_email_shape CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT tender_invitations_source_check CHECK (source IN ('manual','tender_list')),
  CONSTRAINT tender_invitations_status_check CHECK (status IN ('prepared','sent','accepted','declined','revoked')),
  CONSTRAINT tender_invitations_token_hash_shape CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tender_invitations_accepted_consistent
    CHECK ((status = 'accepted') = (accepted_at IS NOT NULL AND accepted_by IS NOT NULL))
);
-- One live invitation per address per tender; a withdrawn one can be replaced.
CREATE UNIQUE INDEX tender_invitations_one_live_per_email ON projects.tender_invitations(tender_id, email)
  WHERE status <> 'revoked';
CREATE UNIQUE INDEX tender_invitations_token_hash_key ON projects.tender_invitations(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX tender_invitations_tender_idx ON projects.tender_invitations(tender_id);

-- Who an invitation is for is fixed when it is created. Otherwise a manager
-- could re-point a bidder's invitation at their own address and accept it
-- under the bidder's company name. To invite someone else, withdraw and
-- invite again.
CREATE FUNCTION projects.tender_invitations_identity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email
     OR NEW.company_name IS DISTINCT FROM OLD.company_name
     OR NEW.tender_id IS DISTINCT FROM OLD.tender_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'an invitation''s company and address cannot change; withdraw it and invite again' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'accepted' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by) THEN
    RAISE EXCEPTION 'an accepted invitation is final' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tender_invitations_identity_guard BEFORE UPDATE ON projects.tender_invitations
  FOR EACH ROW EXECUTE FUNCTION projects.tender_invitations_identity_guard();
REVOKE ALL ON FUNCTION projects.tender_invitations_identity_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.tender_invitations_identity_guard() FROM anon, authenticated;

-- ── 2. Participants (one per accepted invitation) ──────────────────────────
CREATE TABLE projects.tender_participants (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id             uuid NOT NULL REFERENCES projects.tenders(id) ON DELETE CASCADE,
  invitation_id         uuid NOT NULL REFERENCES projects.tender_invitations(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name          text NOT NULL,
  registration_number   text,
  vat_number            text,
  cidb_grade            text,
  bbbee_level           text,
  contact_name          text,
  phone                 text,
  profile_completed_at  timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_participants_invitation_key UNIQUE (invitation_id),
  CONSTRAINT tender_participants_user_key UNIQUE (tender_id, user_id),
  CONSTRAINT tender_participants_company_not_blank CHECK (btrim(company_name) <> ''),
  CONSTRAINT tender_participants_bbbee_check
    CHECK (bbbee_level IS NULL OR bbbee_level IN ('1','2','3','4','5','6','7','8','non-compliant')),
  CONSTRAINT tender_participants_cidb_shape
    CHECK (cidb_grade IS NULL OR cidb_grade ~ '^[1-9][A-Z]{2}( ?PE)?$'),
  -- A profile cannot be marked complete over the API without its scored fields.
  CONSTRAINT tender_participants_complete_needs_fields CHECK (
    profile_completed_at IS NULL OR (registration_number IS NOT NULL AND cidb_grade IS NOT NULL
      AND bbbee_level IS NOT NULL AND contact_name IS NOT NULL AND phone IS NOT NULL))
);
CREATE INDEX tender_participants_user_idx ON projects.tender_participants(user_id);

-- A participant may complete their own profile but never re-point the row.
CREATE FUNCTION projects.tender_participants_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.tender_id IS DISTINCT FROM OLD.tender_id
     OR NEW.invitation_id IS DISTINCT FROM OLD.invitation_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a tender participant cannot be moved' USING ERRCODE = '55000';
  END IF;
  -- The profile is scored (CIDB grade, B-BBEE level), so a bidder may change it
  -- only while the tender is open. The service path (no auth.uid()) is exempt.
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM projects.tenders t
        WHERE t.id = NEW.tender_id AND t.status = 'issued' AND t.closing_at > now()) THEN
    RAISE EXCEPTION 'company details can only change while the tender is open' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tender_participants_guard BEFORE UPDATE ON projects.tender_participants
  FOR EACH ROW EXECUTE FUNCTION projects.tender_participants_guard();
REVOKE ALL ON FUNCTION projects.tender_participants_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.tender_participants_guard() FROM anon, authenticated;

CREATE TRIGGER tender_invitations_set_updated_at BEFORE UPDATE ON projects.tender_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tender_participants_set_updated_at BEFORE UPDATE ON projects.tender_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Row security ────────────────────────────────────────────────────────
ALTER TABLE projects.tender_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_invitations  FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_participants FORCE ROW LEVEL SECURITY;

-- WM side: owner/admin/PM of the project, through 00226's helper.
CREATE POLICY tender_invitations_select ON projects.tender_invitations FOR SELECT TO authenticated
  USING (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_invitations_insert ON projects.tender_invitations FOR INSERT TO authenticated
  WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_invitations_update ON projects.tender_invitations FOR UPDATE TO authenticated
  USING (projects.user_can_manage_tender(tender_id)) WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_invitations_delete ON projects.tender_invitations FOR DELETE TO authenticated
  USING (projects.user_can_manage_tender(tender_id) AND status IN ('prepared','revoked'));

-- Participants: WM reads them; the participant reads and completes their own.
-- Inserts happen only on the service path (the accept action), so there is no
-- INSERT or DELETE policy for authenticated at all.
CREATE POLICY tender_participants_select ON projects.tender_participants FOR SELECT TO authenticated
  USING ((user_id = auth.uid() AND projects.session_proves_email()) OR projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_participants_update_own ON projects.tender_participants FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND projects.session_proves_email())
  WITH CHECK (user_id = auth.uid() AND projects.session_proves_email());

REVOKE ALL ON projects.tender_invitations, projects.tender_participants FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects.tender_invitations TO authenticated;
-- The schema's default privileges grant every verb to authenticated; a
-- participant row is only ever inserted or deleted on the service path, so
-- take those two away outright rather than relying on the absent policies.
REVOKE INSERT, DELETE, TRUNCATE ON projects.tender_participants FROM authenticated;
GRANT SELECT, UPDATE ON projects.tender_participants TO authenticated;
GRANT ALL ON projects.tender_invitations, projects.tender_participants TO service_role;

-- ── 4. The tenderer read path ──────────────────────────────────────────────
-- True when the caller accepted an invitation to this tender and it is no
-- longer a draft. Cancelled tenders stay readable so a bidder can see why.
CREATE FUNCTION projects.tender_participant_can_read(p_tender_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
      FROM projects.tender_participants tp
      JOIN projects.tenders t ON t.id = tp.tender_id
     WHERE tp.tender_id = p_tender_id
       AND tp.user_id = auth.uid()
       AND t.status <> 'draft'
       AND projects.session_proves_email())
$$;

-- Exactly what a tenderer may see of the tender. No reconciliation, no
-- estimate totals, no file paths.
CREATE FUNCTION projects.tender_portal_summary(p_tender_id uuid)
RETURNS TABLE (id uuid, project_name text, package text, title text, revision text,
               status text, closing_at timestamptz, organisation_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id, p.name, t.package, t.title, t.revision, t.status, t.closing_at, o.name
    FROM projects.tenders t
    JOIN projects.projects p ON p.id = t.project_id
    JOIN public.organisations o ON o.id = t.organisation_id
   WHERE t.id = p_tender_id
     AND projects.tender_participant_can_read(p_tender_id)
$$;

-- The BOQ as issued. fixed_amount is shown (a PS/PC sum is printed on the
-- tender); stated_amount of total rows is NOT (in an issued copy it is blank,
-- and if a priced workbook were ever imported as the source it would leak).
CREATE FUNCTION projects.tender_portal_items(p_tender_id uuid)
RETURNS TABLE (id uuid, sort_order int, sheet_name text, row_number int, kind text,
               bill_code text, code text, description text, unit text, quantity numeric,
               heading_path text[], rate_cell_type text, fixed_amount numeric,
               rate_column text, amount_column text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.id, i.sort_order, i.sheet_name, i.row_number, i.kind, i.bill_code, i.code,
         i.description, i.unit, i.quantity, i.heading_path, i.rate_cell_type,
         i.fixed_amount, i.rate_column, i.amount_column
    FROM projects.tender_boq_items i
   WHERE i.tender_id = p_tender_id
     AND projects.tender_participant_can_read(p_tender_id)
   ORDER BY i.sort_order
$$;

CREATE FUNCTION projects.tender_portal_requirements(p_tender_id uuid)
RETURNS TABLE (id uuid, sort_order int, kind text, label text, detail text, mandatory boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.id, r.sort_order, r.kind, r.label, r.detail, r.mandatory
    FROM projects.tender_requirements r
   WHERE r.tender_id = p_tender_id
     AND projects.tender_participant_can_read(p_tender_id)
   ORDER BY r.sort_order
$$;

-- The tenders a signed-in tenderer participates in (their home page).
CREATE FUNCTION projects.tender_portal_my_tenders()
RETURNS TABLE (id uuid, project_name text, package text, title text, revision text,
               status text, closing_at timestamptz, company_name text, profile_completed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id, p.name, t.package, t.title, t.revision, t.status, t.closing_at, tp.company_name, tp.profile_completed_at
    FROM projects.tender_participants tp
    JOIN projects.tenders t ON t.id = tp.tender_id
    JOIN projects.projects p ON p.id = t.project_id
   WHERE tp.user_id = auth.uid()
     AND t.status <> 'draft'
     AND projects.session_proves_email()
   ORDER BY t.closing_at NULLS LAST
$$;

-- Accepting an invitation, atomically, as the signed-in user it was sent to.
--
-- The link alone never creates a session: opening it only emails a sign-in
-- link to the invited address. Only someone who then signs in AS that address
-- can accept, so whoever prepared (and so holds) the link cannot become the
-- bidder. The invitation row is locked, every condition re-checked, and the
-- participant inserted and the invitation closed in one transaction.
CREATE FUNCTION projects.tender_accept(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_inv    projects.tender_invitations%ROWTYPE;
  v_tender projects.tenders%ROWTYPE;
  v_email  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'sign in first' USING ERRCODE = '42501';
  END IF;
  IF NOT projects.session_proves_email() THEN
    RAISE EXCEPTION 'sign in with the link we emailed to the invited address' USING ERRCODE = '42501';
  END IF;
  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL;
  SELECT * INTO v_inv FROM projects.tender_invitations i WHERE i.token_hash = p_token_hash FOR UPDATE;
  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'invitation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_email IS NULL OR v_email <> v_inv.email THEN
    RAISE EXCEPTION 'this invitation was sent to a different email address' USING ERRCODE = '42501';
  END IF;
  -- Whoever runs the tender can never also bid on it.
  IF projects.user_can_manage_tender(v_inv.tender_id) THEN
    RAISE EXCEPTION 'the people running a tender cannot bid on it' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status NOT IN ('prepared','sent') THEN
    RAISE EXCEPTION 'this invitation is %', v_inv.status USING ERRCODE = '55000';
  END IF;
  IF v_inv.token_expires_at IS NOT NULL AND v_inv.token_expires_at <= now() THEN
    RAISE EXCEPTION 'this invitation has expired' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_tender FROM projects.tenders t WHERE t.id = v_inv.tender_id;
  IF v_tender.status <> 'issued' OR v_tender.closing_at IS NULL OR v_tender.closing_at <= now() THEN
    RAISE EXCEPTION 'this tender is not open' USING ERRCODE = '55000';
  END IF;

  INSERT INTO projects.tender_participants (tender_id, invitation_id, user_id, company_name, contact_name, phone)
  VALUES (v_inv.tender_id, v_inv.id, auth.uid(), v_inv.company_name, v_inv.contact_name, v_inv.phone);
  UPDATE projects.tender_invitations
     SET status = 'accepted', accepted_at = now(), accepted_by = auth.uid(), token_hash = NULL
   WHERE id = v_inv.id;
  RETURN v_inv.tender_id;
END $$;
REVOKE ALL ON FUNCTION projects.tender_accept(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.tender_accept(text) FROM anon;
GRANT EXECUTE ON FUNCTION projects.tender_accept(text) TO authenticated, service_role;

-- Explicit statements (not a DO loop): the repo's static anon-EXECUTE guard reads
-- migration text, and a REVOKE built with format() is invisible to it.
REVOKE ALL ON FUNCTION projects.tender_participant_can_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_participant_can_read(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_portal_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_portal_summary(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_portal_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_portal_items(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_portal_requirements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_portal_requirements(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_portal_my_tenders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_portal_my_tenders() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- table: projects.tender_invitations
-- table: projects.tender_participants
-- constraint: tender_invitations_email_shape ON projects.tender_invitations
-- constraint: tender_invitations_accepted_consistent ON projects.tender_invitations
-- constraint: tender_participants_invitation_key ON projects.tender_participants
-- index: tender_invitations_token_hash_key ON projects.tender_invitations
-- function: projects.tender_participant_can_read(uuid)
-- function: projects.tender_portal_summary(uuid)
-- function: projects.tender_portal_items(uuid)
-- function: projects.tender_portal_requirements(uuid)
-- function: projects.tender_portal_my_tenders()
-- trigger: tender_participants_guard ON projects.tender_participants
-- policy: tender_participants_select ON projects.tender_participants
-- policy: tender_participants_update_own ON projects.tender_participants
-- policy: tender_invitations_select ON projects.tender_invitations
-- grant_absent: anon SELECT ON projects.tender_invitations
-- grant_absent: anon EXECUTE ON projects.tender_portal_items(uuid)
-- grant_absent: authenticated INSERT ON projects.tender_participants
-- grant_absent: authenticated DELETE ON projects.tender_participants
-- function: projects.tender_accept(text)
-- function: projects.session_proves_email()
-- trigger: tender_invitations_identity_guard ON projects.tender_invitations
-- grant_absent: anon EXECUTE ON projects.tender_accept(text)
-- index: tender_invitations_one_live_per_email ON projects.tender_invitations
-- constraint: tender_participants_complete_needs_fields ON projects.tender_participants
-- sql: (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('projects.tender_invitations'::regclass, 'projects.tender_participants'::regclass))
-- sql: (SELECT pg_get_functiondef('projects.tender_participant_can_read(uuid)'::regprocedure) LIKE '%session_proves_email%' AND pg_get_functiondef('projects.tender_accept(text)'::regprocedure) LIKE '%session_proves_email%')
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'projects' AND tablename IN ('tenders','tender_boq_items','tender_requirements','tender_estimate_lines') AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%tender_participant%')
-- function: projects.tender_invitations_identity_guard()
-- function: projects.tender_participants_guard()
-- @verify:end
