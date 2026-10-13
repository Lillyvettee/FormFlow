/**
 * ReadOnlyNotice
 *
 * One line near the top of a page telling viewers why there are no add,
 * edit or delete buttons. Pages hide those buttons when canEdit is false.
 *
 * Renders nothing for people who can edit, and nothing when the organization
 * is read-only because its trial ended (BillingBanner already says so on
 * every page).
 */

import { useOrganization } from "@/hooks/use-organization";
import { Eye } from "lucide-react";

export function ReadOnlyNotice() {
  const { canEdit, billing } = useOrganization();
  if (canEdit || !billing.hasAccess) return null;

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
      You have view-only access. Ask an owner or admin if you need to make changes.
    </p>
  );
}
