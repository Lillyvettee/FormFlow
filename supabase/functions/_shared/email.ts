// ============================================================
// Sending email through Resend (https://resend.com).
//
// Secrets:
//   RESEND_API_KEY   re_...
//   NOTIFY_FROM      the sender, e.g. "FormFlow <billing@yourdomain.com>".
//                    Optional for alerts to yourself; required for emails
//                    to customers (see hasCustomerSender).
// ============================================================

import { requireEnv } from "./billing.ts";

/** Resend's shared test sender. It can only deliver to the Resend account's own address. */
const TEST_SENDER = "FormFlow <onboarding@resend.dev>";

/**
 * Whether emails can go to customers. The test sender only reaches your own
 * inbox, so customer emails need NOTIFY_FROM on a domain verified in Resend.
 */
export function hasCustomerSender(): boolean {
  return Boolean(Deno.env.get("NOTIFY_FROM"));
}

/** Send a plain-text email. Throws if Resend rejects it. */
export async function sendEmail({ to, subject, text }: { to: string[]; subject: string; text: string }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: Deno.env.get("NOTIFY_FROM") || TEST_SENDER, to, subject, text }),
  });
  if (!response.ok) throw new Error(`Resend failed: ${response.status} ${await response.text()}`);
}
