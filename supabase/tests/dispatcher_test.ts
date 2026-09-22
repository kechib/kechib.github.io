import {
  clampLimit,
  isDueJob,
} from "../functions/intake-retry-dispatcher/select.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

// clampLimit: positive integer 1..10
assert(clampLimit(5, 5) === 5, "clamp 5 stays 5");
assert(clampLimit(0, 5) === 1, "clamp 0 → 1");
assert(clampLimit(-3, 5) === 1, "clamp -3 → 1");
assert(clampLimit(99, 5) === 10, "clamp 99 → 10 (cap)");
assert(clampLimit("abc", 5) === 5, "clamp non-numeric → fallback 5");
assert(clampLimit(undefined, 5) === 5, "clamp undefined → fallback 5");

const now = "2026-09-22T16:00:00.000Z";
const dueBase = {
  status: "processing_failed",
  attempt_count: 1,
  next_attempt_at: "2026-09-22T15:00:00.000Z",
  max_attempts: 3,
};

// Due: processing_failed, past next_attempt, under max
assert(isDueJob(dueBase, now), "past due attempt=1 → due");

// Not due: future next_attempt
assert(
  !isDueJob({ ...dueBase, next_attempt_at: "2026-09-22T17:00:00.000Z" }, now),
  "future next_attempt → not due",
);

// Not due: null next_attempt (terminal)
assert(
  !isDueJob({ ...dueBase, next_attempt_at: null }, now),
  "null next_attempt → not due",
);

// Not due: at max attempts
assert(
  !isDueJob({ ...dueBase, attempt_count: 3 }, now),
  "attempt_count >= max → not due",
);

// max_attempts null defaults to 3
assert(
  isDueJob({ ...dueBase, max_attempts: null }, now),
  "null max_attempts defaults to 3 → due at attempt=1",
);
assert(
  !isDueJob({ ...dueBase, attempt_count: 3, max_attempts: null }, now),
  "null max_attempts defaults to 3 → not due at attempt=3",
);

// Status filter: only processing_failed is selectable
for (const status of ["pending", "queued", "processing", "processed", "needs_review"]) {
  assert(
    !isDueJob({ ...dueBase, status }, now),
    `status=${status} → not selectable`,
  );
}
assert(
  isDueJob({ ...dueBase, status: "processing_failed" }, now),
  "status=processing_failed → selectable when due",
);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  Deno.exit(1);
}
console.log("\nAll dispatcher tests passed");
