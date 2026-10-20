/**
 * EnterprisePage
 *
 * Route: /enterprise. The Enterprise plan's "Contact us" form, linked from
 * the pricing cards on the landing page and in Settings > Plan. Works signed
 * in or out.
 *
 * Sends to the enterprise-inquiry Edge Function, which saves the request in
 * enterprise_inquiries (migration 016) and emails info@hummotion.com.
 * After a successful send, a thank-you screen replaces the form.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppLogo } from "@/components/app-logo";
import { useAuth } from "@/hooks/use-auth";
import { callFunction } from "@/lib/functions";
import { LEGAL } from "@/lib/legal";
import { PLANS } from "@/lib/plans";
import { AlertCircle, Building2, CheckCircle2, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Values must match the check in migration 016 and SIZES in the function. */
const SIZE_OPTIONS = [
  { value: "1-10", label: "1-10 people" },
  { value: "11-50", label: "11-50 people" },
  { value: "51-200", label: "51-200 people" },
  { value: "201-1000", label: "201-1,000 people" },
  { value: "1000+", label: "More than 1,000 people" },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_GOAL = 2000;
const MAX_NEEDS = 4000;

interface Draft {
  fullName: string;
  organizationName: string;
  email: string;
  workEmail: string;
  department: string;
  organizationSize: string;
  workGoal: string;
  enterpriseNeeds: string;
}

const EMPTY: Draft = {
  fullName: "",
  organizationName: "",
  email: "",
  workEmail: "",
  department: "",
  organizationSize: "",
  workGoal: "",
  enterpriseNeeds: "",
};

/** Inline error per field, or none. */
function validate(d: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const required = (key: keyof Draft, message: string) => {
    if (!d[key].trim()) errors[key] = message;
  };
  required("fullName", "Enter your name.");
  required("organizationName", "Enter your organization's name.");
  required("department", "Enter your department.");
  required("workGoal", "Tell us what you'd like to achieve.");
  required("enterpriseNeeds", "Tell us what you need from Enterprise.");
  if (!d.organizationSize) errors.organizationSize = "Choose your organization's size.";
  if (!EMAIL_PATTERN.test(d.email.trim())) errors.email = "Enter an email address like you@example.com.";
  if (!EMAIL_PATTERN.test(d.workEmail.trim())) errors.workEmail = "Enter your work email, like you@organization.org.";
  return errors;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EnterprisePage() {
  const { user } = useAuth();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** Bots fill in this hidden field; people never see it. */
  const [website, setWebsite] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = `Enterprise - ${LEGAL.appName}`;
    window.scrollTo(0, 0);
  }, []);

  // Signed-in visitors: start with their account email.
  useEffect(() => {
    if (user?.email && !user.is_anonymous) setDraft((d) => (d.email ? d : { ...d, email: user.email! }));
  }, [user?.email, user?.is_anonymous]);

  const errors = validate(draft);
  const hasErrors = Object.keys(errors).length > 0;
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));
  const errorFor = (key: keyof Draft) => (showErrors ? errors[key] : undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending) return;
    setShowErrors(true);
    if (hasErrors) {
      // Move to the first problem so keyboard and screen reader users find it.
      const first = (Object.keys(EMPTY) as (keyof Draft)[]).find((k) => errors[k]);
      if (first) document.getElementById(`enterprise-${first}`)?.focus();
      return;
    }
    setIsSending(true);
    setSendError("");
    try {
      await callFunction("enterprise-inquiry", { ...draft, website }, "We couldn't send your request. Please try again.");
      setSent(true);
      window.scrollTo(0, 0);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "We couldn't send your request. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  /** A labeled input with its inline error. */
  const field = (key: keyof Draft, label: string, input: React.ReactNode, help?: string) => (
    <div className="space-y-2">
      <Label htmlFor={`enterprise-${key}`}>{label}</Label>
      {input}
      {errorFor(key) ? (
        <p id={`enterprise-${key}-error`} className="text-xs text-destructive">
          {errorFor(key)}
        </p>
      ) : (
        help && <p className="text-xs text-muted-foreground">{help}</p>
      )}
    </div>
  );
  const inputProps = (key: keyof Draft) => ({
    id: `enterprise-${key}`,
    value: draft[key],
    onChange: set(key),
    "aria-invalid": Boolean(errorFor(key)),
    "aria-describedby": errorFor(key) ? `enterprise-${key}-error` : undefined,
  });

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 px-4 sm:px-6 py-3">
          <a
            href="/"
            className="flex items-center gap-2 rounded-md font-serif font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AppLogo className="h-7 w-7" />
            {LEGAL.appName}
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-10">
        {sent ? (
          <div role="status" className="max-w-xl mx-auto flex flex-col items-center text-center space-y-4 py-16">
            <div className="h-16 w-16 rounded-full bg-chart-2/10 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-chart-2" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-serif font-bold">Thank you</h1>
            <p className="text-muted-foreground">
              We've received your request and will reply to{" "}
              <span className="font-medium text-foreground">{draft.workEmail.trim()}</span> soon.
            </p>
            <a href={user ? "/settings#plan" : "/"} className="text-sm text-primary hover:underline">
              {user ? "Back to Settings" : "Back to home"}
            </a>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            {/* ===== What Enterprise includes ===== */}
            <section className="space-y-5" aria-labelledby="enterprise-heading">
              <div className="h-12 w-12 rounded-md bg-primary/10 flex items-center justify-center">
                <Building2 className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <h1 id="enterprise-heading" className="text-3xl font-serif font-bold">
                Talk to us about Enterprise
              </h1>
              <p className="text-muted-foreground">
                Everything in {LEGAL.appName}, with no limits, priced for your organization. Tell us a little about your
                team and we'll put together a quote.
              </p>
              <ul className="space-y-2 text-sm">
                {PLANS.enterprise.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden="true" /> {h}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                Prefer email? Write to{" "}
                <a href={`mailto:${LEGAL.contactEmail}`} className="text-primary hover:underline">
                  {LEGAL.contactEmail}
                </a>
                .
              </p>
            </section>

            {/* ===== Form ===== */}
            <Card className="p-6">
              <form onSubmit={submit} className="space-y-4" noValidate>
                <div className="grid gap-4 sm:grid-cols-2">
                  {field("fullName", "Your name", <Input autoComplete="name" maxLength={150} {...inputProps("fullName")} />)}
                  {field(
                    "organizationName",
                    "Organization",
                    <Input autoComplete="organization" maxLength={200} {...inputProps("organizationName")} />,
                  )}
                  {field(
                    "email",
                    "Email",
                    <Input type="email" autoComplete="email" maxLength={320} placeholder="you@example.com" {...inputProps("email")} />,
                  )}
                  {field(
                    "workEmail",
                    "Work email",
                    <Input type="email" autoComplete="work email" maxLength={320} placeholder="you@organization.org" {...inputProps("workEmail")} />,
                    "We'll reply here.",
                  )}
                  {field(
                    "department",
                    "Department",
                    <Input maxLength={150} placeholder="e.g. Programs, Development, Operations" {...inputProps("department")} />,
                  )}
                  {field(
                    "organizationSize",
                    "Organization size",
                    <select
                      {...inputProps("organizationSize")}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="" disabled>
                        Choose a size
                      </option>
                      {SIZE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>,
                  )}
                </div>

                {field(
                  "workGoal",
                  "Work goal",
                  <Textarea rows={3} maxLength={MAX_GOAL} placeholder="What would you like to achieve with HumMotion?" {...inputProps("workGoal")} />,
                )}
                {field(
                  "enterpriseNeeds",
                  "Enterprise-specific needs",
                  <Textarea
                    rows={4}
                    maxLength={MAX_NEEDS}
                    placeholder="For example: number of sites, expected forms and clients, single sign-on, data migration, invoicing"
                    {...inputProps("enterpriseNeeds")}
                  />,
                )}

                {/* Honeypot: hidden from people and screen readers. */}
                <div className="hidden" aria-hidden="true">
                  <label htmlFor="enterprise-website">Website</label>
                  <input
                    id="enterprise-website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>

                {sendError && (
                  <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{sendError}</span>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={isSending} data-testid="button-send-enterprise">
                  {isSending ? "Sending..." : "Contact sales"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  We'll only use these details to reply to you. See our{" "}
                  <a href="/privacy" className="underline hover:text-foreground">
                    Privacy Policy
                  </a>
                  .
                </p>
              </form>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
