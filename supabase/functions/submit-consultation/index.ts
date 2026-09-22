import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

const ALLOWED_ORIGINS = [
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

  const rateLimitStore = new Map<string, { count: number; windowStart: number }>();
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                    req.headers.get("x-real-ip") || "unknown";
  const rateLimitKey = `ratelimit:${clientIp}`;
  const now = Date.now();
  let rateLimitData = rateLimitStore.get(rateLimitKey);
  if (!rateLimitData || now - rateLimitData.windowStart > 60000 * 60) {
    rateLimitData = { count: 0, windowStart: now };
    rateLimitStore.set(rateLimitKey, rateLimitData);
  }
  if (rateLimitData.count >= 10) {
    const retryAfter = Math.ceil((rateLimitData.windowStart + 60000 * 60 - now) / 1000);
    return corsResponse(
      JSON.stringify({ error: "Too many requests", retryAfter }),
      429,
      allowOrigin
    );
  }
  rateLimitData.count++;

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

    const submissionId = payload.submissionId;
    if (!submissionId || typeof submissionId !== "string" || submissionId.length > 255) {
      return corsResponse(JSON.stringify({ error: "Missing or invalid submissionId" }), 400, allowOrigin);
    }

    const brand = payload.brand;
    if (!brand || typeof brand !== "string" || brand.length > 255) {
      return corsResponse(JSON.stringify({ error: "Missing or invalid brand" }), 400, allowOrigin);
    }

    const contact = payload.contact;
    if (!contact || typeof contact !== "string" || contact.length > 255) {
      return corsResponse(JSON.stringify({ error: "Missing or invalid contact" }), 400, allowOrigin);
    }

    const email = payload.email;
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
      return corsResponse(JSON.stringify({ error: "Missing or invalid email" }), 400, allowOrigin);
    }

    const brandIntention = payload.brandIntention;
    if (!brandIntention || typeof brandIntention !== "string") {
      return corsResponse(JSON.stringify({ error: "Missing or invalid brandIntention" }), 400, allowOrigin);
    }

    const businessDecision = payload.businessDecision;
    if (!businessDecision || typeof businessDecision !== "string") {
      return corsResponse(JSON.stringify({ error: "Missing or invalid businessDecision" }), 400, allowOrigin);
    }

    const projectStage = payload.projectStage;
    if (!projectStage || typeof projectStage !== "string") {
      return corsResponse(JSON.stringify({ error: "Missing or invalid projectStage" }), 400, allowOrigin);
    }

    const services = payload.services;
    if (!services || !Array.isArray(services) || services.length === 0 || services.length > MAX_SERVICES) {
      return corsResponse(JSON.stringify({ error: "Missing or invalid services" }), 400, allowOrigin);
    }

    const fullIntake = payload.fullIntake;
    if (fullIntake !== undefined && fullIntake !== null && typeof fullIntake !== "object" && typeof fullIntake !== "string") {
      return corsResponse(JSON.stringify({ error: "Invalid fullIntake" }), 400, allowOrigin);
    }

    const schemaVersion = payload.schemaVersion;
    if (schemaVersion !== undefined && schemaVersion !== 1) {
      return corsResponse(JSON.stringify({ error: "Unsupported schema version" }), 400, allowOrigin);
    }

    const canonicalExisting = await getCanonicalBySubmissionId(supabase, submissionId);
    if (canonicalExisting) {
      const rpcResult = await ensureReconciliation(supabase, submissionId);
      if (rpcResult.error) {
        console.error("Reconciliation returned error for existing submission:", rpcResult.error);
      }
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
      const { data, error } = await insertCanonicalRow(supabase, payload, submissionId, candidate);

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
