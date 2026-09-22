// Post-claim intake pipeline: recovery, checked writes, failure fallback.
// Extracted from index.ts so unit tests can inject a fake supabase client
// and a fake model caller without booting Deno.serve.

import { classifyIntakeError, nextAttemptAt } from "./classify.ts";

export const MAX_ATTEMPTS = 3;

export type Job = {
  id: string;
  submission_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  max_attempts?: number | null;
  next_attempt_at?: string | null;
};

export type IntakeBrief = {
  intakeSummary: string;
  engagementShape: string;
  missingInformation: Array<{ field: string; reason: string; requiredForScope: boolean }>;
  questionsForConsultation: Array<{ id: string; question: string; whyItMatters: string; answerType: string }>;
  recommendedAssessmentModules: Array<{ id: string; label: string; reason: string }>;
  recommendedPreparation: string[];
  proposalInputs: Record<string, unknown>;
};

export type ModelResult = {
  brief: IntakeBrief;
  responseId: string | null;
  usage: unknown;
};

export type CallModel = (
  systemPrompt: string,
  userPayload: unknown,
) => Promise<ModelResult>;

export function isValidSubmissionId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(v);
}

export function extractSubmissionId(body: Record<string, unknown>): string | null {
  if (typeof body["record"] === "object" && body["record"] !== null) {
    const rec = body["record"] as Record<string, unknown>;
    const wtype = body["type"];
    const wtable = body["table"];
    if (wtype !== undefined && wtype !== "INSERT") return null;
    if (wtable !== undefined && wtable !== "intake_processing_jobs") return null;
    const rid = rec["submission_id"];
    return typeof rid === "string" && rid.length > 0 ? rid : null;
  }
  const direct = body["submission_id"] ?? body["submissionId"];
  return typeof direct === "string" && direct.length > 0 ? direct : null;
}

const slog = (msg: string, extra = "") =>
  console.log(`[IntakePipeline] ${msg}${extra ? " " + extra : ""}`);

/**
 * Persist a post-claim failure with a primary write and a minimal fallback.
 * Never leaves a claimed job stuck in `processing` when at least one write
 * can succeed.
 */
