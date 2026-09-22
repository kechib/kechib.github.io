// Notification worker core tests (injected deps, no network, no database).
import {
  backoffMinutes,
  isTerminalEmailCode,
  processBatch,
  processJob,
  renderJob,
  type NotificationJob,
} from "../functions/notification-worker/worker.ts";
import {
  buildClientConfirmation,
  buildInternalNotification,
  escapeHtml,
} from "../functions/notification-worker/templates.ts";
import {
  isEmailConfigured,
  resolveEmailConfig,
} from "../functions/notification-worker/email.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

function job(over: Partial<NotificationJob> = {}): NotificationJob {
  return {
    id: "job-1",
    submission_id: "sub-1",
    notification_type: "consultation.client_confirmation",
    recipient_type: "client",
    recipient_address: "client@example.com",
    payload: {
      brand: "Acme",
      contact_name: "Jane",
      public_reference: "ING-1",
      created_at: "2026-09-22T00:00:00Z",
    },
    attempt_count: 1,
    max_attempts: 3,
    ...over,
  };
}

async function main() {
  // --- allowlist default-deny ---
  {
    let claimed = 0;
    const out = await processBatch(
      {
        claim: async () => {
          claimed++;
          return { jobs: [] };
        },
        update: async () => ({}),
        send: async () => ({ messageId: "m", provider: "resend" }),
      },
      {
        types: ["consultation.client_confirmation"],
        authorizedSubmissionIds: [],
        limit: 5,
      },
    );
    assert(out.error === "AUTHORIZED_IDS_REQUIRED", "empty allowlist rejected");
    assert(claimed === 0, "claim never called with empty allowlist");
  }

  // --- claim error surfaces without processing ---
  {
    const out = await processBatch(
      {
        claim: async () => ({ jobs: null, error: "claim_rpc_unavailable" }),
        update: async () => ({}),
        send: async () => ({ messageId: "m", provider: "resend" }),
      },
      {
        types: ["consultation.client_confirmation"],
        authorizedSubmissionIds: ["sub-1"],
        limit: 5,
      },
    );
    assert(out.error === "claim_rpc_unavailable", "claim rpc error propagated");
    assert(out.claimed === 0, "no jobs processed on claim error");
  }

  // --- success: status sent, idempotency key, provider id recorded ---
  {
    const updates: Array<Record<string, unknown>> = [];
    let sentKey = "";
    const out = await processBatch(
      {
        claim: async () => ({ jobs: [job()] }),
        update: async (_id, patch) => {
          updates.push(patch);
          return {};
        },
        send: async (_j, key) => {
          sentKey = key;
          return { messageId: "re_123", provider: "resend" };
        },
      },
      {
        types: ["consultation.client_confirmation"],
        authorizedSubmissionIds: ["sub-1"],
        limit: 5,
      },
    );
    assert(out.claimed === 1, "claimed one job");
    assert(out.outcomes[0]?.result === "sent", "outcome sent");
    assert(sentKey === "notification:job-1", `stable idempotency key (got ${sentKey})`);
    const u = updates[0]!;
    assert(u["status"] === "sent", "status sent");
    assert(u["provider_message_id"] === "re_123", "provider message id recorded");
    assert(u["provider_name"] === "resend", "provider name recorded");
    assert(u["provider_idempotency_key"] === "notification:job-1", "idempotency key persisted");
    assert(!("attempt_count" in u), "worker never touches attempt_count on success");
  }

  // --- provider failure, attempt < max → requeued with backoff, NO provider id ---
  {
    const updates: Array<Record<string, unknown>> = [];
    const out = await processBatch(
      {
        claim: async () => ({ jobs: [job({ attempt_count: 1, max_attempts: 3 })] }),
        update: async (_id, patch) => {
          updates.push(patch);
          return {};
        },
        send: async () => {
          throw Object.assign(new Error("rate limited"), {
            code: "EMAIL_RATE_LIMITED",
          });
        },
      },
      {
        types: ["consultation.client_confirmation"],
        authorizedSubmissionIds: ["sub-1"],
        limit: 5,
      },
    );
    assert(out.outcomes[0]?.result === "requeued", "retryable → requeued");
    const u = updates[0]!;
    assert(u["status"] === "pending", "requeued as pending");
    assert(typeof u["next_attempt_at"] === "string", "next_attempt_at set");
    assert(!("provider_message_id" in u), "no provider id on failure");
    assert(!("attempt_count" in u), "attempt_count not modified by worker");
    assert(String(u["last_error"]).startsWith("EMAIL_RATE_LIMITED:"), "last_error classified");
  }

  // --- attempt_count == max_attempts → failed, terminal ---
  {
    const updates: Array<Record<string, unknown>> = [];
    const out = await processBatch(
      {
        claim: async () => ({ jobs: [job({ attempt_count: 3, max_attempts: 3 })] }),
        update: async (_id, patch) => {
          updates.push(patch);
          return {};
        },
        send: async () => {
          throw Object.assign(new Error("boom"), { code: "EMAIL_PROVIDER_5XX" });
        },
      },
      {
        types: ["consultation.client_confirmation"],
        authorizedSubmissionIds: ["sub-1"],
        limit: 5,
      },
    );
    assert(out.outcomes[0]?.result === "failed", "max attempts → failed");
    assert(updates[0]!["status"] === "failed", "status failed");
    assert(updates[0]!["next_attempt_at"] === null, "no further attempts scheduled");
  }

  // --- terminal auth error → needs_review even with attempts left ---
  {
    const updates: Array<Record<string, unknown>> = [];
    const out = await processBatch(
      {
        claim: async () => ({ jobs: [job({ attempt_count: 1, max_attempts: 3 })] }),
        update: async (_id, patch) => {
          updates.push(patch);
          return {};
        },
        send: async () => {
          throw Object.assign(new Error("bad key"), { code: "EMAIL_AUTH_ERROR" });
        },
      },
      {
        types: ["consultation.client_confirmation"],
        authorizedSubmissionIds: ["sub-1"],
        limit: 5,
      },
    );
    assert(out.outcomes[0]?.result === "needs_review", "auth error → needs_review");
    assert(updates[0]!["status"] === "needs_review", "status needs_review");
  }

  // --- missing recipient → needs_review, never sends ---
  {
    let sent = 0;
    const out = await processBatch(
      {
        claim: async () => ({
          jobs: [job({ recipient_address: null })],
        }),
        update: async () => ({}),
        send: async () => {
          sent++;
          return { messageId: "m", provider: "resend" };
        },
      },
      {
        types: ["consultation.client_confirmation"],
        authorizedSubmissionIds: ["sub-1"],
        limit: 5,
      },
    );
    assert(sent === 0, "no send without recipient");
    assert(out.outcomes[0]?.result === "needs_review", "missing recipient → needs_review");
    assert(out.outcomes[0]?.code === "EMAIL_NO_RECIPIENT", "code EMAIL_NO_RECIPIENT");
  }

  // --- backoff bounds ---
  assert(backoffMinutes(1) === 10, `attempt1 backoff 10 (got ${backoffMinutes(1)})`);
  assert(backoffMinutes(3) === 40, `attempt3 backoff 40 (got ${backoffMinutes(3)})`);
  assert(backoffMinutes(10) === 60, "backoff capped at 60");

  // --- terminal code set ---
  assert(isTerminalEmailCode("EMAIL_NOT_CONFIGURED"), "EMAIL_NOT_CONFIGURED terminal");
  assert(isTerminalEmailCode("EMAIL_AUTH_ERROR"), "EMAIL_AUTH_ERROR terminal");
  assert(!isTerminalEmailCode("EMAIL_RATE_LIMITED"), "rate limit not terminal");
  assert(!isTerminalEmailCode("EMAIL_PROVIDER_5XX"), "5xx not terminal");

  // --- email config resolution ---
  assert(
    resolveEmailConfig((n) => (n === "EMAIL_PROVIDER" ? "resend" : n === "RESEND_API_KEY" ? "re_key" : undefined)) !== null,
    "resend + key → configured",
  );
  assert(
    resolveEmailConfig(() => undefined) === null,
    "missing env → null (EMAIL_PROVIDER_REQUIRED)",
  );
  assert(
    isEmailConfigConfiguredGuard(),
    "isEmailConfigured false without env",
  );

  // --- templates: client confirmation required copy ---
  {
    const c = buildClientConfirmation({
      brand: "Acme",
      contactName: "Jane",
      publicReference: "ING-1",
      createdAt: "2026-09-22",
    });
    assert(c.subject.includes("ING-1"), "client subject includes reference");
    assert(c.text.includes("has been received"), "client text confirms receipt");
    assert(c.text.includes("ING-1"), "client text includes reference");
    assert(c.text.includes("What happens next"), "client text explains next steps");
    assert(
      /does not guarantee qualification/i.test(c.text),
      "client text explicitly disclaims qualification guarantee",
    );
    assert(
      !/you are booked|calendar invite (is )?sent|automatically scheduled|qualified for engagement/i.test(c.text),
      "no qualification/scheduling promise",
    );
    assert(!/gsk_|Bearer |re_[A-Za-z0-9]/.test(c.html), "no secrets in client html");
  }

  // --- templates: internal notification required content ---
  {
    const i = buildInternalNotification({
      brand: "Acme <script>",
      contactName: "Jane",
      publicReference: "ING-2",
      createdAt: "2026-09-22",
      reviewHint: "Submission sub-1",
    });
    assert(i.subject.includes("Acme <script>") || i.subject.includes("Acme"), "internal subject has brand");
    assert(i.text.includes("ING-2"), "internal text has reference");
    assert(i.text.includes("Acme <script>"), "internal text has brand");
    assert(i.text.includes("Submission sub-1"), "internal text has review hint");
    assert(i.html.includes("&lt;script&gt;"), "brand HTML-escaped in html");
    assert(
      !/secret|password|intake answers copied|full questionnaire/i.test(i.text),
      "no full confidential intake body",
    );
  }

  // --- escapeHtml ---
  assert(escapeHtml(`<a href="x">&'`) === "&lt;a href=&quot;x&quot;&gt;&amp;&#39;", "escapeHtml escapes");

  // --- renderJob builds client + internal ---
  {
    const cfg = {
      provider: "resend" as const,
      apiKey: "re_key",
      from: "Ingressible <hello@ingressible.com>",
      internalAddress: "hello@ingressible.com",
    };
    const c = renderJob(cfg, job());
    assert(c.to === "client@example.com", "render to recipient");
    assert(c.idempotencyKey === "notification:job-1", "render idempotency key");
    assert(c.subject.includes("ING-1"), "render subject");

    const i = renderJob(cfg, job({ notification_type: "consultation.internal_notification" }));
    assert(i.subject.includes("New Ingressible consultation"), "internal subject");

    let threw = "";
    try {
      renderJob(cfg, job({ notification_type: "consultation.scheduling_invite" }));
    } catch (e) {
      threw = (e as Error & { code?: string }).code ?? "";
    }
    assert(threw === "EMAIL_INVALID_REQUEST", "unsupported type → EMAIL_INVALID_REQUEST");
  }
}

function isEmailConfigConfiguredGuard(): boolean {
  return isEmailConfigured(() => undefined) === false;
}

await main();

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  Deno.exit(1);
}
console.log("\nAll notification-worker tests passed");
