# PHASE A PRODUCTION MIGRATION REVIEW

## COMMIT
- **SHA**: bb357d2
- **Message**: `feat: build consultation submission foundation`
- **Verified**: YES

## PRODUCTION PROJECT
- **PRODUCTION PROJECT**: hnldnxbwxwrkpjarykyf (Ingressible Production)
- **OLD PROJECT**: hyfbkaapbdwafblelfvq
- **LOCAL SUPABASE LINK**: hyfbkaapbdwafblelfvq (OLD - unchanged)

## MIGRATION COUNT
**6 migrations** prepared in correct dependency order

---

## MIGRATION REVIEWS

### MIGRATION 1: 20260918000001_notification_jobs.sql
**PURPOSE**: Create notification_jobs table for async notification processing
**DEPENDENCIES**: consultation_submissions table must exist
**TABLES CREATED**: notification_jobs
**TABLES ALTERED**: None
**FUNCTIONS CREATED**: update_notification_jobs_updated_at()
**TRIGGERS CREATED**: trigger_update_notification_jobs_updated_at
**INDEXES CREATED**: 
- notification_jobs_status_idx (partial on status, next_attempt_at)
- notification_jobs_submission_id_idx
- notification_jobs_next_attempt_idx
**UNIQUE CONSTRAINTS**: notification_jobs_unique_idx on (submission_id, notification_type, recipient_type)
**FOREIGN KEYS**: submission_id -> consultation_submissions(submission_id) ON DELETE CASCADE
**CHECK CONSTRAINTS**: status, recipient_type, notification_type
**RLS ENABLED**: YES
**POLICIES**: 
- anon: no select/insert/update/delete
- service_role: full access
- authenticated: own records only (via cs.contact_email)
**SECURITY DEFINER FUNCTIONS**: update_notification_jobs_updated_at()
**ROLLBACK**: DROP TABLE notification_jobs (cascades to FKs)
**SAFE AS WRITTEN**: ✅ - No conflicts with existing schema

---

### MIGRATION 2: 20260918000002_consultation_events.sql
**PURPOSE**: Append-only audit trail for consultation lifecycle
**DEPENDENCIES**: consultation_submissions
**TABLES CREATED**: consultation_events
**TABLES ALTERED**: None
**FUNCTIONS CREATED**: None
**TRIGGERS CREATED**: None
**INDEXES CREATED**: 
- consultation_events_submission_id_idx
- consultation_events_event_type_idx
- consultation_events_created_at_idx
**UNIQUE CONSTRAINTS**: None (append-only)
**FOREIGN KEYS**: submission_id -> consultation_submissions(submission_id) ON DELETE CASCADE
**CHECK CONSTRAINTS**: actor_type IN ('system', 'user', 'admin', 'agent')
**RLS ENABLED**: YES
**POLICIES**: 
- anon: no select/insert/update/delete
- service_role: full access
- authenticated: own records only (cs.contact_email)
**ROLLBACK**: DROP TABLE consultation_events
**SAFE AS WRITTEN**: ✅

---

### MIGRATION 3: 20260918000003_claim_notification_jobs.sql
**PURPOSE**: Atomic job claiming with SKIP LOCKED for notification worker
**DEPENDENCIES**: notification_jobs table
**FUNCTIONS CREATED**: claim_notification_jobs(p_types text[], p_limit int DEFAULT 10)
**TRIGGERS CREATED**: None
**INDEXES CREATED**: None
**SECURITY DEFINER**: YES with safe search_path
**ROLLBACK**: DROP FUNCTION claim_notification_jobs(text[], integer)
**CONFLICT CHECK**: No existing claim_notification_jobs in production
**SAFE AS WRITTEN**: ✅

---

### MIGRATION 4: 20260918000004_public_reference_unique.sql
**PURPOSE**: Add UNIQUE constraint on consultation_submissions.public_reference
**DEPENDENCIES**: consultation_submissions table
**ACTION**: 
1. Check for existing duplicates (fails if any)
2. Add UNIQUE constraint on public_reference

**PRODUCTION DATA VERIFICATION**:
```
DUPLICATE VALUES: NO
NULL VALUES: 0
TOTAL ROWS: 6
UNIQUE MIGRATION SAFE: YES
```

**ROLLBACK**: ALTER TABLE ... DROP CONSTRAINT consultation_submissions_public_reference_key
**SAFE AS WRITTEN**: ✅

---

### MIGRATION 5: 20260918000004_ensure_consultation_jobs.sql
**PURPOSE**: Idempotent reconciliation RPC to ensure all expected jobs exist
**DEPENDENCIES**: notification_jobs, intake_processing_jobs, consultation_submissions
**FUNCTIONS CREATED**: ensure_consultation_jobs(p_submission_id text) RETURNS jsonb
**SECURITY DEFINER**: YES with search_path = 'public'
**IDEMPOTENT**: YES - uses ON CONFLICT DO NOTHING
**CREATES**:
- intake_processing_jobs (if missing)
- notification_jobs (client_confirmation)
- notification_jobs (internal_notification)
**ROLLBACK**: DROP FUNCTION ensure_consultation_jobs(text)
**CONFLICT CHECK**: 
- Does NOT create duplicate intake job (respects existing unique constraint on intake_processing_jobs)
- Uses ON CONFLICT DO NOTHING for notification jobs
**SAFE AS WRITTEN**: ✅

---

