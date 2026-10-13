// ============================================================
// confirm-account-deletion
//
// Step 2 of deleting an account. The /delete-account page calls this with
// the token from the emailed link.
//
// Body: { token: string, confirm?: boolean }
//   - confirm missing/false: returns what will happen, so the page can show it.
//   - confirm true: deletes the account and emails a confirmation.
//
// Deploy with --no-verify-jwt: the link may be opened on a device where the
// person isn't signed in. The secret token is the proof; it works once and
// expires after 24 hours.
// ============================================================

import { admin, json, serve, UserError } from "../_shared/billing.ts";
import { sendEmail } from "../_shared/email.ts";
import { deleteAccount, describePlan, hashToken, planDeletion } from "../_shared/account.ts";

const INVALID_LINK = "This link isn't valid anymore. It may have been used already or replaced by a newer one.";

serve(async (req) => {
  const { token, confirm } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) throw new UserError(INVALID_LINK, 404);

  const { data: request, error } = await admin
    .from("account_deletion_requests")
    .select("user_id, expires_at")
    .eq("token_hash", await hashToken(token))
    .maybeSingle();
  if (error) throw error;
  if (!request) throw new UserError(INVALID_LINK, 404);
  if (new Date(request.expires_at).getTime() < Date.now()) {
    throw new UserError("This link has expired. Request a new one from Settings > Account.", 410);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(request.user_id);
  if (userError || !userData.user) throw new UserError(INVALID_LINK, 404);
  const email = userData.user.email ?? null;

  if (confirm !== true) {
    const plan = await planDeletion(request.user_id);
    return json({ email, summary: describePlan(plan) });
  }

  const plan = await deleteAccount(request.user_id);

  // The account is gone either way; a failed goodbye email shouldn't report failure.
  if (email) {
    try {
      await sendEmail({
        to: [email],
        subject: "Your HumMotion account has been deleted",
        text: [
          "Your HumMotion account has been permanently deleted.",
          "",
          plan.outcome === "delete-organization"
            ? `${plan.organizationName ?? "Your organization"} and its records were deleted, and any subscription was canceled.`
            : plan.outcome === "leave-organization"
              ? `You were removed from ${plan.organizationName ?? "your organization"}. Your team still has the records you created.`
              : "",
          "",
          "If you didn't do this, contact HumMotion support right away.",
        ].join("\n"),
      });
    } catch (err) {
      console.error("confirm-account-deletion: goodbye email failed", err);
    }
  }

  return json({ deleted: true });
});
