/**
 * Readable messages for failed saves and deletes.
 *
 * When the database's security rules reject a change (a viewer, or an
 * organization whose trial ended while the page was open), Supabase returns
 * "new row violates row-level security policy for table ...". That means
 * nothing to the people using the app, so it is replaced here.
 *
 * Note: a delete or update that security rules block often succeeds with
 * zero rows instead of failing. Pages hide those buttons when canEdit is
 * false (see useOrganization), which covers that case.
 */

const PERMISSION_MESSAGE =
  "You can't make changes right now. Your organization may be read-only, or you may have view-only access.";

export function friendlyWriteError(
  error: { message?: string; code?: string } | null | undefined,
  fallback = "Something went wrong. Please try again.",
): string {
  const message = error?.message ?? "";
  if (error?.code === "42501" || /row-level security|permission denied/i.test(message)) return PERMISSION_MESSAGE;
  return message || fallback;
}
