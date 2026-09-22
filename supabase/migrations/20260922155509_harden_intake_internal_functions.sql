
CREATE OR REPLACE FUNCTION public.claim_next_intake_job()
RETURNS public.intake_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claimed public.intake_processing_jobs%ROWTYPE;
BEGIN
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
    WHERE q.status = 'pending'
       OR (
         q.status = 'processing_failed'
         AND q.next_attempt_at IS NOT NULL
         AND q.next_attempt_at <= now()
         AND q.attempt_count < 3
       )
    ORDER BY q.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING ij.* INTO claimed;
  RETURN claimed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_next_intake_job() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_next_intake_job() FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_next_intake_job() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_intake_job() TO service_role;

CREATE OR REPLACE FUNCTION public.create_intake_processing_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.intake_processing_jobs (submission_id, event_type, status)
  VALUES (NEW.submission_id, 'intake.submitted', 'pending')
  ON CONFLICT ON CONSTRAINT intake_processing_jobs_one_per_event DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_intake_processing_job() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_intake_processing_job() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_intake_processing_job() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.find_submissions_needing_reconciliation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_submissions_needing_reconciliation() FROM anon;
REVOKE EXECUTE ON FUNCTION public.find_submissions_needing_reconciliation() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_submissions_needing_reconciliation() TO service_role;

REVOKE EXECUTE ON FUNCTION public.reconcile_consultation_jobs(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_consultation_jobs(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reconcile_consultation_jobs(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_consultation_jobs(text) TO service_role;
;
