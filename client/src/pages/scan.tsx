/**
 * ScanPage
 *
 * Routes: /scan, and /scan/person/:id and /scan/item/:id (what printed QR
 * codes link to, so a phone's own camera app can open them too).
 * Mission and Enterprise (migration 022).
 *
 * Scans with the device camera (@zxing/browser, loaded on first use): QR
 * codes on our ID cards and labels, and UPC/EAN/Code 128 barcodes on
 * products. Codes can also be typed.
 *
 *   Person card  opens the form chosen for the card, linked to the person
 *                (their personal form link), or their profile if none.
 *   Item / barcode  Receive adds stock, Give out removes it, by the chosen
 *                quantity (adjust_inventory: never below zero). Each change
 *                can be undone right away. An unknown barcode can be linked
 *                to an existing item.
 *
 * Everything is looked up under the signed-in member's own organization, so
 * another organization's card or label finds nothing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { parseCardNumber, parseScan, type ScanResult } from "@/lib/cards";
import { personalFormLink } from "@/lib/outcomes";
import { AlertCircle, Camera, CameraOff, Minus, PackageMinus, PackagePlus, Plus, ScanLine, Undo2 } from "lucide-react";
import type { InventoryItem, Person } from "@/types/database";

type Mode = "receive" | "give";

/** The same code read again within this time is ignored (the camera sees it many times a second). */
const REPEAT_MS = 2500;

interface StockChange {
  item: InventoryItem;
  delta: number;
  quantity: number;
}

