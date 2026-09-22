// ==========================================================================
// Supabase Edge Function: intake-retry-dispatcher
// Sweeps due intake_processing_jobs and re-invokes process-intake-submission.
// Trigger: scheduled/cron or manual POST (not the INSERT webhook — status
// updates do not fire intake-job-submitted).
// Auth: same internal secret header as process-intake-submission.
// ==========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorize, requirePost } from "./auth.ts";
import { clampLimit, selectDueJobs } from "./select.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTAKE_INTERNAL_SECRET") ?? null;
const SUPABASE_JWKS = Deno.env.get("SUPABASE_JWKS") ?? null;
const PROCESS_URL = Deno.env.get("INTAKE_PROCESS_URL") ??
  `${SUPABASE_URL}/functions/v1/process-intake-submission`;
const MAX_BATCH = Number(Deno.env.get("INTAKE_RETRY_BATCH") ?? "5");

  type DueJob = {
  id: string;
  submission_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number | null;
  next_attempt_at: string | null;
  last_error: string | null;
};

// @ts-ignore Deno.serve is available on Supabase Edge runtime (unstable on old local Deno)
Deno.serve(async (req: Request): Promise<Response> => {
  const postDenied = requirePost(req);
  if (postDenied) return postDenied;
  const denied = await authorize(req, {
    internalSecret: INTERNAL_SECRET,
    serviceKey: SERVICE_KEY,
    jwksJson: SUPABASE_JWKS,
    acceptPlatformValidatedServiceRole: true,
  });
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const limit = clampLimit(body["limit"], MAX_BATCH);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const nowIso = new Date().toISOString();
  const { jobs, error } = await selectDueJobs(supabase, nowIso, limit);
  if (error) {
    return Response.json({ ok: false, error }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const job of jobs) {
    try {
      const res = await fetch(PROCESS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
          ...(INTERNAL_SECRET ? { "x-intake-internal-secret": INTERNAL_SECRET } : {}),
        },
        body: JSON.stringify({ submission_id: job.submission_id }),
      });
      const json = await res.json().catch(() => ({})) as Record<string, unknown>;
      // Sanitized per-job result: whitelist known fields only (never echo
      // arbitrary payload content back to callers/logs).
      results.push({
        submission_id: job.submission_id,
        http: res.status,
        ok: res.ok,
        result: {
          ok: json["ok"],
          status: json["status"],
          duplicate: json["duplicate"],
          recovered: json["recovered"],
          agentError: json["agentError"],
          retryable: json["retryable"],
          next_attempt_at: json["next_attempt_at"],
          error: typeof json["error"] === "string" ? json["error"] : undefined,
        },
      });
    } catch (e) {
      results.push({
        submission_id: job.submission_id,
        ok: false,
        error: e instanceof Error ? e.message : "dispatch_failed",
      });
    }
  }

  return Response.json({
    ok: true,
    scanned: jobs.length,
    dispatched: results.length,
    results,
  });
});
