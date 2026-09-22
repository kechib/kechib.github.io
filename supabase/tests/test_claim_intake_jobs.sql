-- Local SQL tests for hardened claim RPC (run against Docker supabase_db).
-- Runner creates minimal fixtures, applies migration, then runs these asserts, ROLLBACK.
-- Coverage: T1 pending claim; T2 max-attempt guard; T3 due retry attempt=2;
--   T4 future next_attempt; T5 global claim; T6 ACL; T7 search_path;
--   T8 NULL next_attempt terminal; T9 needs_review/processed/processing never;
--   T10 attempt ladder 1..3 then attempt-4 impossible; T11 single winner;
--   T12 global claim skips terminal processing_failed.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- T1–T7: claim eligibility / max-attempt guard / ACL / search_path
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

    -- T2: at max attempts with due next_attempt must NOT claim (attempt 4 bug)
    UPDATE public.intake_processing_jobs
       SET status = 'processing_failed', attempt_count = 3,
           next_attempt_at = now() - interval '1 second'
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

-- ---------------------------------------------------------------------------
-- T8: processing_failed + NULL next_attempt_at is terminal (not claimable)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'test-claim-null-next-001';
    j public.intake_processing_jobs;
    claimed_count int;
    attempt_after int;
    status_after text;
BEGIN
    DELETE FROM public.intake_processing_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.intake_processing_jobs (submission_id, status, attempt_count, max_attempts, next_attempt_at)
    VALUES (sid, 'processing_failed', 1, 3, NULL);

    SELECT count(*) INTO claimed_count
    FROM public.claim_next_intake_job_for_submission(sid) AS c;

    SELECT attempt_count, status INTO attempt_after, status_after
      FROM public.intake_processing_jobs WHERE submission_id = sid;

    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T8 FAIL: claimed processing_failed with NULL next_attempt_at (count=%)', claimed_count;
    END IF;
    IF attempt_after <> 1 OR status_after <> 'processing_failed' THEN
        RAISE EXCEPTION 'T8 FAIL: row mutated attempt=% status=%', attempt_after, status_after;
    END IF;
    RAISE NOTICE 'T8 PASS: NULL next_attempt_at terminal, not claimable';
END $$;

-- ---------------------------------------------------------------------------
-- T9: needs_review / processed never claimable (even with due next_attempt)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'test-claim-terminal-001';
    claimed_count int;
BEGIN
    DELETE FROM public.intake_processing_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');

    INSERT INTO public.intake_processing_jobs (submission_id, status, attempt_count, max_attempts, next_attempt_at)
    VALUES (sid, 'needs_review', 0, 3, now() - interval '1 hour');

    SELECT count(*) INTO claimed_count
    FROM public.claim_next_intake_job_for_submission(sid) AS c;
    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T9 FAIL: needs_review claimed (count=%)', claimed_count;
    END IF;

    UPDATE public.intake_processing_jobs
       SET status = 'processed', next_attempt_at = now() - interval '1 hour',
           completed_at = now()
     WHERE submission_id = sid;

    SELECT count(*) INTO claimed_count
    FROM public.claim_next_intake_job_for_submission(sid) AS c;
    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T9 FAIL: processed claimed (count=%)', claimed_count;
    END IF;

    -- processing status must not be claimable
    UPDATE public.intake_processing_jobs
       SET status = 'processing', next_attempt_at = now() - interval '1 hour',
           completed_at = NULL
     WHERE submission_id = sid;

    SELECT count(*) INTO claimed_count
    FROM public.claim_next_intake_job_for_submission(sid) AS c;
    IF claimed_count <> 0 THEN
        RAISE EXCEPTION 'T9 FAIL: processing claimed (count=%)', claimed_count;
    END IF;
    RAISE NOTICE 'T9 PASS: needs_review/processed/processing never claimable';
END $$;

-- ---------------------------------------------------------------------------
-- T10: due retry reaches attempt 3; attempt 4 impossible
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'test-claim-attempt-ladder-001';
    job_id uuid;
    got_attempt int;
    claimed_count int;
    attempt_final int;
    expected_attempt int;
