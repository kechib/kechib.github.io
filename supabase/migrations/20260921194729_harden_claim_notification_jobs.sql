-- ==========================================================================
-- Ingressible — Harden claim_notification_jobs Execution Scope
--
-- Restricts the notification job-claiming RPC to service_role only.
--
-- - Preserves the atomic FOR UPDATE SKIP LOCKED claim semantics.
-- - Hardens search_path to '' (fully qualified object references).
-- - Revokes PUBLIC / anon / authenticated execute privileges.
-- - Grants execute exclusively to service_role.
-- - Adds defensive input handling for p_types and p_limit.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.claim_notification_jobs(
    p_types text[],
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
    ON FUNCTION public.claim_notification_jobs(text[], integer)
    FROM PUBLIC;

REVOKE EXECUTE
    ON FUNCTION public.claim_notification_jobs(text[], integer)
    FROM anon;

REVOKE EXECUTE
    ON FUNCTION public.claim_notification_jobs(text[], integer)
    FROM authenticated;

GRANT EXECUTE
    ON FUNCTION public.claim_notification_jobs(text[], integer)
    TO service_role;