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
// Env (server-side only, set via `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (runtime-provided),
//   INTAKE_INTERNAL_SECRET (shared with intake-retry-dispatcher),
//   OPENAI_API_KEY (optional — absent routes to needs_review),
//   OPENAI_INTAKE_MODEL (default: gpt-5.6-luna)
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
import { classifyIntakeError } from "./classify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? null;
const OPENAI_MODEL = Deno.env.get("OPENAI_INTAKE_MODEL") ?? "gpt-5.6-luna";
const INTERNAL_SECRET = Deno.env.get("INTAKE_INTERNAL_SECRET") ?? null;
const SUPABASE_JWKS = Deno.env.get("SUPABASE_JWKS") ?? null;

const slog = (msg: string, extra = "") =>
  console.log(`[IntakePipeline] ${msg}${extra ? " " + extra : ""}`);

const BRIEF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "intakeSummary", "engagementShape", "missingInformation",
    "questionsForConsultation", "recommendedAssessmentModules",
    "recommendedPreparation", "proposalInputs",
  ],
  properties: {
    intakeSummary: { type: "string" },
    engagementShape: {
      type: "string",
      enum: ["separate workstreams", "connected journey", "both", "unclear"],
    },
    missingInformation: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["field", "reason", "requiredForScope"],
        properties: {
          field: { type: "string" },
          reason: { type: "string" },
          requiredForScope: { type: "boolean" },
        },
      },
    },
    questionsForConsultation: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "question", "whyItMatters", "answerType"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          whyItMatters: { type: "string" },
          answerType: { type: "string" },
        },
      },
    },
    recommendedAssessmentModules: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "label", "reason"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    recommendedPreparation: { type: "array", items: { type: "string" } },
    proposalInputs: {
      type: "object",
      additionalProperties: false,
      required: ["services", "workstreams", "deliverables", "budgetPreference", "timeline"],
      properties: {
        services: { type: "array", items: { type: "string" } },
        workstreams: { type: "array", items: { type: "string" } },
        deliverables: { type: "array", items: { type: "string" } },
        budgetPreference: { type: "string" },
        timeline: { type: "string" },
      },
    },
  },
};

/* Extract generated text from a Responses API response body by walking
   response.output[] content items explicitly. Returns null when absent. */
function extractResponseText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const output = (body as Record<string, unknown>)["output"];
  if (!Array.isArray(output)) return null;
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>)["content"];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const t = (part as Record<string, unknown>)["type"];
      const text = (part as Record<string, unknown>)["text"];
      if ((t === "output_text" || t === "text") && typeof text === "string") {
        chunks.push(text);
      }
    }
  }
  const joined = chunks.join("").trim();
  return joined.length ? joined : null;
}

/* Read a sanitized provider error summary from a failed OpenAI response. */
async function readProviderErrorDetail(res: Response): Promise<string | null> {
  const status = res.status;
  let requestId: string | null = null;
  try {
    requestId = res.headers.get("x-request-id");
  } catch { /* ignore */ }
  let raw = "";
  try {
    raw = await res.text();
  } catch { /* ignore */ }
  if (!raw) return `http=${status}` + (requestId ? ` req=${requestId}` : "");
  let err: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(raw.slice(0, 2048));
    if (parsed && typeof parsed === "object") {
      const e = (parsed as Record<string, unknown>)["error"];
      if (e && typeof e === "object") err = e as Record<string, unknown>;
    }
  } catch { /* non-JSON body */ }
  const pick = (v: unknown): string | null =>
    typeof v === "string" && v.length ? v : null;
  const parts: string[] = [`http=${status}`];
  if (err) {
    const t = pick(err["type"]);
    const c = pick(err["code"]);
    const p = pick(err["param"]);
    if (t) parts.push(`type=${t.slice(0, 60)}`);
    if (c) parts.push(`code=${c.slice(0, 60)}`);
    if (p) parts.push(`param=${p.slice(0, 80)}`);
    const m = pick(err["message"]);
    if (m) parts.push(`msg=${sanitizeProviderMessage(m)}`);
  } else {
    parts.push(`body=${sanitizeProviderMessage(raw.slice(0, 200))}`);
  }
  if (requestId) parts.push(`req=${requestId.slice(0, 40)}`);
  return parts.join(" ").slice(0, 600);
}

