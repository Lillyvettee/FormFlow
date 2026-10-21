/**
 * ID card design (migration 023): one per organization, stored in
 * organizations.card_design and used for every printed card.
 *
 * normalizeCardDesign() fills in defaults and drops anything invalid, so an
 * empty or older design always renders.
 */

export type CardLayout = "qr_right" | "qr_left" | "header_band";
export type CardOrientation = "landscape" | "portrait";

export interface CardDesign {
  /** Heading on the card, e.g. "Member card". Empty = none. */
  title: string;
  layout: CardLayout;
  orientation: CardOrientation;
  colors: { background: string; text: string; accent: string };
  /** Custom People fields (tracker_settings) shown on the card, in order. */
  customFieldIds: string[];
  /** The organization's own lines of text, e.g. a phone number. Up to 3. */
  lines: string[];
}

export const CARD_LAYOUTS: { value: CardLayout; label: string }[] = [
  { value: "qr_right", label: "QR code on the right" },
  { value: "qr_left", label: "QR code on the left" },
  { value: "header_band", label: "Colored header band" },
];

export const CARD_ORIENTATIONS: { value: CardOrientation; label: string }[] = [
  { value: "landscape", label: "Landscape (wide)" },
  { value: "portrait", label: "Portrait (tall)" },
];

export const MAX_CARD_LINES = 3;
export const MAX_CARD_LINE_LENGTH = 60;
export const MAX_CARD_FIELDS = 4;

const HEX = /^#[0-9a-f]{6}$/i;
/** Matches the app's default accent when the organization has no branding color. */
const DEFAULT_ACCENT = "#0848a9";

export function defaultCardDesign(brandColor?: string | null): CardDesign {
  return {
    title: "",
    layout: "qr_right",
    orientation: "landscape",
    colors: { background: "#ffffff", text: "#111111", accent: brandColor && HEX.test(brandColor) ? brandColor : DEFAULT_ACCENT },
    customFieldIds: [],
    lines: ["Show this card when you visit."],
  };
}

/** A complete, valid design from whatever is stored. */
export function normalizeCardDesign(raw: unknown, brandColor?: string | null): CardDesign {
  const d = defaultCardDesign(brandColor);
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const colors = (r.colors ?? {}) as Record<string, unknown>;
  const color = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v : fallback);
  return {
    title: typeof r.title === "string" ? r.title.slice(0, 40) : d.title,
    layout: CARD_LAYOUTS.some((l) => l.value === r.layout) ? (r.layout as CardLayout) : d.layout,
    orientation: CARD_ORIENTATIONS.some((o) => o.value === r.orientation) ? (r.orientation as CardOrientation) : d.orientation,
    colors: {
      background: color(colors.background, d.colors.background),
      text: color(colors.text, d.colors.text),
      accent: color(colors.accent, d.colors.accent),
    },
    customFieldIds: Array.isArray(r.customFieldIds)
      ? r.customFieldIds.filter((x): x is string => typeof x === "string").slice(0, MAX_CARD_FIELDS)
      : d.customFieldIds,
    lines: Array.isArray(r.lines)
      ? r.lines.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, MAX_CARD_LINE_LENGTH)).slice(0, MAX_CARD_LINES)
      : d.lines,
  };
}

/** Card size in inches (CR80 ID badge), by orientation. */
export const cardSize = (o: CardOrientation) => (o === "landscape" ? { w: 3.375, h: 2.125 } : { w: 2.125, h: 3.375 });

/** Cards per row on a US Letter page (inside the print margins). */
export const cardsPerRow = (o: CardOrientation) => (o === "landscape" ? 2 : 3);
