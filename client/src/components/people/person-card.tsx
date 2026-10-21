/**
 * PersonIdCard
 *
 * The "ID card" section on a person's page (migration 022, Mission and
 * Enterprise). Gives the person a card number, sets which form opens when
 * the card is scanned, and prints the card (/print/cards).
 *
 * Owners and admins also set the organization's card prefix here.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QrCode } from "@/components/qr-code";
import { useOrganization } from "@/hooks/use-organization";
import { useCardPrefix } from "@/hooks/use-card-prefix";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { formatCardNumber, personScanUrl } from "@/lib/cards";
import { IdCard, Palette, Printer } from "lucide-react";
import { CardDesignDialog } from "@/components/people/card-design-dialog";
import type { Form, Person } from "@/types/database";

/** Select value for "no form: open their profile". */
const PROFILE = "__profile__";

export function PersonIdCard({ person, forms, onChange }: { person: Person; forms: Form[]; onChange: () => void }) {
  const { plan, canEdit, isAdmin } = useOrganization();
  const { toast } = useToast();
  const { prefix, design, save: savePrefix, saveDesign } = useCardPrefix();
  const [designing, setDesigning] = useState(false);
  const [formId, setFormId] = useState(person.card_form_id ?? PROFILE);
  const [isSaving, setIsSaving] = useState(false);
  const [editingPrefix, setEditingPrefix] = useState(false);
  const [prefixDraft, setPrefixDraft] = useState("");

  const published = forms.filter((f) => f.is_published && !f.is_archived);
  const hasCard = person.card_number != null;
  const first = person.full_name.split(" ")[0];

  if (!plan.features.cardsScanning) {
    return (
      <Card className="p-5 space-y-2">
        <div className="flex items-center gap-2">
          <IdCard className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">ID card</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Print a card with a QR code that opens {first}'s form when scanned. Included with the Mission and Enterprise plans.{" "}
          <a href="/settings#plan" className="underline hover:text-foreground">
            See plans
          </a>
        </p>
      </Card>
    );
  }

  const issue = async () => {
    setIsSaving(true);
    const { error } = await supabase.rpc("issue_person_cards", {
      p_person_ids: [person.id],
      p_form_id: formId === PROFILE ? null : formId,
    });
    setIsSaving(false);
    if (error) {
      toast({ title: "Couldn't save the card", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: hasCard ? "Card updated" : "Card created", description: hasCard ? "Printed cards keep working." : "You can print it now." });
    onChange();
  };

  const changePrefix = async () => {
    try {
      await savePrefix(prefixDraft);
      setEditingPrefix(false);
      toast({ title: "Card prefix saved", description: "Print cards again to show the new prefix." });
    } catch (err) {
      toast({ title: "Couldn't save the prefix", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  };

  const dirty = (person.card_form_id ?? PROFILE) !== formId;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <IdCard className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">ID card</h2>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        {hasCard && (
          <div className="flex items-center gap-3 rounded-md border p-3">
            <QrCode value={personScanUrl(person.id)} size="72px" label={`QR code for ${person.full_name}'s card`} />
            <div>
              <p className="text-xs text-muted-foreground">Card number</p>
              <p className="font-mono text-lg font-semibold">{formatCardNumber(prefix, person.card_number!)}</p>
            </div>
          </div>
        )}

        <div className="flex-1 min-w-[16rem] space-y-2">
          <p className="text-sm text-muted-foreground">
            {hasCard ? `When ${first}'s card is scanned, open:` : `Make a card for ${first}. When it's scanned, open:`}
          </p>
          <Select value={formId} onValueChange={setFormId} disabled={!canEdit || isSaving}>
            <SelectTrigger className="w-full sm:w-80" aria-label="What opens when the card is scanned">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PROFILE}>{first}'s profile (this page)</SelectItem>
              {published.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  Form: {f.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {person.card_form_id && !published.some((f) => f.id === person.card_form_id) && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              The form this card opens isn't published any more, so scanning opens the profile instead.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {canEdit && (!hasCard || dirty) && (
              <Button size="sm" onClick={issue} disabled={isSaving}>
                {isSaving ? "Saving..." : hasCard ? "Save" : "Create card"}
              </Button>
            )}
            {hasCard && (
              <Button asChild size="sm" variant="outline">
                <a href={`/print/cards?ids=${person.id}`} target="_blank" rel="noopener noreferrer">
                  <Printer className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Print card
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="text-xs text-muted-foreground border-t pt-3">
          {editingPrefix ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                changePrefix();
              }}
            >
              <label htmlFor="card-prefix">Card prefix for your organization</label>
              <Input
                id="card-prefix"
                value={prefixDraft}
                onChange={(e) => setPrefixDraft(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="e.g. FB"
                className="h-8 w-24 font-mono"
              />
              <Button type="submit" size="sm" className="h-8">
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditingPrefix(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <span>
              <button type="button" className="inline-flex items-center gap-1 underline hover:text-foreground" onClick={() => setDesigning(true)}>
                <Palette className="h-3 w-3" aria-hidden="true" /> Edit card design
              </button>
              {" · "}
              Card numbers {prefix ? `start with "${prefix}-"` : "have no prefix"}.{" "}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => {
                  setPrefixDraft(prefix ?? "");
                  setEditingPrefix(true);
                }}
              >
                {prefix ? "Change prefix" : "Add a prefix"}
              </button>
            </span>
          )}
        </div>
      )}

      {designing && (
        <CardDesignDialog
          initial={design}
          prefix={prefix}
          samplePerson={hasCard ? person : null}
          onSave={saveDesign}
          onClose={() => setDesigning(false)}
        />
      )}
    </Card>
  );
}
