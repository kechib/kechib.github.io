// ==========================================================================
// Supabase Edge Function: notification-worker
// Runtime: Deno (Supabase Edge Functions), deployed on Ingressible Production.
// Trigger: manual POST (no cron at launch). Processes notification_jobs for
//   an EXPLICIT allowlist of submission_ids only — default-deny.
//
// Auth: verify_jwt=true (platform). Handler then enforces exact
//   INTAKE_INTERNAL_SECRET, exact SUPABASE_SERVICE_ROLE_KEY, JWKS
//   service_role JWT, or a platform-validated service_role payload.
//   Unauthenticated → 401.
//
// Safety contracts:
//   - authorizedSubmissionIds must be a non-empty string[] or we never claim.
//   - EMAIL_PROVIDER/RESEND_API_KEY must resolve before any claim → else 503
//     EMAIL_PROVIDER_REQUIRED (no fake transport, no partial sends).
//   - Claim uses claim_notification_jobs_for_submissions (scoped RPC);
//     the unscoped claim_notification_jobs is never called.
//   - attempt_count is incremented once by the claim RPC only.
//   - provider_message_id is written only after a real provider success.
//   - Logs contain job id / type / submission id / classification only —
//     never recipient addresses or payload content.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTAKE_INTERNAL_SECRET,
//   SUPABASE_JWKS (optional), EMAIL_PROVIDER=resend, RESEND_API_KEY,
//   EMAIL_FROM (optional), NOTIFICATION_INTERNAL_ADDRESS (optional).
// ==========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorize, requirePost } from "./auth.ts";
import { isEmailConfigured, resolveEmailConfig, sendEmail } from "./email.ts";
import {
  NOTIFICATION_TYPES,
  processBatch,
  renderJob,
  type Deps,
  type NotificationJob,
} from "./worker.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTAKE_INTERNAL_SECRET") ?? null;
const SUPABASE_JWKS = Deno.env.get("SUPABASE_JWKS") ?? null;

const slog = (msg: string, extra = "") =>
  console.log(`[NotificationWorker] ${msg}${extra ? " " + extra : ""}`);

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

function makeDeps(supabase: RpcClient): Deps {
  return {
    claim: async (types, submissionIds, limit) => {
      const { data, error } = await supabase.rpc(
        "claim_notification_jobs_for_submissions",
        {
          p_types: types,
          p_submission_ids: submissionIds,
          p_limit: limit,
        },
      );
      if (error) {
        slog("claim rpc error", error.message.slice(0, 200));
        return { jobs: null, error: "claim_rpc_unavailable" };
      }
      return { jobs: (data ?? []) as NotificationJob[] };
    },
    update: async (id, patch) => {
      const { error } = await supabase
        .from("notification_jobs")
        .update(patch)
        .eq("id", id);
      if (error) {
        slog("update error", `job=${id} ${error.message.slice(0, 200)}`);
        return { error: error.message };
      }
      return {};
    },
    send: async (job, idempotencyKey) => {
      const cfg = resolveEmailConfig();
      if (!cfg) {
        const e = new Error("email provider not configured") as Error & {
          code: string;
        };
        e.code = "EMAIL_NOT_CONFIGURED";
        throw e;
      }
      const rendered = renderJob(cfg, job);
      return sendEmail(cfg, { ...rendered, idempotencyKey });
    },
  };
}

// @ts-ignore Deno.serve is available on Supabase Edge runtime
Deno.serve(async (req: Request): Promise<Response> => {
  const postDenied = requirePost(req);
  if (postDenied) return postDenied;

  const authDenied = await authorize(req, {
    internalSecret: INTERNAL_SECRET,
    serviceKey: SERVICE_KEY,
    jwksJson: SUPABASE_JWKS,
    acceptPlatformValidatedServiceRole: true,
  });
  if (authDenied) {
    slog("unauthorized");
    return authDenied;
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const rawIds = body["authorizedSubmissionIds"];
  if (
    !Array.isArray(rawIds) ||
    rawIds.length === 0 ||
    !rawIds.every((v) => typeof v === "string" && v.length > 0)
  ) {
    return Response.json(
      { ok: false, error: "AUTHORIZED_IDS_REQUIRED" },
      { status: 400 },
    );
  }
  const authorizedSubmissionIds = rawIds as string[];

  // Resolve email config BEFORE claiming anything.
  if (!isEmailConfigured()) {
    slog("blocked", "EMAIL_PROVIDER_REQUIRED (nothing claimed)");
    return Response.json(
      { ok: false, error: "EMAIL_PROVIDER_REQUIRED" },
      { status: 503 },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  }) as unknown as RpcClient;

  const typesRaw = body["types"];
  const types = Array.isArray(typesRaw)
    ? typesRaw.filter((t): t is string => typeof t === "string")
    : [...NOTIFICATION_TYPES];
  const limitRaw = body["limit"];
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw)
      ? Math.trunc(limitRaw)
      : 5;

  try {
    const out = await processBatch(makeDeps(supabase), {
      types,
      authorizedSubmissionIds,
      limit,
      log: slog,
    });
    if (out.error) {
      const status = out.error === "claim_rpc_unavailable" ? 500 : 400;
      return Response.json(
        { ok: false, error: out.error, claimed: 0, outcomes: [] },
        { status },
      );
    }
    for (const o of out.outcomes) {
      slog(
        "job",
        `id=${o.jobId} type=${o.notificationType} submission=${o.submissionId} result=${o.result}${o.code ? ` code=${o.code}` : ""}`,
      );
    }
    return Response.json({
      ok: true,
      claimed: out.claimed,
      outcomes: out.outcomes,
    });
  } catch (e) {
    slog("worker error", (e instanceof Error ? e.message : "unknown").slice(0, 200));
    return Response.json(
      { ok: false, error: "internal_error" },
      { status: 500 },
    );
  }
});
