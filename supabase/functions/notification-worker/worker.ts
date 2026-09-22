// Core notification worker: claim scoped jobs → build template → real send.
// attempt_count is incremented exactly once, by the claim RPC (not by this
// worker). provider_message_id is written only after a real provider success.

import type { EmailConfig } from "./email.ts";
import { TERMINAL_EMAIL_CODES } from "./email.ts";
import { buildClientConfirmation, buildInternalNotification } from "./templates.ts";

export type NotificationJob = {
  id: string;
  submission_id: string;
  notification_type: string;
  recipient_type: "client" | "internal";
  recipient_address: string | null;
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
};

export type ClaimFn = (
  types: string[],
  submissionIds: string[],
  limit: number,
) => Promise<{ jobs: NotificationJob[] | null; error?: string }>;

export type UpdateFn = (id: string, patch: Record<string, unknown>) => Promise<{ error?: string }>;

export type SendFn = (
  job: NotificationJob,
  idempotencyKey: string,
) => Promise<{ messageId: string; provider: string }>;

export type Deps = {
  claim: ClaimFn;
  update: UpdateFn;
  send: SendFn;
};

export type BatchOptions = {
  types: string[];
  authorizedSubmissionIds: string[];
  limit: number;
  log?: (msg: string, extra?: string) => void;
};

export type JobOutcome = {
  jobId: string;
  submissionId: string;
  notificationType: string;
  result: "sent" | "needs_review" | "failed" | "requeued";
  code?: string;
};

export const NOTIFICATION_TYPES = [
  "consultation.client_confirmation",
  "consultation.internal_notification",
] as const;

/** Exponential backoff, capped at 60 minutes. */
export function backoffMinutes(attemptCount: number): number {
  return Math.min(Math.pow(2, Math.max(1, attemptCount)) * 5, 60);
}

export function isTerminalEmailCode(code: string): boolean {
  return TERMINAL_EMAIL_CODES.has(code);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Claim must be scoped to an explicit non-empty allowlist (default-deny).
 * Empty allowlist → no claim, no sends.
 */
export async function processBatch(
  deps: Deps,
  opts: BatchOptions,
): Promise<{ claimed: number; outcomes: JobOutcome[]; error?: string }> {
  const log = opts.log ?? (() => {});
  const allowlist = opts.authorizedSubmissionIds;
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return { claimed: 0, outcomes: [], error: "AUTHORIZED_IDS_REQUIRED" };
  }
  const types = opts.types.length ? opts.types : [...NOTIFICATION_TYPES];
  const limit = Math.max(1, Math.min(opts.limit || 5, 100));

  const claimRes = await deps.claim(types, allowlist, limit);
  if (claimRes.error) {
    return { claimed: 0, outcomes: [], error: claimRes.error };
  }
  const jobs = claimRes.jobs ?? [];
  log("claimed", `count=${jobs.length} allowlist=${allowlist.length}`);

  const outcomes: JobOutcome[] = [];
  for (const job of jobs) {
    outcomes.push(await processJob(deps, job));
  }
  return { claimed: jobs.length, outcomes };
}

export async function processJob(deps: Deps, job: NotificationJob): Promise<JobOutcome> {
  const base = {
    jobId: job.id,
    submissionId: job.submission_id,
    notificationType: job.notification_type,
  };

  if (!job.recipient_address) {
    await deps.update(job.id, {
      status: "needs_review",
      completed_at: new Date().toISOString(),
      last_error: "EMAIL_NO_RECIPIENT",
      next_attempt_at: null,
    });
    return { ...base, result: "needs_review", code: "EMAIL_NO_RECIPIENT" };
  }

  const idempotencyKey = `notification:${job.id}`;

  try {
    const sent = await deps.send(job, idempotencyKey);
    await deps.update(job.id, {
      status: "sent",
      completed_at: new Date().toISOString(),
      last_error: null,
      next_attempt_at: null,
      provider_message_id: sent.messageId,
      provider_name: sent.provider,
      provider_idempotency_key: idempotencyKey,
      last_provider_attempt_at: new Date().toISOString(),
    });
    return { ...base, result: "sent" };
  } catch (err) {
    const code =
      (err as Error & { code?: string }).code ?? "EMAIL_PROVIDER_5XX";
    const message = `${code}: ${((err as Error).message ?? "").slice(0, 300)}`;

    if (isTerminalEmailCode(code)) {
      await deps.update(job.id, {
        status: "needs_review",
        completed_at: new Date().toISOString(),
        last_error: message,
        next_attempt_at: null,
      });
      return { ...base, result: "needs_review", code };
    }

    if (job.attempt_count >= job.max_attempts) {
      await deps.update(job.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        last_error: message,
        next_attempt_at: null,
      });
      return { ...base, result: "failed", code };
    }

    const next = new Date(
      Date.now() + backoffMinutes(job.attempt_count) * 60 * 1000,
    ).toISOString();
    await deps.update(job.id, {
      status: "pending",
      last_error: message,
      next_attempt_at: next,
    });
    return { ...base, result: "requeued", code };
  }
}

/** Build the rendered email for a job (pure; used by the real send path). */
export function renderJob(
  cfg: EmailConfig,
  job: NotificationJob,
): { to: string; subject: string; html: string; text: string; idempotencyKey: string } {
  const idempotencyKey = `notification:${job.id}`;
  const p = job.payload ?? {};
  const to = job.recipient_address ?? "";

  if (job.notification_type === "consultation.client_confirmation") {
    const built = buildClientConfirmation({
      brand: str(p["brand"]),
      contactName: str(p["contact_name"]),
      publicReference: str(p["public_reference"]),
      createdAt: str(p["created_at"]),
    });
    return { to, subject: built.subject, html: built.html, text: built.text, idempotencyKey };
  }

  if (job.notification_type === "consultation.internal_notification") {
    const built = buildInternalNotification({
      brand: str(p["brand"]),
      contactName: str(p["contact_name"]),
      publicReference: str(p["public_reference"]),
      createdAt: str(p["created_at"]),
      reviewHint: `Submission ${job.submission_id} in the Ingressible console`,
    });
    return { to, subject: built.subject, html: built.html, text: built.text, idempotencyKey };
  }

  // Unknown type: treat as terminal by not building content — caller must
  // surface EMAIL_INVALID_REQUEST. Keep a clear error shape.
  const e = new Error(`unsupported notification_type`) as Error & { code: string };
  e.code = "EMAIL_INVALID_REQUEST";
  throw e;
}
