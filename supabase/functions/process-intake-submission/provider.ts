// Provider-neutral intake model execution.
// Business logic depends on callIntakeModel(...) only — never on a vendor SDK
// or a vendor-specific response shape. Provider selection comes from
// AI_PROVIDER (launch provider: groq). OpenAI remains available as an
// optional fallback and is never required for launch.
//
// Env (server-side only, set via `supabase secrets set`):
//   AI_PROVIDER      groq (default) | openai
//   GROQ_API_KEY     required when AI_PROVIDER=groq
//   GROQ_INTAKE_MODEL  default: openai/gpt-oss-20b
//   OPENAI_API_KEY     required only when AI_PROVIDER=openai
//   OPENAI_INTAKE_MODEL default: gpt-5.6-luna
//
// Every failure leaves an Error with a provider-neutral `code` from:
//   AI_NOT_CONFIGURED, AI_AUTH_ERROR, AI_RATE_LIMITED_TRANSIENT,
//   AI_PROVIDER_QUOTA, AI_INVALID_REQUEST, AI_PROVIDER_5XX, AI_TIMEOUT,
//   AI_NETWORK_ERROR, AI_EMPTY_OUTPUT, AI_INVALID_OUTPUT
// Secrets are never included in messages, detail, or logs.

import type { IntakeBrief, ModelResult } from "./pipeline.ts";

export type ProviderName = "groq" | "openai";

export type ProviderConfig = {
  provider: ProviderName;
  model: string;
  apiKey: string | null;
};

/** Strict IntakeBrief contract. Validated before ANY persistence. */
export const BRIEF_JSON_SCHEMA = {
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

export function validateBrief(v: unknown): v is IntakeBrief {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o["intakeSummary"] !== "string") return false;
  if (typeof o["engagementShape"] !== "string") return false;
  if (!Array.isArray(o["missingInformation"])) return false;
  if (!Array.isArray(o["questionsForConsultation"])) return false;
  if (!Array.isArray(o["recommendedAssessmentModules"])) return false;
  if (!Array.isArray(o["recommendedPreparation"])) return false;
  const p = o["proposalInputs"];
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  for (const k of ["services", "workstreams", "deliverables"]) {
    if (!Array.isArray((p as Record<string, unknown>)[k])) return false;
  }
  if (typeof (p as Record<string, unknown>)["budgetPreference"] !== "string") return false;
  if (typeof (p as Record<string, unknown>)["timeline"] !== "string") return false;
  if (!["separate workstreams", "connected journey", "both", "unclear"].includes(o["engagementShape"] as string)) {
    return false;
  }
  return true;
}

export function aiError(code: string, message: string, detail?: string): Error & { code: string; detail?: string } {
  const e = new Error(message) as Error & { code: string; detail?: string };
  e.code = code;
  if (detail) e.detail = detail;
  return e;
}

export function resolveProviderConfig(
  env: (name: string) => string | undefined = (n) => Deno.env.get(n),
): ProviderConfig {
  const raw = (env("AI_PROVIDER") ?? "groq").trim().toLowerCase();
  if (raw === "openai") {
    return {
      provider: "openai",
      model: env("OPENAI_INTAKE_MODEL") ?? "gpt-5.6-luna",
      apiKey: env("OPENAI_API_KEY") ?? null,
    };
  }
  // Default and launch provider: groq.
  return {
    provider: "groq",
    model: env("GROQ_INTAKE_MODEL") ?? "openai/gpt-oss-20b",
    apiKey: env("GROQ_API_KEY") ?? null,
  };
}

function sanitizeProviderMessage(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9-_]{4,}/g, "sk-REDACTED")
    .replace(/gsk_[A-Za-z0-9-_]{4,}/g, "gsk_REDACTED")
    .replace(/re_[A-Za-z0-9-_]{4,}/g, "re_REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]{4,}/gi, "Bearer REDACTED")
    .replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, "$1REDACTED")
    .slice(0, 300);
}

