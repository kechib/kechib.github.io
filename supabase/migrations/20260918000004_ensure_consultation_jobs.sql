-- ==========================================================================
-- Ingressible — Consultation Job Reconciliation
-- Idempotent function to ensure all expected jobs exist for a submission.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.ensure_consultation_jobs(
    p_submission_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    result jsonb := '{}'::jsonb;
    submission_exists boolean;
    intake_job_exists boolean;
    client_notif_exists boolean;
    internal_notif_exists boolean;
    submission_record public.consultation_submissions%ROWTYPE;
BEGIN
    -- Verify submission exists
    SELECT * INTO submission_record
    FROM public.consultation_submissions
    WHERE submission_id = p_submission_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'error', 'Submission not found',
            'submission_id', p_submission_id
        );
    END IF;

    -- Check existing jobs
    SELECT EXISTS(
        SELECT 1 FROM public.intake_processing_jobs
        WHERE submission_id = p_submission_id
    ) INTO intake_job_exists;

    SELECT EXISTS(
        SELECT 1 FROM public.notification_jobs
        WHERE submission_id = p_submission_id
        AND notification_type = 'consultation.client_confirmation'
        AND recipient_type = 'client'
    ) INTO client_notif_exists;

    SELECT EXISTS(
        SELECT 1 FROM public.notification_jobs
        WHERE submission_id = p_submission_id
        AND notification_type = 'consultation.internal_notification'
        AND recipient_type = 'internal'
    ) INTO internal_notif_exists;

    -- Create missing intake job (idempotent)
    IF NOT intake_job_exists THEN
        INSERT INTO public.intake_processing_jobs (submission_id, event_type, status, attempts, max_attempts)
        VALUES (p_submission_id, 'intake.submitted', 'queued', 0, 3)
        ON CONFLICT (submission_id, event_type) DO NOTHING;
    END IF;

    -- Create client confirmation job
    IF NOT client_notif_exists THEN
        INSERT INTO public.notification_jobs (
            submission_id, notification_type, recipient_type, recipient_address, status, max_attempts, payload
        )
        SELECT
            NEW.submission_id,
            'consultation.client_confirmation',
            'client',
            NEW.email,
            'pending',
            3,
            jsonb_build_object(
                'brand', NEW.brand,
                'contact_name', NEW.contact_name,
                'public_reference', NEW.public_reference,
                'created_at', NEW.created_at
            )
        FROM public.consultation_submissions
        WHERE submission_id = p_submission_id
        ON CONFLICT (submission_id, notification_type, recipient_type) DO NOTHING;
    END IF;

    -- Create internal notification
    IF NOT internal_notif_exists THEN
        INSERT INTO public.notification_jobs (
            submission_id, notification_type, recipient_type, recipient_address, status, max_attempts, payload
        )
        SELECT
            NEW.submission_id,
            'consultation.internal_notification',
            'internal',
            'hello@ingressible.com',
            'pending',
            3,
            jsonb_build_object(
                'brand', NEW.brand,
                'contact_name', NEW.contact_name,
                'email', NEW.email,
                'public_reference', NEW.public_reference,
                'created_at', NEW.created_at
            )
        FROM public.consultation_submissions
        WHERE submission_id = p_submission_id
        ON CONFLICT (submission_id, notification_type, recipient_type) DO NOTHING;
    END IF;

    -- Return what was created
    RETURN jsonb_build_object(
        'submission_id', p_submission_id,
        'intake_job_created', NOT intake_job_exists,
        'client_notification_created', NOT client_notif_exists,
        'internal_notification_created', NOT internal_notif_exists
    );
END;
$$;