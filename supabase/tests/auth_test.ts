import {
  authorize,
  extractBearer,
  extractInternalSecret,
  requirePost,
} from "../functions/process-intake-submission/auth.ts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

function makeReq(headers: Record<string, string>, method = "POST"): Request {
  return new Request("https://example.test/fn", { method, headers });
}

const SECRET = "test-secret";
const SERVICE = "sb_secret_service_key_abc";

async function main() {
  // Unauthenticated → 401
  const unauth = await authorize(makeReq({}), {
    internalSecret: SECRET,
    serviceKey: SERVICE,
    jwksJson: null,
  });
  assert(unauth !== null && unauth.status === 401, "unauthenticated → 401");

  // Wrong internal secret → 401
  const wrongSecret = await authorize(
    makeReq({ "x-intake-internal-secret": "wrong" }),
    { internalSecret: SECRET, serviceKey: SERVICE, jwksJson: null },
  );
  assert(wrongSecret !== null && wrongSecret.status === 401, "wrong secret → 401");

  // Correct internal secret → null (ok)
  const okSecret = await authorize(
    makeReq({ "x-intake-internal-secret": SECRET }),
    { internalSecret: SECRET, serviceKey: SERVICE, jwksJson: null },
  );
  assert(okSecret === null, "correct secret → authorized");

  // Correct service key bearer → null
  const okKey = await authorize(
    makeReq({ Authorization: `Bearer ${SERVICE}` }),
    { internalSecret: SECRET, serviceKey: SERVICE, jwksJson: null },
  );
  assert(okKey === null, "service key bearer → authorized");

  // Forged unsigned alg:none JWT with role=service_role → 401 (never trusted)
  const forgedHeader = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const forgedPayload = btoa(JSON.stringify({ role: "service_role" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const forged = `${forgedHeader}.${forgedPayload}.`;
  const forgedAuth = await authorize(
    makeReq({ Authorization: `Bearer ${forged}` }),
    { internalSecret: SECRET, serviceKey: SERVICE, jwksJson: null },
  );
  assert(forgedAuth !== null && forgedAuth.status === 401, "forged alg:none → 401");

  // Extract helpers
  const r = makeReq({ "x-intake-internal-secret": SECRET, Authorization: "Bearer xyz" });
  assert(extractInternalSecret(r) === SECRET, "extractInternalSecret finds secret");
  assert(extractBearer(r) === "xyz", "extractBearer finds token");
  assert(extractBearer(makeReq({})) === null, "extractBearer null when absent");

  // POST guard
  assert(requirePost(makeReq({}, "POST")) === null, "POST allowed");
  assert(requirePost(makeReq({}, "GET"))?.status === 405, "GET → 405");

  // Platform-validated service_role path (verify_jwt=true only)
  const hsHeader = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expFuture = Math.floor(Date.now() / 1000) + 3600;
  const hsPayload = btoa(JSON.stringify({ role: "service_role", exp: expFuture }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fakeHs = `${hsHeader}.${hsPayload}.sig`;
  const okPlatform = await authorize(
    makeReq({ Authorization: `Bearer ${fakeHs}` }),
    {
      internalSecret: SECRET,
      serviceKey: SERVICE,
      jwksJson: null,
      acceptPlatformValidatedServiceRole: true,
    },
  );
  assert(okPlatform === null, "platform-validated service_role → authorized");

  const deniedNoPlatform = await authorize(
    makeReq({ Authorization: `Bearer ${fakeHs}` }),
    { internalSecret: SECRET, serviceKey: SERVICE, jwksJson: null },
  );
  assert(
    deniedNoPlatform !== null && deniedNoPlatform.status === 401,
    "service_role without platform trust → 401",
  );

  const expPast = Math.floor(Date.now() / 1000) - 60;
  const expPayload = btoa(JSON.stringify({ role: "service_role", exp: expPast }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const expiredHs = `${hsHeader}.${expPayload}.sig`;
  const deniedExpired = await authorize(
    makeReq({ Authorization: `Bearer ${expiredHs}` }),
    {
      internalSecret: SECRET,
      serviceKey: SERVICE,
      jwksJson: null,
      acceptPlatformValidatedServiceRole: true,
    },
  );
  assert(
    deniedExpired !== null && deniedExpired.status === 401,
    "expired platform-validated service_role → 401",
  );

  const roleUserPayload = btoa(JSON.stringify({ role: "authenticated", exp: expFuture }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const userHs = `${hsHeader}.${roleUserPayload}.sig`;
  const deniedUser = await authorize(
    makeReq({ Authorization: `Bearer ${userHs}` }),
    {
      internalSecret: SECRET,
      serviceKey: SERVICE,
      jwksJson: null,
      acceptPlatformValidatedServiceRole: true,
    },
  );
  assert(
    deniedUser !== null && deniedUser.status === 401,
    "authenticated-role platform JWT → 401",
  );
}

await main();

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  Deno.exit(1);
}
console.log("\nAll auth tests passed");
