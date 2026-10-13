/**
 * LegalLayout
 *
 * Shared full-page layout for the Terms of Service, Privacy Policy and
 * Refund & Cancellation pages: a header linking home, the page title with a
 * "Last updated" line, readable body text, and a footer linking the other
 * legal pages. Business details come from LEGAL in lib/legal.ts.
 *
 * Also exports small helpers the pages share (Section, ContactEmail,
 * MailingAddress).
 */

import { useEffect } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { LEGAL, LEGAL_DETAILS_COMPLETE, formatLegalDate } from "@/lib/legal";
import { Heart } from "lucide-react";

export const LEGAL_PAGES = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refunds", label: "Refund & Cancellation Policy" },
] as const;

export function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => {
    document.title = `${title} - ${LEGAL.appName}`;
    window.scrollTo(0, 0);
    if (import.meta.env.DEV && !LEGAL_DETAILS_COMPLETE) {
      console.warn("Legal pages: fill in the TODOs in client/src/lib/legal.ts before taking live payments.");
    }
  }, [title]);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 px-4 sm:px-6 py-3">
          <a
            href="/"
            className="flex items-center gap-2 rounded-md font-serif font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="h-7 w-7 rounded-md bg-primary flex items-center justify-center shrink-0" aria-hidden="true">
              <Heart className="h-3.5 w-3.5 text-primary-foreground" />
            </span>
            {LEGAL.appName}
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-10">
        <article className="max-w-3xl mx-auto prose prose-neutral dark:prose-invert prose-headings:font-semibold prose-h2:text-xl prose-h2:mt-10 prose-a:text-primary">
          <h1 className="mb-2">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0">Last updated {formatLegalDate()}</p>
          {children}
        </article>
      </main>

      <footer className="border-t px-4 sm:px-6 py-8">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <nav aria-label="Legal">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {LEGAL_PAGES.map((page) => (
                <li key={page.href}>
                  <a
                    href={page.href}
                    className="hover:text-foreground transition-colors"
                    aria-current={typeof window !== "undefined" && window.location.pathname === page.href ? "page" : undefined}
                  >
                    {page.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <p>
            &copy; {new Date().getFullYear()} {LEGAL.companyName}
          </p>
        </div>
      </footer>
    </div>
  );
}

/** A section with an h2 heading. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** The contact email as a mailto link. */
export function ContactEmail() {
  return <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>;
}

/** Mailing address paragraph; renders nothing when LEGAL.mailingAddress is "". */
export function MailingAddress() {
  if (!LEGAL.mailingAddress) return null;
  return (
    <p>
      By mail: {LEGAL.companyName}, {LEGAL.mailingAddress}
    </p>
  );
}
