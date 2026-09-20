-- ==========================================================================
-- Ingressible — Reconciliation Query
-- Identify submissions with missing expected jobs.
-- ==========================================================================

-- View to identify submissions with missing expected jobs
CREATE OR REPLACE VIEW public.v_submissions_missing_jobs AS
SELECT
    cs.submission_id,
    cs.public_reference,
    cs.brand,
    cs.contact_name,
    cs.contact_email,
    cs.created_at,
    -- Check intake job
    (NOT EXISTS (
        SELECT 1 FROM public.intake_processing_jobs ij
        WHERE ij.submission_id = cs.submission_id
    )) AS intake_job_missing,
    -- Check client notification
    (NOT EXISTS (
        SELECT 1 FROM public.notification_jobs nj
        WHERE nj.submission_id = cs.submission_id
          AND nj.notification_type = 'consultation.client_confirmation'
          AND nj.recipient_type = 'client'
    )) AS client_notification_missing,
    -- Check internal notification
    (NOT EXISTS (
        SELECT 1 FROM public.notification_jobs nj
        WHERE nj.submission_id = cs.submission_id
          AND nj.notification_type = 'consultation.internal_notification'
          AND nj.recipient_type = 'internal'
    )) AS internal_notification_missing,
    -- Overall missing flag
    (
        (NOT EXISTS (SELECT 1 FROM public.intake_processing_jobs ij WHERE ij.submission_id = cs.submission_id))
        OR (NOT EXISTS (
            SELECT 1 FROM public.notification_jobs nj
            WHERE nj.submission_id = cs.submission_id
              AND nj.notification_type = 'consultation.client_confirmation'
              AND nj.recipient_type = 'client'
        ))
        OR (NOT EXISTS (
            SELECT 1 FROM public.notification_jobs nj
            WHERE nj.submission_id = cs.submission_id
              AND nj.notification_type = 'consultation.internal_notification'
              AND nj.recipient_type = 'internal'
        ))
    ) AS has_missing_jobs
FROM public.consultation_submissions cs
WHERE cs.status IN ('submitted', 'needs_review');

-- Function to find submissions needing reconciliation
CREATE OR REPLACE FUNCTION public.find_submissions_needing_reconciliation()
RETURNS SETOF public.consultation_submissions
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT *
    FROM public.v_submissions_missing_jobs
    WHERE has_missing_jobs = true
    ORDER BY created_at ASC;
$$;

-- Function to reconcile a specific submission
CREATE OR REPLACE FUNCTION public.reconcile_consultation_jobs(
    p_submission_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    result jsonb;
BEGIN
    -- Use the ensure_consultation_jobs function
    RETURN public.ensure_consultation_jobs(p_submission_id);
END;
$$;