/**
 * AdminInboxPage
 *
 * Route: /admin. HumMotion staff only (is_staff(), migration 017).
 * Two tabs: Enterprise requests (from /enterprise) and Feedback (from
 * /feedback), newest first. Each item can be marked handled, which hides it
 * unless "Show handled" is on.
 *
 * Everyone else sees "not found", and the database refuses to return the
 * rows to them anyway.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useIsStaff } from "@/hooks/use-is-staff";
import { supabase } from "@/lib/supabase";
import NotFound from "@/pages/not-found";
import { Inbox, Building2, MessageSquare, Check, RotateCcw, Mail } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Kind = "enterprise" | "feedback";

interface EnterpriseInquiry {
  id: string;
  full_name: string;
  organization_name: string;
  email: string;
  work_email: string;
  department: string;
  organization_size: string;
  work_goal: string;
  enterprise_needs: string;
  created_at: string;
  resolved_at: string | null;
}

interface FeedbackItem {
  id: string | number;
  email: string | null;
  type: string | null;
  subject: string | null;
  message: string | null;
  created_at: string;
  resolved_at: string | null;
}

const FEEDBACK_LABELS: Record<string, string> = {
  bug: "Bug",
  feedback: "Feedback",
  feature: "Feature request",
  other: "Other",
};

/** Newest first; enough for an inbox. Older items are in the Supabase table. */
const PAGE_SIZE = 200;

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminInboxPage() {
  const { isStaff, isLoading: staffLoading } = useIsStaff();
  const { toast } = useToast();
  const [tab, setTab] = useState<Kind>("enterprise");
  const [showHandled, setShowHandled] = useState(false);
  const [inquiries, setInquiries] = useState<EnterpriseInquiry[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  /** Id of the item being marked, so its button can show progress. */
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Inbox - HumMotion";
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const [inq, fb] = await Promise.all([
        supabase.from("enterprise_inquiries").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE),
        supabase
          .from("feedback")
          .select("id, email, type, subject, message, created_at, resolved_at")
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE),
      ]);
      if (inq.error) throw inq.error;
      if (fb.error) throw fb.error;
      setInquiries((inq.data as EnterpriseInquiry[]) ?? []);
      setFeedback((fb.data as FeedbackItem[]) ?? []);
    } catch (err) {
      setLoadError(err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "Couldn't load the inbox.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isStaff) load();
  }, [isStaff, load]);

  const setResolved = async (kind: Kind, id: string | number, resolved: boolean) => {
    const key = `${kind}:${id}`;
    setPendingId(key);
    const { error } = await supabase.rpc("set_inbox_resolved", { p_kind: kind, p_id: String(id), p_resolved: resolved });
    setPendingId(null);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
      return;
    }
    const resolved_at = resolved ? new Date().toISOString() : null;
    if (kind === "enterprise") setInquiries((list) => list.map((i) => (i.id === id ? { ...i, resolved_at } : i)));
    else setFeedback((list) => list.map((f) => (f.id === id ? { ...f, resolved_at } : f)));
  };

  if (staffLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!isStaff) return <NotFound />;

  const openInquiries = inquiries.filter((i) => !i.resolved_at).length;
  const openFeedback = feedback.filter((f) => !f.resolved_at).length;
  const shownInquiries = showHandled ? inquiries : inquiries.filter((i) => !i.resolved_at);
  const shownFeedback = showHandled ? feedback : feedback.filter((f) => !f.resolved_at);

  /** Mark handled / Reopen button. */
  const resolveButton = (kind: Kind, id: string | number, resolvedAt: string | null) => (
    <Button
      variant="outline"
      size="sm"
      disabled={pendingId === `${kind}:${id}`}
      onClick={() => setResolved(kind, id, !resolvedAt)}
    >
      {resolvedAt ? (
        <>
          <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Reopen
        </>
      ) : (
        <>
          <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Mark handled
        </>
      )}
    </Button>
  );

  const tabButton = (kind: Kind, label: string, Icon: typeof Inbox, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === kind}
      onClick={() => setTab(kind)}
      className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        tab === kind ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
      {count > 0 && <Badge variant="secondary">{count}</Badge>}
    </button>
  );

  const empty = (text: string) => <Card className="p-8 text-center text-sm text-muted-foreground">{text}</Card>;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Inbox</h1>
          <p className="text-muted-foreground">Enterprise requests and feedback sent to HumMotion. Only staff can see this page.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} className="h-4 w-4" />
          Show handled
        </label>
      </div>

      <div role="tablist" aria-label="Inbox" className="flex gap-2 border-b">
        {tabButton("enterprise", "Enterprise requests", Building2, openInquiries)}
        {tabButton("feedback", "Feedback", MessageSquare, openFeedback)}
      </div>

      {loadError ? (
        <Card role="alert" className="p-4 flex items-center justify-between gap-4 border-destructive/50">
          <span className="text-sm">Couldn't load the inbox: {loadError}</span>
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </Card>
      ) : isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : tab === "enterprise" ? (
        shownInquiries.length === 0 ? (
          empty(showHandled ? "No Enterprise requests yet." : "No open Enterprise requests.")
        ) : (
          <ul className="space-y-3">
            {shownInquiries.map((i) => (
              <li key={i.id}>
                <Card className={`p-5 space-y-3 ${i.resolved_at ? "opacity-70" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">{i.organization_name}</h2>
                      <p className="text-sm text-muted-foreground">
                        {i.full_name} · {i.department} · {i.organization_size} people · {formatDateTime(i.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`mailto:${i.work_email}?subject=${encodeURIComponent("HumMotion Enterprise")}`}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Reply
                      </a>
                      {resolveButton("enterprise", i.id, i.resolved_at)}
                    </div>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Work email</dt>
                      <dd className="break-all">{i.work_email}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Email</dt>
                      <dd className="break-all">{i.email}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground">Work goal</dt>
                      <dd className="whitespace-pre-wrap">{i.work_goal}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground">Enterprise-specific needs</dt>
                      <dd className="whitespace-pre-wrap">{i.enterprise_needs}</dd>
                    </div>
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : shownFeedback.length === 0 ? (
        empty(showHandled ? "No feedback yet." : "No open feedback.")
      ) : (
        <ul className="space-y-3">
          {shownFeedback.map((f) => (
            <li key={String(f.id)}>
              <Card className={`p-5 space-y-2 ${f.resolved_at ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{f.subject || "(No subject)"}</h2>
                      {f.type && <Badge variant="outline">{FEEDBACK_LABELS[f.type] ?? f.type}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {f.email ?? "No email"} · {formatDateTime(f.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.email && (
                      <a
                        href={`mailto:${f.email}?subject=${encodeURIComponent(`Re: ${f.subject ?? "Your feedback"}`)}`}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" /> Reply
                      </a>
                    )}
                    {resolveButton("feedback", f.id, f.resolved_at)}
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap">{f.message}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
