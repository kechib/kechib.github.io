// Unit tests for the extracted post-claim intake pipeline.
import {
  buildAgentInput,
  extractSubmissionId,
  isValidSubmissionId,
  markJobFailure,
  markJobProcessed,
  processClaimedJob,
  type IntakeBrief,
  type Job,
  type ModelResult,
} from "../functions/process-intake-submission/pipeline.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const JOB: Job = {
  id: "job-1",
  submission_id: "sub-test-001",
  event_type: "intake.submitted",
  status: "processing",
  attempt_count: 1,
  max_attempts: 3,
  next_attempt_at: null,
};

const BRIEF: IntakeBrief = {
  intakeSummary: "summary",
  engagementShape: "unclear",
  missingInformation: [],
  questionsForConsultation: [],
  recommendedAssessmentModules: [],
  recommendedPreparation: [],
  proposalInputs: {},
};

type UpdateCall = { payload: Record<string, unknown>; eqId: string; succeeded: boolean };
type UpsertCall = { payload: Record<string, unknown> };

function makeFakeSupabase(opts: {
  submission?: Record<string, unknown> | null;
  submissionError?: { message: string } | null;
  existingResult?: Record<string, unknown> | null;
  existingResultError?: { message: string } | null;
  failJobUpdates?: number; // fail first N job updates
  failUpsert?: boolean;
}) {
  const jobUpdates: UpdateCall[] = [];
  const upserts: UpsertCall[] = [];
  let updateAttempts = 0;

  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(table: string) {
      if (table === "intake_agent_results") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: opts.existingResult ?? null,
                    error: opts.existingResultError ?? null,
                  }),
                };
              },
            };
          },
          upsert(payload: Record<string, unknown>, _opts?: unknown) {
            upserts.push({ payload });
            return Promise.resolve({
              error: opts.failUpsert ? { message: "upsert boom" } : null,
            });
          },
        };
      }
      if (table === "consultation_submissions") {
        return {
          select() {
            return {
              eq() {
                return {
                  single: async () => ({
                    data: opts.submission ?? null,
                    error: opts.submissionError ??
                      (opts.submission ? null : { message: "not found" }),
                  }),
                };
              },
            };
          },
        };
      }
      if (table === "intake_processing_jobs") {
        return {
          update(payload: Record<string, unknown>) {
            return {
              eq(_col: string, id: string) {
                updateAttempts++;
                const failedNow = updateAttempts <= (opts.failJobUpdates ?? 0);
                jobUpdates.push({ payload, eqId: id, succeeded: !failedNow });
                if (failedNow) {
                  return Promise.resolve({ error: { message: "update boom" } });
                }
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, jobUpdates, upserts };
}

const SYSTEM = "system";

async function main() {
  // --- submission id validation ---
  assert(isValidSubmissionId("abc-123"), "valid submission id accepted");
  assert(!isValidSubmissionId("bad id!!"), "spaces rejected");
  assert(!isValidSubmissionId(""), "empty rejected");
  assert(!isValidSubmissionId(null), "null rejected");
  assert(!isValidSubmissionId(123), "number rejected");

  assert(
    extractSubmissionId({ submission_id: "abc-1" }) === "abc-1",
    "extract direct submission_id",
  );
  assert(
    extractSubmissionId({ submissionId: "abc-2" }) === "abc-2",
    "extract camelCase submissionId",
  );
  assert(
    extractSubmissionId({
      type: "INSERT",
      table: "intake_processing_jobs",
      record: { submission_id: "abc-3" },
    }) === "abc-3",
    "extract webhook record submission_id",
  );
  assert(
    extractSubmissionId({ type: "UPDATE", table: "intake_processing_jobs", record: { submission_id: "x" } }) === null,
    "non-insert webhook event → null",
  );
  assert(
    extractSubmissionId({ type: "INSERT", table: "other", record: { submission_id: "x" } }) === null,
    "wrong table → null",
  );

  // --- submission read failure exits processing safely (404 + job failed) ---
  {
    const fake = makeFakeSupabase({ submission: null });
    const out = await processClaimedJob(fake.client, "missing-sub", JOB, async () => {
      throw new Error("model should not run");
    }, { systemPrompt: SYSTEM, model: "m" });
    assert(out.http === 404, "missing submission → 404");
    assert(out.body["error"] === "submission-not-found", "body submission-not-found");
    assert(
      fake.jobUpdates.length === 1 && fake.jobUpdates[0].payload["status"] === "processing_failed",
      "missing submission → job marked processing_failed",
    );
    assert(fake.jobUpdates[0].payload["next_attempt_at"] === null, "NOT_FOUND non-retryable → no next_attempt");
  }

  // --- existing result recovery: no second model call, job finalized ---
  {
    const fake = makeFakeSupabase({
      submission: { submission_id: "sub-test-001" },
      existingResult: { submission_id: "sub-test-001", analysis_json: { intakeSummary: "x" } },
    });
    let modelCalls = 0;
    const out = await processClaimedJob(fake.client, "sub-test-001", JOB, async () => {
      modelCalls++;
      throw new Error("should not be called");
    }, { systemPrompt: SYSTEM, model: "m" });
    assert(modelCalls === 0, "existing result → no second model call");
    assert(out.body["recovered"] === true, "existing result → recovered=true");
    assert(out.body["status"] === "processed", "existing result → processed");
    assert(
      fake.jobUpdates.some((u) => u.payload["status"] === "processed"),
      "existing result → job finalized processed",
    );
  }

  // --- model failure: AI_NOT_CONFIGURED → needs_review, checked write ---
  {
    const fake = makeFakeSupabase({ submission: { submission_id: "sub-test-001" } });
    const out = await processClaimedJob(fake.client, "sub-test-001", JOB, async () => {
      const e = new Error("no key");
      (e as Error & { code?: string }).code = "AI_NOT_CONFIGURED";
      throw e;
    }, { systemPrompt: SYSTEM, model: "m" });
    assert(out.http === 200, "agent failure → 200 with status body");
    assert(out.body["status"] === "needs_review", "AI_NOT_CONFIGURED → needs_review");
    assert(out.body["agentError"] === "AI_NOT_CONFIGURED", "agentError AI_NOT_CONFIGURED");
    assert(
      fake.jobUpdates[0]?.payload["status"] === "needs_review",
      "job write uses needs_review",
    );
    assert(fake.jobUpdates[0]?.payload["next_attempt_at"] === null, "needs_review not retryable");
  }

  // --- model failure retryable → processing_failed with next_attempt ---
  {
    const fake = makeFakeSupabase({ submission: { submission_id: "sub-test-001" } });
    const out = await processClaimedJob(fake.client, "sub-test-001", JOB, async () => {
      const e = new Error("rate");
      (e as Error & { code?: string }).code = "AI_RATE_LIMITED";
      throw e;
    }, { systemPrompt: SYSTEM, model: "m" });
    assert(out.body["status"] === "processing_failed", "rate limit → processing_failed");
    assert(out.body["retryable"] === true, "rate limit retryable");
    assert(
      typeof out.body["next_attempt_at"] === "string",
      "retryable failure schedules next_attempt_at",
    );
  }

  // --- result persistence failure exits processing safely ---
  {
    const fake = makeFakeSupabase({
      submission: { submission_id: "sub-test-001" },
      failUpsert: true,
    });
    const okModel = async (): Promise<ModelResult> => ({
      brief: BRIEF,
      responseId: "resp-1",
      usage: null,
    });
    const out = await processClaimedJob(fake.client, "sub-test-001", JOB, okModel, {
      systemPrompt: SYSTEM,
      model: "m",
    });
    assert(out.http === 500, "persist failure → 500");
    assert(out.body["error"] === "persist_failed", "persist_failed body");
    assert(
      fake.jobUpdates.some((u) =>
        u.payload["status"] === "processing_failed" &&
        String(u.payload["last_error"] ?? "").includes("RESULT_PERSIST_FAILED")
      ),
      "persist failure → job RESULT_PERSIST_FAILED",
    );
    assert(
      !fake.jobUpdates.some((u) => u.payload["status"] === "processed"),
      "persist failure → job not marked processed",
    );
  }

  // --- happy path: model + persist + checked finalize ---
  {
    const fake = makeFakeSupabase({ submission: { submission_id: "sub-test-001" } });
    const okModel = async (): Promise<ModelResult> => ({
      brief: BRIEF,
      responseId: "resp-1",
      usage: null,
    });
    const out = await processClaimedJob(fake.client, "sub-test-001", JOB, okModel, {
      systemPrompt: SYSTEM,
      model: "m",
    });
    assert(out.http === 200, "happy path → 200");
    assert(out.body["status"] === "processed", "happy path → processed");
    assert(fake.upserts.length === 1, "happy path → one upsert");
    assert(
      fake.jobUpdates.some((u) => u.payload["status"] === "processed"),
      "happy path → job processed",
    );
  }

  // --- final job update failure enters recovery (fallback then failure-state) ---
  {
    // Fail the first two job updates (primary processed + fallback processed),
    // then allow markJobFailure writes to succeed.
    const fake = makeFakeSupabase({
      submission: { submission_id: "sub-test-001" },
      failJobUpdates: 2,
    });
    const okModel = async (): Promise<ModelResult> => ({
      brief: BRIEF,
      responseId: "resp-1",
      usage: null,
    });
    const out = await processClaimedJob(fake.client, "sub-test-001", JOB, okModel, {
      systemPrompt: SYSTEM,
      model: "m",
    });
    assert(out.body["finalizeFailed"] === true, "double finalize failure reported");
    assert(
      fake.jobUpdates.some((u) =>
        u.payload["status"] === "processing_failed" &&
        String(u.payload["last_error"] ?? "").includes("JOB_FINALIZE_FAILED")
      ),
      "finalize failure → recovery via JOB_FINALIZE_FAILED",
    );
    assert(
      !fake.jobUpdates.slice(0, 2).some((u) => u.succeeded),
      "first two processed writes failed",
    );
    assert(
      fake.jobUpdates.slice(0, 2).every((u) => u.payload["status"] === "processed" && !u.succeeded),
      "both finalize attempts targeted processed and failed",
    );
  }

  // --- first failure-state write failure triggers fallback write ---
  {
    const fake = makeFakeSupabase({
      submission: null, // triggers markJobFailure(NOT_FOUND)
      failJobUpdates: 1, // primary fails, fallback succeeds
    });
    const out = await processClaimedJob(fake.client, "missing-sub", JOB, async () => {
      throw new Error("no");
    }, { systemPrompt: SYSTEM, model: "m" });
    assert(out.http === 404, "still returns 404 after fallback");
    assert(fake.jobUpdates.length === 2, "primary + fallback failure writes");
    assert(fake.jobUpdates[0].payload["status"] === "processing_failed", "primary attempted");
    assert(fake.jobUpdates[1].payload["status"] === "processing_failed", "fallback attempted");
    assert(
      fake.jobUpdates[1].payload["completed_at"] === undefined,
      "fallback omits completed_at",
    );
    assert(fake.jobUpdates[1].payload["last_error"] !== undefined, "fallback keeps last_error");
  }

  // --- both failure writes fail → writeFailed surfaced ---
  {
    const fake = makeFakeSupabase({ submission: null, failJobUpdates: 99 });
    const outcome = await markJobFailure(fake.client, JOB, "AI_HTTP_500", "boom");
    assert(outcome.writeFailed === true, "double failure-write fail → writeFailed");
  }

  // --- markJobProcessed: primary fail → fallback ok ---
  {
    const fake = makeFakeSupabase({ failJobUpdates: 1 });
    const r = await markJobProcessed(fake.client, JOB);
    assert(r.ok === true && r.fallbackUsed === true, "processed primary fail → fallback ok");
  }

  // --- buildAgentInput maps columns ---
  {
    const input = buildAgentInput({
      submission_id: "s1",
      brand: "Brand",
      contact_name: "N",
      contact_email: "a@example.com",
      brand_intention: "bi",
      business_decision: "bd",
      project_stage: "ps",
      selected_services: ["s"],
    });
    assert(input["submissionId"] === "s1", "buildAgentInput submissionId");
    assert(input["brand"] === "Brand", "buildAgentInput brand");
  }
}

await main();

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  Deno.exit(1);
}
console.log("\nAll pipeline tests passed");
