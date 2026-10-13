/**
 * Applies an organization's brand color (Settings > Branding) to the app.
 *
 * The theme in index.css defines its colors as CSS variables in "H S% L%"
 * form (e.g. --primary: 217 91% 35%). Setting those variables inline on
 * <html> overrides both the light and dark themes, so every bg-primary,
 * text-primary, focus ring, sidebar highlight and chart picks up the brand.
 *
 * Two layers, so pages can borrow a brand without losing the user's own:
 *   - "organization": the signed-in user's organization (set by
 *     OrganizationProvider).
 *   - "page": a page showing someone else's branding, e.g. a public form.
 *     It wins while set; clearing it brings back the organization color.
 */

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

/** Variables overridden. Anything else in the theme stays as defined in index.css. */
const VARIABLES = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-ring",
] as const;

const layers: { organization: string | null; page: string | null } = { organization: null, page: null };

export function setBrandColor(layer: keyof typeof layers, hex: string | null | undefined) {
  layers[layer] = hex && HEX_PATTERN.test(hex) ? hex : null;
  apply(layers.page ?? layers.organization);
}

function apply(hex: string | null) {
  const style = document.documentElement.style;
  if (!hex) {
    VARIABLES.forEach((v) => style.removeProperty(v));
    return;
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const { h, s, l } = rgbToHsl(r, g, b);
  const color = `${h} ${s}% ${l}%`;
  // Focus rings use a lighter version so they stand out against the color itself.
  const ring = `${h} ${s}% ${Math.min(Math.max(l + 20, 50), 70)}%`;
  const foreground = prefersDarkText(r, g, b) ? "0 0% 9%" : "0 0% 98%";

  style.setProperty("--primary", color);
  style.setProperty("--primary-foreground", foreground);
  style.setProperty("--ring", ring);
  style.setProperty("--sidebar-primary", color);
  style.setProperty("--sidebar-primary-foreground", foreground);
  style.setProperty("--sidebar-ring", ring);
}

function rgbToHsl(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Whether text on this color should be near-black rather than white, using
 * WCAG contrast. Light brand colors (yellow, light green) get dark text so
 * buttons stay readable.
 */
function prefersDarkText(r: number, g: number, b: number) {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithBlack > contrastWithWhite;
}
