// Real transactional email transport for the notification worker.
// There is NO fake/in-memory transport here on purpose: production must never
// record a provider message id for a send that did not happen.
//
// Env:
//   EMAIL_PROVIDER   must be "resend" (launch provider). Missing/other →
//                    EMAIL_PROVIDER_REQUIRED (worker refuses to claim jobs).
//   RESEND_API_KEY   required
//   EMAIL_FROM       default: Ingressible <hello@ingressible.com>
//   NOTIFICATION_INTERNAL_ADDRESS  default: hello@ingressible.com

export type EmailConfig = {
  provider: "resend";
  apiKey: string;
  from: string;
  internalAddress: string;
};

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type SendResult = { messageId: string; provider: string };

export const TERMINAL_EMAIL_CODES = new Set([
  "EMAIL_PROVIDER_REQUIRED",
  "EMAIL_NOT_CONFIGURED",
  "EMAIL_AUTH_ERROR",
  "EMAIL_INVALID_REQUEST",
  "EMAIL_NO_RECIPIENT",
]);

export function emailError(code: string, message: string, detail?: string): Error & {
  code: string;
  detail?: string;
} {
  const e = new Error(message) as Error & { code: string; detail?: string };
  e.code = code;
  if (detail) e.detail = detail;
  return e;
}

export function resolveEmailConfig(
  env: (name: string) => string | undefined = (n) => Deno.env.get(n),
): EmailConfig | null {
  const provider = (env("EMAIL_PROVIDER") ?? "").trim().toLowerCase();
  const apiKey = env("RESEND_API_KEY") ?? null;
  if (provider !== "resend" || !apiKey) return null;
  return {
    provider: "resend",
    apiKey,
    from: env("EMAIL_FROM") ?? "Ingressible <hello@ingressible.com>",
    internalAddress: env("NOTIFICATION_INTERNAL_ADDRESS") ?? "hello@ingressible.com",
  };
}

export function isEmailConfigured(
  env: (name: string) => string | undefined = (n) => Deno.env.get(n),
): boolean {
  return resolveEmailConfig(env) !== null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function sanitize(s: string): string {
  return s
    .replace(/re_[A-Za-z0-9-_]{4,}/g, "re_REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]{4,}/gi, "Bearer REDACTED")
    .slice(0, 300);
}

/** Send one email through the configured real provider. */
export async function sendEmail(
  cfg: EmailConfig,
  payload: EmailPayload,
  fetchFn: FetchLike = fetch,
): Promise<SendResult> {
  if (!payload.to) {
    throw emailError("EMAIL_NO_RECIPIENT", "recipient address missing");
  }
  let res: Response;
  try {
    res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        headers: { "X-Idempotency-Key": payload.idempotencyKey },
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    const timedOut = /timeout|abort|timed out/i.test(msg);
    throw emailError(
      timedOut ? "EMAIL_TIMEOUT" : "EMAIL_NETWORK_ERROR",
      `email fetch failed: ${sanitize(msg)}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const detail = `http=${res.status} ${sanitize(body.slice(0, 200))}`;
    if (res.status === 401 || res.status === 403) {
      throw emailError("EMAIL_AUTH_ERROR", "email provider rejected credentials", detail);
    }
    if (res.status === 429) {
      throw emailError("EMAIL_RATE_LIMITED", "email provider rate limited", detail);
    }
    if (res.status >= 500) {
      throw emailError("EMAIL_PROVIDER_5XX", `email provider HTTP ${res.status}`, detail);
    }
    throw emailError("EMAIL_INVALID_REQUEST", `email provider HTTP ${res.status}`, detail);
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof json["id"] === "string" ? json["id"] : null;
  if (!id) {
    throw emailError("EMAIL_INVALID_RESPONSE", "provider returned no message id");
  }
  return { messageId: id, provider: cfg.provider };
}
 
 
