/**
 * BulkCardsDialog
 *
 * "ID cards" on the People page (migration 022, Mission and Enterprise):
 * make cards for everyone who doesn't have one yet, choosing the form their
 * cards open, and print every card at once (/print/cards?all=1).
 * Each person's own page can still change their card's form.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/use-organization";
import { useCardPrefix } from "@/hooks/use-card-prefix";
import { CardDesignDialog } from "@/components/people/card-design-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Palette, Printer } from "lucide-react";
import type { Person } from "@/types/database";

const PROFILE = "__profile__";

export function BulkCardsDialog({ people, onClose, onIssued }: { people: Person[]; onClose: () => void; onIssued: () => void }) {
  const { canEdit, isAdmin } = useOrganization();
  const { toast } = useToast();
  const { prefix, design, saveDesign } = useCardPrefix();
  const [designing, setDesigning] = useState(false);
  const [forms, setForms] = useState<{ id: string; title: string }[]>([]);
  const [formId, setFormId] = useState(PROFILE);
  const [isSaving, setIsSaving] = useState(false);

  const without = people.filter((p) => p.card_number == null);
  const withCard = people.length - without.length;

  useEffect(() => {
    supabase
      .from("forms")
      .select("id, title")
      .eq("is_published", true)
      .eq("is_archived", false)
      .eq("is_sample", false)
      .order("title")
      .then(({ data }) => setForms(data ?? []));
  }, []);

  const issue = async () => {
    setIsSaving(true);
    const { data, error } = await supabase.rpc("issue_person_cards", {
      p_person_ids: without.map((p) => p.id),
      p_form_id: formId === PROFILE ? null : formId,
    });
    setIsSaving(false);
    if (error) {
      toast({ title: "Couldn't make the cards", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${data ?? without.length} cards made`, description: "You can print them now." });
    onIssued();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ID cards</DialogTitle>
          <DialogDescription>
            Cards are ID-badge size with a QR code. Scanning one with the Scan page (or a phone camera, while signed in) opens the
            form you choose, already linked to that person.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm">
            {withCard} of {people.length} {people.length === 1 ? "person has" : "people have"} a card.
          </p>

          {canEdit && without.length > 0 && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">
                Make cards for the {without.length} {without.length === 1 ? "person" : "people"} without one
              </p>
              <Select value={formId} onValueChange={setFormId}>
                <SelectTrigger aria-label="What opens when these cards are scanned">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROFILE}>Open their profile</SelectItem>
                  {forms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      Open form: {f.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={issue} disabled={isSaving}>
                {isSaving ? "Making cards..." : "Make cards"}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {isAdmin && (
              <Button variant="outline" onClick={() => setDesigning(true)} className="mr-auto">
                <Palette className="mr-1 h-4 w-4" aria-hidden="true" /> Edit card design
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button asChild disabled={withCard === 0}>
              <a href="/print/cards?all=1" target="_blank" rel="noopener noreferrer" aria-disabled={withCard === 0}>
                <Printer className="mr-1 h-4 w-4" aria-hidden="true" /> Print all cards
              </a>
            </Button>
          </div>
        </div>
        {designing && (
          <CardDesignDialog
            initial={design}
            prefix={prefix}
            samplePerson={people.find((p) => p.card_number != null) ?? null}
            onSave={saveDesign}
            onClose={() => setDesigning(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
