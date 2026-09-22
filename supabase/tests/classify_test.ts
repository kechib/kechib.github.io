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

// --- Production evidence: 429 + insufficient_quota must be non-retryable ---
{
  const c = classifyIntakeError(
    "AI_RATE_LIMITED",
    "http=429 type=insufficient_quota code=credit_balance_exhausted msg=You have no credits remaining.",
  );
  assert(c.retryable === false, "insufficient_quota is not retryable");
  assert(c.code === "AI_BILLING_EXHAUSTED", `billing code got ${c.code}`);
  assert(c.status === "processing_failed", "billing → processing_failed");
  assert(nextAttemptAt(1, 3) !== null, "backoff helper still works for retries");
}

// --- True rate limit remains retryable ---
{
  const c = classifyIntakeError(
    "AI_RATE_LIMITED",
    "http=429 type=rate_limit_error code=rate_limit_exceeded msg=Too many requests",
  );
  assert(c.retryable === true, "true rate limit is retryable");
  assert(c.code === "AI_RATE_LIMITED", `rate code got ${c.code}`);
}

// --- Hard client errors non-retryable ---
for (const code of ["AI_HTTP_400", "AI_HTTP_401", "AI_HTTP_403", "AI_INVALID_OUTPUT"]) {
  const c = classifyIntakeError(code, "http=400");
  assert(c.retryable === false, `${code} not retryable`);
}

// --- 5xx / empty output retryable ---
{
  assert(classifyIntakeError("AI_HTTP_503", "http=503").retryable === true, "503 retryable");
  assert(classifyIntakeError("AI_EMPTY_OUTPUT").retryable === true, "empty output retryable");
}

// --- AI_NOT_CONFIGURED → needs_review, never retry ---
{
  const c = classifyIntakeError("AI_NOT_CONFIGURED");
  assert(c.status === "needs_review", "not configured → needs_review");
  assert(c.retryable === false, "not configured not retryable");
}

// --- nextAttemptAt respects max ---
{
  assert(nextAttemptAt(3, 3) === null, "attempt 3/3 → no next_attempt");
  assert(nextAttemptAt(1, 3) !== null, "attempt 1/3 → schedules next");
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  Deno.exit(1);
}
console.log("\nAll classify tests passed");
