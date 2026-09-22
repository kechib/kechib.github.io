// Error classification for intake processing.
// Non-retryable provider/config failures must NOT schedule next_attempt_at
// or burn max_attempts; retryable failures schedule linear backoff.

export type IntakeErrorClass = {
  code: string;
  detail?: string;
  /** When true: set next_attempt_at and allow further claims under max_attempts. */
  retryable: boolean;
  /** Job status to persist. */
  status: "processing_failed" | "needs_review";
};

const NON_RETRYABLE_HTTP = new Set([400, 401, 403, 404, 422]);
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Parse provider detail string for quota / billing markers. */
function detailSaysBilling(detail: string | null | undefined): boolean {
  if (!detail) return false;
  const d = detail.toLowerCase();
  return (
    d.includes("insufficient_quota") ||
    d.includes("credit_balance_exhausted") ||
    d.includes("exceeded your current quota") ||
    d.includes("billing") ||
    d.includes("no credits remaining")
  );
}

function detailSaysRateLimit(detail: string | null | undefined): boolean {
  if (!detail) return false;
  const d = detail.toLowerCase();
  return (
    d.includes("rate_limit") ||
    d.includes("rate limit") ||
    d.includes("too many requests")
  );
}

/** Extract http=NNN from detail when present. */
function httpFromDetail(detail: string | null | undefined): number | null {
  if (!detail) return null;
  const m = /http=(\d{3})/.exec(detail);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify an agent/OpenAI failure.
 * Codes seen in production:
 *   AI_NOT_CONFIGURED, AI_RATE_LIMITED, AI_HTTP_400/401/429/5xx,
 *   AI_EMPTY_OUTPUT, AI_INVALID_OUTPUT, and detail with insufficient_quota.
 */
export function classifyIntakeError(
  code: string,
  detail?: string | null,
): IntakeErrorClass {
  const d = detail ?? undefined;
  const http = httpFromDetail(d);

  // Missing API key / not configured → human review, never auto-retry.
  if (code === "AI_NOT_CONFIGURED") {
    return { code, status: "needs_review", retryable: false, detail: d };
  }

  // Billing / quota exhausted is non-retryable until credits are topped up.
  // Production showed 429 + insufficient_quota mis-tagged as AI_RATE_LIMITED
  // and left with next_attempt_at set — that is the bug this fixes.
  if (
    detailSaysBilling(d) ||
    code === "AI_BILLING_EXHAUSTED" ||
    code === "AI_QUOTA_EXHAUSTED"
  ) {
    return {
      code: "AI_BILLING_EXHAUSTED",
      detail: d,
      status: "processing_failed",
      retryable: false,
    };
  }

  // Hard provider client errors: bad schema, bad key, forbidden — no retry.
  if (code === "AI_HTTP_400" || code === "AI_HTTP_401" || code === "AI_HTTP_403" || code === "AI_HTTP_404" || code === "AI_HTTP_422") {
    return { code, detail: d, status: "processing_failed", retryable: false };
  }
  if (code === "AI_INVALID_OUTPUT") {
    return { code, detail: d, status: "processing_failed", retryable: false };
  }

  // Explicit rate limit (not billing) → retryable.
  if (code === "AI_RATE_LIMITED" || detailSaysRateLimit(d)) {
    // 429 without billing markers is a true rate limit.
    if (http === 429 || code === "AI_RATE_LIMITED" || detailSaysRateLimit(d)) {
      if (!detailSaysBilling(d)) {
        return {
          code: "AI_RATE_LIMITED",
          detail: d,
          status: "processing_failed",
          retryable: true,
        };
      }
      return {
        code: "AI_BILLING_EXHAUSTED",
        detail: d,
        status: "processing_failed",
        retryable: false,
      };
    }
  }

  // Empty/missing model output: transient provider glitch → retry.
  if (code === "AI_EMPTY_OUTPUT") {
    return { code, detail: d, status: "processing_failed", retryable: true };
  }

  // Any other AI_HTTP_NNN: retry 5xx / 408 / 425; do not retry other 4xx.
  const m = /^AI_HTTP_(\d{3})$/.exec(code);
  if (m) {
    const status = Number(m[1]);
    if (NON_RETRYABLE_HTTP.has(status)) {
      return { code, detail: d, status: "processing_failed", retryable: false };
    }
    if (RETRYABLE_HTTP.has(status) || status >= 500) {
      return { code, detail: d, status: "processing_failed", retryable: true };
    }
    return { code, detail: d, status: "processing_failed", retryable: false };
  }

  if (http !== null) {
    if (NON_RETRYABLE_HTTP.has(http)) {
      return { code, detail: d, status: "processing_failed", retryable: false };
    }
    if (http >= 500 || RETRYABLE_HTTP.has(http)) {
      return { code, detail: d, status: "processing_failed", retryable: true };
    }
  }

  // Unknown non-config errors: treat as non-retryable to avoid hot-looping
  // on deterministic failures; operators can requeue manually.
  if (code === "NOT_FOUND" || code === "submission-not-found") {
    return { code, detail: d, status: "processing_failed", retryable: false };
  }

  // Default: retryable transient (network, timeout, unknown 5xx path).
  return { code, detail: d, status: "processing_failed", retryable: true };
}

/** Linear backoff: attempt_count * 5 minutes (matches prior policy). */
export function nextAttemptAt(attemptCount: number, maxAttempts: number): string | null {
  if (attemptCount >= maxAttempts) return null;
  const minutes = Math.max(1, attemptCount) * 5;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}
