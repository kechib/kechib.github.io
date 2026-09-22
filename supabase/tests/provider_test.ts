// Provider-neutral model execution tests (mocked fetch, no network).
import {
  aiError,
  callIntakeModel,
  classifyHttpFailure,
  resolveProviderConfig,
  validateBrief,
} from "../functions/process-intake-submission/provider.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const VALID_BRIEF = {
  intakeSummary: "summary",
  engagementShape: "unclear",
  missingInformation: [],
  questionsForConsultation: [],
  recommendedAssessmentModules: [],
  recommendedPreparation: [],
  proposalInputs: {
    services: [],
    workstreams: [],
    deliverables: [],
    budgetPreference: "Unknown",
    timeline: "Unknown",
  },
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function main() {
  // --- provider selection defaults to groq (launch provider) ---
  {
    const cfg = resolveProviderConfig((n) =>
      n === "GROQ_API_KEY" ? "gsk_test" :
      n === "GROQ_INTAKE_MODEL" ? "openai/gpt-oss-20b" : undefined
    );
    assert(cfg.provider === "groq", "default provider is groq");
    assert(cfg.model === "openai/gpt-oss-20b", `groq model got ${cfg.model}`);
    assert(cfg.apiKey === "gsk_test", "groq key read");
  }
  {
    const cfg = resolveProviderConfig((n) =>
      n === "AI_PROVIDER" ? "openai" :
      n === "OPENAI_API_KEY" ? "sk-test" :
      n === "OPENAI_INTAKE_MODEL" ? "gpt-x" : undefined
    );
    assert(cfg.provider === "openai", "AI_PROVIDER=openai honoured");
    assert(cfg.model === "gpt-x", "openai model env honoured");
  }

  // --- missing key → AI_NOT_CONFIGURED, no network call ---
  {
    let called = false;
    const cfg = resolveProviderConfig(() => undefined);
    try {
      await callIntakeModel(cfg, "sys", {}, () => {
        called = true;
        return Promise.reject(new Error("should not fetch"));
      });
      assert(false, "missing key should throw");
    } catch (e) {
      assert((e as Error & { code?: string }).code === "AI_NOT_CONFIGURED", "missing key → AI_NOT_CONFIGURED");
    }
    assert(called === false, "no fetch without api key");
  }

  // --- HTTP status → provider-neutral code mapping ---
  assert(classifyHttpFailure(400, null) === "AI_INVALID_REQUEST", "400 → AI_INVALID_REQUEST");
  assert(classifyHttpFailure(401, null) === "AI_AUTH_ERROR", "401 → AI_AUTH_ERROR");
  assert(classifyHttpFailure(403, null) === "AI_AUTH_ERROR", "403 → AI_AUTH_ERROR");
  assert(classifyHttpFailure(429, "type=rate_limit_exceeded") === "AI_RATE_LIMITED_TRANSIENT", "429 rate → transient");
  assert(classifyHttpFailure(429, "code=insufficient_quota") === "AI_PROVIDER_QUOTA", "429 quota → quota");
  assert(classifyHttpFailure(500, null) === "AI_PROVIDER_5XX", "500 → AI_PROVIDER_5XX");
  assert(classifyHttpFailure(503, null) === "AI_PROVIDER_5XX", "503 → AI_PROVIDER_5XX");

  // --- happy path: strict structured output parsed + provenance captured ---
  {
    const cfg = { provider: "groq" as const, model: "openai/gpt-oss-20b", apiKey: "gsk_test" };
    let url = "";
    let sentBody: Record<string, unknown> | null = null;
    const out = await callIntakeModel(cfg, "sys", { a: 1 }, (u, init) => {
      url = u;
      sentBody = JSON.parse(String(init?.body));
      return Promise.resolve(jsonResponse(200, {
        id: "chatcmpl-123",
        choices: [{ message: { role: "assistant", content: JSON.stringify(VALID_BRIEF) } }],
        usage: { total_tokens: 10 },
        x_groq: { id: "req_1" },
      }));
    });
    assert(url === "https://api.groq.com/openai/v1/chat/completions", "groq chat completions endpoint");
    const rf = sentBody!["response_format"] as Record<string, unknown>;
    assert(rf["type"] === "json_schema", "strict json_schema response_format");
    const js = rf["json_schema"] as Record<string, unknown>;
    assert(js["strict"] === true, "strict mode enabled");
    assert(out.brief.intakeSummary === "summary", "brief parsed");
    assert(out.responseId === "chatcmpl-123", "response id captured");
    assert(out.provider === "groq", "provider provenance groq");
    assert(out.model === "openai/gpt-oss-20b", "model provenance captured");
  }

  // --- empty content → AI_EMPTY_OUTPUT ---
  {
    const cfg = { provider: "groq" as const, model: "m", apiKey: "k" };
    try {
      await callIntakeModel(cfg, "sys", {}, () =>
        Promise.resolve(jsonResponse(200, { choices: [{ message: { content: "" } }] })));
      assert(false, "empty content should throw");
    } catch (e) {
      assert((e as Error & { code?: string }).code === "AI_EMPTY_OUTPUT", "empty → AI_EMPTY_OUTPUT");
    }
  }

  // --- non-JSON and schema-invalid output → AI_INVALID_OUTPUT ---
  for (const content of ["not json", JSON.stringify({ intakeSummary: 1 })]) {
    const cfg = { provider: "groq" as const, model: "m", apiKey: "k" };
    try {
      await callIntakeModel(cfg, "sys", {}, () =>
        Promise.resolve(jsonResponse(200, { choices: [{ message: { content } }] })));
      assert(false, "invalid output should throw");
    } catch (e) {
      assert(
        (e as Error & { code?: string }).code === "AI_INVALID_OUTPUT",
        "invalid output → AI_INVALID_OUTPUT",
      );
    }
  }

  // --- HTTP failures surface sanitized provider-neutral codes ---
  {
    const cfg = { provider: "groq" as const, model: "m", apiKey: "k" };
    const cases: Array<[number, Record<string, unknown>, string]> = [
      [401, { error: { message: "Invalid API Key" } }, "AI_AUTH_ERROR"],
      [429, { error: { message: "Rate limit reached", type: "rate_limit_exceeded" } }, "AI_RATE_LIMITED_TRANSIENT"],
      [429, { error: { message: "Insufficient quota", type: "insufficient_quota", code: "insufficient_quota" } }, "AI_PROVIDER_QUOTA"],
      [500, { error: { message: "oops" } }, "AI_PROVIDER_5XX"],
      [400, { error: { message: "bad request" } }, "AI_INVALID_REQUEST"],
    ];
    for (const [status, body, expected] of cases) {
      try {
        await callIntakeModel(cfg, "sys", {}, () => Promise.resolve(jsonResponse(status, body)));
        assert(false, `status ${status} should throw`);
      } catch (e) {
        const err = e as Error & { code?: string; detail?: string };
        assert(err.code === expected, `http ${status} → ${expected} (got ${err.code})`);
        assert(!/gsk_|Bearer\s+\S+/i.test(err.detail ?? ""), `no secrets in detail for ${status}`);
      }
    }
  }

  // --- timeout / network errors are retryable-class codes ---
  {
    const cfg = { provider: "groq" as const, model: "m", apiKey: "k" };
    for (
      const [message, expected] of [
        ["The operation was aborted due to timeout", "AI_TIMEOUT"],
        ["dns failure", "AI_NETWORK_ERROR"],
      ] as Array<[string, string]>
    ) {
      try {
        await callIntakeModel(cfg, "sys", {}, () => Promise.reject(new Error(message)));
        assert(false, "fetch failure should throw");
      } catch (e) {
        assert((e as Error & { code?: string }).code === expected, `${message} → ${expected}`);
      }
    }
  }

  // --- bounded fallback: unsupported structured output retries once with json_object ---
  {
    const cfg = { provider: "groq" as const, model: "m", apiKey: "k" };
    let calls = 0;
    const out = await callIntakeModel(cfg, "sys", {}, () => {
      calls++;
      if (calls === 1) {
        return Promise.resolve(jsonResponse(400, {
          error: { message: "Invalid `response_format` type: json_schema not supported" },
        }));
      }
      return Promise.resolve(jsonResponse(200, {
        id: "chatcmpl-2",
        choices: [{ message: { content: JSON.stringify(VALID_BRIEF) } }],
      }));
    });
    assert(calls === 2, "exactly one fallback attempt");
    assert(out.brief.intakeSummary === "summary", "fallback still validates brief");
  }

  // --- validateBrief rejects schema drift ---
  assert(validateBrief(VALID_BRIEF) === true, "valid brief accepted");
  assert(validateBrief({ ...VALID_BRIEF, engagementShape: "wrong" }) === false, "bad enum rejected");
  assert(validateBrief({ ...VALID_BRIEF, proposalInputs: {} }) === false, "incomplete proposalInputs rejected");
  assert(validateBrief(null) === false, "null rejected");

  // --- aiError carries code ---
  {
    const e = aiError("AI_NOT_CONFIGURED", "msg", "extra");
    assert(e.code === "AI_NOT_CONFIGURED" && e.detail === "extra", "aiError carries code/detail");
  }

  // --- openai path preserved (optional) ---
  {
    const cfg = { provider: "openai" as const, model: "gpt-x", apiKey: "sk-test" };
    let url = "";
    const out = await callIntakeModel(cfg, "sys", {}, (u) => {
      url = u;
      return Promise.resolve(jsonResponse(200, {
        id: "resp_1",
        output: [
          { content: [{ type: "output_text", text: JSON.stringify(VALID_BRIEF) }] },
        ],
      }));
    });
    assert(url === "https://api.openai.com/v1/responses", "openai responses endpoint preserved");
    assert(out.provider === "openai", "openai provider provenance");
  }
}

await main();

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  Deno.exit(1);
}
console.log("\nAll provider tests passed");
