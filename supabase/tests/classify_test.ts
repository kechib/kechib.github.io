import {
  classifyIntakeError,
  nextAttemptAt,
} from "../functions/process-intake-submission/classify.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

// --- Provider-neutral codes: terminal → needs_review ---
for (
  const code of [
    "AI_NOT_CONFIGURED",
    "AI_AUTH_ERROR",
    "AI_INVALID_OUTPUT",
    "AI_PROVIDER_QUOTA",
    "AI_BILLING_EXHAUSTED",
    "AI_QUOTA_EXHAUSTED",
  ]
) {
  const c = classifyIntakeError(code, "http=401");
  assert(c.status === "needs_review", `${code} → needs_review`);
  assert(c.retryable === false, `${code} not retryable`);
}

// --- Production evidence: 429 + insufficient_quota must be non-retryable ---
{
  const c = classifyIntakeError(
    "AI_RATE_LIMITED",
    "http=429 type=insufficient_quota code=credit_balance_exhausted msg=You have no credits remaining.",
  );
  assert(c.retryable === false, "insufficient_quota is not retryable");
  assert(c.code === "AI_PROVIDER_QUOTA", `quota code got ${c.code}`);
  assert(c.status === "needs_review", "quota → needs_review");
  assert(nextAttemptAt(1, 3) !== null, "backoff helper still works for retries");
}

// --- credit_balance_exhausted alone (no http=) still quota / non-retryable ---
{
  const c = classifyIntakeError(
    "AI_RATE_LIMITED",
    "type=insufficient_quota code=credit_balance_exhausted msg=You have no credits remaining.",
  );
  assert(c.retryable === false, "credit_balance_exhausted alone not retryable");
  assert(c.code === "AI_PROVIDER_QUOTA", `quota code got ${c.code}`);
}

// --- Temporary rate limit remains retryable ---
{
  const c = classifyIntakeError(
    "AI_RATE_LIMITED_TRANSIENT",
    "http=429 type=rate_limit_error code=rate_limit_exceeded msg=Too many requests",
  );
  assert(c.retryable === true, "temporary rate limit is retryable");
  assert(c.code === "AI_RATE_LIMITED_TRANSIENT", `rate code got ${c.code}`);
  assert(c.status === "processing_failed", "rate limit → processing_failed");
}
{
  const c = classifyIntakeError(
    "AI_RATE_LIMITED",
    "http=429 type=rate_limit_error code=rate_limit_exceeded msg=Too many requests",
  );
  assert(c.retryable === true, "legacy AI_RATE_LIMITED without billing retryable");
}

// --- Auth errors → needs_review ---
for (const code of ["AI_HTTP_401", "AI_HTTP_403"]) {
  const c = classifyIntakeError(code, `http=${code.slice(-3)}`);
  assert(c.status === "needs_review", `${code} → needs_review`);
  assert(c.retryable === false, `${code} not retryable`);
}
assert(
  classifyIntakeError("AI_AUTH_ERROR", "http=401").status === "needs_review",
  "AI_AUTH_ERROR → needs_review",
);

// --- Other hard client errors non-retryable (no needs_review) ---
for (
  const code of [
    "AI_HTTP_400",
    "AI_HTTP_404",
    "AI_HTTP_422",
    "AI_INVALID_REQUEST",
  ]
) {
  const c = classifyIntakeError(code, "http=400");
  assert(c.retryable === false, `${code} not retryable`);
  assert(c.status === "processing_failed", `${code} → processing_failed`);
}

// --- 5xx / timeout / network / empty output retryable ---
{
  assert(classifyIntakeError("AI_PROVIDER_5XX", "http=503").retryable === true, "AI_PROVIDER_5XX retryable");
  assert(classifyIntakeError("AI_HTTP_503", "http=503").retryable === true, "503 retryable");
  assert(classifyIntakeError("AI_EMPTY_OUTPUT").retryable === true, "empty output retryable");
  assert(classifyIntakeError("AI_TIMEOUT").retryable === true, "AI_TIMEOUT retryable");
  assert(classifyIntakeError("AI_NETWORK_ERROR").retryable === true, "AI_NETWORK_ERROR retryable");
}

// --- AI_NOT_CONFIGURED → needs_review, never retry ---
{
  const c = classifyIntakeError("AI_NOT_CONFIGURED");
  assert(c.status === "needs_review", "not configured → needs_review");
  assert(c.retryable === false, "not configured not retryable");
}

// --- nextAttemptAt respects max (bounded attempts, never infinite) ---
{
  assert(nextAttemptAt(3, 3) === null, "attempt 3/3 → no next_attempt");
  assert(nextAttemptAt(1, 3) !== null, "attempt 1/3 → schedules next");
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  Deno.exit(1);
}
console.log("\nAll classify tests passed");
