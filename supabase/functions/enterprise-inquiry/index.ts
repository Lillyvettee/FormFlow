// ============================================================
// enterprise-inquiry
//
// Saves an Enterprise "Contact us" request from /enterprise and emails it
// to the sales inbox.
//
// Body: { fullName, organizationName, email, workEmail, department,
//         organizationSize, workGoal, enterpriseNeeds, website }
// (website is a hidden field people never see; bots fill it in.)
//
// Secrets:
//   ENTERPRISE_NOTIFY_TO   optional; where requests go. Defaults to
//                          info@hummotion.com. Comma-separate several.
//   RESEND_API_KEY, NOTIFY_FROM   see _shared/email.ts
//
// Deploy with --no-verify-jwt: visitors don't need to be signed in.
// Safeguards instead of sign-in:
//   - Every field is checked for length and format.
//   - At most MAX_PER_HOUR requests are emailed per hour in total; past
//     that they are still saved, just not emailed.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { requireEnv } from "../_shared/env.ts";
import { sendEmail } from "../_shared/email.ts";

// Not billing.ts: that file needs the Stripe secrets.
const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DEFAULT_NOTIFY_TO = "info@hummotion.com";
const MAX_PER_HOUR = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Must match the check in migration 016 and SIZE_OPTIONS on the page. */
const SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];

/** Trimmed text between 1 and max characters, or null. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
}

function email(value: unknown): string | null {
  const v = text(value, 320);
  return v && EMAIL.test(v) ? v : null;
}

/** The signed-in user, if the caller sent a real session (not just the anon key). */
async function signedInUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await admin.auth.getUser(token);
  return data.user && !data.user.is_anonymous ? data.user.id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));

    // Bots fill in every field. Pretend it worked so they don't retry.
    if (typeof body.website === "string" && body.website.trim()) return json({ ok: true });

    const inquiry = {
      full_name: text(body.fullName, 150),
      organization_name: text(body.organizationName, 200),
      email: email(body.email),
      work_email: email(body.workEmail),
      department: text(body.department, 150),
      organization_size: SIZES.includes(body.organizationSize) ? body.organizationSize as string : null,
      work_goal: text(body.workGoal, 2000),
      enterprise_needs: text(body.enterpriseNeeds, 4000),
    };
    const missing = Object.entries(inquiry).filter(([, v]) => v === null).map(([k]) => k);
    if (missing.length) {
      return json({ error: "Please fill in every field. Check that both email addresses are valid." }, 400);
    }

    const { data: saved, error } = await admin
      .from("enterprise_inquiries")
      .insert({ ...inquiry, user_id: await signedInUserId(req) })
      .select("id")
      .single();
    if (error) throw error;

    // ----- Email the sales inbox -----
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("enterprise_inquiries")
      .select("id", { count: "exact", head: true })
      .not("notified_at", "is", null)
      .gte("created_at", since);

    if ((count ?? 0) >= MAX_PER_HOUR) {
      console.warn(`enterprise-inquiry: hourly email limit reached; ${saved.id} saved but not emailed.`);
    } else {
      const to = (Deno.env.get("ENTERPRISE_NOTIFY_TO") || DEFAULT_NOTIFY_TO).split(",").map((s) => s.trim()).filter(Boolean);
      try {
        await sendEmail({
          to,
          subject: `Enterprise inquiry: ${inquiry.organization_name}`,
          text: [
            `Name: ${inquiry.full_name}`,
            `Organization: ${inquiry.organization_name}`,
            `Email: ${inquiry.email}`,
            `Work email: ${inquiry.work_email}`,
            `Department: ${inquiry.department}`,
            `Organization size: ${inquiry.organization_size} people`,
            "",
            "Work goal:",
            inquiry.work_goal,
            "",
            "Enterprise-specific needs:",
            inquiry.enterprise_needs,
            "",
            `Saved as ${saved.id} in enterprise_inquiries.`,
          ].join("\n"),
        });
        await admin.from("enterprise_inquiries").update({ notified_at: new Date().toISOString() }).eq("id", saved.id);
      } catch (err) {
        // The request is saved either way; don't make the visitor resend it.
        console.error("enterprise-inquiry: email failed:", err);
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error("enterprise-inquiry:", err);
    return json({ error: "We couldn't send your request. Please try again, or email info@hummotion.com." }, 500);
  }
});
