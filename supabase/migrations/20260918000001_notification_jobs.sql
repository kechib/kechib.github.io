-- ==========================================================================
-- Ingressible — Notification Jobs Table
-- Job queue for client confirmations, internal notifications, scheduling,
-- proposals, and other async communications.
-- ==========================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create notification_jobs table
CREATE TABLE IF NOT EXISTS public.notification_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id text NOT NULL,
    notification_type text NOT NULL,
    recipient_type text NOT NULL,
    recipient_address text,
    status text NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    last_error text,
    next_attempt_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    payload jsonb NOT NULL DEFAULT '{}',
    -- Provider idempotency fields
    provider_name text,
    provider_message_id text,
    provider_idempotency_key text,
    last_provider_attempt_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Constraints
ALTER TABLE public.notification_jobs
    ADD CONSTRAINT notification_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'needs_review'));

ALTER TABLE public.notification_jobs
    ADD CONSTRAINT notification_jobs_recipient_type_check
    CHECK (recipient_type IN ('client', 'internal'));

ALTER TABLE public.notification_jobs
    ADD CONSTRAINT notification_jobs_notification_type_check
    CHECK (notification_type IN (
        'consultation.client_confirmation',
        'consultation.internal_notification',
        'consultation.scheduling_invite',
        'consultation.proposal_delivery',
        'consultation.proposal_approved',
        'consultation.agreement_sent',
        'consultation.engagement_created'
    ));

-- Unique constraint to prevent duplicate jobs
CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_unique_idx
    ON public.notification_jobs (submission_id, notification_type, recipient_type);

-- Foreign key
ALTER TABLE public.notification_jobs
    ADD CONSTRAINT notification_jobs_submission_id_fkey
    FOREIGN KEY (submission_id)
    REFERENCES public.consultation_submissions(submission_id)
    ON DELETE CASCADE;

-- Indexes for job processing
CREATE INDEX IF NOT EXISTS notification_jobs_status_idx
    ON public.notification_jobs (status, next_attempt_at)
    WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS notification_jobs_submission_id_idx
    ON public.notification_jobs (submission_id);

CREATE INDEX IF NOT EXISTS notification_jobs_next_attempt_idx
    ON public.notification_jobs (next_attempt_at)
    WHERE status IN ('pending', 'processing');

-- Updated at trigger
CREATE OR REPLACE FUNCTION public.update_notification_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_notification_jobs_updated_at ON public.notification_jobs;
CREATE TRIGGER trigger_update_notification_jobs_updated_at
    BEFORE UPDATE ON public.notification_jobs
    FOR EACH ROW EXECUTE FUNCTION public.update_notification_jobs_updated_at();

-- ==========================================================================
-- Row Level Security
-- ==========================================================================

ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;

-- No anonymous access
DROP POLICY IF EXISTS "notification_jobs_anon_no_select" ON public.notification_jobs;
CREATE POLICY "notification_jobs_anon_no_select"
    ON public.notification_jobs FOR SELECT
    TO anon
    USING (false);

DROP POLICY IF EXISTS "notification_jobs_anon_no_insert" ON public.notification_jobs;
CREATE POLICY "notification_jobs_anon_no_insert"
    ON public.notification_jobs FOR INSERT
    TO anon
    WITH CHECK (false);

DROP POLICY IF EXISTS "notification_jobs_anon_no_update" ON public.notification_jobs;
CREATE POLICY "notification_jobs_anon_no_update"
    ON public.notification_jobs FOR UPDATE
    TO anon
    USING (false);

DROP POLICY IF EXISTS "notification_jobs_anon_no_delete" ON public.notification_jobs;
CREATE POLICY "notification_jobs_anon_no_delete"
    ON public.notification_jobs FOR DELETE
    TO anon
    USING (false);

-- Service role has full access (for Edge Functions and workers)
DROP POLICY IF EXISTS "notification_jobs_service_all" ON public.notification_jobs;
CREATE POLICY "notification_jobs_service_all"
    ON public.notification_jobs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated users can only see their own notifications (if they have the submission_id)
DROP POLICY IF EXISTS "notification_jobs_auth_select" ON public.notification_jobs;
CREATE POLICY "notification_jobs_auth_select"
    ON public.notification_jobs FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.consultation_submissions cs
            WHERE cs.submission_id = notification_jobs.submission_id
            AND cs.contact_email = auth.email()
        )
    );

-- ==========================================================================
-- Updated at trigger
-- ==========================================================================

CREATE TRIGGER trigger_update_notification_jobs_updated_at
    BEFORE UPDATE ON public.notification_jobs
    FOR EACH ROW EXECUTE FUNCTION public.update_notification_jobs_updated_at();