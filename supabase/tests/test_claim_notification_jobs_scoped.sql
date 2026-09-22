-- Local SQL tests for claim_notification_jobs_for_submissions (scoped claim).
-- Runner creates fixtures + table, applies migration, runs asserts, ROLLBACK.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- T1: empty allowlist → default deny (no rows, no mutation)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'scoped-claim-empty-001';
    claimed_count int;
    attempt_after int;
    status_after text;
    job_id uuid;
BEGIN
    DELETE FROM public.notification_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.notification_jobs
        (submission_id, notification_type, recipient_type, recipient_address, status, attempt_count, max_attempts, payload)
    VALUES (sid, 'consultation.client_confirmation', 'client', 'c@example.com', 'pending', 0, 3, '{}')
    RETURNING id INTO job_id;

    SELECT count(*) INTO claimed_count
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY['consultation.client_confirmation']::text[],
        ARRAY[]::text[],
        10) AS c;

    SELECT attempt_count, status INTO attempt_after, status_after
      FROM public.notification_jobs WHERE id = job_id;

    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T1 FAIL: empty allowlist claimed rows (count=%)', claimed_count;
    END IF;
    IF attempt_after <> 0 OR status_after <> 'pending' THEN
        RAISE EXCEPTION 'T1 FAIL: row mutated attempt=% status=%', attempt_after, status_after;
    END IF;
    RAISE NOTICE 'T1 PASS: empty allowlist → default deny, no mutation';
END $$;

-- ---------------------------------------------------------------------------
-- T2: NULL allowlist → default deny
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    claimed_count int;
BEGIN
    SELECT count(*) INTO claimed_count
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY['consultation.client_confirmation']::text[],
        NULL,
        10) AS c;
    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T2 FAIL: NULL allowlist claimed rows (count=%)', claimed_count;
    END IF;
    RAISE NOTICE 'T2 PASS: NULL allowlist → default deny';
END $$;

-- ---------------------------------------------------------------------------
-- T3: empty types → no claim even with allowlist
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'scoped-claim-empty-types-001';
    claimed_count int;
    attempt_after int;
BEGIN
    DELETE FROM public.notification_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.notification_jobs
        (submission_id, notification_type, recipient_type, recipient_address, status, attempt_count, max_attempts, payload)
    VALUES (sid, 'consultation.client_confirmation', 'client', 'c@example.com', 'pending', 0, 3, '{}');

    SELECT count(*) INTO claimed_count
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY[]::text[],
        ARRAY[sid]::text[],
        10) AS c;

    SELECT attempt_count INTO attempt_after
      FROM public.notification_jobs WHERE submission_id = sid;

    IF claimed_count <> 0 OR attempt_after <> 0 THEN
        RAISE EXCEPTION 'T3 FAIL: empty types claimed (count=% attempt=%)', claimed_count, attempt_after;
    END IF;
    RAISE NOTICE 'T3 PASS: empty types → no claim';
END $$;

-- ---------------------------------------------------------------------------
-- T4: allowlist match claims exactly that job; attempt=1, status=processing
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'scoped-claim-match-001';
    other_sid text := 'scoped-claim-other-001';
    claimed_count int;
    attempt_after int;
    status_after text;
    claimed_sid text;
    other_attempt int;
BEGIN
    DELETE FROM public.notification_jobs WHERE submission_id IN (sid, other_sid);
    DELETE FROM public.consultation_submissions WHERE submission_id IN (sid, other_sid);
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com'),
           (other_sid, 'OtherBrand', 'o@example.com');
    INSERT INTO public.notification_jobs
        (submission_id, notification_type, recipient_type, recipient_address, status, attempt_count, max_attempts, payload)
    VALUES (sid, 'consultation.client_confirmation', 'client', 'c@example.com', 'pending', 0, 3, '{}'),
           (other_sid, 'consultation.client_confirmation', 'client', 'o@example.com', 'pending', 0, 3, '{}');

    SELECT count(*), min(c.submission_id) INTO claimed_count, claimed_sid
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY['consultation.client_confirmation']::text[],
        ARRAY[sid]::text[],
        10) AS c;

    SELECT attempt_count, status INTO attempt_after, status_after
      FROM public.notification_jobs WHERE submission_id = sid;
    SELECT attempt_count INTO other_attempt
      FROM public.notification_jobs WHERE submission_id = other_sid;

    IF claimed_count <> 1 OR claimed_sid <> sid THEN
        RAISE EXCEPTION 'T4 FAIL: expected 1 claim for sid, got count=% sid=%',
            claimed_count, claimed_sid;
    END IF;
    IF attempt_after <> 1 OR status_after <> 'processing' THEN
        RAISE EXCEPTION 'T4 FAIL: expected attempt=1 processing got attempt=% status=%',
            attempt_after, status_after;
    END IF;
    IF other_attempt <> 0 THEN
        RAISE EXCEPTION 'T4 FAIL: out-of-allowlist job mutated attempt=%', other_attempt;
    END IF;
    RAISE NOTICE 'T4 PASS: allowlist scoping claims only authorized submission';
