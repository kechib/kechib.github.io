// ==========================================================================
// Supabase Edge Function: process-intake-submission
// Runtime: Deno (Supabase Edge Functions), deployed on Ingressible Production.
// Trigger: database webhook on intake_processing_jobs INSERT, or direct
//   invoke with { submission_id }. One invocation processes exactly one job,
//   claimed atomically via claim_next_intake_job_for_submission (SKIP LOCKED).
//   Idempotent on submission_id. Supabase is the source of truth; webhook
//   payloads are identifiers only, never trusted intake content.
//
// Env (server-side only, set via `supabase secrets set`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (runtime-provided),
//   OPENAI_API_KEY (optional — absent routes to needs_review),
//   OPENAI_INTAKE_MODEL (default: gpt-5.6-luna)
// ==========================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? null;
const OPENAI_MODEL = Deno.env.get("OPENAI_INTAKE_MODEL") ?? "gpt-5.6-luna";

const MAX_ATTEMPTS = 3;

const slog = (msg: string, extra = "") =>
  console.log(`[IntakePipeline] ${msg}${extra ? " " + extra : ""}`);

type Job = {
  id: string;
  submission_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
};

type IntakeBrief = {
  intakeSummary: string;
  engagementShape: string;
  missingInformation: Array<{ field: string; reason: string; requiredForScope: boolean }>;
  questionsForConsultation: Array<{ id: string; question: string; whyItMatters: string; answerType: string }>;
  recommendedAssessmentModules: Array<{ id: string; label: string; reason: string }>;
  recommendedPreparation: string[];
  proposalInputs: Record<string, unknown>;
};

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

/* Read a sanitized provider error summary from a failed OpenAI response.
   Retains: HTTP status, error.type/code/param, short sanitized message,
   x-request-id. Strips anything resembling credentials (sk-*, Bearer
   tokens, key assignments) and caps length. Never throws. */
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

/* Strip credential-like material and cap length. */
function sanitizeProviderMessage(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9-_]{4,}/g, "sk-REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]{4,}/gi, "Bearer REDACTED")
    .replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, "$1REDACTED")
    .slice(0, 300);
}

function validateBrief(v: unknown): v is IntakeBrief {
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
  userPayload: unknown
): Promise<{ brief: IntakeBrief; responseId: string | null; usage: unknown }> {
  if (!OPENAI_API_KEY) {
    const e = new Error("OPENAI_API_KEY missing");
    (e as Error & { code?: string }).code = "AI_NOT_CONFIGURED";
    throw e;
  }
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL, // never silently substituted; provider errors surface
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
  });
  if (!res.ok) {
    // Safe diagnostic capture: HTTP status, provider error fields, request
    // ID only. Never prompts, keys, headers, or client intake content.
    const detail = await readProviderErrorDetail(res).catch(() => null);
    const e = new Error(`OpenAI HTTP ${res.status}`);
    // Exact provider status in code (status numbers are safe, non-secret).
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
    brief: parsed,
    responseId: typeof rec["id"] === "string" ? rec["id"] : null,
    usage: rec["usage"] ?? null,
  };
}

/* Build the agent input from the canonical DB row. Uses actual column
   names; falls back into the intake JSONB for fields stored there. */
