// Notification email templates. Pure functions — no secrets, no network.
// All interpolated values are HTML-escaped. Templates never embed the full
// confidential intake body.

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ClientTemplate = {
  brand: string;
  contactName: string;
  publicReference: string;
  createdAt: string;
};

export type InternalTemplate = {
  brand: string;
  contactName: string;
  publicReference: string;
  createdAt: string;
  reviewHint: string;
};

function shell(title: string, bodyHtml: string): { html: string; text: string } {
  return {
    html:
      `<!doctype html><html><body style="font-family:Georgia,serif;line-height:1.55;color:#1c1a17">` +
      `<h1 style="font-size:1.35rem;margin:0 0 0.75rem">${escapeHtml(title)}</h1>` +
      bodyHtml +
      `<p style="margin-top:1.5rem;font-size:0.85rem;color:#5c564e">Ingressible LLC &middot; Preserving the Vision. Expanding the Experience.</p>` +
      `</body></html>`,
    text: title,
  };
}

/**
 * Client confirmation:
 *  - confirms receipt
 *  - public reference
 *  - brief explanation of what happens next
 *  - NO automatic qualification, NO automatic scheduling promise
 */
export function buildClientConfirmation(t: ClientTemplate): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Ingressible consultation request received — ${t.publicReference}`;
  const body =
    `<p>Hello ${escapeHtml(t.contactName || "there")},</p>` +
    `<p><strong>Your consultation request has been received.</strong></p>` +
    `<p>Public reference: <strong>${escapeHtml(t.publicReference)}</strong></p>` +
    `<p>What happens next: Kechi will review the information you shared and follow up by email ` +
    `to discuss fit, possible scope, and next steps. Submitting a request does not guarantee ` +
    `qualification, booking, or scheduling — those are decided after review.</p>` +
    `<p>If you need to add anything, reply to this email and include your public reference.</p>`;
  const shellOut = shell("Consultation request received", body);
  return {
    subject,
    html: shellOut.html,
    text:
      `Your consultation request has been received.\n` +
      `Public reference: ${t.publicReference}\n\n` +
      `What happens next: Kechi will review your information and follow up by email to discuss ` +
      `fit, possible scope, and next steps. Submitting a request does not guarantee qualification, ` +
      `booking, or scheduling.\n`,
  };
}

/**
 * Internal notification:
 *  - new consultation received
 *  - public reference + brand/company name
 *  - safe reference/link for review
 *  - NO confidential full intake body
 */
export function buildInternalNotification(t: InternalTemplate): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `New Ingressible consultation — ${t.brand} — ${t.publicReference}`;
  const body =
    `<p>A new consultation request was received.</p>` +
    `<ul>` +
    `<li><strong>Brand / company:</strong> ${escapeHtml(t.brand)}</li>` +
    `<li><strong>Public reference:</strong> ${escapeHtml(t.publicReference)}</li>` +
    `<li><strong>Contact:</strong> ${escapeHtml(t.contactName)}</li>` +
    `<li><strong>Received:</strong> ${escapeHtml(t.createdAt)}</li>` +
    `</ul>` +
    `<p>Review: ${escapeHtml(t.reviewHint)}</p>` +
    `<p style="font-size:0.9rem;color:#5c564e">This email intentionally omits the full intake answers. ` +
    `Open the submission in the Ingressible console to read them.</p>`;
  const shellOut = shell("New consultation received", body);
  return {
    subject,
    html: shellOut.html,
    text:
      `New consultation received.\n` +
      `Brand / company: ${t.brand}\n` +
      `Public reference: ${t.publicReference}\n` +
      `Contact: ${t.contactName}\n` +
      `Received: ${t.createdAt}\n` +
      `Review: ${t.reviewHint}\n\n` +
      `Full intake answers are not included in this email.\n`,
  };
}
