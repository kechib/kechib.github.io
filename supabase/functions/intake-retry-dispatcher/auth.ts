// Shared internal auth for intake-retry-dispatcher.
// NEVER trust a decoded JWT payload alone: forged unsigned alg:none tokens
// previously bypassed auth. Accept only:
//   1) exact INTAKE_INTERNAL_SECRET on an internal header, or
//   2) Bearer token equal to SUPABASE_SERVICE_ROLE_KEY (exact match), or
//   3) Bearer JWT that cryptographically verifies against SUPABASE_JWKS
//      with role=service_role (RS256/ES256 via Web Crypto).
// Unauthenticated → 401.

const AUTH_HEADER_NAMES = [
  "x-intake-internal-secret",
  "x-internal-secret",
  "x-webhook-secret",
];

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export function extractInternalSecret(req: Request): string | null {
  for (const name of AUTH_HEADER_NAMES) {
    const v = req.headers.get(name);
    if (v) return v;
  }
  return null;
}

export function extractBearer(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1] : null;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type JwtHeader = { alg?: string; kid?: string };
type JwtPayload = { role?: string; iss?: string; exp?: number };

function parseJwt(token: string): {
  header: JwtHeader;
  payload: JwtPayload;
  signingInput: string;
  signature: Uint8Array;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as JwtHeader;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as JwtPayload;
    return {
      header,
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: b64urlToBytes(parts[2]),
    };
  } catch {
    return null;
  }
}

async function verifyWithJwks(token: string, jwksJson: string): Promise<boolean> {
  const parsed = parseJwt(token);
  if (!parsed) return false;
  const { header, payload, signingInput, signature } = parsed;

  if (!header.alg || header.alg === "none" || header.alg === "None") return false;
  if (payload.role !== "service_role") return false;
  if (payload.exp !== undefined && payload.exp * 1000 < Date.now()) return false;

  let jwks: { keys?: JsonWebKey[] };
  try {
    jwks = JSON.parse(jwksJson);
  } catch {
    return false;
  }
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const candidates = header.kid
    ? keys.filter((k) => (k as { kid?: string }).kid === header.kid)
    : keys;
  if (!candidates.length) return false;

  const data = new TextEncoder().encode(signingInput);
  for (const jwk of candidates) {
    try {
      let key: CryptoKey;
      if (header.alg.startsWith("RS")) {
        key = await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );
      } else if (header.alg.startsWith("ES")) {
        key = await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );
      } else {
        continue;
      }
      const ok = header.alg.startsWith("RS")
        ? await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, data)
        : await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, data);
      if (ok) return true;
    } catch {
      // try next key
    }
  }
  return false;
}

function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function authorize(
  req: Request,
  opts: {
    internalSecret: string | null;
    serviceKey: string | null;
    jwksJson: string | null;
    /** See process-intake-submission/auth.ts — only with verify_jwt=true. */
    acceptPlatformValidatedServiceRole?: boolean;
  },
): Promise<Response | null> {
  const { internalSecret, serviceKey, jwksJson, acceptPlatformValidatedServiceRole } = opts;

  const provided = extractInternalSecret(req);
  if (internalSecret && provided && timingSafeEqual(provided, internalSecret)) {
    return null;
  }

  const bearer = extractBearer(req);
  if (bearer) {
    if (serviceKey && timingSafeEqual(bearer, serviceKey)) return null;
    if (jwksJson && (await verifyWithJwks(bearer, jwksJson))) return null;
    if (acceptPlatformValidatedServiceRole) {
      const parsed = parseJwt(bearer);
      if (
        parsed &&
        parsed.header.alg &&
        parsed.header.alg !== "none" &&
        parsed.header.alg !== "None" &&
        parsed.payload.role === "service_role" &&
        (parsed.payload.exp === undefined || parsed.payload.exp * 1000 >= Date.now())
      ) {
        return null;
      }
    }
  }

  return unauthorized();
}

export function requirePost(req: Request): Response | null {
  if (req.method === "POST" || req.method === "OPTIONS") return null;
  return Response.json(
    { ok: false, error: "method_not_allowed" },
    { status: 405 },
  );
}