END $$;

-- ---------------------------------------------------------------------------
-- T5: type filter still applies (wrong type not claimed)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'scoped-claim-type-001';
    claimed_count int;
    attempt_after int;
BEGIN
    DELETE FROM public.notification_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.notification_jobs
        (submission_id, notification_type, recipient_type, recipient_address, status, attempt_count, max_attempts, payload)
    VALUES (sid, 'consultation.client_confirmation', 'client', 'c@example.com', 'pending', 0, 3, '{}');

    SELECT count(*) INTO claimed_count
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY['consultation.internal_notification']::text[],
        ARRAY[sid]::text[],
        10) AS c;
    SELECT attempt_count INTO attempt_after
      FROM public.notification_jobs WHERE submission_id = sid;

    IF claimed_count <> 0 OR attempt_after <> 0 THEN
        RAISE EXCEPTION 'T5 FAIL: wrong type claimed (count=% attempt=%)', claimed_count, attempt_after;
    END IF;
    RAISE NOTICE 'T5 PASS: type filter respected under allowlist';
END $$;

-- ---------------------------------------------------------------------------
-- T6: max_attempts guard (attempt=3/3 not claimable)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'scoped-claim-max-001';
    claimed_count int;
    attempt_after int;
BEGIN
    DELETE FROM public.notification_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.notification_jobs
        (submission_id, notification_type, recipient_type, recipient_address, status,
         attempt_count, max_attempts, next_attempt_at, payload)
    VALUES (sid, 'consultation.client_confirmation', 'client', 'c@example.com', 'pending',
            3, 3, now() - interval '1 minute', '{}');

    SELECT count(*) INTO claimed_count
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY['consultation.client_confirmation']::text[],
        ARRAY[sid]::text[],
        10) AS c;
    SELECT attempt_count INTO attempt_after
      FROM public.notification_jobs WHERE submission_id = sid;

    IF claimed_count <> 0 OR attempt_after <> 3 THEN
        RAISE EXCEPTION 'T6 FAIL: claimed beyond max_attempts (count=% attempt=%)',
            claimed_count, attempt_after;
    END IF;
    RAISE NOTICE 'T6 PASS: attempt 3/3 not claimable';
END $$;

-- ---------------------------------------------------------------------------
-- T7: future next_attempt_at blocks claim
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'scoped-claim-future-001';
    claimed_count int;
BEGIN
    DELETE FROM public.notification_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.notification_jobs
        (submission_id, notification_type, recipient_type, recipient_address, status,
         attempt_count, max_attempts, next_attempt_at, payload)
    VALUES (sid, 'consultation.client_confirmation', 'client', 'c@example.com', 'pending',
            0, 3, now() + interval '10 minutes', '{}');

    SELECT count(*) INTO claimed_count
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY['consultation.client_confirmation']::text[],
        ARRAY[sid]::text[],
        10) AS c;
    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T7 FAIL: claimed before next_attempt_at (count=%)', claimed_count;
    END IF;
    RAISE NOTICE 'T7 PASS: future next_attempt_at blocks claim';
END $$;

-- ---------------------------------------------------------------------------
-- T8: non-pending statuses never claimable
-- (4 rows via distinct (notification_type, recipient_type) — unique index safe)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'scoped-claim-status-001';
    claimed_count int;
