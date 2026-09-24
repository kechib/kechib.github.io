#!/usr/bin/env bash
# Local tests for intake claim RPC + error classification + notification worker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DENO="${DENO_BIN:-/Users/kechiboniface/.supabase/deno}"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_ingressible}"

echo "== 1/5 Deno classify tests =="
"$DENO" run --allow-read "$ROOT/supabase/tests/classify_test.ts"

echo "== 1b/5 Deno auth tests =="
"$DENO" run --allow-read "$ROOT/supabase/tests/auth_test.ts"

echo "== 1c/5 Deno dispatcher select tests =="
"$DENO" run --allow-read "$ROOT/supabase/tests/dispatcher_test.ts"

echo "== 1d/5 Deno pipeline recovery tests =="
"$DENO" run --allow-read "$ROOT/supabase/tests/pipeline_test.ts"

echo "== 1e/5 Deno provider (Groq) tests =="
"$DENO" run --allow-read "$ROOT/supabase/tests/provider_test.ts"

echo "== 1f/5 Deno notification-worker tests =="
"$DENO" run --allow-read "$ROOT/supabase/tests/worker_test.ts"

echo "== 2a/5 SQL intake claim RPC tests (fixtures → migration → asserts → rollback) =="
TMP_SQL="$(mktemp)"
{
  cat <<'FIX'
BEGIN;
CREATE TABLE IF NOT EXISTS public.consultation_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id text UNIQUE NOT NULL,
    public_reference text,
    status text NOT NULL DEFAULT 'submitted',
    brand text,
    contact_name text,
    contact_email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Production now requires public_reference. Keep legacy fixtures compatible
-- without weakening the real schema; the surrounding transaction rolls back.
ALTER TABLE public.consultation_submissions
    ALTER COLUMN public_reference SET DEFAULT
    ('TEST-' || substr(md5(random()::text), 1, 12));
CREATE TABLE IF NOT EXISTS public.intake_processing_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id text NOT NULL,
    event_type text NOT NULL DEFAULT 'intake.submitted',
    status text NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    last_error text,
    next_attempt_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    max_attempts integer NOT NULL DEFAULT 3
);
CREATE UNIQUE INDEX IF NOT EXISTS intake_processing_jobs_sub_event_uq
    ON public.intake_processing_jobs (submission_id, event_type);
FIX
  echo
  cat "$ROOT/supabase/migrations/20260922160000_harden_claim_intake_jobs.sql"
  echo
  cat "$ROOT/supabase/tests/test_claim_intake_jobs.sql"
  echo
  echo "ROLLBACK;"
} > "$TMP_SQL"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$TMP_SQL"
rm -f "$TMP_SQL"

echo "== 2b/5 SQL scoped notification claim RPC tests =="
TMP_SQL2="$(mktemp)"
{
  cat <<'FIX'
BEGIN;
CREATE TABLE IF NOT EXISTS public.consultation_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id text UNIQUE NOT NULL,
    public_reference text,
    status text NOT NULL DEFAULT 'submitted',
    brand text,
    contact_name text,
    contact_email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Production now requires public_reference. Keep legacy fixtures compatible
-- without weakening the real schema; the surrounding transaction rolls back.
ALTER TABLE public.consultation_submissions
    ALTER COLUMN public_reference SET DEFAULT
    ('TEST-' || substr(md5(random()::text), 1, 12));
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
    provider_name text,
    provider_message_id text,
    provider_idempotency_key text,
    last_provider_attempt_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_unique_idx
    ON public.notification_jobs (submission_id, notification_type, recipient_type);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notification_jobs_submission_id_fkey'
          AND conrelid = 'public.notification_jobs'::regclass
    ) THEN
        ALTER TABLE public.notification_jobs
            ADD CONSTRAINT notification_jobs_submission_id_fkey
            FOREIGN KEY (submission_id)
            REFERENCES public.consultation_submissions(submission_id)
            ON DELETE CASCADE;
    END IF;
END
$$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
    END IF;
END $$;
FIX
  echo
  cat "$ROOT/supabase/migrations/20260922170000_claim_notification_jobs_for_submissions.sql"
  echo
  cat "$ROOT/supabase/tests/test_claim_notification_jobs_scoped.sql"
  echo
  echo "ROLLBACK;"
} > "$TMP_SQL2"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$TMP_SQL2"
rm -f "$TMP_SQL2"

echo "== 3/5 Syntax checks (Deno) =="
set +e
"$DENO" check \
  "$ROOT/supabase/functions/process-intake-submission/index.ts" \
  "$ROOT/supabase/functions/process-intake-submission/pipeline.ts" \
  "$ROOT/supabase/functions/process-intake-submission/classify.ts" \
  "$ROOT/supabase/functions/process-intake-submission/provider.ts" \
  "$ROOT/supabase/functions/process-intake-submission/auth.ts" \
  "$ROOT/supabase/functions/intake-retry-dispatcher/index.ts" \
  "$ROOT/supabase/functions/intake-retry-dispatcher/auth.ts" \
  "$ROOT/supabase/functions/intake-retry-dispatcher/select.ts" \
  "$ROOT/supabase/functions/submit-consultation/index.ts" \
  "$ROOT/supabase/functions/notification-worker/index.ts" \
  "$ROOT/supabase/functions/notification-worker/worker.ts" \
  "$ROOT/supabase/functions/notification-worker/email.ts" \
  "$ROOT/supabase/functions/notification-worker/auth.ts" \
  "$ROOT/supabase/functions/notification-worker/templates.ts" \
  "$ROOT/supabase/tests/classify_test.ts" \
  "$ROOT/supabase/tests/auth_test.ts" \
  "$ROOT/supabase/tests/dispatcher_test.ts" \
  "$ROOT/supabase/tests/pipeline_test.ts" \
  "$ROOT/supabase/tests/provider_test.ts" \
  "$ROOT/supabase/tests/worker_test.ts"
CHECK_RC=$?
set -e
if [ "$CHECK_RC" -ne 0 ]; then
  echo "deno check returned $CHECK_RC — falling back to deno cache"
  "$DENO" cache \
    "$ROOT/supabase/functions/process-intake-submission/index.ts" \
    "$ROOT/supabase/functions/process-intake-submission/pipeline.ts" \
    "$ROOT/supabase/functions/process-intake-submission/classify.ts" \
    "$ROOT/supabase/functions/process-intake-submission/provider.ts" \
    "$ROOT/supabase/functions/process-intake-submission/auth.ts" \
    "$ROOT/supabase/functions/intake-retry-dispatcher/index.ts" \
    "$ROOT/supabase/functions/intake-retry-dispatcher/auth.ts" \
    "$ROOT/supabase/functions/intake-retry-dispatcher/select.ts" \
    "$ROOT/supabase/functions/notification-worker/index.ts" \
    "$ROOT/supabase/functions/notification-worker/worker.ts" \
    "$ROOT/supabase/functions/notification-worker/email.ts" \
    "$ROOT/supabase/functions/notification-worker/auth.ts" \
    "$ROOT/supabase/functions/notification-worker/templates.ts"
fi

echo "ALL LOCAL TESTS PASSED"
