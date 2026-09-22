-- Local SQL tests for hardened claim RPC (run against Docker supabase_db).
-- Runner creates minimal fixtures, applies migration, then runs these asserts, ROLLBACK.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- T1–T5: claim eligibility / max-attempt guard
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'test-claim-max-attempt-001';
    j public.intake_processing_jobs;
    claimed_count int;
    attempt_after int;
    status_after text;
BEGIN
    DELETE FROM public.intake_processing_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');

    -- T1: claim pending job increments attempt once, sets processing
    INSERT INTO public.intake_processing_jobs (submission_id, status, attempt_count, max_attempts)
    VALUES (sid, 'pending', 0, 3);

    SELECT * INTO j FROM public.claim_next_intake_job_for_submission(sid);
    IF j.id IS NULL THEN
        RAISE EXCEPTION 'T1 FAIL: expected claim of pending job';
    END IF;
    IF j.attempt_count <> 1 OR j.status <> 'processing' THEN
        RAISE EXCEPTION 'T1 FAIL: expected attempt=1 status=processing got attempt=% status=%',
            j.attempt_count, j.status;
    END IF;
    RAISE NOTICE 'T1 PASS: claim pending → attempt=1 processing';

    -- T2: at max attempts with next_attempt_at NULL must NOT claim (attempt 4 bug)
    UPDATE public.intake_processing_jobs
       SET status = 'processing_failed', attempt_count = 3, next_attempt_at = NULL
     WHERE id = j.id;

    SELECT count(*) INTO claimed_count
    FROM public.claim_next_intake_job_for_submission(sid) AS c;

    SELECT attempt_count, status
      INTO attempt_after, status_after
      FROM public.intake_processing_jobs WHERE id = j.id;

    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T2 FAIL: claimed beyond max_attempts (count=%)', claimed_count;
    END IF;
    IF attempt_after <> 3 OR status_after <> 'processing_failed' THEN
        RAISE EXCEPTION 'T2 FAIL: row mutated attempt=% status=%', attempt_after, status_after;
    END IF;
    RAISE NOTICE 'T2 PASS: attempt_count=3 max_attempts=3 → no claim (max-attempt guard)';

    -- T3: processing_failed with next_attempt_at past and attempt < max → claims
    UPDATE public.intake_processing_jobs
       SET status = 'processing_failed', attempt_count = 1,
           next_attempt_at = now() - interval '1 minute', max_attempts = 3
     WHERE id = j.id;

    SELECT * INTO j FROM public.claim_next_intake_job_for_submission(sid);
    IF j.attempt_count <> 2 OR j.status <> 'processing' THEN
        RAISE EXCEPTION 'T3 FAIL: expected retry claim attempt=2 got % status=%',
            j.attempt_count, j.status;
    END IF;
    IF j.next_attempt_at IS NOT NULL THEN
        RAISE EXCEPTION 'T3 FAIL: next_attempt_at should clear on claim';
    END IF;
    RAISE NOTICE 'T3 PASS: due retry claimed, attempt=2, next_attempt_at cleared';

    -- T4: processing_failed with future next_attempt_at → not yet due
    UPDATE public.intake_processing_jobs
       SET status = 'processing_failed', attempt_count = 1,
           next_attempt_at = now() + interval '10 minutes'
     WHERE id = j.id;

    SELECT count(*) INTO claimed_count
    FROM public.claim_next_intake_job_for_submission(sid) AS c;
    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T4 FAIL: claimed before next_attempt_at';
    END IF;
    RAISE NOTICE 'T4 PASS: future next_attempt_at blocks claim';

    -- T5: global claim_next_intake_job returns this due job when nothing else locks it
    UPDATE public.intake_processing_jobs
       SET status = 'processing_failed', attempt_count = 1,
           next_attempt_at = now() - interval '1 minute'
     WHERE id = j.id;

    SELECT * INTO j FROM public.claim_next_intake_job();
    IF j.id IS NULL OR j.attempt_count <> 2 OR j.status <> 'processing' THEN
        RAISE EXCEPTION 'T5 FAIL: global claim expected attempt=2 got id=% attempt=% status=%',
            j.id, j.attempt_count, j.status;
    END IF;
    RAISE NOTICE 'T5 PASS: claim_next_intake_job claimed due job';

    -- Reset to terminal for ACL section isolation
    UPDATE public.intake_processing_jobs SET status = 'processed', completed_at = now() WHERE id = j.id;
END $$;

-- ---------------------------------------------------------------------------
-- T6: ACL — anon/authenticated/PUBLIC must not EXECUTE; service_role must
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    fn text := 'public.claim_next_intake_job_for_submission(text)';
    has_anon boolean;
    has_auth boolean;
    has_service boolean;
    has_public boolean;
BEGIN
    SELECT has_function_privilege('anon', fn, 'EXECUTE') INTO has_anon;
    SELECT has_function_privilege('authenticated', fn, 'EXECUTE') INTO has_auth;
    SELECT has_function_privilege('service_role', fn, 'EXECUTE') INTO has_service;
    SELECT has_function_privilege('public', fn, 'EXECUTE') INTO has_public;

    IF has_anon THEN
        RAISE EXCEPTION 'T6 FAIL: anon has EXECUTE';
    END IF;
    IF has_auth THEN
        RAISE EXCEPTION 'T6 FAIL: authenticated has EXECUTE';
    END IF;
    IF NOT has_service THEN
        RAISE EXCEPTION 'T6 FAIL: service_role missing EXECUTE';
    END IF;
    IF has_public THEN
        RAISE EXCEPTION 'T6 FAIL: PUBLIC still has EXECUTE';
    END IF;
    RAISE NOTICE 'T6 PASS: ACL anon=no authenticated=no PUBLIC=no service_role=yes';
END $$;

-- ---------------------------------------------------------------------------
-- T7: search_path hardened (empty or explicit)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sp text;
BEGIN
    SELECT coalesce(array_to_string(proconfig, ','), '') INTO sp
      FROM pg_proc
     WHERE oid = 'public.claim_next_intake_job_for_submission(text)'::regprocedure;
    IF position('search_path' in sp) = 0 THEN
        RAISE EXCEPTION 'T7 FAIL: search_path not set, got %', sp;
    END IF;
    RAISE NOTICE 'T7 PASS: search_path=%', sp;
END $$;