// deno-lint-ignore no-explicit-any
export async function markJobFailure(
  supabase: any,
  job: Job,
  code: string,
  detail: string | null,
): Promise<{ status: string; next_attempt_at: string | null; fallbackUsed?: boolean; writeFailed?: boolean }> {
  const cls = classifyIntakeError(code, detail);
  const attempts = job.attempt_count;
  const maxAttempts = job.max_attempts ?? MAX_ATTEMPTS;
  const next = cls.retryable ? nextAttemptAt(attempts, maxAttempts) : null;
  const lastError = detail ? `${cls.code} | ${detail}`.slice(0, 800) : cls.code;
  const primary = {
    status: cls.status,
    completed_at: new Date().toISOString(),
    last_error: lastError,
    next_attempt_at: next,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("intake_processing_jobs")
    .update(primary)
    .eq("id", job.id);
  if (!error) {
    slog("processing failed", `${job.submission_id} ${cls.code} retryable=${cls.retryable}`);
    return { status: cls.status, next_attempt_at: next };
  }
  slog("failure update error, falling back", `${job.id} ${error.message}`);
  // Fallback: essential columns only (no completed_at — that may be the bad column).
  const fallback = {
    status: cls.status,
    last_error: lastError,
    next_attempt_at: next,
    updated_at: new Date().toISOString(),
  };
  const fb = await supabase
    .from("intake_processing_jobs")
    .update(fallback)
    .eq("id", job.id);
  if (fb.error) {
    slog("fallback failure write failed", `${job.id} ${fb.error.message}`);
    return { status: cls.status, next_attempt_at: next, writeFailed: true };
  }
  return { status: cls.status, next_attempt_at: next, fallbackUsed: true };
}

/**
 * Mark job processed with a checked primary write and a minimal fallback.
 * If both fail, recover by writing a retryable failure so a later claim can
 * finish via existing-result recovery (never leaves the job in `processing`).
 */
// deno-lint-ignore no-explicit-any
export async function markJobProcessed(
  supabase: any,
  job: Job,
): Promise<{ ok: boolean; recovered?: boolean; fallbackUsed?: boolean }> {
  const primary = {
    status: "processed",
    completed_at: new Date().toISOString(),
    last_error: null,
    next_attempt_at: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("intake_processing_jobs")
    .update(primary)
    .eq("id", job.id);
  if (!error) return { ok: true };

  slog("processed update error, falling back", `${job.id} ${error.message}`);
  const fallback = {
    status: "processed",
    updated_at: new Date().toISOString(),
  };
  const fb = await supabase
    .from("intake_processing_jobs")
    .update(fallback)
    .eq("id", job.id);
  if (!fb.error) return { ok: true, fallbackUsed: true };

  slog("fallback processed write failed, recovering via failure state", `${job.id} ${fb.error.message}`);
  const outcome = await markJobFailure(supabase, job, "JOB_FINALIZE_FAILED", fb.error.message);
  return { ok: false, recovered: !outcome.writeFailed };
}

/**
 * Full post-claim processing: canonical submission → optional existing-result
 * recovery → model → persist → checked finalize.
 */
export type ProcessOutcome = {
  http: number;
  body: Record<string, unknown>;
};

// deno-lint-ignore no-explicit-any
export async function processClaimedJob(
  supabase: any,
  submissionId: string,
  job: Job,
  callModel: CallModel,
  opts: {
    systemPrompt: string;
    model: string;
    log?: (msg: string, extra?: string) => void;
  },
): Promise<ProcessOutcome> {
  const log = opts.log ?? slog;

  // 1. Existing result recovery: if a prior invocation persisted the brief
  // but died before the final job-state write, finalize without a second model call.
  const existing = await supabase
    .from("intake_agent_results")
    .select("submission_id, analysis_json, status")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (existing.error) {
    log("existing-result check error", `${submissionId} ${existing.error.message}`);
  } else if (existing.data && existing.data.analysis_json) {
    const fin = await markJobProcessed(supabase, job);
    log("recovered existing result", submissionId);
    return {
      http: 200,
      body: { ok: true, submissionId, status: "processed", recovered: true, finalized: fin.ok },
    };
  }

  // 2. Canonical submission (never from email/webhook payload).
  const { data: sub, error: subErr } = await supabase
    .from("consultation_submissions")
    .select("*")
    .eq("submission_id", submissionId)
    .single();
  if (subErr || !sub) {
    await markJobFailure(supabase, job, "NOT_FOUND", subErr?.message ?? null);
    return {
      http: 404,
      body: { ok: false, submissionId, error: "submission-not-found" },
    };
  }

  // 3. Model call.
  let brief: IntakeBrief;
  let responseId: string | null = null;
  let usage: unknown = null;
  try {
    const out = await callModel(opts.systemPrompt, buildAgentInput(sub));
    brief = out.brief;
    responseId = out.responseId;
    usage = out.usage;
  } catch (agentErr) {
    const code = (agentErr as Error & { code?: string }).code ?? "agent-error";
    const detail = (agentErr as Error & { detail?: string }).detail ?? null;
    const outcome = await markJobFailure(supabase, job, code, detail);
    const cls = classifyIntakeError(code, detail);
    return {
      http: 200,
      body: {
        ok: true,
        submissionId,
        status: outcome.status,
        agentError: cls.code,
        retryable: cls.retryable,
        next_attempt_at: outcome.next_attempt_at,
        writeFailed: outcome.writeFailed ?? false,
      },
    };
  }

  // 4. Persist validated brief only.
  const upsertRes = await supabase.from("intake_agent_results").upsert({
    submission_id: submissionId,
    analysis_json: {
      ...brief,
      _provenance: {
        model: opts.model,
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
    model: opts.model,
    schema_version: 1,
    status: "processed",
    updated_at: new Date().toISOString(),
  }, { onConflict: "submission_id" });

  if (upsertRes.error) {
    await markJobFailure(supabase, job, "RESULT_PERSIST_FAILED", upsertRes.error.message);
    return {
      http: 500,
      body: { ok: false, submissionId, error: "persist_failed" },
    };
  }

  // 5. Checked finalize.
  const fin = await markJobProcessed(supabase, job);
  if (fin.ok) {
    log("processing completed", submissionId);
    return { http: 200, body: { ok: true, submissionId, status: "processed" } };
  }
  log("finalize failed; recovery attempted", `${submissionId} recovered=${fin.recovered}`);
  return {
    http: fin.recovered ? 200 : 500,
    body: {
      ok: !!fin.recovered,
      submissionId,
      status: fin.recovered ? "processed" : "processing_failed",
      finalizeFailed: true,
    },
  };
}

export function buildAgentInput(sub: Record<string, unknown>): Record<string, unknown> {
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