/** Read a sanitized, provider-neutral error summary from a failed response. */
export async function readProviderErrorDetail(res: Response): Promise<string | null> {
  const status = res.status;
  let requestId: string | null = null;
  try {
    requestId = res.headers.get("x-request-id") ?? res.headers.get("x-groq-id");
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
      else if (typeof (parsed as Record<string, unknown>)["message"] === "string") {
        err = parsed as Record<string, unknown>;
      }
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
    if (c) parts.push(`code=${String(c).slice(0, 60)}`);
    if (p) parts.push(`param=${p.slice(0, 80)}`);
    const m = pick(err["message"]);
    if (m) parts.push(`msg=${sanitizeProviderMessage(m)}`);
  } else {
    parts.push(`body=${sanitizeProviderMessage(raw.slice(0, 200))}`);
  }
  if (requestId) parts.push(`req=${requestId.slice(0, 40)}`);
  return parts.join(" ").slice(0, 600);
}

/** Map an HTTP failure to a provider-neutral code. */
export function classifyHttpFailure(status: number, detail: string | null): string {
  const d = (detail ?? "").toLowerCase();
  if (status === 401 || status === 403) return "AI_AUTH_ERROR";
  if (status === 429) {
    const quota = d.includes("insufficient_quota") || d.includes("credit_balance_exhausted") ||
      d.includes("quota_exceeded") || d.includes("exceeded your current quota") ||
      d.includes("no credits remaining") || d.includes("billing");
    if (quota) return "AI_PROVIDER_QUOTA";
    return "AI_RATE_LIMITED_TRANSIENT";
  }
  if (status === 408) return "AI_TIMEOUT";
  if (status === 425) return "AI_NETWORK_ERROR";
  if (status >= 500) return "AI_PROVIDER_5XX";
  if (status === 400 || status === 404 || status === 422) return "AI_INVALID_REQUEST";
  if (status >= 400) return "AI_INVALID_REQUEST";
  return "AI_PROVIDER_5XX";
}

const QUOTA_MARKERS = [
  "insufficient_quota", "credit_balance_exhausted", "quota_exceeded",
  "exceeded your current quota", "no credits remaining", "billing",
];

export function detailSaysQuota(detail: string | null | undefined): boolean {
  if (!detail) return false;
  const d = detail.toLowerCase();
  return QUOTA_MARKERS.some((m) => d.includes(m));
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 45000;

function extractJson(text: string | null): unknown {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Tolerate fenced output if a model ignores the response_format contract.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Chat-completions style content extraction (Groq + OpenAI chat). */
function extractChatContent(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as Record<string, unknown>)["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const msg = (first as Record<string, unknown>)["message"];
  if (!msg || typeof msg !== "object") return null;
  const content = (msg as Record<string, unknown>)["content"];
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const part of content) {
      if (part && typeof part === "object") {
        const t = (part as Record<string, unknown>)["text"];
        if (typeof t === "string") chunks.push(t);
      }
    }
    const joined = chunks.join("").trim();
    return joined.length ? joined : null;
  }
  return null;
}

/** OpenAI Responses API content extraction. */
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
      if ((t === "output_text" || t === "text") && typeof text === "string") chunks.push(text);
    }
  }
  const joined = chunks.join("").trim();
  return joined.length ? joined : null;
}

function finishParse(text: string | null, meta: {
  provider: string; model: string; responseId: string | null; usage: unknown;
}): ModelResult {
  if (!text) throw aiError("AI_EMPTY_OUTPUT", "empty model output");
  const parsed = extractJson(text);
  if (parsed === null) throw aiError("AI_INVALID_OUTPUT", "non-JSON model output");
  if (!validateBrief(parsed)) {
    throw aiError("AI_INVALID_OUTPUT", "model output failed brief validation");
  }
  return { brief: parsed, responseId: meta.responseId, usage: meta.usage, provider: meta.provider, model: meta.model };
}

async function postJson(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ ok: true; res: Response } | { ok: false; error: Error & { code: string; detail?: string } }> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : "network error";
    const timedOut = /timeout|abort|timed out/i.test(msg);
    return {
      ok: false,
      error: aiError(
        timedOut ? "AI_TIMEOUT" : "AI_NETWORK_ERROR",
        `model fetch failed: ${sanitizeProviderMessage(msg)}`,
      ),
    };
  }
  return { ok: true, res };
}

async function readFailure(res: Response): Promise<Error & { code: string; detail?: string }> {
  const detail = await readProviderErrorDetail(res).catch(() => null);
  return failureFromDetail(res.status, detail);
}

/**
 * Build a provider-neutral failure from an already-read detail string.
 * (Response bodies are single-read; never call readProviderErrorDetail twice.)
 */