BEGIN
    DELETE FROM public.intake_processing_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.intake_processing_jobs (submission_id, status, attempt_count, max_attempts)
    VALUES (sid, 'pending', 0, 3)
    RETURNING id INTO job_id;

    FOR expected_attempt IN 1..3 LOOP
        SELECT id, attempt_count INTO job_id, got_attempt
          FROM public.claim_next_intake_job_for_submission(sid);
        IF job_id IS NULL OR got_attempt <> expected_attempt THEN
            RAISE EXCEPTION 'T10 FAIL: expected claim attempt=% got attempt=% id=%',
                expected_attempt, got_attempt, job_id;
        END IF;
        IF expected_attempt < 3 THEN
            UPDATE public.intake_processing_jobs
               SET status = 'processing_failed',
                   next_attempt_at = now() - interval '1 second'
             WHERE id = job_id;
        END IF;
    END LOOP;

    -- force due retry at attempt 3 → must NOT claim (attempt 4 impossible)
    UPDATE public.intake_processing_jobs
       SET status = 'processing_failed',
           next_attempt_at = now() - interval '1 second'
     WHERE id = job_id;

    SELECT count(*) INTO claimed_count
      FROM public.claim_next_intake_job_for_submission(sid) AS c;
    SELECT attempt_count INTO attempt_final
      FROM public.intake_processing_jobs WHERE id = job_id;

    IF claimed_count <> 0 OR attempt_final <> 3 THEN
        RAISE EXCEPTION 'T10 FAIL: attempt 4 possible (count=% attempt=%)',
            claimed_count, attempt_final;
    END IF;
    RAISE NOTICE 'T10 PASS: attempts 1→2→3 claimed; attempt 4 impossible';
END $$;

-- ---------------------------------------------------------------------------
-- T11: concurrent claim — single winner, single increment
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'test-claim-concurrent-001';
    id_a uuid;
    second_count int;
    attempt_final int;
BEGIN
    DELETE FROM public.intake_processing_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.intake_processing_jobs (submission_id, status, attempt_count, max_attempts)
    VALUES (sid, 'pending', 0, 3)
    RETURNING id INTO id_a;

    -- first claim wins
    PERFORM id FROM public.claim_next_intake_job_for_submission(sid);

    -- second claim (same job now processing) must find nothing
    SELECT count(*) INTO second_count
      FROM public.claim_next_intake_job_for_submission(sid) AS c;

    SELECT attempt_count INTO attempt_final
      FROM public.intake_processing_jobs WHERE id = id_a;

    IF second_count <> 0 THEN
        RAISE EXCEPTION 'T11 FAIL: second claim succeeded (count=%)', second_count;
    END IF;
    IF attempt_final <> 1 THEN
        RAISE EXCEPTION 'T11 FAIL: attempt_count incremented more than once (%)', attempt_final;
    END IF;
    RAISE NOTICE 'T11 PASS: concurrent/repeat claim single winner, attempt_count=1';
END $$;

-- ---------------------------------------------------------------------------
-- T12: global claim skips NULL-next_attempt processing_failed rows
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    sid text := 'test-claim-global-null-001';
    claimed_id uuid;
    attempt_after int;
    status_after text;
BEGIN
    DELETE FROM public.intake_processing_jobs WHERE submission_id = sid;
    DELETE FROM public.consultation_submissions WHERE submission_id = sid;
    INSERT INTO public.consultation_submissions (submission_id, brand, contact_email)
    VALUES (sid, 'TestBrand', 't@example.com');
    INSERT INTO public.intake_processing_jobs (submission_id, status, attempt_count, max_attempts, next_attempt_at)
    VALUES (sid, 'processing_failed', 2, 3, NULL);

    SELECT id INTO claimed_id
      FROM public.claim_next_intake_job()
     WHERE submission_id = sid;

    SELECT attempt_count, status INTO attempt_after, status_after
      FROM public.intake_processing_jobs WHERE submission_id = sid;

    IF claimed_id IS NOT NULL THEN
        RAISE EXCEPTION 'T12 FAIL: global claim took NULL-next_attempt job';
    END IF;
    IF attempt_after <> 2 OR status_after <> 'processing_failed' THEN
        RAISE EXCEPTION 'T12 FAIL: row mutated attempt=% status=%', attempt_after, status_after;
    END IF;
    RAISE NOTICE 'T12 PASS: global claim skips terminal processing_failed';
END $$;
