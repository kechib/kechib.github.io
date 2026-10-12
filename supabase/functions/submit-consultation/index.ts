import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

const ALLOWED_ORIGINS = [
  "https://ingressible.com",
  "https://www.ingressible.com",
  "https://workspace.ingressible.com",
  "https://www.kechiboniface.com",
  "https://kechiboniface.com",
  "https://kechib.github.io",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
];

const MAX_PAYLOAD_SIZE = 256 * 1024;
const MIN_COMPLETION_TIME_MS = 5000;
const MAX_REF_RETRIES = 5;
const MAX_SERVICES = 20;

function generatePublicReference(): string {
  const prefix = "ING";
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

function resolveOrigin(requestOrigin: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return "";
}

function corsResponse(body: string, status: number, origin: string): Response {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Origin": origin,
      "Content-Type": "application/json",
    },
  });
}

function newCandidate(): string {
  return generatePublicReference();
}

function parseFullIntake(value: unknown): Record<string, any> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function normalizeServices(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

async function rateLimitKey(req: Request): Promise<string> {
  const clientIp =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const bytes = new TextEncoder().encode(clientIp.slice(0, 128));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `consultation:${hex}`;
}

async function consumeSubmissionRateLimit(
  supabase: any,
  req: Request
): Promise<{ allowed: boolean; retryAfter: number }> {
  const { data, error } = await supabase.rpc("consume_consultation_rate_limit", {
    p_key: await rateLimitKey(req),
    p_limit: 10,
    p_window_seconds: 3600,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(result?.allowed),
    retryAfter: Math.max(0, Number(result?.retry_after) || 0),
  };
}

async function getCanonicalBySubmissionId(
  supabase: any,
  submissionId: string
): Promise<any | null> {
  const { data, error } = await supabase
    .from("consultation_submissions")
    .select("submission_id, public_reference, created_at, updated_at")
    .eq("submission_id", submissionId)
    .single();
  if (error || !data) return null;
  return data;
}

async function insertCanonicalRow(
  supabase: any,
  payload: any,
  submissionId: string,
  publicReference: string
): Promise<{ data: any; error: any }> {
  const servicesArray = typeof payload.services === "string"
    ? payload.services.split(",").map((s: string) => s.trim()).filter((s: string) => s)
    : (Array.isArray(payload.services) ? payload.services : []);

  const intakeObj = typeof payload.fullIntake === "string"
    ? (() => { try { return JSON.parse(payload.fullIntake); } catch { return {}; } })()
    : (payload.fullIntake || {});

  return supabase
    .from("consultation_submissions")
    .insert({
      submission_id: submissionId,
      brand: payload.brand,
      contact_name: payload.contact,
      contact_email: payload.email,
      company_category: payload.company_category || "",
      brand_intention: payload.brandIntention,
      business_decision: payload.businessDecision,
      project_stage: payload.projectStage,
      selected_services: servicesArray,
      intake: intakeObj,
      source: "web",
      schema_version: payload.schemaVersion || 1,
      status: "submitted",
      public_reference: publicReference,
    })
    .select("submission_id, public_reference, created_at, updated_at")
    .single();
}

async function recordCreationEvent(
  supabase: any,
  submissionId: string
): Promise<{ error: any }> {
  return supabase.from("consultation_events").insert({
    submission_id: submissionId,
    event_type: "submission.received",
    actor_type: "system",
    safe_metadata: {},
  });
}

async function ensureReconciliation(
  supabase: any,
  submissionId: string
): Promise<{ data: any; error: any }> {
  return supabase.rpc("ensure_consultation_jobs", { p_submission_id: submissionId });
}

async function dispatchNotifications(
  supabaseUrl: string,
  serviceRoleKey: string,
  submissionId: string
): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/notification-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      authorizedSubmissionIds: [submissionId],
      types: [
        "consultation.client_confirmation",
        "consultation.internal_notification",
      ],
      limit: 2,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `notification-worker status=${response.status} ${detail.slice(0, 160)}`
    );
  }
}