BEGIN
    DELETE FROM public.notification_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');

    INSERT INTO public.notification_jobs
        (submission_id, notification_type, recipient_type, recipient_address, status,
         attempt_count, max_attempts, next_attempt_at, payload)
    VALUES
        (sid, 'consultation.client_confirmation', 'client', 'c@example.com', 'processing',
         1, 3, now() - interval '1 hour', '{}'),
        (sid, 'consultation.client_confirmation', 'internal', 'k@example.com', 'sent',
         1, 3, now() - interval '1 hour', '{}'),
        (sid, 'consultation.internal_notification', 'client', 'c@example.com', 'failed',
         1, 3, now() - interval '1 hour', '{}'),
        (sid, 'consultation.internal_notification', 'internal', 'k@example.com', 'needs_review',
         1, 3, now() - interval '1 hour', '{}');

    SELECT count(*) INTO claimed_count
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY['consultation.client_confirmation', 'consultation.internal_notification']::text[],
        ARRAY[sid]::text[],
        10) AS c;
    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T8 FAIL: non-pending status claimed (count=%)', claimed_count;
    END IF;
    RAISE NOTICE 'T8 PASS: non-pending status never claimable';
END $$;

-- ---------------------------------------------------------------------------
-- T9: repeat claim single winner (no duplicate claim of same row)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'scoped-claim-repeat-001';
    first_count int;
    second_count int;
    attempt_final int;
BEGIN
    DELETE FROM public.notification_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.notification_jobs
        (submission_id, notification_type, recipient_type, recipient_address, status, attempt_count, max_attempts, payload)
    VALUES (sid, 'consultation.client_confirmation', 'client', 'c@example.com', 'pending', 0, 3, '{}');

    SELECT count(*) INTO first_count
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY['consultation.client_confirmation']::text[],
        ARRAY[sid]::text[], 10) AS c;
    SELECT count(*) INTO second_count
      FROM public.claim_notification_jobs_for_submissions(
        ARRAY['consultation.client_confirmation']::text[],
        ARRAY[sid]::text[], 10) AS c;
    SELECT attempt_count INTO attempt_final
      FROM public.notification_jobs WHERE submission_id = sid;

    IF first_count <> 1 OR second_count <> 0 OR attempt_final <> 1 THEN
        RAISE EXCEPTION 'T9 FAIL: first=% second=% attempt=%', first_count, second_count, attempt_final;
    END IF;
    RAISE NOTICE 'T9 PASS: repeat claim single winner, attempt_count=1 (incremented once)';
END $$;

-- ---------------------------------------------------------------------------
-- T10: ACL — anon/authenticated/PUBLIC no EXECUTE; service_role yes
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    fn text := 'public.claim_notification_jobs_for_submissions(text[], text[], integer)';
    has_anon boolean;
    has_auth boolean;
    has_service boolean;
    has_public boolean;
BEGIN
    SELECT has_function_privilege('anon', fn, 'EXECUTE') INTO has_anon;
    SELECT has_function_privilege('authenticated', fn, 'EXECUTE') INTO has_auth;
    SELECT has_function_privilege('service_role', fn, 'EXECUTE') INTO has_service;
    SELECT has_function_privilege('public', fn, 'EXECUTE') INTO has_public;

    IF has_anon THEN RAISE EXCEPTION 'T10 FAIL: anon has EXECUTE'; END IF;
    IF has_auth THEN RAISE EXCEPTION 'T10 FAIL: authenticated has EXECUTE'; END IF;
    IF NOT has_service THEN RAISE EXCEPTION 'T10 FAIL: service_role missing EXECUTE'; END IF;
    IF has_public THEN RAISE EXCEPTION 'T10 FAIL: PUBLIC still has EXECUTE'; END IF;
    RAISE NOTICE 'T10 PASS: ACL anon=no authenticated=no PUBLIC=no service_role=yes';
END $$;

-- ---------------------------------------------------------------------------
-- T11: search_path hardened
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sp text;
BEGIN
    SELECT coalesce(array_to_string(proconfig, ','), '') INTO sp
      FROM pg_proc
     WHERE oid = 'public.claim_notification_jobs_for_submissions(text[], text[], integer)'::regprocedure;
    IF position('search_path' in sp) = 0 THEN
        RAISE EXCEPTION 'T11 FAIL: search_path not set, got %', sp;
    END IF;
    RAISE NOTICE 'T11 PASS: search_path=%', sp;
END $$;