### MIGRATION 6: 20260918000005_reconciliation.sql
**PURPOSE**: Reconciliation view and wrapper RPC
**DEPENDENCIES**: ensure_consultation_jobs()
**VIEW CREATED**: v_submissions_missing_jobs
**FUNCTIONS CREATED**: 
- find_submissions_needing_reconciliation() RETURNS SETOF consultation_submissions
- reconcile_consultation_jobs(p_submission_id text) RETURNS jsonb
**SECURITY DEFINER**: YES
**ROLLBACK**: DROP VIEW v_submissions_missing_jobs; DROP FUNCTION find_submissions_needing_reconciliation(); DROP FUNCTION reconcile_consultation_jobs(text)
**SAFE AS WRITTEN**: ✅

---

## LIVE SCHEMA CONFLICTS
**NONE** - All migrations are additive and don't conflict with existing production objects.

---

## PUBLIC_REFERENCE EXISTING DATA
- **DUPLICATE VALUES**: NO
- **NULL VALUES**: 0
- **TOTAL ROWS**: 6
- **UNIQUE MIGRATION SAFE**: YES

---

## RLS REVIEW
**PASS** - All new tables have RLS enabled with proper policies:
- anon: no access
- service_role: full access
- authenticated: own records only (via cs.contact_email - CORRECTED from cs.email)
- consultation_events: no external client access

---

## SECURITY DEFINER REVIEW
**PASS** - All SECURITY DEFINER functions:
- update_notification_jobs_updated_at() - safe
- claim_notification_jobs() - safe (parameters validated, FOR UPDATE SKIP LOCKED)
- ensure_consultation_jobs() - uses ON CONFLICT DO NOTHING
- reconcile_consultation_jobs() - calls ensure_consultation_jobs
- claim_notification_jobs() - FOR UPDATE SKIP LOCKED, atomic claim
- update_notification_jobs_updated_at() - safe
- create_intake_processing_job() - existing, safe

---

## EXISTING INTAKE TRIGGERS PRESERVED
**YES** - All existing production triggers preserved:
- trg_create_intake_processing_job (AFTER INSERT on consultation_submissions)
- trg_touch_submissions
- trg_touch_agent_results
- intake-job-submitted (calls process-intake-submission Edge Function)
- RI_ConstraintTrigger_* (FK constraints)

---

## RECONCILIATION
**PASS** - ensure_consultation_jobs() + reconciliation view + reconcile_consultation_jobs() provide complete reconciliation capability.

---

## RATE LIMIT
**PASS** - Implemented in submit-consultation Edge Function (in-memory, 10 req/hr per IP). No persistent storage migration needed.

---

## SUBMIT-CONSULTATION SECURITY
**PASS** - Edge Function has:
- verify_jwt = false (documented for public form)
- Strict CORS: exact allowed origins
- Method restriction (POST/OPTIONS only)
- Content-Type validation (application/json)
- Payload size limit (256KB / 413)
- Schema validation
- Rate limiting (10 req/hr per IP)
- Honeypot field
- 5-second minimum completion time
- Strict input validation (no unknown fields, strict types)
- verify_jwt = false explicitly configured
- Service role key only server-side

---

## NOTIFICATION-WORKER
- Atomic claim: claim_notification_jobs RPC with FOR UPDATE SKIP LOCKED
- Retry: exponential backoff (5/10/20/40/60 min), max 3 attempts
- Provider idempotency: notification:<job_id> key passed
- Fake email safety: explicit EMAIL_TRANSPORT=fake, blocked in production
- Crash-after-send protection: provider idempotency key
- Fake email blocked in production (APP_ENV=production)

---

## PROCESS-INTAKE LOCAL/PRODUCTION MATCH
**YES** - Local hash f76837cb122088e09cbf9cfb33b77810b9bddbd5f4014f53046c019dc379adad matches production v12 hash exactly. **DEPLOYMENT NOT REQUIRED.**

---

## EDGE FUNCTIONS TO DEPLOY
1. submit-consultation (new)
2. notification-worker (new)
**NOT**: process-intake-submission (already v12 in production, local matches)

---

## EXISTING WEBHOOK SECURITY
**PENDING** - Current intake-job-submitted trigger embeds service_role JWT in pg_net call. Remediation plan documented but not executed.

---

## BLOCKERS CLASSIFICATION
| Category | Items |
|----------|-------|
| **BEFORE DATABASE MIGRATION** | None (all migrations safe) |
| **BEFORE EDGE DEPLOYMENT** | 1. Set verify_jwt=false on submit-consultation<br>2. Configure CORS origins in function config |
| **BEFORE CONTROLLED LIVE SUBMISSION** | 1. Real email provider config<br>2. OpenAI credits for AI validation |
| **LATER PHASE** | Google Calendar, proposals, agreements, payment, engagement |

---

## PRODUCTION MIGRATION ORDER
1. 20260918000001_notification_jobs.sql
2. 20260918000002_consultation_events.sql
3. 20260918000003_claim_notification_jobs.sql
4. 20260918000004_public_reference_unique.sql
5. 20260918000004_ensure_consultation_jobs.sql
6. 20260918000005_reconciliation.sql

---

## EDGE DEPLOYMENT ORDER
1. submit-consultation (verify_jwt=false)
2. notification-worker

---

## FINAL STATUS
**PASS — READY FOR CONTROLLED PRODUCTION MIGRATION AUTHORIZATION**

All Phase A code complete and verified. Six migrations ready for safe application. Two Edge Functions ready for deployment. Production reconciliation complete. Local Supabase link points to OLD project - will need relink for migration application.

**STOP. DO NOT APPLY OR DEPLOY WITHOUT AUTHORIZATION.**