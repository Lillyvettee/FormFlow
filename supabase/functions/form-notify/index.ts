// ============================================================
// form-notify
//
// Sends a form response's emails, set per form in the form builder
// (forms.settings.notifications):
//   - an alert to the organization's chosen staff addresses, with the answers
//   - a confirmation to the respondent, at the address they gave in the
//     form's chosen email question, with an optional message and a copy of
//     their answers
//
// Called by the public form page right after a response is saved.
// Body: { submissionId: string }
//
// Deploy with --no-verify-jwt: respondents aren't signed in. Safeguards
// instead of sign-in:
//   - Each response's emails go out at most once (it claims notified_at).
//   - Only responses submitted in the last 15 minutes are sent.
//   - Confirmations are capped per form per hour, so a form can't be used to
//     flood someone's inbox.
//   - Only answers to the form's own questions are included.
//
// Needs NOTIFY_FROM on a domain verified in Resend (like trial reminders).
// Without it nothing is sent and the log says why.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { requireEnv } from "../_shared/env.ts";
import { hasCustomerSender, sendEmail } from "../_shared/email.ts";

// Not billing.ts: that file needs the Stripe secrets, and form emails
// shouldn't depend on billing being set up.
const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const serve = (handler: (req: Request) => Promise<Response>) =>
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      return await handler(req);
    } catch (err) {
      console.error("form-notify:", err);
      return json({ sent: false }, 500);
    }
  });

const MAX_AGE_MS = 15 * 60 * 1000;
const MAX_CONFIRMATIONS_PER_HOUR = 60;
const MAX_STAFF_RECIPIENTS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Field {
  id: string;
  label?: string;
  type: string;
}

interface Notifications {
  staffEmails?: string[];
  confirmEmailFieldId?: string | null;
  confirmMessage?: string | null;
  includeAnswers?: boolean;
}

/**
 * One answer as text. Private uploads (migration 014) aren't linked: the file
 * only opens for the organization, inside HumMotion. Older public uploads
 * show their link.
 */
const answerText = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "string" && value.startsWith("hm-file://")) return "File uploaded (open it in HumMotion)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(answerText).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).slice(0, 2000);
};

serve(async (req) => {
  const { submissionId } = await req.json().catch(() => ({}));
  if (typeof submissionId !== "string" || !UUID.test(submissionId)) return json({ sent: false });

  const { data: sub } = await admin
    .from("form_submissions")
    .select("id, form_id, data, submitted_at, notified_at")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub || sub.notified_at) return json({ sent: false });
  if (Date.now() - new Date(sub.submitted_at).getTime() > MAX_AGE_MS) return json({ sent: false });

  const { data: form } = await admin.from("forms").select("id, title, fields, settings, organization_id").eq("id", sub.form_id).maybeSingle();
  const notifications: Notifications = form?.settings?.notifications ?? {};
  const staff = (notifications.staffEmails ?? []).filter((e) => EMAIL.test(e)).slice(0, MAX_STAFF_RECIPIENTS);
  const confirmTo = notifications.confirmEmailFieldId ? String(sub.data?.[notifications.confirmEmailFieldId] ?? "").trim() : "";
  if (!form || (!staff.length && !EMAIL.test(confirmTo))) return json({ sent: false });

  if (!hasCustomerSender()) {
    console.warn("form-notify: NOTIFY_FROM is not set, so form emails can't be sent. See BILLING_SETUP.md.");
    return json({ sent: false });
  }

  // Claim the response; a second call (or a retry) finds it already claimed.
  const { data: claimed } = await admin
    .from("form_submissions")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", sub.id)
    .is("notified_at", null)
    .select("id");
  if (!claimed?.length) return json({ sent: false });

  const { data: org } = await admin.from("organizations").select("name").eq("id", form.organization_id).maybeSingle();
  const orgName = org?.name ?? "HumMotion";
  const fields: Field[] = (Array.isArray(form.fields) ? form.fields : []).filter((f: Field) => f && f.id && f.type !== "section");
  const answers = fields.map((f) => `${f.label || "Untitled question"}: ${answerText(sub.data?.[f.id])}`).join("\n");
  const submitted = new Date(sub.submitted_at).toUTCString();
  const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");

  const errors: string[] = [];

  if (staff.length) {
    try {
      await sendEmail({
        to: staff,
        subject: `New response: ${form.title}`.slice(0, 150),
        text: [
          `${form.title} has a new response (${submitted}).`,
          "",
          answers,
          "",
          siteUrl ? `See all responses: ${siteUrl}/reports?tab=forms&form=${form.id}` : "",
          "",
          `You're getting this because your address is on this form's notification list in ${orgName}'s HumMotion account.`,
        ].join("\n"),
      });
    } catch (err) {
      errors.push(`staff alert: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (EMAIL.test(confirmTo)) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .eq("form_id", form.id)
      .gte("notified_at", hourAgo);
    if ((count ?? 0) > MAX_CONFIRMATIONS_PER_HOUR) {
      console.warn(`form-notify: hourly confirmation limit reached for form ${form.id}; skipped.`);
    } else {
      try {
        await sendEmail({
          to: [confirmTo],
          subject: `Thanks for your response to ${form.title}`.slice(0, 150),
          text: [
            (notifications.confirmMessage ?? "").trim() || `Thank you! ${orgName} received your response to "${form.title}".`,
            ...(notifications.includeAnswers ? ["", "A copy of your answers:", "", answers] : []),
            "",
            `- ${orgName}`,
          ].join("\n"),
        });
      } catch (err) {
        errors.push(`confirmation: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  if (errors.length) console.error(`form-notify ${sub.id}: ${errors.join("; ")}`);
  return json({ sent: errors.length === 0 });
});
