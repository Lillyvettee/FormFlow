/**
 * Print sheets (migration 022, Mission and Enterprise). Full-page routes
 * outside the sidebar layout, opened in a new tab and printed from the
 * browser.
 *
 *   /print/cards?ids=<id>,<id>   ID cards for those people
 *   /print/cards?all=1           every person with a card
 *     ID-badge size (3.375 x 2.125 in, CR80), 10 per US Letter page with
 *     cut lines. Organization name and logo, the person's name, card number
 *     and a QR code linking to /scan/person/<id>.
 *
 *   /print/labels?ids=<id>,...   inventory labels for those items
 *   /print/labels?all=1          every item
 *     Avery 5160 / 8160 layout (30 per page, 2.625 x 1 in). Item name, its
 *     barcode if it has one, and a QR code linking to /scan/item/<id>.
 *
 * Print at 100% scale ("Actual size"), not "Fit to page", or the labels
 * won't line up.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLogo } from "@/components/app-logo";
import { QrCode } from "@/components/qr-code";
import { useOrganization } from "@/hooks/use-organization";
import { useCardPrefix } from "@/hooks/use-card-prefix";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/report-utils";
import { formatCardNumber, itemScanUrl, personScanUrl } from "@/lib/cards";
import { Printer } from "lucide-react";
import type { InventoryItem, Person } from "@/types/database";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ids from ?ids=a,b,c (valid ones only), or "all" for ?all=1. */
function requestedIds(): string[] | "all" {
  const params = new URLSearchParams(window.location.search);
  if (params.get("all") === "1") return "all";
  return (params.get("ids") ?? "").split(",").filter((id) => UUID.test(id));
}

/** Screen-only toolbar, page setup, and states shared by both sheets. */
function Sheet({
  title,
  hint,
  pageCss,
  state,
  count,
  children,
}: {
  title: string;
  hint: string;
  pageCss: string;
  state: "loading" | "ready" | "error" | "locked";
  count: number;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} - HumMotion`;
  }, [title]);

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{`@media print { @page { ${pageCss} } body { background: white; } .no-print { display: none !important; } }`}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-3">
        <div>
          <h1 className="font-semibold">{title}</h1>
          <p className="text-xs text-neutral-600">{hint}</p>
        </div>
        <Button onClick={() => window.print()} disabled={state !== "ready" || count === 0}>
          <Printer className="mr-1 h-4 w-4" aria-hidden="true" /> Print
        </Button>
      </div>
      {state === "loading" ? (
        <div className="p-6 space-y-3" aria-busy="true">
          <Skeleton className="h-32 w-80" />
          <Skeleton className="h-32 w-80" />
        </div>
      ) : state === "locked" ? (
        <p className="p-6 text-sm">ID cards and labels are included with the Mission and Enterprise plans.</p>
      ) : state === "error" ? (
        <p className="p-6 text-sm">Couldn't load what to print. Make sure you're signed in, then refresh the page.</p>
      ) : count === 0 ? (
        <p className="p-6 text-sm">Nothing to print yet.</p>
      ) : (
        children
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ID cards
// ---------------------------------------------------------------------------

export function PrintCardsPage() {
  const { organization, branding, plan, isLoading: orgLoading } = useOrganization();
  const { prefix, isLoading: prefixLoading } = useCardPrefix();
  const [people, setPeople] = useState<Person[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "locked">("loading");

  useEffect(() => {
    if (orgLoading) return;
    if (!plan.features.cardsScanning) {
      setState("locked");
      return;
    }
    const ids = requestedIds();
    fetchAll<Person>((f, t) => {
      let q = supabase.from("people").select("*").not("card_number", "is", null);
      if (ids !== "all") q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      return q.order("card_number").range(f, t);
    })
      .then((rows) => {
        setPeople(rows);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [orgLoading, plan.features.cardsScanning]);

  return (
    <Sheet
      title="ID cards"
      hint="Prints 10 cards per Letter page with cut lines. Use 100% scale (Actual size). Card stock works best."
      pageCss="size: letter; margin: 0.4in 0.5in;"
      state={prefixLoading && state === "ready" ? "loading" : state}
      count={people.length}
    >
      <div className="p-6 print:p-0 grid gap-0 justify-start" style={{ gridTemplateColumns: "repeat(2, 3.375in)" }}>
        {people.map((p) => (
          <div
            key={p.id}
            className="flex flex-col justify-between border border-dashed border-neutral-400 p-[0.14in] break-inside-avoid"
            style={{ width: "3.375in", height: "2.125in" }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt="" className="h-6 max-w-[0.9in] object-contain" />
              ) : (
                <AppLogo className="h-5 w-5" />
              )}
              <span className="truncate text-[9pt] font-semibold">{organization?.name}</span>
            </div>
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13pt] font-bold leading-tight break-words">{p.full_name}</p>
                <p className="mt-1 font-mono text-[11pt] tracking-wide">{formatCardNumber(prefix, p.card_number!)}</p>
                <p className="mt-1 text-[6.5pt] text-neutral-600">Show this card when you visit.</p>
              </div>
              <QrCode value={personScanUrl(p.id)} size="1.05in" label={`QR code for ${p.full_name}`} />
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Inventory labels
// ---------------------------------------------------------------------------

export function PrintLabelsPage() {
  const { plan, isLoading: orgLoading } = useOrganization();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "locked">("loading");

  useEffect(() => {
    if (orgLoading) return;
    if (!plan.features.cardsScanning) {
      setState("locked");
      return;
    }
    const ids = requestedIds();
    fetchAll<InventoryItem>((f, t) => {
      let q = supabase.from("inventory_items").select("*").eq("is_sample", false);
      if (ids !== "all") q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      return q.order("name").range(f, t);
    })
      .then((rows) => {
        setItems(rows);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [orgLoading, plan.features.cardsScanning]);

  return (
    <Sheet
      title="Inventory labels"
      hint="Avery 5160 / 8160 layout, 30 labels per Letter page. Print at 100% scale (Actual size)."
      // Avery 5160: 0.5in top/bottom margins, 0.1875in sides.
      pageCss="size: letter; margin: 0.5in 0.1875in;"
      state={state}
      count={items.length}
    >
      <div
        className="p-6 print:p-0 grid justify-start"
        style={{ gridTemplateColumns: "repeat(3, 2.625in)", columnGap: "0.125in", gridAutoRows: "1in" }}
      >
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-[0.08in] px-[0.1in] overflow-hidden outline outline-1 outline-dashed outline-neutral-300 print:outline-none">
            <QrCode value={itemScanUrl(item.id)} size="0.78in" label={`QR code for ${item.name}`} />
            <div className="min-w-0">
              <p className="text-[9pt] font-semibold leading-tight line-clamp-2">{item.name}</p>
              {item.barcode && <p className="font-mono text-[7pt] text-neutral-700 truncate">{item.barcode}</p>}
              {item.location && <p className="text-[7pt] text-neutral-600 truncate">{item.location}</p>}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
