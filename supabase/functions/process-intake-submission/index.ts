// ==========================================================================
// Supabase Edge Function: process-intake-submission
// Runtime: Deno (Supabase Edge Functions), deployed on Ingressible Production.
// Trigger: database webhook on intake_processing_jobs INSERT, or direct
//   invoke with { submission_id }. One invocation processes exactly one job,
//   claimed atomically via claim_next_intake_job_for_submission (SKIP LOCKED).
//   Idempotent on submission_id. Supabase is the source of truth; webhook
//   payloads are identifiers only, never trusted intake content.
//
// Auth: verify_jwt=true (platform validates the webhook HS256 service_role
//   JWT and service-key/secret bearers before the handler). Handler then
//   enforces exact INTAKE_INTERNAL_SECRET, exact SUPABASE_SERVICE_ROLE_KEY,
//   JWKS service_role JWT, or a platform-validated service_role payload.
//   Unauthenticated → 401.
//
// Model execution is provider-neutral: business logic calls callIntakeModel
//   from ./provider.ts and never touches a vendor SDK or response shape.
//
// Env (server-side only, set via `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (runtime-provided),
//   INTAKE_INTERNAL_SECRET (shared with intake-retry-dispatcher),
//   AI_PROVIDER (launch value: groq; optional: openai),
//   GROQ_API_KEY + GROQ_INTAKE_MODEL (default: openai/gpt-oss-20b),
//   OPENAI_API_KEY + OPENAI_INTAKE_MODEL (only when AI_PROVIDER=openai).
//   Missing provider configuration routes the job to needs_review.
// ==========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorize, requirePost } from "./auth.ts";
import {
  extractSubmissionId,
  isValidSubmissionId,
  markJobFailure,
  processClaimedJob,
  type Job,
} from "./pipeline.ts";
import { callIntakeModel, resolveProviderConfig } from "./provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTAKE_INTERNAL_SECRET") ?? null;
const SUPABASE_JWKS = Deno.env.get("SUPABASE_JWKS") ?? null;

const PROVIDER = resolveProviderConfig();

const slog = (msg: string, extra = "") =>
  console.log(`[IntakePipeline] ${msg}${extra ? " " + extra : ""}`);

const SYSTEM_PROMPT = [
  "You are the Ingressible Intake & Scope Assistant.",
  "Understand the brand's intended experience, business decision, product/platform,",
  "critical customer journey, constraints, and desired deliverables.",
  "Use Access → Capability → Agency → Participation → Belonging as a lens.",
  "Do not diagnose disability. Do not assess. Do not certify. Do not give legal advice.",
  "Do not make accessibility findings and do not certify accessibility.",
  "Do not make legal conclusions.",
  "Do not approve or reject a brand.",
  "Do not set final pricing.",
  "Do not fabricate evidence, thresholds, benchmarks, or findings.",
  "Use Unknown / Needs Confirmation / Research Needed where appropriate.",
  "Kechi Boniface makes all final decisions — scope, pricing, and qualification.",
  "Return JSON only with keys: intakeSummary, engagementShape, missingInformation[],",
  "questionsForConsultation[], recommendedAssessmentModules[], recommendedPreparation[], proposalInputs.",
].join("\n");

// @ts-ignore Deno.serve is available on Supabase Edge runtime (unstable on old local Deno)
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

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  let submissionId: string | null = null;
  let claimed: Job | null = null;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    submissionId = extractSubmissionId(body);
    if (!isValidSubmissionId(submissionId)) {
      return Response.json(
        { ok: false, error: "missing or invalid submission_id" },
        { status: 400 },
      );
    }

    const { data: claimedRows, error: claimErr } = await supabase.rpc(
      "claim_next_intake_job_for_submission",
      { p_submission_id: submissionId },
    );
    if (claimErr) {
      slog("claim error", `${submissionId} ${claimErr.message}`);
      return Response.json(
        { ok: false, submissionId, error: claimErr.message },
        { status: 502 },
      );
    }
    if (!claimedRows || (Array.isArray(claimedRows) && claimedRows.length === 0)) {
      slog("duplicate suppressed", submissionId);
      return Response.json({ ok: true, submissionId, duplicate: true });
    }
    const job = (Array.isArray(claimedRows) ? claimedRows[0] : claimedRows) as Job;
    claimed = job;
    slog(
      "processing started",
      `${submissionId} attempt=${job.attempt_count} provider=${PROVIDER.provider}`,
    );

    const outcome = await processClaimedJob(
      supabase,
      submissionId,
      job,
      (systemPrompt, userPayload) =>
        callIntakeModel(PROVIDER, systemPrompt, userPayload),
      {
        systemPrompt: SYSTEM_PROMPT,
        model: PROVIDER.model,
        provider: PROVIDER.provider,
        log: slog,
      },
    );
    return Response.json(outcome.body, { status: outcome.http });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    const code = (e as Error & { code?: string }).code ?? "AI_PROVIDER_5XX";
    const detail = (e as Error & { detail?: string }).detail ?? msg;
    slog("processing failed", `${submissionId ?? "?"} ${code}`);
    if (claimed) {
      await markJobFailure(supabase, claimed, code, detail);
    }
    return Response.json({ ok: false, submissionId, error: msg }, { status: 500 });
  }
});
