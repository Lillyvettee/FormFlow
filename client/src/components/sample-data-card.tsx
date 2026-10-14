/**
 * SampleDataCard
 *
 * Lets an owner or admin try the app with a sample food bank's records
 * (load_sample_data, migration 008) and remove them again with one click
 * (clear_sample_data). Sample records are flagged in the database, so
 * clearing never touches anything the team added themselves.
 *
 * Shows on the dashboard:
 *   - an offer to load sample data while the organization is empty
 *   - a reminder with a "Clear sample data" button while sample records exist
 *   - nothing otherwise, and nothing for members and viewers
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Sparkles, Info } from "lucide-react";

type Status = "empty" | "sample" | "none";

/** onChanged: called after sample data is added or removed, so the page can reload its numbers. */
export function SampleDataCard({ onChanged }: { onChanged: () => void }) {
  const { isAdmin, canEdit } = useOrganization();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    supabase.rpc("sample_data_status").then(({ data }) => {
      if (!cancelled && typeof data === "string") setStatus(data as Status);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const run = async (fn: "load_sample_data" | "clear_sample_data") => {
    setIsWorking(true);
    try {
      const { error } = await supabase.rpc(fn);
      if (error) throw error;
      // Ask again rather than assume: someone else may have added records meanwhile.
      const { data } = await supabase.rpc("sample_data_status");
      setStatus(typeof data === "string" ? (data as Status) : "none");
      onChanged();
      toast({
        title: fn === "load_sample_data" ? "Sample data added" : "Sample data removed",
        description:
          fn === "load_sample_data"
            ? "Explore the forms, donations, volunteer hours and inventory. Clear it any time from the dashboard."
            : "Your organization is ready for real records.",
      });
    } catch (err) {
      toast({
        title: fn === "load_sample_data" ? "Couldn't add sample data" : "Couldn't remove sample data",
        description: err && typeof err === "object" && "message" in err ? String(err.message) : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsWorking(false);
    }
  };

  if (!isAdmin || status === null || status === "none") return null;

  if (status === "empty") {
    // Read-only organizations can't add records, sample or otherwise.
    if (!canEdit) return null;
    return (
      <Card className="p-5 flex flex-wrap items-center justify-between gap-4 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-3 min-w-0">
          <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Want to see HumMotion in action first?</p>
            <p className="text-sm text-muted-foreground">
              Load a sample food bank's forms, responses, donations, volunteer hours and inventory. You can remove it
              all with one click when you're ready to start.
            </p>
          </div>
        </div>
        <Button onClick={() => run("load_sample_data")} disabled={isWorking}>
          {isWorking ? "Adding..." : "Load sample data"}
        </Button>
      </Card>
    );
  }

  return (
    <Card role="status" className="p-4 flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary/5">
      <p className="flex items-center gap-2 text-sm">
        <Info className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        You're looking at sample data. Clear it before adding your own records so your reports stay accurate.
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={isWorking}>
            {isWorking ? "Removing..." : "Clear sample data"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove sample data?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the sample forms and their responses, donations, volunteer hours, inventory and links.
              Anything your team added stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run("clear_sample_data")}>Remove sample data</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
