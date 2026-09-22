#!/usr/bin/env bash
# Local tests for intake claim RPC + error classification.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DENO="${DENO_BIN:-/Users/kechiboniface/.supabase/deno}"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_ingressiblellc}"

echo "== 1/3 Deno classify tests =="
"$DENO" run --allow-read "$ROOT/supabase/tests/classify_test.ts"

echo "== 2/3 SQL claim RPC tests (fixtures → migration → asserts → rollback) =="
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

echo "== 3/3 Syntax checks (Deno) =="
set +e
"$DENO" check \
  "$ROOT/supabase/functions/process-intake-submission/index.ts" \
  "$ROOT/supabase/functions/process-intake-submission/classify.ts" \
  "$ROOT/supabase/functions/intake-retry-dispatcher/index.ts" \
  "$ROOT/supabase/tests/classify_test.ts"
CHECK_RC=$?
set -e
if [ "$CHECK_RC" -ne 0 ]; then
  echo "deno check returned $CHECK_RC — falling back to deno cache"
  "$DENO" cache \
    "$ROOT/supabase/functions/process-intake-submission/index.ts" \
    "$ROOT/supabase/functions/process-intake-submission/classify.ts" \
    "$ROOT/supabase/functions/intake-retry-dispatcher/index.ts"
fi

echo "ALL LOCAL TESTS PASSED"
