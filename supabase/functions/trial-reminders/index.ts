// ============================================================
// trial-reminders
//
// Emails owners and admins of organizations that haven't subscribed:
//   - 7 days before the free trial ends
//   - 1 day before
//   - when it has ended (records are now read-only)
//
// Runs once a day from a pg_cron job (migration 005). Each email is sent once
// per organization; organization_billing.trial_reminders_sent records which.
// Running it more often, or twice by accident, sends nothing extra.
//
// Deploy with --no-verify-jwt. Instead of a Supabase login, callers must send
// the header x-cron-secret matching the CRON_SECRET secret.
//
// Needs NOTIFY_FROM on a domain verified in Resend: Resend's test sender
// can't deliver to customers. Without it this does nothing and says why.
// ============================================================

import { admin, json, requireEnv, serve } from "../_shared/billing.ts";
import { hasCustomerSender, sendEmail } from "../_shared/email.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Organizations whose trial ended longer ago than this don't get the "ended" email (e.g. if the job was off for a while). */
const ENDED_NOTICE_WINDOW_MS = 3 * DAY_MS;

type Stage = "7d" | "1d" | "ended";

/** Which reminder is due, given time left in the trial and what was already sent. */
function dueStage(msLeft: number, sent: string[]): Stage | null {
  if (msLeft <= 0) return msLeft > -ENDED_NOTICE_WINDOW_MS && !sent.includes("ended") ? "ended" : null;
  if (msLeft <= DAY_MS) return sent.includes("1d") ? null : "1d";
  // Skip the 7-day email if the 1-day one already went out.
  if (msLeft <= 7 * DAY_MS) return sent.includes("7d") || sent.includes("1d") ? null : "7d";
  return null;
}

function emailFor(stage: Stage, orgName: string, trialEndsAt: string) {
  const site = requireEnv("SITE_URL").replace(/\/$/, "");
  const planLink = `${site}/settings#plan`;
  const endDate = new Date(trialEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  if (stage === "ended") {
    return {
      subject: `Your HumMotion trial has ended`,
      text: [
        `The free trial for ${orgName} ended on ${endDate}.`,
        "",
        "Your records are safe, and everyone on your team can still sign in, view and export them. Adding and editing are paused, and your public forms aren't accepting responses.",
        "",
        `Choose a plan to pick up right where you left off: ${planLink}`,
      ].join("\n"),
    };
  }

  const when = stage === "1d" ? "tomorrow" : "in 7 days";
  return {
    subject: `Your HumMotion trial ends ${when}`,
    text: [
      `The free trial for ${orgName} ends ${when}, on ${endDate}.`,
      "",
      "Choose a plan now to keep adding records and collecting form responses without interruption. You won't be charged until the trial ends.",
      "",
      `Choose a plan: ${planLink}`,
      "",
      "If you don't, nothing is deleted: your records become read-only until you subscribe.",
    ].join("\n"),
  };
}

serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== requireEnv("CRON_SECRET")) return json({ error: "Unauthorized" }, 401);

  if (!hasCustomerSender()) {
    console.warn("trial-reminders: NOTIFY_FROM is not set, so no reminders were sent. See BILLING_SETUP.md.");
    return json({ sent: 0, skipped: "NOTIFY_FROM not set" });
  }

  // Unsubscribed organizations whose trial ends within 7 days or ended recently.
  const now = Date.now();
  const { data: rows, error } = await admin
    .from("organization_billing")
    .select("organization_id, trial_ends_at, status, trial_reminders_sent, organizations(name)")
    .or("status.is.null,status.not.in.(active,trialing,past_due)")
    .gt("trial_ends_at", new Date(now - ENDED_NOTICE_WINDOW_MS).toISOString())
    .lte("trial_ends_at", new Date(now + 7 * DAY_MS).toISOString());
  if (error) throw error;

  let sent = 0;
  const failures: string[] = [];

  for (const row of rows ?? []) {
    const already: string[] = row.trial_reminders_sent ?? [];
    const stage = dueStage(new Date(row.trial_ends_at).getTime() - now, already);
    if (!stage) continue;

    // Owners and admins with an email. Demo organizations have none and are skipped.
    const { data: admins, error: membersError } = await admin
      .from("organization_members")
      .select("email")
      .eq("organization_id", row.organization_id)
      .in("role", ["owner", "admin"])
      .not("email", "is", null);
    if (membersError) throw membersError;
    const to = (admins ?? []).map((m) => m.email as string);
    if (to.length === 0) continue;

    const org = row.organizations as { name: string } | { name: string }[] | null;
    const orgName = (Array.isArray(org) ? org[0]?.name : org?.name) || "your organization";

    try {
      await sendEmail({ to, ...emailFor(stage, orgName, row.trial_ends_at) });
    } catch (err) {
      // Try again tomorrow; keep going with the other organizations.
      console.error(`trial-reminders: ${row.organization_id}`, err);
      failures.push(row.organization_id);
      continue;
    }

    const { error: markError } = await admin
      .from("organization_billing")
      .update({ trial_reminders_sent: [...already, stage] })
      .eq("organization_id", row.organization_id);
    if (markError) throw markError;
    sent += 1;
  }

  return json({ sent, failed: failures.length });
});
