/**
 * TeamPage
 *
 * Manage who can access the organization. Place at: client/src/pages/team.tsx
 * Route: /team (inside OrganizationGate).
 *
 * Everyone sees:   the organization name, the member list, role descriptions,
 *                  and a "Leave organization" option.
 * Admins/owners:   rename the organization, invite people, change roles,
 *                  remove members, and copy or revoke pending invite links.
 *
 * Invitations are links. The app does not send email itself, so after
 * creating an invite, copy the link and send it however you like (email,
 * text, Slack). The link only works for the email address it was created for
 * and expires after 14 days.
 *
 * All permission rules are enforced in the database (see the migration).
 * The checks here only decide which controls to show.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { PlanLimitNotice } from "@/components/plan-limit-notice";
import { useOrganization, ROLE_LABELS, ROLE_DESCRIPTIONS, type OrgRole } from "@/hooks/use-organization";
import { Users, UserPlus, Copy, Trash2, Link2, Building2, LogOut, Check } from "lucide-react";

// ===========================================================================
// Types and helpers
// ===========================================================================

interface Member {
  user_id: string;
  role: OrgRole;
  email: string | null;
  display_name: string | null;
  joined_at: string;
}

interface Invitation {
  id: string;
  email: string;
  role: Exclude<OrgRole, "owner">;
  token: string;
  created_at: string;
  expires_at: string;
}

/** What a confirmation dialog should say and do. */
interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

/** Roles in display order. */
const ROLE_ORDER: OrgRole[] = ["owner", "admin", "member", "viewer"];

