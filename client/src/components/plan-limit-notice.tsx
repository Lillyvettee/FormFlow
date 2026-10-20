/**
 * PlanLimitNotice
 *
 * One line near the top of the Forms, People and Team pages once the
 * organization has used most of a plan limit (lib/plans), e.g.
 * "45 of 50 active forms used on Starter. See plans".
 *
 * The page passes the count it already has loaded, so the line updates as
 * soon as something is added or removed. The database enforces the limit
 * regardless (migration 016); this is the early warning.
 *
 * Renders nothing on unlimited plans, below WARN_AT of the limit, or when
 * the organization is read-only (BillingBanner covers that).
 */

import { useOrganization } from "@/hooks/use-organization";
import { formatLimit, type PlanLimits } from "@/lib/plans";
import { AlertTriangle, Info } from "lucide-react";

/** Start warning at 80% of the limit. */
const WARN_AT = 0.8;

const LABELS: Record<Exclude<keyof PlanLimits, "reports">, { noun: string; full: string }> = {
  forms: { noun: "active forms", full: "Archive a form you no longer use, or upgrade to add more." },
  people: { noun: "client profiles", full: "Upgrade to add more people." },
  members: { noun: "team members and open invitations", full: "Revoke an invitation, or upgrade to add more people." },
};

export function PlanLimitNotice({ resource, used }: { resource: Exclude<keyof PlanLimits, "reports">; used: number }) {
  const { plan, billing, isAdmin } = useOrganization();
  const limit = plan.limits[resource];
  if (limit === null || !billing.hasAccess || used < limit * WARN_AT) return null;

  const full = used >= limit;
  const { noun, full: fullHint } = LABELS[resource];
  const Icon = full ? AlertTriangle : Info;

  return (
    <p
      role="status"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 py-2 text-sm ${
        full ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-muted text-muted-foreground"
      }`}
      data-testid={`notice-plan-limit-${resource}`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {full
          ? `You've used all ${formatLimit(limit)} ${noun} on the ${plan.name} plan. ${fullHint}`
          : `${used.toLocaleString("en-US")} of ${formatLimit(limit)} ${noun} used on the ${plan.name} plan.`}
      </span>
      {isAdmin ? (
        <a href="/settings#plan" className="font-medium underline hover:no-underline">
          See plans
        </a>
      ) : (
        full && <span>Ask an owner or admin about upgrading.</span>
      )}
    </p>
  );
}
