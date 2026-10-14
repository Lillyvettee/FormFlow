/**
 * PersonHistory
 *
 * For owners and admins: who added, changed or deleted this person's record,
 * help given and case notes, and when (activity_log, migration 015). It
 * names the fields that changed, not their contents.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useOrganization } from "@/hooks/use-organization";
import { supabase } from "@/lib/supabase";
import { History } from "lucide-react";

interface Entry {
  id: number;
  actor_name: string | null;
  action: "created" | "changed" | "deleted";
  record_type: "person" | "help given" | "case note";
  summary: string | null;
  changed_fields: string[] | null;
  created_at: string;
}

const FIELD_NAMES: Record<string, string> = {
  full_name: "name",
  first_name: "first name",
  last_name: "last name",
  start_date: "start date",
  service_type: "type",
  inventory_item_id: "inventory item",
  body: "text",
  custom: "custom fields",
};

const PAGE = 20;

const describe = (e: Entry): string => {
  const what = e.record_type === "person" ? "the record" : e.record_type === "help given" ? `help given (${e.summary ?? ""})` : "a case note";
  if (e.action === "changed") {
    const fields = (e.changed_fields ?? []).map((f) => FIELD_NAMES[f] ?? f.replace(/_/g, " "));
    return `changed ${what}${fields.length ? `: ${fields.join(", ")}` : ""}`;
  }
  return `${e.action === "created" ? "added" : "deleted"} ${what}`;
};

export function PersonHistory({ personId }: { personId: string }) {
  const { isAdmin } = useOrganization();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    supabase
      .from("activity_log")
      .select("id, actor_name, action, record_type, summary, changed_fields, created_at")
      .eq("person_id", personId)
      .order("created_at", { ascending: false })
      .limit(limit + 1)
      .then(({ data, error }) => {
        if (cancelled) return;
        // Before migration 015 there's no history yet; show nothing.
        if (error) {
          setEntries([]);
          return;
        }
        setEntries((data ?? []).slice(0, limit));
        setHasMore((data ?? []).length > limit);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, personId, limit]);

  if (!isAdmin || entries === null || entries.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="font-semibold flex items-center gap-2">
        <History className="h-4 w-4 text-primary" aria-hidden="true" /> History
        <span className="text-xs font-normal text-muted-foreground">Visible to owners and admins</span>
      </h2>
      <Card className="p-4">
        <ul className="space-y-2 text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
              <span>
                <strong>{e.actor_name || "Someone no longer on the team"}</strong> {describe(e)}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(e.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </li>
          ))}
        </ul>
        {hasMore && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit((l) => l + PAGE)}>
            Show more
          </Button>
        )}
      </Card>
    </div>
  );
}
