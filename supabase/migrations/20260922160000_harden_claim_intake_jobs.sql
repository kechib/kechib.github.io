-- ==========================================================================
-- Ingressible — Harden claim_next_intake_job_for_submission (+ sibling)
-- Forward migration: max-attempt guard, attempt eligibility, ACL lockdown.
-- Production defects addressed:
--   * claim eligible when attempt_count >= max (no guard) → attempt 4+
--   * processing_failed with NULL next_attempt_at wrongly claimable (mass retry)
--   * SECURITY DEFINER with broad PUBLIC/anon/authenticated EXECUTE
--   * no max_attempts column on intake_processing_jobs (add if missing)
-- Idempotent: safe to re-apply.
-- ==========================================================================

-- 1) max_attempts column (production currently lacks it; default matches app MAX_ATTEMPTS=3)
ALTER TABLE public.intake_processing_jobs
    ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'intake_processing_jobs_max_attempts_check'
          AND conrelid = 'public.intake_processing_jobs'::regclass
    ) THEN
        ALTER TABLE public.intake_processing_jobs
            ADD CONSTRAINT intake_processing_jobs_max_attempts_check
            CHECK (max_attempts >= 1);
    END IF;
END $$;

-- 2) Claim RPC scoped to one submission (used by process-intake-submission).
--    Eligibility:
--      * pending/queued: claimable (first claim may have next_attempt_at NULL)
--      * processing_failed: claimable ONLY if next_attempt_at IS NOT NULL
--        AND next_attempt_at <= now() (NULL next_attempt_at = terminal, no
--        automatic retry) AND attempt_count < max_attempts
--      * processing / processed / needs_review: NEVER claimable
--    Atomic: FOR UPDATE SKIP LOCKED; increments attempt_count exactly once.
--    DROP first: prod return type may differ (SQLSTATE 42P13 under CREATE OR REPLACE).
DROP FUNCTION IF EXISTS public.claim_next_intake_job_for_submission(text);
CREATE OR REPLACE FUNCTION public.claim_next_intake_job_for_submission(
    p_submission_id text
)
RETURNS SETOF public.intake_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    job_record public.intake_processing_jobs;
BEGIN
    FOR job_record IN
        UPDATE public.intake_processing_jobs AS t
        SET
            status = 'processing',
            started_at = COALESCE(t.started_at, now()),
            attempt_count = t.attempt_count + 1,
            next_attempt_at = NULL,
            updated_at = now()
        FROM (
            SELECT id
            FROM public.intake_processing_jobs
            WHERE submission_id = p_submission_id
              AND (
                    status IN ('pending', 'queued')
                    OR (
                        status = 'processing_failed'
                        AND next_attempt_at IS NOT NULL
                        AND next_attempt_at <= now()
                    )
              )
              AND attempt_count < max_attempts
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
        ) AS locked
        WHERE t.id = locked.id
        RETURNING t.*
    LOOP
        RETURN NEXT job_record;
    END LOOP;
END;
$$;

-- 3) Global claim (retry dispatcher / sweeper): next due job across submissions.
--    DROP first: prod return type may differ (SQLSTATE 42P13 under CREATE OR REPLACE).
DROP FUNCTION IF EXISTS public.claim_next_intake_job();
CREATE OR REPLACE FUNCTION public.claim_next_intake_job()
RETURNS SETOF public.intake_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    job_record public.intake_processing_jobs;
BEGIN
    FOR job_record IN
        UPDATE public.intake_processing_jobs AS t
        SET
            status = 'processing',
            started_at = COALESCE(t.started_at, now()),
            attempt_count = t.attempt_count + 1,
            next_attempt_at = NULL,
            updated_at = now()
        FROM (
            SELECT id
            FROM public.intake_processing_jobs
            WHERE (
                    status IN ('pending', 'queued')
                    OR (
                        status = 'processing_failed'
                        AND next_attempt_at IS NOT NULL
                        AND next_attempt_at <= now()
                    )
              )
              AND attempt_count < max_attempts
            ORDER BY COALESCE(next_attempt_at, created_at) ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        ) AS locked
        WHERE t.id = locked.id
        RETURNING t.*
    LOOP
        RETURN NEXT job_record;
    END LOOP;
END;
$$;

-- 4) ACL: service_role only. Strip PUBLIC/anon/authenticated EXECUTE.
REVOKE ALL ON FUNCTION public.claim_next_intake_job_for_submission(text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_intake_job_for_submission(text)
    TO service_role;

REVOKE ALL ON FUNCTION public.claim_next_intake_job()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_intake_job()
    TO service_role;

COMMENT ON FUNCTION public.claim_next_intake_job_for_submission(text) IS
    'Atomically claim one intake job for a submission (SKIP LOCKED). Enforces attempt_count < max_attempts. service_role only.';
COMMENT ON FUNCTION public.claim_next_intake_job() IS
    'Atomically claim the next due intake job across submissions (SKIP LOCKED). Enforces attempt_count < max_attempts. service_role only.';
