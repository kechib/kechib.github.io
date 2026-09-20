/* ==========================================================================
   Ingressible — Submit Consultation Edge Function
   Canonical server-side endpoint for consultation submissions.
   ========================================================================== */

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
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
];

const MAX_PAYLOAD_SIZE = 256 * 1024; // 256 KB
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_REQUESTS = 10; // per IP per window

// Simple in-memory rate limit store (in production, use Redis/KV)
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

Deno.serve(async (req) => {
  // Dynamic CORS based on origin
  const requestOrigin = req.headers.get("origin");
  const allowOrigin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : "";
  const responseCorsHeaders = {
    ...corsHeaders,
    "Access-Control-Allow-Origin": allowOrigin || "",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseCorsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  }

  // CORS: validate origin
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response(
      JSON.stringify({ error: "Origin not allowed" }),
      { status: 403, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Content-Type validation
  const contentType = req.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return new Response(
      JSON.stringify({ error: "Content-Type must be application/json" }),
      { status: 415, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Payload size limit
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
    return new Response(
      JSON.stringify({ error: "Payload too large" }),
      { status: 413, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Create Supabase client with service role (server-side only)
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { status: 500, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  // Rate limiting (per IP)
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
                   req.headers.get("x-real-ip") ||
                   "unknown";
  const rateLimitKey = `ratelimit:${clientIp}`;
  const now = Date.now();

  let rateLimitData = rateLimitStore.get(rateLimitKey);
  if (!rateLimitData || now - rateLimitData.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitData = { count: 0, windowStart: now };
    rateLimitStore.set(rateLimitKey, rateLimitData);
  }

  if (rateLimitData.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((rateLimitData.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return new Response(
      JSON.stringify({ error: "Too many requests", retryAfter }),
      { status: 429, headers: { ...responseCorsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfter) } }
    );
  }

  rateLimitData.count++;

  try {
    // Parse and validate request
    let payload;
    try {
      const text = await req.text();
      if (text.length > MAX_PAYLOAD_SIZE) {
        return new Response(
          JSON.stringify({ error: "Payload too large" }),
          { status: 413, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
        );
      }
      payload = JSON.parse(text);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON payload" }),
        { status: 400, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate required fields
    const validationError = validatePayload(payload);
    if (validationError) {
      return new Response(
        JSON.stringify({ error: validationError }),
        { status: 400, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Anti-spam: honeypot field
    if (payload.honeypot && payload.honeypot.trim().length > 0) {
      // Silently accept but don't process (bot detected)
      return new Response(
        JSON.stringify({ success: true, submissionId: "ignored", publicReference: "ignored" }),
        { status: 200, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Minimum completion time check (5 seconds minimum)
    if (payload.startedAt) {
      const elapsed = Date.now() - payload.startedAt;
      if (elapsed < 5000) { // 5 seconds minimum
        return new Response(
          JSON.stringify({ error: "Form submitted too quickly" }),
          { status: 400, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const {
      submissionId,
      idempotencyKey,
      schemaVersion,
      status,
      brand,
      contact,
      email,
      services,
      projectStage,
      brandIntention,
      businessDecision,
      budget,
      timeline,
      confidential,
      nda,
      deliverables,
      fullIntake,
    } = payload;

    // Verify schema version
    if (schemaVersion !== 1) {
      return new Response(
        JSON.stringify({ error: "Unsupported schema version" }),
        { status: 400, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate public reference (server-trusted)
    const publicReference = generatePublicReference();

    // Upsert submission with idempotency - with collision retry for public_reference
    let submission;
    let insertError;
    let publicReference = generatePublicReference();
    let attempt = 0;
    const maxRefAttempts = 5;

    while (attempt < maxRefAttempts) {
      const { data: submission, error: insertError } = await supabase
        .from("consultation_submissions")
        .upsert(
          {
            submission_id: payload.submissionId,
            idempotency_key: payload.idempotencyKey,
            public_reference: publicReference,
            brand,
            contact,
            email,
            services,
            project_stage: projectStage,
            brand_intention: brandIntention,
            business_decision: businessDecision,
            budget,
            timeline,
            confidential,
            nda,
            deliverables,
            full_intake: fullIntake,
            schema_version: schemaVersion,
            status: status || "submitted",
          },
          {
            onConflict: "submission_id",
            ignoreDuplicates: false,
          }
        )
        .select("submission_id, public_reference, created_at")
        .single();

      insertError = insertError;
      if (!insertError) {
        submission = submission;
        break;
      }

      // Handle unique constraint violations
      if (insertError.code === "23505") {
        // Check if it's a duplicate submission_id (idempotent retry)
        if (insertError.message?.includes("submission_id")) {
          const { data: existing } = await supabase
            .from("consultation_submissions")
            .select("submission_id, public_reference, created_at")
            .eq("submission_id", payload.submissionId)
            .single();

          if (existing) {
            return new Response(
              JSON.stringify({
                success: true,
                submissionId: existing.submission_id,
                publicReference: existing.public_reference,
                idempotent: true,
                createdAt: existing.created_at,
              }),
              { status: 200, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        // Check if it's a public_reference collision
        if (insertError.message?.includes("public_reference")) {
          attempt++;
          if (attempt >= maxRefAttempts) {
            console.error("Max public reference collision retries exceeded");
            return new Response(
              JSON.stringify({ error: "Failed to generate unique reference" }),
              { status: 500, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
            );
          }
          // Generate new reference and retry
          publicReference = generatePublicReference();
          continue;
        }

      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to persist submission" }),
        { status: 500, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!submission) {
      return new Response(
        JSON.stringify({ error: "Failed to persist submission" }),
        { status: 500, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create downstream jobs transactionally
    const jobResults = await createDownstreamJobs(supabase, submission.submission_id);

    return new Response(
      JSON.stringify({
        success: true,
        submissionId: submission.submission_id,
        publicReference: submission.public_reference,
        createdAt: submission.created_at,
        jobsCreated: jobResults,
      }),
      { status: 201, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Submit consultation error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function validatePayload(payload) {
  if (!payload.submissionId) return "Missing submissionId";
  if (!payload.idempotencyKey) return "Missing idempotencyKey";
  if (!payload.brand || typeof payload.brand !== "string") return "Missing or invalid brand";
  if (!payload.contact || typeof payload.contact !== "string") return "Missing or invalid contact";
  if (!payload.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return "Missing or invalid email";
  if (!payload.services || typeof payload.services !== "string") return "Missing or invalid services";
  if (!payload.projectStage || typeof payload.projectStage !== "string") return "Missing or invalid projectStage";
  if (!payload.brandIntention || typeof payload.brandIntention !== "string") return "Missing or invalid brandIntention";
  if (!payload.fullIntake || typeof payload.fullIntake !== "string") return "Missing or invalid fullIntake";
  if (payload.schemaVersion !== 1) return "Unsupported schema version";
  return null;
}

function generatePublicReference() {
  const prefix = "ING";
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

async function createDownstreamJobs(supabase, submissionId) {
  const results = { clientConfirmation: false, internalNotification: false };

  const { data: submission } = await supabase
    .from("consultation_submissions")
    .select("email, brand, contact, public_reference, submission_id, created_at")
    .eq("submission_id", submissionId)
    .single();

  if (submission) {
    // 1. Create client confirmation notification job
    const { error: clientNotifError } = await supabase
      .from("notification_jobs")
      .insert({
        submission_id: submission.submission_id,
        notification_type: "consultation.client_confirmation",
        recipient_type: "client",
        recipient_address: submission.email,
        status: "pending",
        max_attempts: 3,
        payload: {
          brand: submission.brand,
          contact_name: submission.contact,
          public_reference: submission.public_reference,
          created_at: submission.created_at,
        },
      });

    if (clientNotifError) {
      console.error("Failed to create client confirmation job:", clientNotifError);
    } else {
      results.clientConfirmation = true;
    }

    // 2. Create internal notification job
    const { error: internalNotifError } = await supabase
      .from("notification_jobs")
      .insert({
        submission_id: submission.submission_id,
        notification_type: "consultation.internal_notification",
        recipient_type: "internal",
        recipient_address: "hello@ingressible.com",
        status: "pending",
        max_attempts: 3,
        payload: {
          brand: submission.brand,
          contact_name: submission.contact,
          email: submission.email,
          public_reference: submission.public_reference,
          created_at: submission.created_at,
        },
      });

    if (internalNotifError) {
      console.error("Failed to create internal notification job:", internalNotifError);
    } else {
      results.internalNotification = true;
    }
  }

  return results;
}

async function recordEvent(supabase, submissionId, eventType, metadata = {}) {
  await supabase.from("consultation_events").insert({
    submission_id: submissionId,
    event_type: eventType,
    actor_type: "system",
    safe_metadata: metadata,
  });
}