// ============================================================
// join-organization
//
// Accepts an invitation for someone who is the only member of their own
// organization (migration 018). Called from the invite page after they
// choose what happens to their records.
//
// Body: { token: string, mode: "move" | "discard" }
//   move     their records join the new team; the old, emptied
//            organization is removed
//   discard  the old organization and everything in it is deleted
//
// Order matters:
//   1. Check everything (join_details), including the new team's plan
//      limits for "move", so nothing is canceled for a join that would fail.
//   2. Cancel the old organization's Stripe subscription. Only this
//      function holds the Stripe key.
//   3. "discard": remove the old organization's stored files.
//   4. join_organization(): moves or deletes, and joins, in one transaction.
//
// Signed-in owners only (it's their own invitation); deploy normally, with
// JWT verification on.
// ============================================================

import { admin, json, serve, UserError } from "../_shared/billing.ts";
import { cancelOrganizationSubscription, getSignedInUser, removeOrganizationFiles } from "../_shared/account.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Database errors raised on purpose are written for people; pass them on. */
function asUserError(error: { message?: string; code?: string }): UserError | null {
  return error.code === "P0001" && error.message ? new UserError(error.message, 409) : null;
}

serve(async (req) => {
  const user = await getSignedInUser(req);
  if (user.is_anonymous) throw new UserError("Create an account to join a team.", 403);

  const { token, mode } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !UUID.test(token)) throw new UserError("This invitation link is not valid.");
  if (mode !== "move" && mode !== "discard") throw new UserError("Choose whether to bring your records or delete them.");

  // ----- 1. Check -----
  const { data: details, error: detailsError } = await admin.rpc("join_details", {
    p_user: user.id,
    p_email: user.email ?? "",
    p_token: token,
  });
  if (detailsError) throw asUserError(detailsError) ?? detailsError;

  const oldOrganization: string | null = details?.organization_id ?? null;
  if (oldOrganization) {
    if (details.other_members > 0) {
      throw new UserError(
        "Your current organization has other members. Make someone else an owner and leave it on the Team page first.",
        409,
      );
    }
    if (mode === "move" && details.move_problem) throw new UserError(details.move_problem, 409);

    // ----- 2. Stop charging the old organization -----
    await cancelOrganizationSubscription(oldOrganization);

    // ----- 3. Files of an organization being deleted -----
    if (mode === "discard") await removeOrganizationFiles(oldOrganization);
  }

  // ----- 4. Move or delete, and join -----
  const { data: organizationId, error } = await admin.rpc("join_organization", {
    p_user: user.id,
    p_email: user.email ?? "",
    p_display_name: (user.user_metadata?.full_name as string | undefined) ?? "",
    p_token: token,
    p_mode: mode,
  });
  if (error) throw asUserError(error) ?? error;

  return json({ organizationId });
});