function failureFromDetail(
  status: number,
  detail: string | null,
): Error & { code: string; detail?: string } {
  const code = classifyHttpFailure(status, detail);
  return aiError(code, `provider HTTP ${status}`, detail ?? undefined);
}

async function callGroq(
  cfg: ProviderConfig,
  systemPrompt: string,
  userPayload: unknown,
  fetchFn: FetchLike,
): Promise<ModelResult> {
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const headers = { Authorization: `Bearer ${cfg.apiKey}` };
  const base = {
    model: cfg.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    temperature: 0.2,
    max_completion_tokens: 6000,
  };

  const strictBody = {
    ...base,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "ingressible_intake_brief",
        strict: true,
        schema: BRIEF_JSON_SCHEMA,
      },
    },
  };

  let attempt = await postJson(fetchFn, url, headers, strictBody);
  if (!attempt.ok) throw attempt.error;

  let res = attempt.res;
  if (!res.ok) {
    const detail = await readProviderErrorDetail(res).catch(() => null);
    const unsupported = res.status === 400 &&
      /response_format|json_schema|structured output|schema/i.test(detail ?? "");
    if (!unsupported) throw failureFromDetail(res.status, detail);
    // One bounded fallback: JSON mode + schema restated in the system prompt.
    attempt = await postJson(fetchFn, url, headers, {
      ...base,
      messages: [
        { role: "system", content: `${systemPrompt}\n\nReturn ONLY a JSON object that exactly matches this JSON Schema:\n${JSON.stringify(BRIEF_JSON_SCHEMA)}` },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      response_format: { type: "json_object" },
    });
    if (!attempt.ok) throw attempt.error;
    res = attempt.res;
    if (!res.ok) {
      const fbDetail = await readProviderErrorDetail(res).catch(() => null);
      throw failureFromDetail(res.status, fbDetail);
    }
  }

  const body: unknown = await res.json().catch(() => null);
  if (!body || typeof body !== "object") throw aiError("AI_EMPTY_OUTPUT", "empty provider body");
  const rec = body as Record<string, unknown>;
  const text = extractChatContent(body);
  const responseId =
    (typeof rec["id"] === "string" ? rec["id"] : null) ??
    (typeof (rec["x_groq"] as Record<string, unknown> | undefined)?.["id"] === "string"
      ? ((rec["x_groq"] as Record<string, unknown>)["id"] as string)
      : null);
  return finishParse(text, {
    provider: cfg.provider,
    model: cfg.model,
    responseId,
    usage: rec["usage"] ?? null,
  });
}

async function callOpenAI(
  cfg: ProviderConfig,
  systemPrompt: string,
  userPayload: unknown,
  fetchFn: FetchLike,
): Promise<ModelResult> {
  const url = "https://api.openai.com/v1/responses";
  const headers = { Authorization: `Bearer ${cfg.apiKey}` };
  const attempt = await postJson(fetchFn, url, headers, {
    model: cfg.model,
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
  });
  if (!attempt.ok) throw attempt.error;
  const res = attempt.res;
  if (!res.ok) throw await readFailure(res);
  const body: unknown = await res.json().catch(() => null);
  if (!body || typeof body !== "object") throw aiError("AI_EMPTY_OUTPUT", "empty provider body");
  const rec = body as Record<string, unknown>;
  return finishParse(extractResponseText(body), {
    provider: cfg.provider,
    model: cfg.model,
    responseId: typeof rec["id"] === "string" ? rec["id"] : null,
    usage: rec["usage"] ?? null,
  });
}

/**
 * Provider-neutral intake model call. Throws only Errors carrying a
 * provider-neutral `code` (and optional sanitized `detail`).
 */
export async function callIntakeModel(
  cfg: ProviderConfig,
  systemPrompt: string,
  userPayload: unknown,
  fetchFn: FetchLike = fetch,
): Promise<ModelResult> {
  if (!cfg.apiKey) {
    throw aiError(
      "AI_NOT_CONFIGURED",
      `${cfg.provider} API key missing (AI_PROVIDER=${cfg.provider})`,
    );
  }
  if (cfg.provider === "openai") {
    return await callOpenAI(cfg, systemPrompt, userPayload, fetchFn);
  }
  return await callGroq(cfg, systemPrompt, userPayload, fetchFn);
}
