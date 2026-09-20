-- ==========================================================================
-- Ingressible — Claim Notification Jobs Function
-- Atomic job claiming for the notification worker.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.claim_notification_jobs(
    p_types text[],
    p_limit integer DEFAULT 10
)
RETURNS SETOF notification_jobs
LANGUAGE plpgsql
AS $$
DECLARE
    job_record notification_jobs;
BEGIN
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
              AND notification_type = ANY($1)
              AND (next_attempt_at IS NULL OR next_attempt_at <= now())
              AND attempt_count < max_attempts
            ORDER BY created_at ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
        ) locked
        WHERE notification_jobs.id = locked.id
        RETURNING notification_jobs.*
    LOOP
        RETURN NEXT job_record;
    END LOOP;
END;
$$;