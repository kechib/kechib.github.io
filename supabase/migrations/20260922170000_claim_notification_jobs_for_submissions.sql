-- ==========================================================================
-- Ingressible — Scoped notification job claim (default-deny allowlist)
--
-- claim_notification_jobs_for_submissions:
--   - Atomic FOR UPDATE SKIP LOCKED claim, identical eligibility rules to
--     claim_notification_jobs (status='pending', type in list, due,
--     attempt_count < max_attempts).
--   - Additional mandatory filter: submission_id = ANY(p_submission_ids).
--   - Empty / NULL allowlist returns nothing (default deny) — the worker can
--     never fall back to an unscoped backlog claim.
--   - attempt_count incremented exactly once here (worker never increments).
--   - SECURITY DEFINER, SET search_path = '', service_role only.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.claim_notification_jobs_for_submissions(
    p_types text[],
    p_submission_ids text[],
    p_limit integer DEFAULT 10
)
RETURNS SETOF public.notification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    job_record public.notification_jobs%ROWTYPE;
    v_limit integer;
BEGIN
    IF p_types IS NULL
       OR array_length(p_types, 1) IS NULL
       OR array_length(p_types, 1) = 0 THEN
        RETURN;
    END IF;

    -- Default deny: no allowlist → no claim.
    IF p_submission_ids IS NULL
       OR array_length(p_submission_ids, 1) IS NULL
       OR array_length(p_submission_ids, 1) = 0 THEN
        RETURN;
    END IF;

    v_limit := COALESCE(p_limit, 10);
    IF v_limit <= 0 THEN
        RETURN;
    END IF;
    v_limit := LEAST(v_limit, 100);

    FOR job_record IN
        UPDATE public.notification_jobs nj
        SET
            status = 'processing',
            started_at = now(),
            attempt_count = attempt_count + 1,
            updated_at = now()
        FROM (
            SELECT id
            FROM public.notification_jobs
            WHERE status = 'pending'
              AND notification_type = ANY(p_types)
              AND submission_id = ANY(p_submission_ids)
              AND (next_attempt_at IS NULL OR next_attempt_at <= now())
              AND attempt_count < max_attempts
            ORDER BY created_at ASC
            LIMIT v_limit
            FOR UPDATE SKIP LOCKED
        ) locked
        WHERE nj.id = locked.id
        RETURNING nj.*
    LOOP
        RETURN NEXT job_record;
    END LOOP;
END;
$$;

REVOKE EXECUTE
    ON FUNCTION public.claim_notification_jobs_for_submissions(text[], text[], integer)
    FROM PUBLIC;

REVOKE EXECUTE
    ON FUNCTION public.claim_notification_jobs_for_submissions(text[], text[], integer)
    FROM anon;

REVOKE EXECUTE
    ON FUNCTION public.claim_notification_jobs_for_submissions(text[], text[], integer)
    FROM authenticated;

GRANT EXECUTE
    ON FUNCTION public.claim_notification_jobs_for_submissions(text[], text[], integer)
    TO service_role;
