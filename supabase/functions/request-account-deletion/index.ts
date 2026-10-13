// ============================================================
// request-account-deletion
//
// Step 1 of deleting an account (Settings > Account > Delete account).
// Emails the signed-in person a one-time link to /delete-account that
// expires in 24 hours. Nothing is deleted until they open it and confirm
// (see confirm-account-deletion).
//
// Refuses up front if deletion isn't allowed yet (the only owner of a team),
// so people find out now rather than after clicking the email.
//
// Needs NOTIFY_FROM on a domain verified in Resend, like the trial reminders.
// ============================================================

import { admin, json, requireEnv, serve, UserError } from "../_shared/billing.ts";
import { hasCustomerSender, sendEmail } from "../_shared/email.ts";
import { describePlan, getSignedInUser, hashToken, newToken, planDeletion } from "../_shared/account.ts";

/** Don't send another email if one went out this recently. */
const RESEND_COOLDOWN_MS = 60 * 1000;

serve(async (req) => {
  const user = await getSignedInUser(req);
  if (user.is_anonymous || !user.email) {
    throw new UserError("Demo accounts don't need deleting; they're removed automatically.");
  }
  if (!hasCustomerSender()) {
    console.error("request-account-deletion: NOTIFY_FROM is not set, so the confirmation email can't be sent.");
    throw new UserError("Account deletion isn't available right now. Please contact support.", 503);
  }

  const plan = await planDeletion(user.id);

  const { data: existing } = await admin
    .from("account_deletion_requests")
    .select("created_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing && Date.now() - new Date(existing.created_at).getTime() < RESEND_COOLDOWN_MS) {
    return json({ email: user.email });
  }

  // A new request replaces any earlier link.
  const token = newToken();
  const now = new Date();
  const { error } = await admin.from("account_deletion_requests").upsert({
    user_id: user.id,
    token_hash: await hashToken(token),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw error;

  const link = `${requireEnv("SITE_URL").replace(/\/$/, "")}/delete-account?token=${token}`;
  await sendEmail({
    to: [user.email],
    subject: "Confirm deleting your HumMotion account",
    text: [
      "We received a request to permanently delete your HumMotion account.",
      "",
      describePlan(plan),
      "",
      "To delete your account, open this link within 24 hours and confirm:",
      link,
      "",
      "If you didn't ask for this, ignore this email. Nothing will change, and we recommend changing your password.",
    ].join("\n"),
  });

  return json({ email: user.email });
});
