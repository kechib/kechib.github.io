
CREATE OR REPLACE FUNCTION public.claim_next_intake_job_for_submission(
    p_submission_id text
)
RETURNS SETOF public.intake_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.intake_processing_jobs ij
  SET
    status = 'processing',
    started_at = now(),
    completed_at = NULL,
    attempt_count = ij.attempt_count + 1,
    updated_at = now()
  WHERE ij.id = (
    SELECT q.id
    FROM public.intake_processing_jobs q
    WHERE q.submission_id = p_submission_id
      AND (
        q.status = 'pending'
        OR (
          q.status = 'processing_failed'
          AND q.next_attempt_at IS NOT NULL
          AND q.next_attempt_at <= now()
          AND q.attempt_count < 3
        )
      )
    ORDER BY q.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING ij.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_next_intake_job_for_submission(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_next_intake_job_for_submission(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_next_intake_job_for_submission(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_intake_job_for_submission(text) TO service_role;
;