export default function ScanPage({ kind }: { kind?: "person" | "item" }) {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const { plan, canEdit } = useOrganization();
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>("receive");
  const [qty, setQty] = useState(1);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [lastChange, setLastChange] = useState<StockChange | null>(null);
  /** An item opened from its label's link: choose Receive or Give out by hand. */
  const [openItem, setOpenItem] = useState<InventoryItem | null>(null);
  /** A barcode nobody has yet: offer to link it to an item. */
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [linkTo, setLinkTo] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  // The scan callback outlives renders, so it reads the latest settings from here.
  const settingsRef = useRef({ mode, qty });
  settingsRef.current = { mode, qty };

  useEffect(() => {
    document.title = "Scan - HumMotion";
  }, []);

  // ----- Acting on a scan -----

  const changeStock = useCallback(
    async (item: InventoryItem, delta: number) => {
      const { data, error } = await supabase.rpc("adjust_inventory", { p_item_id: item.id, p_delta: delta });
      if (error) {
        setMessage({ tone: "error", text: error.message });
        return;
      }
      const quantity = data as number;
      setLastChange({ item, delta, quantity });
      setMessage({
        tone: "ok",
        text: `${delta > 0 ? "Added" : "Gave out"} ${Math.abs(delta)} ${item.unit ?? ""} ${item.name}. Now ${quantity} in stock.`.replace(/\s+/g, " "),
      });
      if (navigator.vibrate) navigator.vibrate(60);
    },
    [],
  );

  const openPerson = useCallback(
    async (id: string) => {
      const { data: person } = await supabase.from("people").select("*").eq("id", id).maybeSingle<Person>();
      if (!person) {
        setMessage({ tone: "error", text: "That card isn't for anyone in your organization, or you can't see People." });
        return;
      }
      if (person.card_form_id) {
        const { data: form } = await supabase
          .from("forms")
          .select("id")
          .eq("id", person.card_form_id)
          .eq("is_published", true)
          .eq("is_archived", false)
          .maybeSingle();
        if (form) {
          const link = new URL(personalFormLink(form.id, person.access_token));
          navigate(link.pathname + link.search);
          return;
        }
      }
      navigate(`/people/${person.id}`);
    },
    [navigate],
  );

  const handle = useCallback(
    async (result: ScanResult, fromLink = false) => {
      setBusy(true);
      setMessage(null);
      setUnknownCode(null);
      setOpenItem(null);
      try {
        if (result.kind === "person") {
          await openPerson(result.id);
          return;
        }
        const query = supabase.from("inventory_items").select("*");
        const { data: item } = await (result.kind === "item" ? query.eq("id", result.id) : query.eq("barcode", result.code)).maybeSingle<InventoryItem>();
        if (!item) {
          if (result.kind === "barcode") {
            setUnknownCode(result.code);
          } else {
            setMessage({ tone: "error", text: "That label isn't for an item in your inventory." });
          }
          return;
        }
        if (fromLink || !canEdit) {
          setOpenItem(item);
          return;
        }
        const { mode: m, qty: q } = settingsRef.current;
        await changeStock(item, m === "receive" ? q : -q);
      } finally {
        setBusy(false);
      }
    },
    [openPerson, changeStock, canEdit],
  );

  // A printed code opened directly (/scan/person/:id or /scan/item/:id).
  useEffect(() => {
    if (!kind || !params.id || !plan.features.cardsScanning) return;
    handle({ kind, id: params.id }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, params.id, plan.features.cardsScanning]);

  // ----- Camera -----

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser can't use the camera here. Type the code below instead.");
      return;
    }
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      setCameraOn(true);
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current!,
        (res) => {
          if (!res) return;
          const code = res.getText();
          const now = Date.now();
          if (code === lastCodeRef.current.code && now - lastCodeRef.current.at < REPEAT_MS) return;
          lastCodeRef.current = { code, at: now };
          const parsed = parseScan(code);
          if (parsed) handle(parsed);
        },
      );
    } catch (err) {
      setCameraOn(false);
      const name = err instanceof Error ? err.name : "";
      setCameraError(
        name === "NotAllowedError"
          ? "Camera access was blocked. Allow the camera for this site in your browser settings, then try again."
          : name === "NotFoundError"
            ? "No camera was found on this device. Type the code below instead."
            : "Couldn't start the camera. Type the code below instead.",
      );
    }
  }, [handle]);

  useEffect(() => stopCamera, [stopCamera]);

  // ----- Typed codes -----

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = manual.trim();
    if (!text) return;
    setManual("");
    const parsed = parseScan(text);
    // A card number typed by hand ("FB-000123" or "123") finds the person first.
    const n = parsed?.kind === "barcode" ? parseCardNumber(text) : null;
    if (n !== null) {
      const { data } = await supabase.from("people").select("id").eq("card_number", n).maybeSingle();
      if (data) return handle({ kind: "person", id: data.id });
    }
    if (parsed) handle(parsed);
  };

  // ----- Unknown barcode: link it -----

  useEffect(() => {
    if (!unknownCode || items.length) return;
    supabase
      .from("inventory_items")
      .select("id, name")
      .eq("is_sample", false)
      .is("barcode", null)
      .order("name")
      .then(({ data }) => setItems(data ?? []));
  }, [unknownCode, items.length]);

  const linkBarcode = async () => {
    if (!unknownCode || !linkTo) return;
    const { error } = await supabase.from("inventory_items").update({ barcode: unknownCode }).eq("id", linkTo);
    if (error) {
      toast({ title: "Couldn't link the barcode", description: error.message, variant: "destructive" });
      return;
    }
    const code = unknownCode;
    setItems([]);
    setLinkTo("");
    toast({ title: "Barcode linked", description: "Scanning it now finds this item." });
    handle({ kind: "barcode", code });
  };

  const undo = async () => {
    if (!lastChange) return;
    const { item, delta } = lastChange;
    setLastChange(null);
    const { data, error } = await supabase.rpc("adjust_inventory", { p_item_id: item.id, p_delta: -delta });
    setMessage(error ? { tone: "error", text: error.message } : { tone: "ok", text: `Undone. ${item.name}: ${data} in stock.` });
  };

  // ----- Render -----

  if (!plan.features.cardsScanning) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card className="p-6 space-y-2">
          <h1 className="text-xl font-serif font-bold">Scan</h1>
          <p className="text-sm text-muted-foreground">
            Scan ID cards and inventory barcodes with your phone or tablet camera. Included with the Mission and Enterprise plans.{" "}
            <a href="/settings#plan" className="underline hover:text-foreground">
              See plans
            </a>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold">Scan</h1>
        <p className="text-muted-foreground text-sm">ID cards open their form. Item labels and product barcodes change stock.</p>
      </div>

      {/* ----- Inventory mode ----- */}
      {canEdit && (
        <Card className="p-4 space-y-3">
          <div role="group" aria-label="What item scans do" className="grid grid-cols-2 gap-2">
            {(
              [
                ["receive", "Receive", PackagePlus],
                ["give", "Give out", PackageMinus],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={`flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  mode === value ? "border-primary bg-primary/10 text-primary" : "hover:border-primary/50"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="scan-qty" className="text-sm">
              Quantity per scan
            </Label>
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Less">
              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Input
              id="scan-qty"
              type="number"
              min={1}
              max={10000}
              value={qty}
              onChange={(e) => setQty(Math.min(10000, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
              className="h-8 w-20 text-center"
            />
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => setQty((q) => Math.min(10000, q + 1))} aria-label="More">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </Card>
      )}

      {/* ----- Camera ----- */}
      <Card className="overflow-hidden">
        <div className={`relative bg-black aspect-[4/3] ${cameraOn ? "" : "hidden"}`}>
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Camera view" />
          <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80" aria-hidden="true" />
        </div>
        <div className="p-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {cameraOn ? "Point the camera at a QR code or barcode." : "Use your device's camera to scan."}
          </p>
          {cameraOn ? (
            <Button variant="outline" onClick={stopCamera}>
              <CameraOff className="mr-1 h-4 w-4" aria-hidden="true" /> Stop camera
            </Button>
          ) : (
            <Button onClick={startCamera}>
              <Camera className="mr-1 h-4 w-4" aria-hidden="true" /> Start camera
            </Button>
          )}
        </div>
        {cameraError && (
          <p role="alert" className="mx-4 mb-4 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            {cameraError}
          </p>
        )}
      </Card>

      {/* ----- Typed code ----- */}
      <form onSubmit={submitManual} className="flex gap-2">
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Or type a card number or barcode"
          aria-label="Card number or barcode"
          className="flex-1"
        />
        <Button type="submit" variant="outline" disabled={busy || !manual.trim()}>
          <ScanLine className="mr-1 h-4 w-4" aria-hidden="true" /> Look up
        </Button>
      </form>

      {/* ----- Results ----- */}
      <div aria-live="polite" className="space-y-3">
        {busy && <p className="text-sm text-muted-foreground">Looking up...</p>}

        {message && (
          <Card className={`p-4 text-sm ${message.tone === "error" ? "border-destructive/50 text-destructive" : "border-primary/40"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{message.text}</span>
              {message.tone === "ok" && lastChange && (
                <Button size="sm" variant="ghost" onClick={undo}>
                  <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Undo
                </Button>
              )}
            </div>
          </Card>
        )}

        {openItem && (
          <Card className="p-4 space-y-3">
            <div>
              <p className="font-semibold">{openItem.name}</p>
              <p className="text-sm text-muted-foreground">
                {openItem.quantity ?? 0} {openItem.unit ?? ""} in stock{openItem.location ? ` · ${openItem.location}` : ""}
              </p>
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => changeStock(openItem, qty).then(() => setOpenItem(null))}>
                  <PackagePlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Receive {qty}
                </Button>
                <Button size="sm" variant="outline" onClick={() => changeStock(openItem, -qty).then(() => setOpenItem(null))}>
                  <PackageMinus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Give out {qty}
                </Button>
              </div>
            )}
          </Card>
        )}

        {unknownCode && (
          <Card className="p-4 space-y-3">
            <p className="text-sm">
              No item has the barcode <span className="font-mono">{unknownCode}</span> yet.
            </p>
            {canEdit && (
              <>
                {items.length ? (
                  <div className="flex flex-wrap gap-2">
                    <Select value={linkTo} onValueChange={setLinkTo}>
                      <SelectTrigger className="w-full sm:w-64" aria-label="Item to link this barcode to">
                        <SelectValue placeholder="Link it to an item..." />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={linkBarcode} disabled={!linkTo}>
                      Link barcode
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Every item already has a barcode. Add the item in Inventory first.</p>
                )}
                <a href="/inventory" className="text-sm text-primary hover:underline">
                  Add a new item in Inventory
                </a>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
