-- ==========================================================================
-- Ingressible — Corrective Forward Migration
-- Repair ensure_consultation_jobs for the live production schema.
--
-- WHY:
--   The original 20260918000004_ensure_consultation_jobs.sql was authored
--   against a misremembered intake_processing_jobs schema:
--     * referenced NEW.* (trigger-only record) instead of submission_record.*
--     * inserted into non-existent columns attempts / max_attempts
--     * inserted status 'queued' (not in the CHECK constraint)
--   It was applied to production. Per migration history rules this file is
--   NOT rewritten; this forward migration creates the authoritative final
--   definition.
--
-- LIVE SCHEMA (confirmed):
--   intake_processing_jobs: id, submission_id, event_type, status,
--     attempt_count, created_at, started_at, completed_at, last_error,
--     next_attempt_at, updated_at
--     status CHECK: pending, processing, processed, needs_review,
--                   processing_failed  (default pending; attempt_count 0)
--     UNIQUE (submission_id, event_type)
--   notification_jobs: unique on (submission_id, notification_type,
--     recipient_type)
--
-- SECURITY:
--   Internal reconciliation only. SECURITY DEFINER is required because the
--   unprivileged service path needs to create jobs across RLS-protected
--   tables. search_path emptied, all objects schema-qualified, no dynamic
--   SQL. Browser roles (PUBLIC/anon/authenticated) are revoked.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.ensure_consultation_jobs(
    p_submission_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    submission_record public.consultation_submissions%ROWTYPE;
    inserted_rows bigint;
    intake_created boolean := false;
    client_created boolean := false;
    internal_created boolean := false;
BEGIN
    -- 1. Canonical submission lookup. Orphan jobs must never be created.
    SELECT *
    INTO submission_record
    FROM public.consultation_submissions
    WHERE submission_id = p_submission_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'submission_id', p_submission_id,
            'error', 'Submission not found'
        );
    END IF;

    -- 2. Intake job — only valid live columns, production trigger-compatible
    --    status. ON CONFLICT (submission_id, event_type) DO NOTHING keeps the
    --    claim on the UNIQUE constraint; attempt_count defaults to 0.
    INSERT INTO public.intake_processing_jobs (
        submission_id,
        event_type,
        status
    )
    VALUES (
        p_submission_id,
        'intake.submitted',
        'pending'
    )
    ON CONFLICT (submission_id, event_type) DO NOTHING;

    -- Evidence from the INSERT outcome, not from the pre-check.
    GET DIAGNOSTICS inserted_rows = ROW_COUNT;
    intake_created := inserted_rows > 0;

    -- 3. Client confirmation job — minimal payload from the canonical row.
    INSERT INTO public.notification_jobs (
        submission_id,
        notification_type,
        recipient_type,
        recipient_address,
        status,
        max_attempts,
        payload
    )
    VALUES (
        p_submission_id,
        'consultation.client_confirmation',
        'client',
        submission_record.contact_email,
        'pending',
        3,
        jsonb_build_object(
            'brand', submission_record.brand,
            'contact_name', submission_record.contact_name,
            'public_reference', submission_record.public_reference,
            'created_at', submission_record.created_at
        )
    )
    ON CONFLICT (submission_id, notification_type, recipient_type) DO NOTHING;

    GET DIAGNOSTICS inserted_rows = ROW_COUNT;
    client_created := inserted_rows > 0;

    -- 4. Internal notification job — minimal payload from the canonical row.
    INSERT INTO public.notification_jobs (
        submission_id,
        notification_type,
        recipient_type,
        recipient_address,
        status,
        max_attempts,
        payload
    )
    VALUES (
        p_submission_id,
        'consultation.internal_notification',
        'internal',
        'hello@ingressible.com',
        'pending',
        3,
        jsonb_build_object(
            'brand', submission_record.brand,
            'contact_name', submission_record.contact_name,
            'email', submission_record.contact_email,
            'public_reference', submission_record.public_reference,
            'created_at', submission_record.created_at
        )
    )
    ON CONFLICT (submission_id, notification_type, recipient_type) DO NOTHING;

    GET DIAGNOSTICS inserted_rows = ROW_COUNT;
    internal_created := inserted_rows > 0;

    -- 5. Truthful return: what this invocation actually inserted
    --    (ROW_COUNT 1 = inserted, 0 = already present / conflict).
    RETURN jsonb_build_object(
        'submission_id', p_submission_id,
        'intake_job_created', intake_created,
        'client_notification_created', client_created,
        'internal_notification_created', internal_created
    );
END;
$$;

-- ==========================================================================
-- Execution hardening — internal reconciliation only.
-- ==========================================================================

REVOKE ALL ON FUNCTION public.ensure_consultation_jobs(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.ensure_consultation_jobs(text) FROM anon;

REVOKE ALL ON FUNCTION public.ensure_consultation_jobs(text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_consultation_jobs(text) TO service_role;

-- Function owner (postgres) retains administrative access by ownership.