/** Roles that can be given in an invitation (owners are promoted afterwards). */
const INVITE_ROLES: Exclude<OrgRole, "owner">[] = ["admin", "member", "viewer"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Full invite URL for a token. */
const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Readable message from a Supabase error or anything thrown. */
const errorMessage = (e: unknown, fallback: string): string =>
  e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
    ? (e as { message: string }).message
    : fallback;

// ===========================================================================
// Page
// ===========================================================================

export default function TeamPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { organization, role: myRole, isAdmin, isOwner, refresh } = useOrganization();

  // ----- Data -----
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // ----- Organization name -----
  const [orgName, setOrgName] = useState(organization?.name ?? "");
  const [isRenaming, setIsRenaming] = useState(false);

  // ----- Invite form -----
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<OrgRole, "owner">>("member");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  /** The link just created, shown prominently so it can be copied right away. */
  const [newInviteLink, setNewInviteLink] = useState<{ email: string; url: string } | null>(null);

  // ----- Row actions -----
  /** user_id whose role is being saved, to disable that row's control meanwhile. */
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  /** Briefly shows "Copied" on the button that was clicked. */
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => setOrgName(organization?.name ?? ""), [organization?.name]);

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Load members, and pending invitations for admins.
   * Security rules limit both to the user's organization.
   */
  const load = useCallback(async () => {
    setLoadError("");
    try {
      const membersReq = supabase
        .from("organization_members")
        .select("user_id, role, email, display_name, joined_at")
        .order("joined_at", { ascending: true });

      const invitesReq = isAdmin
        ? supabase
            .from("organization_invitations")
            .select("id, email, role, token, created_at, expires_at")
            .is("accepted_at", null)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as Invitation[], error: null });

      const [membersRes, invitesRes] = await Promise.all([membersReq, invitesReq]);
      if (membersRes.error) throw membersRes.error;
      if (invitesRes.error) throw invitesRes.error;

      // Sort by role (owners first), then name.
      const sortedMembers = ((membersRes.data as Member[]) ?? []).sort(
        (a, b) =>
          ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
          (a.display_name || a.email || "").localeCompare(b.display_name || b.email || ""),
      );
      setMembers(sortedMembers);
      setInvitations((invitesRes.data as Invitation[]) ?? []);
    } catch (e) {
      setLoadError(errorMessage(e, "Couldn't load your team."));
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  // -------------------------------------------------------------------------
  // Permission helpers (UI only; the database enforces the same rules)
  // -------------------------------------------------------------------------

  /** Whether I can change this person's role. Nobody changes their own role. */
  const canChangeRole = (m: Member) => isAdmin && m.user_id !== user?.id && (m.role !== "owner" || isOwner);

  /** Roles I can assign: only owners can create owners. */
  const assignableRoles: OrgRole[] = isOwner ? ROLE_ORDER : ROLE_ORDER.filter((r) => r !== "owner");

  const ownerCount = members.filter((m) => m.role === "owner").length;

  // -------------------------------------------------------------------------
  // Copy to clipboard
  // -------------------------------------------------------------------------

  /** Copy text and flash "Copied" on the button identified by key. Falls back to showing the link. */
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      toast({ title: "Couldn't copy automatically", description: text });
    }
  };

  // -------------------------------------------------------------------------
  // Rename organization
  // -------------------------------------------------------------------------

  const renameOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = orgName.trim();
    if (!organization || !name || name === organization.name || isRenaming) return;
    setIsRenaming(true);
    try {
      const { error } = await supabase.from("organizations").update({ name }).eq("id", organization.id);
      if (error) throw error;
      await refresh();
      toast({ title: "Organization renamed" });
    } catch (err) {
      toast({ title: "Couldn't rename", description: errorMessage(err, "Try again."), variant: "destructive" });
    } finally {
      setIsRenaming(false);
    }
  };

  // -------------------------------------------------------------------------
  // Invitations
  // -------------------------------------------------------------------------

  /** Create an invitation and show its link. Replaces any open invite for the same email. */
  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) {
      setInviteError("Enter a valid email address.");
      return;
    }
    setIsInviting(true);
    setInviteError("");
    try {
      const { data: token, error } = await supabase.rpc("create_invitation", { p_email: email, p_role: inviteRole });
      if (error) throw error;
      setNewInviteLink({ email, url: inviteUrl(token as string) });
      setInviteEmail("");
      await load();
    } catch (err) {
      setInviteError(errorMessage(err, "Couldn't create the invitation."));
    } finally {
      setIsInviting(false);
    }
  };

  const requestRevoke = (inv: Invitation) =>
    setConfirmState({
      title: "Revoke this invitation?",
      description: `The link sent to ${inv.email} will stop working.`,
      confirmLabel: "Revoke invitation",
      onConfirm: async () => {
        const { error } = await supabase.from("organization_invitations").delete().eq("id", inv.id);
        if (error) throw error;
        if (newInviteLink?.email === inv.email) setNewInviteLink(null);
        toast({ title: "Invitation revoked" });
        await load();
      },
    });

  // -------------------------------------------------------------------------
  // Members
  // -------------------------------------------------------------------------

  /** Change a member's role; the list updates right away and reloads to confirm. */
  const changeRole = async (m: Member, newRole: OrgRole) => {
    if (newRole === m.role) return;
    setUpdatingUserId(m.user_id);
    try {
      const { error } = await supabase.rpc("update_member_role", { p_user_id: m.user_id, p_role: newRole });
      if (error) throw error;
      toast({ title: `${m.display_name || m.email} is now ${ROLE_LABELS[newRole].toLowerCase()}` });
      await load();
    } catch (err) {
      toast({ title: "Couldn't change role", description: errorMessage(err, "Try again."), variant: "destructive" });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const requestRemove = (m: Member) =>
    setConfirmState({
      title: `Remove ${m.display_name || m.email}?`,
      description:
        "They will lose access right away. Records they created stay with your organization. You can invite them again later.",
      confirmLabel: "Remove from team",
      onConfirm: async () => {
        const { error } = await supabase.rpc("remove_member", { p_user_id: m.user_id });
        if (error) throw error;
        toast({ title: "Removed from team" });
        await load();
      },
    });

  /** Leave the organization, then reload so the gate shows the setup screen. */
  const requestLeave = () =>
    setConfirmState({
      title: `Leave ${organization?.name ?? "this organization"}?`,
      description: "You will lose access to its records. To come back, someone will need to invite you again.",
      confirmLabel: "Leave organization",
      onConfirm: async () => {
        const { error } = await supabase.rpc("leave_organization");
        if (error) throw error;
        await refresh();
        window.location.href = "/";
      },
    });

  /** Run the pending confirmation; keeps the dialog open with an error toast if it fails. */
  const runConfirm = async (e: React.MouseEvent) => {
    e.preventDefault(); // keep the dialog open until finished
    if (!confirmState) return;
    setIsConfirming(true);
    try {
      await confirmState.onConfirm();
      setConfirmState(null);
    } catch (err) {
      toast({ title: "Something went wrong", description: errorMessage(err, "Try again."), variant: "destructive" });
    } finally {
      setIsConfirming(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* ===== Header ===== */}
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold">Team</h1>
        <p className="text-muted-foreground">
          Everyone on your team shares the same forms, donations, volunteer hours and other records.
        </p>
      </div>

      {/* Open invitations count too, so only admins (who can see them) get the warning. */}
      {isAdmin && !isLoading && (
        <PlanLimitNotice
          resource="members"
          used={members.length + invitations.filter((inv) => new Date(inv.expires_at) > new Date()).length}
        />
      )}

      {loadError && (
        <Card role="alert" className="p-4 flex items-center justify-between gap-4 border-destructive/50">
          <span className="text-sm">{loadError}</span>
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </Card>
      )}

      {/* ===== Organization name ===== */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="font-semibold text-lg">Organization</h2>
        </div>
        {isAdmin ? (
          <form onSubmit={renameOrganization} className="flex flex-wrap items-end gap-3">
            <div className="space-y-2 flex-1 min-w-[200px]">
              <Label htmlFor="team-org-name">Name</Label>
              <Input id="team-org-name" value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={150} />
            </div>
            <Button type="submit" disabled={!orgName.trim() || orgName.trim() === organization?.name || isRenaming}>
              {isRenaming ? "Saving..." : "Save name"}
            </Button>
          </form>
        ) : (
          <p className="font-medium">{organization?.name}</p>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          Your role: <span className="font-medium text-foreground">{myRole ? ROLE_LABELS[myRole] : "-"}</span>
        </p>
      </Card>

      {/* ===== Invite (admins only) ===== */}
      {isAdmin && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <UserPlus className="h-5 w-5 text-primary" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-lg">Invite someone</h2>
              <p className="text-sm text-muted-foreground">
                You'll get a link to send them. It only works for that email address and expires in 14 days.
              </p>
            </div>
          </div>

          <form onSubmit={createInvite} className="flex flex-wrap items-end gap-3" noValidate>
            <div className="space-y-2 flex-1 min-w-[220px]">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                inputMode="email"
                placeholder="name@organization.org"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  setInviteError("");
                }}
                aria-invalid={Boolean(inviteError)}
                aria-describedby={inviteError ? "invite-error" : "invite-role-help"}
              />
            </div>
            <div className="space-y-2 w-40">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Exclude<OrgRole, "owner">)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!inviteEmail.trim() || isInviting}>
              {isInviting ? "Creating..." : "Create invite link"}
            </Button>
          </form>
          <p id="invite-role-help" className="text-xs text-muted-foreground">
            {ROLE_DESCRIPTIONS[inviteRole]}
          </p>
          {inviteError && (
            <p id="invite-error" role="alert" className="text-sm text-destructive">
              {inviteError}
            </p>
          )}

          {/* The link just created, ready to copy. */}
          {newInviteLink && (
            <div role="status" className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-2">
              <p className="text-sm font-medium">Invite link for {newInviteLink.email}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={newInviteLink.url} readOnly className="flex-1 min-w-[220px] font-mono text-xs" aria-label="Invite link" onFocus={(e) => e.target.select()} />
                <Button type="button" onClick={() => copy(newInviteLink.url, "new")}>
                  {copiedKey === "new" ? (
                    <>
                      <Check className="mr-1 h-4 w-4" aria-hidden="true" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1 h-4 w-4" aria-hidden="true" /> Copy link
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Send this to them by email or text. They'll sign up or sign in, then join automatically.</p>
            </div>
          )}
        </Card>
      )}

      {/* ===== Members ===== */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 p-6 pb-4">
          <Users className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="font-semibold text-lg">
            Members {!isLoading && <span className="text-muted-foreground font-normal">({members.length})</span>}
          </h2>
        </div>

        {isLoading ? (
          <div className="px-6 pb-6 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  {isAdmin && <TableHead className="w-16">
                    <span className="sr-only">Actions</span>
                  </TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const isMe = m.user_id === user?.id;
                  const name = m.display_name || m.email || "Unknown";
                  return (
                    <TableRow key={m.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{name}</span>
                          {isMe && <Badge variant="secondary">You</Badge>}
                        </div>
                        {m.display_name && m.email && <p className="text-xs text-muted-foreground">{m.email}</p>}
                      </TableCell>
                      <TableCell>
                        {canChangeRole(m) ? (
                          <Select
                            value={m.role}
                            onValueChange={(v) => changeRole(m, v as OrgRole)}
                            disabled={updatingUserId === m.user_id}
                          >
                            <SelectTrigger className="w-32 h-8" aria-label={`Role for ${name}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {assignableRoles.map((r) => (
                                <SelectItem
                                  key={r}
                                  value={r}
                                  // The last owner cannot be demoted.
                                  disabled={m.role === "owner" && r !== "owner" && ownerCount <= 1}
                                >
                                  {ROLE_LABELS[r]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant={m.role === "owner" ? "default" : "outline"}>{ROLE_LABELS[m.role]}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {formatDate(m.joined_at)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          {!isMe && (m.role !== "owner" || isOwner) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => requestRemove(m)}
                              aria-label={`Remove ${name} from team`}
                              title="Remove from team"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* ===== Pending invitations (admins only) ===== */}
      {isAdmin && invitations.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 p-6 pb-4">
            <Link2 className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="font-semibold text-lg">Pending invitations</h2>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => {
                  const expired = new Date(inv.expires_at) < new Date();
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium break-all">{inv.email}</TableCell>
                      <TableCell>{ROLE_LABELS[inv.role]}</TableCell>
                      <TableCell className="text-sm">
                        {expired ? (
                          <span className="text-destructive">Expired</span>
                        ) : (
                          <span className="text-muted-foreground">Expires {formatDate(inv.expires_at)}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {!expired && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copy(inviteUrl(inv.token), inv.id)}
                              aria-label={`Copy invite link for ${inv.email}`}
                              title="Copy link"
                            >
                              {copiedKey === inv.id ? (
                                <Check className="h-4 w-4 text-chart-2" aria-hidden="true" />
                              ) : (
                                <Copy className="h-4 w-4" aria-hidden="true" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => requestRevoke(inv)}
                            aria-label={`Revoke invitation for ${inv.email}`}
                            title={expired ? "Remove" : "Revoke"}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="px-6 py-3 text-xs text-muted-foreground border-t">
            To resend an expired invitation, create a new one for the same email.
          </p>
        </Card>
      )}

      {/* ===== Role guide ===== */}
      <Card className="p-6">
        <h2 className="font-semibold mb-3">What each role can do</h2>
        <dl className="grid sm:grid-cols-2 gap-3">
          {ROLE_ORDER.map((r) => (
            <div key={r} className="rounded-md border p-3">
              <dt className="font-medium text-sm">{ROLE_LABELS[r]}</dt>
              <dd className="text-xs text-muted-foreground mt-0.5">{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* ===== Leave ===== */}
      <div className="flex justify-end">
        <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={requestLeave}>
          <LogOut className="mr-1 h-4 w-4" aria-hidden="true" /> Leave organization
        </Button>
      </div>

      {/* ===== Shared confirmation dialog ===== */}
      <AlertDialog
        open={confirmState !== null}
        onOpenChange={(open) => {
          if (!open && !isConfirming) setConfirmState(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmState?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConfirming}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runConfirm}
              disabled={isConfirming}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isConfirming ? "Working..." : confirmState?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
