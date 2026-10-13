/**
 * Legal details
 *
 * Business details shown on the Terms of Service (/terms), Privacy Policy
 * (/privacy) and Refund & Cancellation (/refunds) pages.
 *
 * BEFORE TAKING LIVE PAYMENTS: fill in every field marked TODO, set
 * LEGAL_DETAILS_COMPLETE to true, and have a lawyer review the pages.
 * Stripe asks for links to these pages when you activate live payments.
 */

export const LEGAL = {
  /** Product name used in the page headers and text. */
  appName: "FormFlow", // TODO: confirm; the landing page currently says "HumMotion"
  /** The legal entity that provides the service and signs the terms. */
  companyName: "FormFlow", // TODO: your legal business name, e.g. "Big State Electric LTD"
  /** Where people send questions, privacy requests and refund requests. */
  contactEmail: "support@example.com", // TODO: a real inbox someone reads
  /** Postal address. Required by some states; leave "" to hide it. */
  mailingAddress: "", // TODO: e.g. "123 Main St, Austin, TX 78701"
  /** Whose laws govern the terms. */
  governingLaw: "the State of Texas", // TODO: confirm
  /** Where disputes are heard. */
  venue: "the state and federal courts located in Texas", // TODO: confirm (e.g. a specific county)
  /** Shown as "Last updated". Change it whenever the terms change (YYYY-MM-DD). */
  effectiveDate: "2026-10-13",
};

/**
 * Flip to true once every TODO above is filled in. Until then a warning is
 * logged in the browser console (development builds only) on the legal pages.
 */
export const LEGAL_DETAILS_COMPLETE = false;

/** effectiveDate as a readable date, e.g. "October 13, 2026". */
export function formatLegalDate(isoDate: string = LEGAL.effectiveDate): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  // Built from parts so the date doesn't shift a day in US time zones.
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
