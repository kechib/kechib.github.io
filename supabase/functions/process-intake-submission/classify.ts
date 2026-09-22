// Provider-neutral error classification for intake processing.
// Terminal failures must NOT schedule next_attempt_at or burn further
// attempts; retryable failures schedule linear backoff, always bounded by
// max_attempts (claim RPC enforces attempt_count < max_attempts).
//
// Required codes and their policy:
//   AI_NOT_CONFIGURED          terminal → needs_review
//   AI_AUTH_ERROR (401/403)    terminal → needs_review
//   AI_RATE_LIMITED_TRANSIENT  retryable
//   AI_PROVIDER_QUOTA          terminal → needs_review
//   AI_INVALID_REQUEST         terminal (no retry)
//   AI_PROVIDER_5XX            retryable
//   AI_TIMEOUT                 retryable
//   AI_NETWORK_ERROR           retryable
//   AI_EMPTY_OUTPUT            retryable (transient provider glitch)
//   AI_INVALID_OUTPUT          terminal → needs_review

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

const QUOTA_MARKERS = [
  "insufficient_quota",
  "credit_balance_exhausted",
  "quota_exceeded",
  "exceeded your current quota",
  "no credits remaining",
  "billing",
];

/** Parse provider detail string for quota / billing markers. */
function detailSaysBilling(detail: string | null | undefined): boolean {
  if (!detail) return false;
  const d = detail.toLowerCase();
  return QUOTA_MARKERS.some((m) => d.includes(m));
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

const TERMINAL_NEEDS_REVIEW = new Set([
  "AI_NOT_CONFIGURED",
  "AI_AUTH_ERROR",
  "AI_INVALID_OUTPUT",
  "AI_PROVIDER_QUOTA",
  // Legacy quota/billing codes written by earlier provider versions.
  "AI_BILLING_EXHAUSTED",
  "AI_QUOTA_EXHAUSTED",
]);

const RETRYABLE_TRANSIENT = new Set([
  "AI_RATE_LIMITED_TRANSIENT",
  "AI_RATE_LIMITED",
  "AI_PROVIDER_5XX",
  "AI_TIMEOUT",
  "AI_NETWORK_ERROR",
  "AI_EMPTY_OUTPUT",
]);

const TERMINAL_NO_RETRY = new Set([
  "AI_INVALID_REQUEST",
  "NOT_FOUND",
  "submission-not-found",
]);

/**
 * Classify an intake model failure into a provider-neutral policy.
 */
export function classifyIntakeError(
  code: string,
  detail?: string | null,
): IntakeErrorClass {
  const d = detail ?? undefined;
  const http = httpFromDetail(d);

  if (TERMINAL_NEEDS_REVIEW.has(code)) {
    return { code, detail: d, status: "needs_review", retryable: false };
  }

  // Detail-based quota detection (covers legacy OpenAI 429 bodies that
  // reached us under a generic rate-limit code).
  if (detailSaysBilling(d)) {
    return {
      code: "AI_PROVIDER_QUOTA",
      detail: d,
      status: "needs_review",
      retryable: false,
    };
  }

  if (RETRYABLE_TRANSIENT.has(code)) {
    return { code, detail: d, status: "processing_failed", retryable: true };
  }

  if (TERMINAL_NO_RETRY.has(code)) {
    return { code, detail: d, status: "processing_failed", retryable: false };
  }

  // Legacy provider-HTTP codes.
  if (code === "AI_HTTP_401" || code === "AI_HTTP_403") {
    return { code: "AI_AUTH_ERROR", detail: d, status: "needs_review", retryable: false };
  }
  const m = /^AI_HTTP_(\d{3})$/.exec(code);
  if (m) {
    const status = Number(m[1]);
    if (status === 429 && !detailSaysBilling(d)) {
      return { code: "AI_RATE_LIMITED_TRANSIENT", detail: d, status: "processing_failed", retryable: true };
    }
    if (NON_RETRYABLE_HTTP.has(status)) {
      return { code, detail: d, status: "processing_failed", retryable: false };
    }
    if (RETRYABLE_HTTP.has(status) || status >= 500) {
      return { code, detail: d, status: "processing_failed", retryable: true };
    }
    return { code, detail: d, status: "processing_failed", retryable: false };
  }

  // A plain 429/5xx detail without an explicit code.
  if (http !== null) {
    if (http === 401 || http === 403) {
      return { code: "AI_AUTH_ERROR", detail: d, status: "needs_review", retryable: false };
    }
    if (NON_RETRYABLE_HTTP.has(http)) {
      return { code, detail: d, status: "processing_failed", retryable: false };
    }
    if (http >= 500 || RETRYABLE_HTTP.has(http)) {
      return { code, detail: d, status: "processing_failed", retryable: true };
    }
  }

  // A transient rate-limit marker without a recognized code.
  if (detailSaysRateLimit(d)) {
    return { code: "AI_RATE_LIMITED_TRANSIENT", detail: d, status: "processing_failed", retryable: true };
  }

  // Unknown errors: retryable, but always bounded by max_attempts so the
  // system can never loop indefinitely.
  return { code, detail: d, status: "processing_failed", retryable: true };
}

/** Linear backoff: attempt_count * 5 minutes (matches prior policy). */
export function nextAttemptAt(attemptCount: number, maxAttempts: number): string | null {
  if (attemptCount >= maxAttempts) return null;
  const minutes = Math.max(1, attemptCount) * 5;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}
