-- ==========================================================================
-- Ingressible — Consultation Events Table
-- Append-only audit trail for consultation lifecycle events.
-- ==========================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create consultation_events table
CREATE TABLE IF NOT EXISTS public.consultation_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id text NOT NULL,
    event_type text NOT NULL,
    actor_type text NOT NULL,
    safe_metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Constraints
ALTER TABLE public.consultation_events
    ADD CONSTRAINT consultation_events_actor_type_check
    CHECK (actor_type IN ('system', 'user', 'admin', 'agent'));

CREATE INDEX IF NOT EXISTS consultation_events_submission_id_idx
    ON public.consultation_events (submission_id);

CREATE INDEX IF NOT EXISTS consultation_events_event_type_idx
    ON public.consultation_events (event_type);

CREATE INDEX IF NOT EXISTS consultation_events_created_at_idx
    ON public.consultation_events (created_at DESC);

-- Foreign key
ALTER TABLE public.consultation_events
    ADD CONSTRAINT consultation_events_submission_id_fkey
    FOREIGN KEY (submission_id)
    REFERENCES public.consultation_submissions(submission_id)
    ON DELETE CASCADE;

-- ==========================================================================
-- Row Level Security
-- ==========================================================================

ALTER TABLE public.consultation_events ENABLE ROW LEVEL SECURITY;

-- No anonymous access
DROP POLICY IF EXISTS "consultation_events_anon_no_select" ON public.consultation_events;
CREATE POLICY "consultation_events_anon_no_select"
    ON public.consultation_events FOR SELECT
    TO anon
    USING (false);

DROP POLICY IF EXISTS "consultation_events_anon_no_insert" ON public.consultation_events;
CREATE POLICY "consultation_events_anon_no_insert"
    ON public.consultation_events FOR INSERT
    TO anon
    WITH CHECK (false);

DROP POLICY IF EXISTS "consultation_events_anon_no_update" ON public.consultation_events;
CREATE POLICY "consultation_events_anon_no_update"
    ON public.consultation_events FOR UPDATE
    TO anon
    USING (false);

DROP POLICY IF EXISTS "consultation_events_anon_no_delete" ON public.consultation_events;
CREATE POLICY "consultation_events_anon_no_delete"
    ON public.consultation_events FOR DELETE
    TO anon
    USING (false);

-- Service role has full access
DROP POLICY IF EXISTS "consultation_events_service_all" ON public.consultation_events;
CREATE POLICY "consultation_events_service_all"
    ON public.consultation_events FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated users can only see their own events
DROP POLICY IF EXISTS "consultation_events_auth_select" ON public.consultation_events;
CREATE POLICY "consultation_events_auth_select"
    ON public.consultation_events FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.consultation_submissions cs
            WHERE cs.submission_id = consultation_events.submission_id
            AND cs.contact_email = auth.email()
        )
    );

-- ==========================================================================
-- Documentation
-- ==========================================================================

COMMENT ON TABLE public.consultation_events IS
'Append-only audit trail for consultation lifecycle events. Each event records a significant state change or action related to a consultation submission.';

COMMENT ON COLUMN public.consultation_events.event_type IS
'Standardized event type. Examples: submission.received, notification.client_confirmation.queued, notification.internal.queued, intake.queued, intake.processing, intake.processed, intake.failed, qualification.completed, scheduling_invite.sent, consultation.scheduled, consultation.completed, proposal.drafted, proposal.approved, proposal.sent, proposal.accepted, engagement.created';

COMMENT ON COLUMN public.consultation_events.actor_type IS
'Type of actor that triggered the event: system (automated), user (client), admin (Kechi/team), agent (AI)';

COMMENT ON COLUMN public.consultation_events.safe_metadata IS
'JSON metadata for the event. MUST NOT contain full intake contents, secrets, PII beyond what is necessary for the event, or sensitive business data. Keep minimal and purpose-specific.';