/**
 * ID cards and scanning (migration 022).
 *
 * People's cards carry a QR code with a link to /scan/person/<id>, and our
 * own inventory labels one to /scan/item/<id>. Links (rather than bare ids)
 * mean a phone's ordinary camera app can open them too. They only work for
 * signed-in members of the organization; they never contain anything
 * private, such as a person's form-link token.
 *
 * Anything else that's scanned (UPC/EAN codes on products) is treated as an
 * inventory barcode and looked up in inventory_items.barcode.
 */

export const PERSON_SCAN_PATH = "/scan/person/";
export const ITEM_SCAN_PATH = "/scan/item/";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "FB-000123", or "000123" without a prefix. */
export function formatCardNumber(prefix: string | null | undefined, n: number): string {
  const digits = String(n).padStart(6, "0");
  return prefix ? `${prefix}-${digits}` : digits;
}

/**
 * The card number typed into a search box, as a number: accepts "FB-000123",
 * "fb 123", "000123" or "123". Null if it doesn't look like one.
 */
export function parseCardNumber(text: string): number | null {
  const t = text.trim();
  // "PREFIX-000123" or "PREFIX 123" (the prefix may itself contain digits),
  // "FB000123" (letters run straight into the number), or just "000123".
  const m =
    t.match(/^[a-z0-9]{1,6}[\s-]+(\d{1,9})$/i) ?? t.match(/^[a-z]{1,6}(\d{1,9})$/i) ?? t.match(/^(\d{1,9})$/);
  return m ? Number(m[1]) : null;
}

export const personScanUrl = (id: string, origin = window.location.origin) => `${origin}${PERSON_SCAN_PATH}${id}`;
export const itemScanUrl = (id: string, origin = window.location.origin) => `${origin}${ITEM_SCAN_PATH}${id}`;

export type ScanResult = { kind: "person"; id: string } | { kind: "item"; id: string } | { kind: "barcode"; code: string };

/** What a scanned code refers to. Our links are recognized from any site address. */
export function parseScan(text: string): ScanResult | null {
  const raw = text.trim();
  if (!raw) return null;
  for (const [path, kind] of [
    [PERSON_SCAN_PATH, "person"],
    [ITEM_SCAN_PATH, "item"],
  ] as const) {
    const at = raw.indexOf(path);
    if (at >= 0) {
      const id = raw.slice(at + path.length).split(/[/?#]/)[0];
      if (UUID.test(id)) return { kind, id: id.toLowerCase() };
    }
  }
  if (raw.length > 128) return null;
  return { kind: "barcode", code: raw };
}
