/**
 * Per-form look and sharing helpers.
 *
 * A form's look lives in forms.settings.theme (see FormSettings in
 * types/database.ts). Anything left unset falls back to the organization's
 * branding from Settings > Branding, then to the app's default theme.
 *
 * Sharing:
 *   /forms/:id/submit   full page, for links
 *   /forms/:id/embed    compact page for an <iframe> on another website. It
 *                       tells the host page its height (RESIZE_MESSAGE), and
 *                       the snippet from embedCode() resizes the iframe.
 */

import type { Form } from "@/types/database";

export const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

/** Message type the embed page posts to the website hosting it. */
export const RESIZE_MESSAGE = "hummotion:resize";

export interface FormAppearance {
  backgroundColor: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
}

/** The form's own colors and logo, ignoring invalid values. */
export function getAppearance(form?: Pick<Form, "settings"> | null): FormAppearance {
  const theme = (form?.settings as { theme?: Record<string, unknown> } | null)?.theme ?? {};
  const color = (v: unknown) => (typeof v === "string" && HEX_PATTERN.test(v) ? v : null);
  const logo = typeof theme.logoUrl === "string" && theme.logoUrl.startsWith("https://") ? theme.logoUrl : null;
  return { backgroundColor: color(theme.backgroundColor), primaryColor: color(theme.primaryColor), logoUrl: logo };
}

/** True when dark text reads better than white text on this color. */
export function prefersDarkText(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs. against near-black (#171717).
  return (1.05 / (luminance + 0.05)) < ((luminance + 0.05) / 0.0588);
}

export const getShareUrl = (formId: string): string => `${window.location.origin}/forms/${formId}/submit`;
export const getEmbedUrl = (formId: string): string => `${window.location.origin}/forms/${formId}/embed`;

/**
 * HTML to paste into a website. The script grows the iframe to fit the form,
 * so visitors never see a scrollbar inside it, and only trusts messages from
 * this app's own address.
 */
export function embedCode(formId: string, title: string): string {
  const origin = window.location.origin;
  const safeTitle = title.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<iframe src="${getEmbedUrl(formId)}" title="${safeTitle}" data-hummotion-form="${formId}" style="width:100%;max-width:720px;height:700px;border:0;" loading="lazy" allow="microphone"></iframe>
<script>
window.addEventListener("message", function (e) {
  if (e.origin !== "${origin}" || !e.data || e.data.type !== "${RESIZE_MESSAGE}") return;
  document.querySelectorAll("iframe[data-hummotion-form]").forEach(function (f) {
    if (f.contentWindow === e.source) f.style.height = e.data.height + "px";
  });
});
</script>`;
}
