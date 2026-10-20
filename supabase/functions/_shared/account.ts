// ============================================================
// Account deletion, shared by request-account-deletion and
// confirm-account-deletion.
//
// What deleting an account does depends on the person's organization:
//   - Only member:  the whole organization goes too (its records, files and
//                   any Stripe subscription, which is canceled right away).
//   - On a team:    they leave the team; records they created stay with it
//                   (migration 007 keeps those rows when the user is deleted).
//   - Only owner of a team with other members: refused until they make
//                   someone else an owner, so the team isn't left unmanaged.
// ============================================================

import { admin, stripe, UserError } from "./billing.ts";

export type DeletionOutcome = "delete-organization" | "leave-organization" | "no-organization";

export interface DeletionPlan {
  outcome: DeletionOutcome;
  organizationId: string | null;
  organizationName: string | null;
}

const SUBSCRIBED_STATUSES = ["active", "trialing", "past_due"];
const MEDIA_BUCKET = "media";

/** The signed-in, non-demo user making the request. */
export async function getSignedInUser(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new UserError("Please sign in again.", 401);
  return data.user;
}

/** Works out what deleting this user would do. Throws a UserError if it isn't allowed yet. */
export async function planDeletion(userId: string): Promise<DeletionPlan> {
  const { data: membership, error } = await admin
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!membership) return { outcome: "no-organization", organizationId: null, organizationName: null };

  const org = membership.organizations as { name: string } | { name: string }[] | null;
  const organizationName = (Array.isArray(org) ? org[0]?.name : org?.name) ?? null;

  const { data: members, error: membersError } = await admin
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", membership.organization_id);
  if (membersError) throw membersError;

  const others = (members ?? []).filter((m) => m.user_id !== userId);
  if (others.length === 0) {
    return { outcome: "delete-organization", organizationId: membership.organization_id, organizationName };
  }
  if (membership.role === "owner" && !others.some((m) => m.role === "owner")) {
    throw new UserError(
      "You're the only owner of your team. Make someone else an owner on the Team page before deleting your account.",
      409,
    );
  }
  return { outcome: "leave-organization", organizationId: membership.organization_id, organizationName };
}

/** Plain-language summary of a plan, for emails and the confirmation page. */
export function describePlan(plan: DeletionPlan): string {
  if (plan.outcome === "delete-organization") {
    return `You're the only member of ${plan.organizationName ?? "your organization"}, so it will be deleted too, with all of its forms, responses, donations, volunteer hours, inventory, links and files. Any subscription will be canceled.`;
  }
  if (plan.outcome === "leave-organization") {
    return `You'll be removed from ${plan.organizationName ?? "your organization"}. The records you created stay with your team.`;
  }
  return "Your sign-in and profile will be removed.";
}

/** Deletes the account, re-checking the rules first in case the team changed since the email. */
export async function deleteAccount(userId: string): Promise<DeletionPlan> {
  const plan = await planDeletion(userId);

  if (plan.outcome === "delete-organization" && plan.organizationId) {
    await deleteOrganization(plan.organizationId);
  }

  // Removes the profile and team membership too (they cascade from auth.users).
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
  return plan;
}

/** Cancels billing, removes stored files, then deletes the organization and everything in it. */
async function deleteOrganization(organizationId: string) {
  // 1. Stop charging first. If Stripe fails, nothing has been deleted yet.
  await cancelOrganizationSubscription(organizationId);
  // 2. Files: media library uploads and files attached to form responses.
  await removeOrganizationFiles(organizationId);
  // 3. The organization. Every data table cascades from it.
  const { error } = await admin.from("organizations").delete().eq("id", organizationId);
  if (error) throw error;
}

/** Cancels the organization's Stripe subscription right away, if it has a working one. */
export async function cancelOrganizationSubscription(organizationId: string) {
  const { data: billing } = await admin
    .from("organization_billing")
    .select("stripe_subscription_id, status")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (billing?.stripe_subscription_id && SUBSCRIBED_STATUSES.includes(billing.status)) {
    await stripe.subscriptions.cancel(billing.stripe_subscription_id);
  }
}

/**
 * Removes the organization's media library uploads and files attached to
 * form responses. A failure leaves orphaned files but doesn't throw, so it
 * never blocks what the person asked for.
 */
export async function removeOrganizationFiles(organizationId: string) {
  const paths: string[] = [];
  const { data: media } = await admin.from("media_items").select("file_url").eq("organization_id", organizationId);
  for (const item of media ?? []) {
    const path = item.file_url?.split(`/${MEDIA_BUCKET}/`)[1];
    if (path) paths.push(decodeURIComponent(path));
  }
  const { data: forms } = await admin.from("forms").select("id").eq("organization_id", organizationId);
  for (const form of forms ?? []) {
    const { data: files } = await admin.storage.from(MEDIA_BUCKET).list(`public/${form.id}`, { limit: 1000 });
    for (const file of files ?? []) paths.push(`public/${form.id}/${file.name}`);
  }
  // Storage accepts up to 1000 paths per call.
  for (let i = 0; i < paths.length; i += 1000) {
    const { error } = await admin.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + 1000));
    if (error) console.error("couldn't remove some organization files", error);
  }
}

// ------------------------------------------------------------
// Tokens for the emailed link. Only the hash is stored.
// ------------------------------------------------------------

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
