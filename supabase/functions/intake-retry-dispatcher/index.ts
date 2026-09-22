// ==========================================================================
// Supabase Edge Function: intake-retry-dispatcher
// Sweeps due intake_processing_jobs and re-invokes process-intake-submission.
// Trigger: scheduled/cron or manual POST (not the INSERT webhook — status
// updates do not fire intake-job-submitted).
// Auth: same internal secret header as process-intake-submission.
// ==========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTAKE_INTERNAL_SECRET") ?? null;
const PROCESS_URL = Deno.env.get("INTAKE_PROCESS_URL") ??
  `${SUPABASE_URL}/functions/v1/process-intake-submission`;
const MAX_BATCH = Number(Deno.env.get("INTAKE_RETRY_BATCH") ?? "5");

const authHeaderNames = [
  "x-intake-internal-secret",
  "x-internal-secret",
  "x-webhook-secret",
];

function extractInternalSecret(req: Request): string | null {
  for (const name of authHeaderNames) {
    const v = req.headers.get(name);
    if (v) return v;
  }
  return null;
}

/** service_role JWT in Authorization (webhook/platform path). */
function isServiceRoleAuth(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return false;
  try {
    const parts = m[1].split(".");
    if (parts.length < 2) return false;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function authorize(req: Request): Response | null {
  const provided = extractInternalSecret(req);
  if (INTERNAL_SECRET && provided && provided === INTERNAL_SECRET) {
    return null;
  }
  if (isServiceRoleAuth(req)) return null;
  return Response.json(
    { ok: false, error: "unauthorized" },
    { status: 401 },
  );
}

type DueJob = {
  id: string;
  submission_id: string;
  attempt_count: number;
  max_attempts: number | null;
  next_attempt_at: string | null;
  last_error: string | null;
};

// @ts-ignore Deno.serve is available on Supabase Edge runtime (unstable on old local Deno)
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  const denied = authorize(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const limit = Math.min(
    Math.max(Number(body["limit"] ?? MAX_BATCH) || MAX_BATCH, 1),
    20,
  );

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Due for retry: processing_failed (or pending/queued) with next_attempt_at
  // elapsed or null, still under max_attempts.
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("intake_processing_jobs")
    .select("id, submission_id, attempt_count, max_attempts, next_attempt_at, last_error")
    .in("status", ["processing_failed", "pending", "queued"])
    .lt("attempt_count", 3) // app MAX_ATTEMPTS; column may be null-safe via COALESCE below
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("COALESCE(next_attempt_at, created_at)", { ascending: true })
    .limit(limit);

  // Fallback query if lt(attempt_count) rejected when max_attempts missing historically:
  let jobs: DueJob[] = [];
  if (error) {
    const { data: retry, error: err2 } = await supabase
      .from("intake_processing_jobs")
      .select("id, submission_id, attempt_count, max_attempts, next_attempt_at, last_error")
      .in("status", ["processing_failed", "pending", "queued"])
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
      .order("created_at", { ascending: true })
      .limit(limit * 2);
    if (err2) {
      return Response.json({ ok: false, error: err2.message }, { status: 500 });
    }
    jobs = (retry ?? []).filter((j) => {
      const max = j.max_attempts ?? 3;
      return (j.attempt_count ?? 0) < max;
    }).slice(0, limit);
  } else {
    jobs = (data ?? []) as DueJob[];
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
      const json = await res.json().catch(() => ({}));
      results.push({
        submission_id: job.submission_id,
        http: res.status,
        ok: res.ok,
        result: json,
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
