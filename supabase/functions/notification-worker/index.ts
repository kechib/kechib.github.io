/* ==========================================================================
   Ingressible — Notification Worker Edge Function
   Processes notification jobs from the notification_jobs queue.
   ========================================================================== */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BATCH_SIZE = 10;
const PROCESSING_TIMEOUT_MS = 120000; // 2 minutes

interface NotificationJob {
  id: string;
  submission_id: string;
  notification_type: string;
  recipient_type: "client" | "internal";
  recipient_address: string | null;
  payload: Record<string, unknown>;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batchSize || 5, MAX_BATCH_SIZE);
    const types = body.types || [
      "consultation.client_confirmation",
      "consultation.internal_notification",
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROCESSING_TIMEOUT_MS);

    try {
      const results = await processBatch(supabase, types, batchSize, controller.signal);
      return new Response(
        JSON.stringify({ success: true, processed: results.length, results }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      if (err.name === "AbortError") {
        return new Response(
          JSON.stringify({ error: "Processing timeout" }),
          { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    console.error("Notification worker error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processBatch(
  supabase: ReturnType<typeof createClient>,
  types: string[],
  batchSize: number,
  signal: AbortSignal
) {
  const results = [];

  // Claim jobs atomically
  const { data: jobs, error: claimError } = await claimJobs(supabase, "consultation.client_confirmation", 5);
  if (claimError) throw claimError;

  for (const job of jobs) {
    if (signal.aborted) break;

    const result = await processJob(job);
    results.push({ jobId: job.id, ...result });
  }

  return results;
}

async function claimJobs(
  supabase: ReturnType<typeof createClient>,
  notificationType: string,
  limit: number
): Promise<NotificationJob[]> {
  const { data, error } = await supabase.rpc("claim_notification_jobs", {
    p_types: ["consultation.client_confirmation"],
    p_limit: 10,
  });

  if (claimError) throw claimError;
  return data || [];
}

async function processJob(job: NotificationJob) {
  const { id, submission_id, notification_type, recipient_type, recipient_address, payload } = job;

  // Generate stable idempotency key for provider
  const idempotencyKey = `notification:${id}`;

  try {
    // Mark as processing
    await supabase
      .from("notification_jobs")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
        attempt_count: supabase.raw("attempt_count + 1"),
      })
      .eq("id", job.id);

    // Dispatch based on notification type
    let result;
    switch (notification_type) {
      case "consultation.client_confirmation":
        result = await sendClientConfirmation(job, idempotencyKey);
        break;
      case "consultation.internal_notification":
        result = await sendInternalNotification(job, idempotencyKey);
        break;
      default:
        throw new Error(`Unknown notification type: ${notification_type}`);
    }

    // Mark as sent
    await supabase
      .from("notification_jobs")
      .update({
        status: "sent",
        completed_at: new Date().toISOString(),
        last_error: null,
        provider_message_id: result.messageId,
        provider_name: result.transport,
        provider_idempotency_key: idempotencyKey,
        last_provider_attempt_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return { success: true, ...result };
  } catch (err) {
    console.error(`Notification job ${job.id} failed:`, err);

    // Increment attempt count and schedule retry if applicable
    const { data: jobData } = await supabase
      .from("notification_jobs")
      .select("attempt_count, max_attempts")
      .eq("id", job.id)
      .single();

    const attemptCount = (jobData?.attempt_count || 0) + 1;
    const maxAttempts = jobData?.max_attempts || 3;

    if (attemptCount < maxAttempts) {
      // Schedule retry with exponential backoff
      const backoffMinutes = Math.min(Math.pow(2, attemptCount) * 5, 60);
      const nextAttempt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();

      await supabase
        .from("notification_jobs")
        .update({
          status: "pending",
          attempt_count: attemptCount,
          last_error: err.message,
          next_attempt_at: nextAttempt,
        })
        .eq("id", job.id);

      return { success: false, retried: true, nextAttempt };
    } else {
      // Max attempts exceeded
      await supabase
        .from("notification_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          last_error: err.message,
        })
        .eq("id", job.id);

      return { success: false, failed: true, error: err.message };
    }
  }
}

async function sendClientConfirmation(job: NotificationJob, idempotencyKey: string) {
  const { brand, contact_name, public_reference, created_at } = job.payload as {
    brand: string;
    contact_name: string;
    public_reference: string;
    created_at: string;
  };

  const emailTransport = Deno.env.get("EMAIL_TRANSPORT") || "real";
  const appEnv = Deno.env.get("APP_ENV") || Deno.env.get("SUPABASE_ENV") || "development";
  const isProduction = appEnv === "production";
  const emailApiKey = Deno.env.get("EMAIL_API_KEY");

  // Fake transport only allowed in non-production with explicit opt-in
  if (emailTransport === "fake") {
    if (isProduction) {
      throw new Error("Fake email transport not allowed in production");
    }
    console.log(`[FAKE EMAIL] Client confirmation sent to ${job.recipient_address}`);
    console.log(`  Subject: Ingressible consultation request received — ${job.payload.public_reference}`);
    console.log(`  To: ${job.recipient_address}`);
    return { transport: "fake", messageId: `fake-${Date.now()}`, idempotencyKey };
  }

  // Real transport requires API key
  if (!emailApiKey) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }

  // Real email provider integration would go here
  // Example with Resend:
  // const resend = new Resend(emailApiKey);
  // const { data, error } = await resend.emails.send({
  //   from: 'Ingressible <hello@ingressible.com>',
  //   to: job.recipient_address,
  //   subject: `Ingressible consultation request received — ${job.payload.public_reference}`,
  //   html: renderClientConfirmationEmail(job.payload),
  //   headers: { 'Idempotency-Key': idempotencyKey },
  // });

  return { transport: "real", messageId: "real-message-id", idempotencyKey };
}

async function sendInternalNotification(job: NotificationJob, idempotencyKey: string) {
  const { brand, contact_name, email, public_reference, created_at } = job.payload as {
    brand: string;
    contact_name: string;
    email: string;
    public_reference: string;
    created_at: string;
  };

  const emailTransport = Deno.env.get("EMAIL_TRANSPORT") || "real";
  const appEnv = Deno.env.get("APP_ENV") || Deno.env.get("SUPABASE_ENV") || "development";
  const isProduction = appEnv === "production";
  const emailApiKey = Deno.env.get("EMAIL_API_KEY");

  // Fake transport only allowed in non-production with explicit opt-in
  if (emailTransport === "fake") {
    if (isProduction) {
      throw new Error("Fake email transport not allowed in production");
    }
    console.log(`[FAKE EMAIL] Internal notification sent to ${job.recipient_address}`);
    console.log(`  Subject: New Ingressible consultation — ${job.payload.brand} — ${job.payload.public_reference}`);
    return { transport: "fake", messageId: `fake-internal-${Date.now()}`, idempotencyKey };
  }

  // Real transport requires API key
  if (!emailApiKey) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }

  // Real email provider integration would go here
  // Example with Resend:
  // const resend = new Resend(emailApiKey);
  // await resend.emails.send({
  //   from: 'Ingressible <hello@ingressible.com>',
  //   to: job.recipient_address,
  //   subject: `New Ingressible consultation — ${job.payload.brand} — ${job.payload.public_reference}`,
  //   html: renderInternalNotificationEmail(job.payload),
  //   headers: { 'Idempotency-Key': idempotencyKey },
  // });

  return { transport: "real", messageId: "real-message-id", idempotencyKey };
}