function sanitizeProviderMessage(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9-_]{4,}/g, "sk-REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]{4,}/gi, "Bearer REDACTED")
    .replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, "$1REDACTED")
    .slice(0, 300);
}

function validateBrief(v: unknown): v is import("./pipeline.ts").IntakeBrief {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o["intakeSummary"] === "string"
    && typeof o["engagementShape"] === "string"
    && Array.isArray(o["missingInformation"])
    && Array.isArray(o["questionsForConsultation"])
    && Array.isArray(o["recommendedAssessmentModules"])
    && Array.isArray(o["recommendedPreparation"])
    && !!o["proposalInputs"] && typeof o["proposalInputs"] === "object";
}

async function callOpenAI(
  systemPrompt: string,
  userPayload: unknown,
): Promise<import("./pipeline.ts").ModelResult> {
  if (!OPENAI_API_KEY) {
    const e = new Error("OPENAI_API_KEY missing");
    (e as Error & { code?: string }).code = "AI_NOT_CONFIGURED";
    throw e;
  }
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "ingressible_intake_brief",
            strict: true,
            schema: BRIEF_JSON_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : "network error";
    const e = new Error(`OpenAI fetch failed: ${msg}`);
    (e as Error & { code?: string }).code =
      msg.includes("timeout") || msg.includes("abort") ? "AI_TIMEOUT" : "AI_NETWORK_ERROR";
    throw e;
  }
  if (!res.ok) {
    const detail = await readProviderErrorDetail(res).catch(() => null);
    const e = new Error(`OpenAI HTTP ${res.status}`);
    (e as Error & { code?: string }).code = res.status === 429
      ? "AI_RATE_LIMITED"
      : `AI_HTTP_${res.status}`;
    if (detail) (e as Error & { detail?: string }).detail = detail;
    throw e;
  }
  const body: unknown = await res.json();
  const text = extractResponseText(body);
  if (!text) {
    const e = new Error("empty model output");
    (e as Error & { code?: string }).code = "AI_EMPTY_OUTPUT";
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const e = new Error("non-JSON model output");
    (e as Error & { code?: string }).code = "AI_INVALID_OUTPUT";
    throw e;
  }
  if (!validateBrief(parsed)) {
    const e = new Error("model output failed brief validation");
    (e as Error & { code?: string }).code = "AI_INVALID_OUTPUT";
    throw e;
  }
  const rec = body as Record<string, unknown>;
  return {
    brief: parsed as import("./pipeline.ts").IntakeBrief,
    responseId: typeof rec["id"] === "string" ? rec["id"] : null,
    usage: rec["usage"] ?? null,
  };
}

const SYSTEM_PROMPT = [
  "You are the Ingressible Intake & Scope Assistant.",
  "Understand the brand's intended experience, business decision, product/platform,",
  "critical customer journey, constraints, and desired deliverables.",
  "Use Access → Capability → Agency → Participation → Belonging as a lens.",
  "Do not diagnose disability. Do not assess. Do not certify. Do not give legal advice.",
  "Do not fabricate evidence, thresholds, benchmarks, or findings.",
  "Use Unknown / Needs Confirmation / Research Needed where appropriate.",
  "Kechi Boniface makes final scope decisions.",
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

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
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
    slog("processing started", `${submissionId} attempt=${job.attempt_count}`);

    const outcome = await processClaimedJob(supabase, submissionId, job, callOpenAI, {
      systemPrompt: SYSTEM_PROMPT,
      model: OPENAI_MODEL,
      log: slog,
    });
    return Response.json(outcome.body, { status: outcome.http });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    slog("processing failed", `${submissionId ?? "?"} ${msg}`);
    if (claimed) {
      await markJobFailure(supabase, claimed, "AI_HTTP_500", msg);
    }
    return Response.json({ ok: false, submissionId, error: msg }, { status: 500 });
  }
});
