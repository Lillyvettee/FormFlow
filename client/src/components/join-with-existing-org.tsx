/**
 * JoinWithExistingOrg
 *
 * Shown on the invite page when the invited person already has their own
 * organization (everyone creates one at sign-up). See migration 018.
 *
 *   - Their organization has other members: explains they must hand over
 *     ownership and leave on the Team page first (the old rule).
 *   - They're its only member: lists what's in it and lets them choose to
 *     bring their records into the new team, or delete them, then join.
 *     Bringing records is unavailable if it would put the team over its
 *     plan limits; deleting needs a confirmation tick.
 *
 * Joining goes through the join-organization Edge Function, which also
 * cancels the old organization's subscription.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { callFunction } from "@/lib/functions";
import { AlertCircle } from "lucide-react";

/** get_join_options() in migration 018. */
interface JoinOptions {
  has_organization: boolean;
  organization_name?: string;
  role?: string;
  other_members?: number;
  subscribed?: boolean;
  records?: Record<string, number>;
  move_problem?: string | null;
}

type Mode = "move" | "discard";

const RECORD_LABELS: [key: string, one: string, many: string][] = [
  ["forms", "form", "forms"],
  ["responses", "form response", "form responses"],
  ["people", "client profile", "client profiles"],
  ["donations", "donation", "donations"],
  ["volunteer_hours", "volunteer hours entry", "volunteer hours entries"],
  ["inventory_items", "inventory item", "inventory items"],
  ["links", "link", "links"],
  ["media_items", "media file", "media files"],
];

export function JoinWithExistingOrg({
  token,
  teamName,
  onPlainJoin,
}: {
  token: string;
  teamName: string;
  /** They turn out to have no organization: use the normal accept. */
  onPlainJoin: () => void;
}) {
  const [options, setOptions] = useState<JoinOptions | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_join_options", { p_token: token }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setLoadError(error.message);
      else setOptions(data as JoinOptions);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {loadError}
      </p>
    );
  }
  if (!options) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (!options.has_organization) {
    return (
      <Button className="w-full" onClick={onPlainJoin}>
        Join {teamName}
      </Button>
    );
  }

  const oldName = options.organization_name || "your current organization";

  // ----- On a team: the old rule -----
  if ((options.other_members ?? 0) > 0) {
    return (
      <div className="space-y-3 text-left">
        <p className="text-sm text-muted-foreground">
          You're a member of <strong className="text-foreground">{oldName}</strong>, and you can only belong to one
          organization at a time. Its records stay with that team.
        </p>
        <p className="text-sm text-muted-foreground">
          {options.role === "owner"
            ? "Make someone else an owner, then choose Leave organization on the Team page. Come back to this link afterwards."
            : "Choose Leave organization on the Team page, then come back to this link."}
        </p>
        <Button asChild variant="outline" className="w-full">
          <a href="/team">Go to the Team page</a>
        </Button>
      </div>
    );
  }

  // ----- Only member: choose -----
  const records = RECORD_LABELS.map(([key, one, many]) => {
    const n = options.records?.[key] ?? 0;
    return n > 0 ? `${n.toLocaleString("en-US")} ${n === 1 ? one : many}` : null;
  }).filter(Boolean) as string[];
  const moveBlocked = Boolean(options.move_problem);
  const canJoin = mode === "move" ? !moveBlocked : mode === "discard" ? confirmDelete : false;

  const join = async () => {
    if (!mode || !canJoin) return;
    setIsJoining(true);
    setJoinError("");
    try {
      await callFunction("join-organization", { token, mode }, "Couldn't join the team. Try again.");
      window.location.replace("/");
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Couldn't join the team. Try again.");
      setIsJoining(false);
    }
  };

  const choice = (value: Mode, title: string, body: React.ReactNode, disabled = false) => (
    <label
      className={`flex gap-3 rounded-md border p-3 text-sm ${
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:border-primary/50"
      } ${mode === value ? "border-primary bg-primary/5" : ""}`}
    >
      <input
        type="radio"
        name="join-mode"
        value={value}
        checked={mode === value}
        disabled={disabled || isJoining}
        onChange={() => setMode(value)}
        className="mt-0.5 h-4 w-4 shrink-0"
      />
      <span className="space-y-1">
        <span className="block font-medium text-foreground">{title}</span>
        <span className="block text-muted-foreground">{body}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-4 text-left">
      <p className="text-sm text-muted-foreground">
        You already have your own organization, <strong className="text-foreground">{oldName}</strong>
        {records.length ? `, with ${records.join(", ")}` : ", with no records yet"}. You can only belong to one
        organization, so choose what happens to it.
      </p>

      <fieldset className="space-y-2">
        <legend className="sr-only">What happens to {oldName}</legend>
        {choice(
          "move",
          `Bring my records to ${teamName}`,
          moveBlocked ? (
            <span className="text-destructive">{options.move_problem}</span>
          ) : (
            `Everything you added moves into ${teamName}, where the whole team can see it. Sample data isn't brought over.`
          ),
          moveBlocked,
        )}
        {choice("discard", `Delete ${oldName}`, "Its records and files are deleted permanently.")}
      </fieldset>

      {mode === "discard" && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmDelete}
            onChange={(e) => setConfirmDelete(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span>
            I understand that {oldName} and everything in it will be deleted and can't be recovered.
          </span>
        </label>
      )}

      {options.subscribed && (
        <p className="text-sm text-muted-foreground">
          {oldName}'s subscription will be canceled right away. Refunds follow our{" "}
          <a href="/refunds" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            Refund policy
          </a>
          .
        </p>
      )}

      {joinError && (
        <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{joinError}</span>
        </div>
      )}

      <Button
        className="w-full"
        variant={mode === "discard" ? "destructive" : "default"}
        onClick={join}
        disabled={!canJoin || isJoining}
      >
        {isJoining ? "Joining..." : mode === "discard" ? `Delete ${oldName} and join` : `Join ${teamName}`}
      </Button>
    </div>
  );
}
