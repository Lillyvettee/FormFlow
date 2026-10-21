/**
 * Printable report: opens a styled page in a new tab and starts the print
 * dialog, where "Save as PDF" makes the file.
 *
 * The page carries the organization's name, logo and brand color, a short
 * highlights summary, headline numbers with period comparisons, the charts
 * currently on screen (copied from elements marked data-report-chart) and
 * tables.
 *
 * Safety: every piece of data goes through escapeHtml, and the page's
 * Content-Security-Policy blocks scripts entirely, because form answers come
 * from the public.
 */

import { escapeHtml as h } from "@/lib/report-utils";

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_BRAND = "#1a3f8f";

export interface PdfStat {
  label: string;
  value: string;
  /** e.g. "+18% vs Sep 1 to Sep 14" */
  change?: string | null;
}

/** Row of headline numbers. */
export const pdfStats = (items: PdfStat[]): string =>
  `<div class="stats">${items
    .map(
      (s) =>
        `<div class="stat"><strong>${h(s.value)}</strong><span>${h(s.label)}</span>${s.change ? `<em>${h(s.change)}</em>` : ""}</div>`,
    )
    .join("")}</div>`;

/** A table with every cell escaped. */
export const pdfTable = (headers: string[], rows: (string | number)[][], highlightRow?: (i: number) => boolean): string =>
  rows.length
    ? `<table><thead><tr>${headers.map((x) => `<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${rows
        .map((r, i) => `<tr${highlightRow?.(i) ? ' class="highlight"' : ""}>${r.map((c) => `<td>${h(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`
    : `<p class="note">Nothing to show for this period.</p>`;

export const pdfHeading = (text: string): string => `<h2>${h(text)}</h2>`;
export const pdfNote = (text: string): string => `<p class="note">${h(text)}</p>`;

/** Progress bar for goals. */
export const pdfProgress = (label: string, detail: string, pct: number, color: string): string =>
  `<div class="goal"><div class="goal-top"><strong>${h(label)}</strong><span>${h(detail)}</span></div><div class="bar"><div style="width:${Math.max(
    0,
    Math.min(100, pct),
  )}%;background:${HEX.test(color) ? color : DEFAULT_BRAND}"></div></div></div>`;

/**
 * Copy the charts on screen into the report. Recharts draws SVG, which can
 * be copied as-is; the legend under each donut is copied as text.
 */
const chartsFrom = (root: HTMLElement | null): string => {
  if (!root) return "";
  const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-report-chart]"));
  const blocks = cards
    .map((card) => {
      const svg = card.querySelector<SVGSVGElement>("svg.recharts-surface");
      if (!svg) return "";
      const copy = svg.cloneNode(true) as SVGSVGElement;
      const w = svg.getAttribute("width");
      const ht = svg.getAttribute("height");
      if (!copy.getAttribute("viewBox") && w && ht) copy.setAttribute("viewBox", `0 0 ${w} ${ht}`);
      copy.removeAttribute("width");
      copy.removeAttribute("height");
      copy.setAttribute("preserveAspectRatio", "xMidYMid meet");
      // Theme variables don't exist in the print window; give axis text a plain color.
      copy.querySelectorAll("text").forEach((t) => t.setAttribute("fill", "#555"));
      const legend = Array.from(card.querySelectorAll("ul > li"))
        .map((li) => `<li>${h(li.textContent?.trim() ?? "")}</li>`)
        .join("");
      const isDonut = Boolean(card.querySelector(".recharts-pie"));
      return `<figure class="${isDonut ? "chart donut" : "chart"}"><figcaption>${h(card.dataset.reportChart)}</figcaption>${copy.outerHTML}${
        legend ? `<ul class="legend">${legend}</ul>` : ""
      }</figure>`;
    })
    .filter(Boolean);
  return blocks.length ? `<h2>Charts</h2><div class="charts">${blocks.join("")}</div>` : "";
};

/**
 * Open the report. Resolves false if the browser blocked the new tab.
 *
 * beforeWrite runs after the tab opens (it has to open right away, inside
 * the click, or pop-up blockers stop it) and before the report is written.
 * If it throws, the tab closes and the error is passed on.
 */
export async function openPrintableReport(opts: {
  title: string;
  periodLine: string;
  orgName: string;
  logoUrl: string | null;
  brandColor: string | null;
  highlights: string[];
  /** HTML built with the pdf* helpers above, or a function that builds it after beforeWrite. */
  body: string | (() => string);
  /** Element containing the on-screen charts to copy (data-report-chart). */
  chartsRoot?: HTMLElement | null;
  beforeWrite?: () => Promise<unknown>;
}): Promise<boolean> {
  const w = window.open("", "_blank");
  if (!w) return false;

  if (opts.beforeWrite) {
    w.document.write('<p style="font-family: sans-serif; padding: 48px; color: #555">Preparing your report...</p>');
    w.document.close();
    try {
      await opts.beforeWrite();
    } catch (err) {
      w.close();
      throw err;
    }
    w.document.open();
  }
  const body = typeof opts.body === "function" ? opts.body() : opts.body;

  const brand = opts.brandColor && HEX.test(opts.brandColor) ? opts.brandColor : DEFAULT_BRAND;
  const logo = opts.logoUrl && /^https:\/\//.test(opts.logoUrl) ? opts.logoUrl : null;
  const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  w.document.write(`<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https: data:">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Quicksand:wght@300..700&display=swap">
    <title>${h(`${opts.orgName} - ${opts.title} - ${generated}`)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Quicksand, sans-serif; max-width: 960px; margin: 0 auto; padding: 48px 40px; color: #111; }
      .header { display: flex; justify-content: space-between; align-items: center; gap: 24px; border-bottom: 3px solid ${brand}; padding-bottom: 20px; margin-bottom: 28px; }
      .header h1 { font-size: 28px; margin: 0 0 6px; }
      .header p { margin: 2px 0; color: #555; font-size: 13px; }
      .org { text-align: right; font-weight: 700; font-size: 15px; color: ${brand}; }
      .org img { display: block; max-height: 64px; max-width: 180px; margin: 0 0 6px auto; object-fit: contain; }
      .highlights { background: ${brand}0f; border-left: 4px solid ${brand}; padding: 14px 18px; border-radius: 6px; }
      .highlights h2 { border: 0; margin: 0 0 6px; padding: 0; font-size: 15px; color: ${brand}; }
      .highlights p { margin: 6px 0; font-size: 14px; line-height: 1.5; }
      h2 { font-size: 18px; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-top: 32px; }
      .note { font-size: 12px; color: #666; font-style: italic; }
      .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
      .stat { background: #f4f6fa; border-radius: 8px; padding: 14px 18px; text-align: center; flex: 1; min-width: 140px; }
      .stat strong { display: block; font-size: 24px; color: ${brand}; margin-bottom: 4px; }
      .stat span { font-size: 12px; color: #555; display: block; }
      .stat em { font-size: 11px; color: #777; display: block; margin-top: 4px; font-style: normal; }
      .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .chart { margin: 0; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; page-break-inside: avoid; break-inside: avoid; }
      .chart figcaption { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
      .chart svg { width: 100%; height: auto; max-height: 260px; }
      .chart.donut svg { max-height: 160px; }
      .legend { list-style: none; padding: 0; margin: 8px 0 0; font-size: 11px; color: #444; columns: 2; }
      .goal { margin: 12px 0; page-break-inside: avoid; }
      .goal-top { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; margin-bottom: 6px; }
      .goal-top span { color: #555; }
      .bar { height: 10px; background: #e5e7eb; border-radius: 99px; overflow: hidden; }
      .bar div { height: 100%; border-radius: 99px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
      thead { display: table-header-group; } /* repeat headers on each printed page */
      tr { page-break-inside: avoid; }
      th { background: #f4f4f4; text-align: left; padding: 7px 10px; border: 1px solid #ddd; font-weight: 600; }
      td { padding: 6px 10px; border: 1px solid #ddd; vertical-align: top; word-break: break-word; }
      tr:nth-child(even) td { background: #fafafa; }
      tr.highlight td { background: #fff0f0; }
      .footer { margin-top: 48px; border-top: 1px solid #ddd; padding-top: 14px; font-size: 11px; color: #999; text-align: center; }
      @media print { body { padding: 16px; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      @media (max-width: 700px) { .charts { grid-template-columns: 1fr; } }
    </style>
  </head><body>
    <div class="header">
      <div>
        <h1>${h(opts.title)}</h1>
        <p>${h(opts.periodLine)}</p>
        <p>Prepared ${h(generated)}</p>
      </div>
      <div class="org">${logo ? `<img src="${h(logo)}" alt="">` : ""}${h(opts.orgName)}</div>
    </div>
    ${
      opts.highlights.length
        ? `<section class="highlights"><h2>Highlights</h2>${opts.highlights.map((p) => `<p>${h(p)}</p>`).join("")}</section>`
        : ""
    }
    ${body}
    ${chartsFrom(opts.chartsRoot ?? null)}
    <div class="footer">${h(opts.orgName)} · Prepared with HumMotion on ${h(generated)}</div>
  </body></html>`);
  w.document.close();

  // Print once the page (fonts, logo) has loaded.
  const print = () => {
    w.focus();
    w.print();
  };
  if (w.document.readyState === "complete") setTimeout(print, 300);
  else w.addEventListener("load", print, { once: true });
  return true;
}