function buildAgentInput(sub: Record<string, unknown>): Record<string, unknown> {
  const intake = (sub["intake"] && typeof sub["intake"] === "object"
    ? sub["intake"]
    : {}) as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (sub[k] !== undefined && sub[k] !== null && sub[k] !== "") return sub[k];
      if (intake[k] !== undefined && intake[k] !== null && intake[k] !== "") return intake[k];
    }
    return undefined;
  };
  return {
    submissionId: sub["submission_id"],
    publicReference: sub["public_reference"],
    brand: sub["brand"],
    contact: { name: sub["contact_name"], email: sub["contact_email"] },
    organizationType: pick("company_category", "companyCategory", "orgType"),
    website: pick("website"),
    brandIntention: sub["brand_intention"],
    businessDecision: sub["business_decision"],
    projectStage: sub["project_stage"],
    selectedServices: sub["selected_services"],
    products: pick("products"),
    journeyApproach: pick("connectedJourney", "connected_journey"),
    journeyTasks: pick("customerTasks", "customer_tasks"),
    scopes: {
      fragrance: pick("fragranceScope"),
      makeup: pick("makeupScope"),
      bodyCare: pick("bodyCareScope"),
      packaging: pick("packagingScope"),
      retail: pick("retailScope"),
      web: pick("webScope"),
      mobileWeb: pick("mobileWebScope"),
      ios: pick("iosScope"),
      android: pick("androidScope"),
      remediation: pick("remediationScope"),
      retest: pick("retestScope"),
      research: pick("researchScope"),
    },
    deliverables: pick("deliverables"),
    timeline: pick("timeline"),
    stakeholders: pick("stakeholders"),
    confidentiality: {
      confidential: pick("confidential"),
      ndaRequired: pick("ndaRequired"),
    },
    investmentPreference: pick("budgetPreference", "budget_preference"),
    filesMetadata: pick("files"),
    schemaVersion: sub["schema_version"],
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

Deno.serve(async (req: Request): Promise<Response> => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let submissionId: string | null = null;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Accept: direct { submission_id } / { submissionId }, or database
    // webhook { type, table, record: { submission_id } }. The payload is an
    // identifier only — intake content is always re-read from Supabase.
    if (
      typeof body["record"] === "object" && body["record"] !== null
    ) {
      const rec = body["record"] as Record<string, unknown>;
      const wtype = body["type"];
      const wtable = body["table"];
      if (wtype !== undefined && wtype !== "INSERT") {
        return Response.json({ ok: true, ignored: "non-insert event" });
      }
      if (wtable !== undefined && wtable !== "intake_processing_jobs") {
        return Response.json({ ok: true, ignored: "unexpected table" });
      }
      const rid = rec["submission_id"];
      submissionId = typeof rid === "string" && rid.length > 0 ? rid : null;
    } else {
      const direct = body["submission_id"] ?? body["submissionId"];
      submissionId = typeof direct === "string" && direct.length > 0 ? direct : null;
    }
    if (!submissionId || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(submissionId)) {
      return Response.json({ ok: false, error: "missing or invalid submission_id" }, { status: 400 });
    }

    // 1. Atomic claim via RPC (FOR UPDATE SKIP LOCKED): only the
    // invocation that wins the row lock proceeds; all others no-op.
    // Scoped to this submission_id so retries stay on the same job.
    const { data: claimedRows, error: claimErr } = await supabase.rpc(
      "claim_next_intake_job_for_submission",
      { p_submission_id: submissionId }
    );
    if (claimErr || !claimedRows || (Array.isArray(claimedRows) && claimedRows.length === 0)) {
      // Already claimed/processed/failed-terminal — idempotent no-op.
      slog("duplicate suppressed", submissionId);
      return Response.json({ ok: true, submissionId, duplicate: true });
    }
    const job = (Array.isArray(claimedRows) ? claimedRows[0] : claimedRows) as Job;
    slog("processing started", submissionId);

    // 2. Retrieve canonical submission (never from email).
    const { data: sub, error: subErr } = await supabase
      .from("consultation_submissions")
      .select("*")
      .eq("submission_id", submissionId)
      .single();
    if (subErr || !sub) throw Object.assign(new Error("submission-not-found"), { code: "NOT_FOUND" });

    // 3. Agent analysis. callOpenAI throws AI_NOT_CONFIGURED when no key,
    // AI_RATE_LIMITED / AI_HTTP_ERROR / AI_EMPTY_OUTPUT / AI_INVALID_OUTPUT
    // otherwise. callOpenAI itself validates the brief — only a validated
    // IntakeBrief ever reaches persistence (never { raw }).
    // NOTE: job.attempt_count was ALREADY incremented once by the claim RPC;
    // failure logic below reuses it directly (no second increment).
    let brief: IntakeBrief;
    let responseId: string | null = null;
    let usage: unknown = null;
    try {
      const out = await callOpenAI(SYSTEM_PROMPT, buildAgentInput(sub));
      brief = out.brief;
      responseId = out.responseId;
      usage = out.usage;
    } catch (agentErr) {
      const code = (agentErr as Error & { code?: string }).code ?? "agent-error";
      const detail = (agentErr as Error & { detail?: string }).detail ?? null;
      slog("processing failed", `${submissionId} ${code}`);
      const terminal = code === "AI_NOT_CONFIGURED" ? "needs_review" : "processing_failed";
      const attempts = job.attempt_count;
      await supabase.from("intake_processing_jobs").update({
        status: attempts >= MAX_ATTEMPTS && terminal === "processing_failed" ? "processing_failed" : terminal,
        completed_at: new Date().toISOString(),
        last_error: detail ? `${code} | ${detail}`.slice(0, 800) : code,
        next_attempt_at: attempts < MAX_ATTEMPTS
          ? new Date(Date.now() + attempts * 5 * 60 * 1000).toISOString()
          : null,
      }).eq("id", job.id);
      // Submission itself stays submitted — never reverted, never duplicated.
      return Response.json({ ok: true, submissionId, status: terminal, agentError: code });
    }

    // 4. Persist validated brief only, plus limited provider metadata
    // (response id, model, usage). Never the raw provider payload.
    await supabase.from("intake_agent_results").upsert({
      submission_id: submissionId,
      analysis_json: {
        ...brief,
        _provenance: {
          model: OPENAI_MODEL,
          responseId,
          usage: usage ?? undefined,
          generatedAt: new Date().toISOString(),
          sourceVersion: 1,
        },
      },
      summary: brief.intakeSummary,
      missing_information: brief.missingInformation,
      recommended_modules: brief.recommendedAssessmentModules,
      consultation_questions: brief.questionsForConsultation,
      model: OPENAI_MODEL,
      schema_version: 1,
      status: "processed",
      updated_at: new Date().toISOString(),
    }, { onConflict: "submission_id" });

    // 6. Mark job processed.
    await supabase.from("intake_processing_jobs").update({
      status: "processed", completed_at: new Date().toISOString(), last_error: null,
    }).eq("id", job.id);
    slog("processing completed", submissionId);
    return Response.json({ ok: true, submissionId, status: "processed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    slog("processing failed", `${submissionId ?? "?"} ${msg}`);
    return Response.json({ ok: false, submissionId, error: msg }, { status: 500 });
  }
});