function queueNotificationDispatch(
  supabaseUrl: string,
  serviceRoleKey: string,
  submissionId: string
): void {
  // @ts-ignore EdgeRuntime is provided by the hosted Supabase runtime.
  EdgeRuntime.waitUntil(
    dispatchNotifications(supabaseUrl, serviceRoleKey, submissionId).catch((err) => {
      console.error("Notification dispatch failed", {
        submissionId,
        error: err instanceof Error ? err.message : "unknown",
      });
    })
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  const requestOrigin = req.headers.get("origin");
  const allowOrigin = resolveOrigin(requestOrigin);

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { ...corsHeaders, "Access-Control-Allow-Origin": allowOrigin },
    });
  }

  if (req.method !== "POST") {
    return corsResponse(JSON.stringify({ error: "Method not allowed" }), 405, allowOrigin);
  }

  if (requestOrigin && !ALLOWED_ORIGINS.includes(requestOrigin)) {
    return corsResponse(JSON.stringify({ error: "Origin not allowed" }), 403, allowOrigin);
  }

  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return corsResponse(JSON.stringify({ error: "Content-Type must be application/json" }), 415, allowOrigin);
  }

  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
    return corsResponse(JSON.stringify({ error: "Payload too large" }), 413, allowOrigin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return corsResponse(JSON.stringify({ error: "Server configuration error" }), 500, allowOrigin);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const rateLimit = await consumeSubmissionRateLimit(supabase, req);
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: "Too many requests",
          retryAfter: rateLimit.retryAfter || 3600,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Access-Control-Allow-Origin": allowOrigin,
            "Content-Type": "application/json",
            "Retry-After": String(rateLimit.retryAfter || 3600),
          },
        }
      );
    }
  } catch (rateError) {
    console.error("Consultation rate limit check failed:", rateError);
    return corsResponse(
      JSON.stringify({ error: "Submission protection is temporarily unavailable" }),
      503,
      allowOrigin
    );
  }

  try {
    let payload: any;
    try {
      const text = await req.text();
      if (text.length > MAX_PAYLOAD_SIZE) {
        return corsResponse(JSON.stringify({ error: "Payload too large" }), 413, allowOrigin);
      }
      payload = JSON.parse(text);
    } catch {
      return corsResponse(JSON.stringify({ error: "Invalid JSON payload" }), 400, allowOrigin);
    }

    if (payload.honeypot && payload.honeypot.trim().length > 0) {
      return corsResponse(
        JSON.stringify({ success: true, submissionId: "ignored", publicReference: "ignored" }),
        200,
        allowOrigin
      );
    }

    if (payload.startedAt) {
      const elapsed = Date.now() - payload.startedAt;
      if (elapsed < MIN_COMPLETION_TIME_MS) {
        return corsResponse(
          JSON.stringify({ error: "Form submitted too quickly" }),
          400,
          allowOrigin
        );
      }
    }

    const fullIntakeObject = parseFullIntake(payload.fullIntake);

    const submissionId = payload.submissionId ?? payload.submission_id;
    if (!submissionId || typeof submissionId !== "string" || submissionId.length > 255) {
      console.warn("consultation_validation_error", { code: "INVALID_SUBMISSION_ID" });
      return corsResponse(JSON.stringify({
        error: "Missing or invalid submissionId",
        code: "INVALID_SUBMISSION_ID",
        userMessage: "We could not identify this consultation submission. Your answers are still saved."
      }), 400, allowOrigin);
    }

    const brand = payload.brand ?? payload.company ?? fullIntakeObject.brand;
    if (!brand || typeof brand !== "string" || brand.length > 255) {
      console.warn("consultation_validation_error", { code: "INVALID_BRAND" });
      return corsResponse(JSON.stringify({
        error: "Missing or invalid brand",
        code: "INVALID_BRAND",
        userMessage: "Please review the brand or company name before submitting."
      }), 400, allowOrigin);
    }

    const contact = payload.contact ?? payload.primary_contact ?? payload.contactName ?? fullIntakeObject.primary_contact ?? fullIntakeObject.contact;
    if (!contact || typeof contact !== "string" || contact.length > 255) {
      console.warn("consultation_validation_error", { code: "INVALID_CONTACT" });
      return corsResponse(JSON.stringify({
        error: "Missing or invalid contact",
        code: "INVALID_CONTACT",
        userMessage: "Please review the primary contact name before submitting."
      }), 400, allowOrigin);
    }

    const email = payload.email ?? payload.work_email ?? fullIntakeObject.work_email ?? fullIntakeObject.email;
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      console.warn("consultation_validation_error", { code: "INVALID_EMAIL" });
      return corsResponse(JSON.stringify({
        error: "Missing or invalid email",
        code: "INVALID_EMAIL",
        userMessage: "Please review the work email address before submitting."
      }), 400, allowOrigin);
    }

    const brandIntention =
      payload.brandIntention ??
      payload.brand_intention ??
      fullIntakeObject.brandIntention ??
      fullIntakeObject.brand_intention ??
      "";

    const businessDecision =
      payload.businessDecision ??
      payload.business_decision ??
      fullIntakeObject.businessDecision ??
      fullIntakeObject.business_decision ??
      "";

    const projectStage =
      payload.projectStage ??
      payload.project_stage ??
      fullIntakeObject.projectStage ??
      fullIntakeObject.project_stage;
    if (!projectStage || typeof projectStage !== "string") {
      console.warn("consultation_validation_error", { code: "INVALID_PROJECT_STAGE" });
      return corsResponse(JSON.stringify({
        error: "Missing or invalid projectStage",
        code: "INVALID_PROJECT_STAGE",
        userMessage: "Please review the project stage before submitting."
      }), 400, allowOrigin);
    }

    const services = normalizeServices(
      payload.services ??
      payload.selectedServices ??
      payload.selected_services ??
      fullIntakeObject.selectedServices ??
      fullIntakeObject.selected_services
    );
    if (services.length === 0 || services.length > MAX_SERVICES) {
      console.warn("consultation_validation_error", { code: "INVALID_SERVICES" });
      return corsResponse(JSON.stringify({
        error: "Missing or invalid services",
        code: "INVALID_SERVICES",
        userMessage: "Please choose at least one service before submitting."
      }), 400, allowOrigin);
    }

    if (payload.fullIntake !== undefined && payload.fullIntake !== null &&
        typeof payload.fullIntake !== "object" && typeof payload.fullIntake !== "string") {
      console.warn("consultation_validation_error", { code: "INVALID_FULL_INTAKE" });
      return corsResponse(JSON.stringify({
        error: "Invalid fullIntake",
        code: "INVALID_FULL_INTAKE",
        userMessage: "Some consultation details could not be read. Your answers are still saved."
      }), 400, allowOrigin);
    }

    const rawSchemaVersion = payload.schemaVersion ?? payload.schema_version ?? 1;
    const schemaVersion = Number(rawSchemaVersion);
    if (!Number.isFinite(schemaVersion) || schemaVersion !== 1) {
      console.warn("consultation_validation_error", { code: "UNSUPPORTED_SCHEMA_VERSION" });
      return corsResponse(JSON.stringify({
        error: "Unsupported schema version",
        code: "UNSUPPORTED_SCHEMA_VERSION",
        userMessage: "This consultation form needs to be refreshed before it can be submitted. Your answers are still saved."
      }), 400, allowOrigin);
    }

    const normalizedPayload = {
      ...payload,
      submissionId,
      brand,
      contact,
      email,
      brandIntention: typeof brandIntention === "string" ? brandIntention : "",
      businessDecision: typeof businessDecision === "string" ? businessDecision : "",
      projectStage,
      services,
      fullIntake: fullIntakeObject,
      schemaVersion,
    };

    const canonicalExisting = await getCanonicalBySubmissionId(supabase, submissionId);
    if (canonicalExisting) {
      const rpcResult = await ensureReconciliation(supabase, submissionId);
      if (rpcResult.error) {
        console.error("Reconciliation returned error for existing submission:", rpcResult.error);
      }
      queueNotificationDispatch(supabaseUrl, supabaseServiceRoleKey, submissionId);
      return corsResponse(
        JSON.stringify({
          success: true,
          submissionId: canonicalExisting.submission_id,
          publicReference: canonicalExisting.public_reference,
          message: "Your consultation request has been received.",
          createdAt: canonicalExisting.created_at,
        }),
        200,
        allowOrigin
      );
    }

    let submission: any;
    let attempt = 0;

    while (attempt < MAX_REF_RETRIES) {
      const candidate = newCandidate();
      const { data, error } = await insertCanonicalRow(supabase, normalizedPayload, submissionId, candidate);

      if (!error && data) {
        submission = data;
        break;
      }

      if (error && error.code === "23505") {
        const existing = await getCanonicalBySubmissionId(supabase, submissionId);
        if (existing && existing.public_reference) {
          submission = existing;
          break;
        }
      }

      attempt++;
      if (attempt >= MAX_REF_RETRIES) {
        return corsResponse(
          JSON.stringify({ error: "Failed to generate unique reference" }),
          500,
          allowOrigin
        );
      }
    }

    if (!submission || !submission.public_reference) {
      return corsResponse(
        JSON.stringify({ error: "Canonical consultation could not be resolved" }),
        500,
        allowOrigin
      );
    }

    const eventResult = await recordCreationEvent(supabase, submissionId);
    if (eventResult.error) {
      console.error("Failed to insert consultation_event:", eventResult.error);
    }

    let rpcResult: any;
    try {
      rpcResult = await ensureReconciliation(supabase, submissionId);
    } catch (reconErr) {
      console.error("Reconciliation invocation failed:", reconErr);
    }
    if (rpcResult && rpcResult.error) {
      console.error("Reconciliation returned error:", rpcResult.error);
    }

    queueNotificationDispatch(supabaseUrl, supabaseServiceRoleKey, submissionId);

    return corsResponse(
      JSON.stringify({
        success: true,
        submissionId: submission.submission_id,
        publicReference: submission.public_reference,
        message: "Your consultation request has been received.",
        createdAt: submission.created_at,
      }),
      200,
      allowOrigin
    );
  } catch (err) {
    console.error("Submit consultation error:", err);
    return corsResponse(
      JSON.stringify({ error: "Internal server error" }),
      500,
      allowOrigin
    );
  }
});
