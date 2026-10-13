/**
 * LandingPage
 *
 * Public marketing page shown at "/" to signed-out visitors.
 *
 * Sections, top to bottom:
 *   1. Header       logo, section links, theme toggle, sign in / get started
 *   2. Hero         headline, calls to action, trust points, dashboard mockup
 *   3. Features     grid of eight product areas          (#features)
 *   4. Reports      report types and what they include  (#reports)
 *   5. Forms        special field types and sequences    (#forms)
 *   6. Pricing      Starter and Mission plans            (#pricing)
 *   7. Final CTA
 *   8. Footer
 *
 * All copy and lists live in constants at the top of the file, so marketing
 * text can be edited without touching the layout.
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import {
  BarChart3,
  FileText,
  Package,
  ArrowRight,
  Heart,
  Shield,
  DollarSign,
  Clock,
  // Renamed so it does not shadow the browser's built-in Image constructor.
  Image as ImageIcon,
  Link2,
  FolderOpen,
  CheckCircle2,
  TrendingUp,
  Mic,
  type LucideIcon,
} from "lucide-react";

// ===========================================================================
// Brand
// ===========================================================================

/**
 * Product name, used everywhere on this page.
 * Note: the login, feedback and report pages say "FormFlow" while this page
 * says "HumMotion". Pick one and update those pages to match.
 */
const APP_NAME = "HumMotion";

// ===========================================================================
// Content
// ===========================================================================

/**
 * Feature cards. Each color pairs a light tint with a darker icon color, and
 * a dark-mode variant so icons stay readable on dark backgrounds (the
 * original -600 colors were low contrast in dark mode).
 */
const FEATURES: { icon: LucideIcon; title: string; desc: string; color: string }[] = [
  {
    icon: FileText,
    title: "Smart Form Builder",
    desc: "Create volunteer sign-ups, intake forms, and surveys with photo upload and voice memo fields. Connect forms in sequences automatically.",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    icon: DollarSign,
    title: "Donation Log",
    desc: "Record every donation with donor name, amount, campaign, and payment method. Visualize fundraising trends and export for grant reporting.",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    icon: Clock,
    title: "Volunteer Hours Tracker",
    desc: "Log volunteer hours by person and activity. See your top contributors and total impact hours, essential for grant applications.",
    color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    icon: Package,
    title: "Inventory Management",
    desc: "Track donated supplies with quick quantity controls. Get alerts when stock runs low, with a custom threshold for each item.",
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  {
    icon: BarChart3,
    title: "Visual Impact Reports",
    desc: "Five report types covering impact, donations, volunteer hours, inventory, and form submissions, all with charts and PDF export.",
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  {
    icon: ImageIcon,
    title: "Media Library",
    desc: "Upload and organize photos and voice memos from your programs. Attach media directly to form submissions for richer data collection.",
    color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  },
  {
    icon: FolderOpen,
    title: "Link Organizer",
    desc: "Save grant portals, partner websites, and resources in collapsible folders. Everything your team needs, always one click away.",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    icon: TrendingUp,
    title: "Live Dashboard",
    desc: "See total raised, volunteer hours, submissions, and low-stock alerts the moment you log in. Real data, not placeholders.",
    color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  },
];

/** Short reassurance points under the hero buttons. */
const TRUST_POINTS: { icon: LucideIcon; label: string }[] = [
  { icon: Shield, label: "Secure & private" },
  { icon: DollarSign, label: "Non-profit pricing" },
  { icon: CheckCircle2, label: "No credit card needed" },
];

/** Sample figures for the dashboard mockup in the hero. Illustrative only. */
const MOCKUP_STATS: { label: string; value: string; icon: LucideIcon; color: string; bg: string }[] = [
  { label: "Total Raised", value: "$24,850", icon: DollarSign, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
  { label: "Volunteer Hours", value: "1,284", icon: Clock, color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/30" },
  { label: "Form Submissions", value: "647", icon: FileText, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
  { label: "Active Forms", value: "12", icon: BarChart3, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/30" },
];

/** Bar heights for the mockup's "last 14 days" chart. */
const MOCKUP_BARS = [3, 5, 4, 8, 6, 12, 9, 7, 11, 14, 10, 8, 13, 16];

/**
 * Bullet points in the reports section.
 * The original promised a "PDF with your org's branding", but the current
 * PDF export does not use branding settings. Changed to describe what the
 * export actually does; restore the branding line once that is built.
 */
const REPORT_HIGHLIGHTS = [
  "Donation trends with area charts",
  "Top volunteer leaderboards",
  "Form response breakdowns with pie charts",
  "Inventory stock level alerts",
  "Filter by period, like this year or last year",
  "One-click PDF and CSV export",
];

/** The five report types. "nventory Report" typo from the original is fixed. */
const REPORT_TYPES: { icon: LucideIcon; label: string; desc: string }[] = [
  { icon: TrendingUp, label: "Impact Overview", desc: "Total raised, hours, submissions at a glance" },
  { icon: DollarSign, label: "Donation Report", desc: "Trends, campaigns, payment methods" },
  { icon: Clock, label: "Volunteer Hours Report", desc: "Top volunteers, activities, hours over time" },
  { icon: Package, label: "Inventory Report", desc: "Stock levels, categories, restock alerts" },
  { icon: FileText, label: "Form Submissions Report", desc: "Per-field charts, response timeline, raw data" },
];

/** Form capabilities in the forms section (previously four copy-pasted cards). */
const FORM_CAPABILITIES: { icon: LucideIcon; title: string; desc: string; color: string }[] = [
  {
    icon: FileText,
    title: "Text, Email, Number, Date",
    desc: "Standard form fields",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    icon: ImageIcon,
    title: "Photo Upload",
    desc: "Respondents upload images directly from their phone",
    color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  },
  {
    icon: Mic,
    title: "Voice Memo",
    desc: "Record or upload audio directly in the form",
    color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    icon: Link2,
    title: "Connected Form Sequences",
    desc: "Chain forms together: submit one, get routed to the next",
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
];

/** Pricing plans. Keep in sync with PLANS in components/plan-section.tsx and the Stripe prices. */
const PLANS: {
  name: string;
  price: string;
  period: string;
  badge?: string;
  features: string[];
  cta: string;
  highlight: boolean;
}[] = [
  {
    name: "Starter",
    price: "$5",
    period: "per month",
    features: [
      "Unlimited forms with media fields",
      "Donation & volunteer hour tracking",
      "Visual impact reports + PDF export",
      "Media library",
      "Inventory with low-stock alerts",
    ],
    cta: "Start 30-day free trial",
    highlight: false,
  },
  {
    name: "Mission",
    price: "$3",
    period: "per month, billed annually",
    badge: "Save 40%",
    features: ["Everything in Starter", "Custom organization branding", "Priority support", "Early access to new features"],
    cta: "Start 30-day free trial",
    highlight: true,
  },
];

/** In-page links shown in the header on larger screens. */
const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#reports", label: "Reports" },
  { href: "#pricing", label: "Pricing" },
];

// ===========================================================================
// Small presentational components
// ===========================================================================

/** Logo mark: heart icon on a primary-colored square. Decorative. */
function LogoMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box = { sm: "h-7 w-7 rounded-md", md: "h-8 w-8 rounded-md", lg: "h-16 w-16 rounded-2xl" }[size];
  const icon = { sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-8 w-8" }[size];
  return (
    <div className={`${box} bg-primary flex items-center justify-center shrink-0`} aria-hidden="true">
      <Heart className={`${icon} text-primary-foreground`} />
    </div>
  );
}

/** Small label above a section heading. */
function Eyebrow({ children }: { children: string }) {
  return <p className="text-sm font-medium text-primary uppercase tracking-widest">{children}</p>;
}

/**
 * Button that is really a link.
 * The original wrapped <Button> in <a>, putting a <button> inside a link.
 * That is invalid HTML and gives keyboard users two tab stops per button.
 * asChild renders the button styles directly onto the <a>.
 */
function LinkButton({
  href,
  children,
  ...props
}: { href: string; children: React.ReactNode } & Omit<React.ComponentProps<typeof Button>, "asChild">) {
  return (
    <Button asChild {...props}>
      <a href={href}>{children}</a>
    </Button>
  );
}

/**
 * Decorative dashboard preview for the hero.
 * Hidden from screen readers (aria-hidden) because the numbers are made up
 * and would be confusing read aloud; a visually hidden description stands in.
 */
function DashboardMockup() {
  return (
    <figure className="mt-16 relative max-w-5xl mx-auto">
      {/* Soft glow behind the card. "/8" is not a default Tailwind opacity step,
          so the original class generated no CSS; /10 does. */}
      <div className="absolute -inset-4 bg-gradient-to-b from-primary/10 to-transparent rounded-3xl blur-2xl" aria-hidden="true" />
      <figcaption className="sr-only">
        Example dashboard showing total raised, volunteer hours, form submissions and a chart of recent submissions.
      </figcaption>

      <Card className="relative overflow-hidden border shadow-2xl" aria-hidden="true">
        {/* Fake browser bar */}
        <div className="flex items-center gap-2 px-4 py-3 bg-muted/60 border-b">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-destructive/50" />
            <div className="h-3 w-3 rounded-full bg-chart-4/50" />
            <div className="h-3 w-3 rounded-full bg-chart-2/50" />
          </div>
          <div className="flex-1 mx-4 h-6 bg-background rounded-md flex items-center px-3 min-w-0">
            {/* Domains are lowercase; the original showed "app.HumMotion.com". */}
            <span className="text-xs text-muted-foreground truncate">app.{APP_NAME.toLowerCase()}.com/dashboard</span>
          </div>
        </div>

        {/* Dashboard preview */}
        <div className="p-4 sm:p-6 bg-background space-y-4">
          <div>
            <p className="font-serif font-bold text-lg">Good morning, Maria</p>
            <p className="text-sm text-muted-foreground">Here's your organization's impact at a glance</p>
          </div>

          {/* Two columns on phones. The original forced four columns at every
              width, which crushed the cards on small screens. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {MOCKUP_STATS.map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="p-3 rounded-lg border bg-card space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">{stat.label}</p>
                    <div className={`h-7 w-7 rounded-md ${stat.bg} flex items-center justify-center shrink-0`}>
                      <Icon className={`h-3.5 w-3.5 ${stat.color}`} />
                    </div>
                  </div>
                  <p className="text-xl font-bold">{stat.value}</p>
                </div>
              );
            })}
          </div>

          {/* Fake chart */}
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium mb-3">Submissions: Last 14 Days</p>
            <div className="flex items-end gap-1.5 h-20">
              {MOCKUP_BARS.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-sm bg-primary/80"
                  style={{ height: `${(h / Math.max(...MOCKUP_BARS)) * 100}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </Card>
    </figure>
  );
}

// ===========================================================================
// Page component
// ===========================================================================

export default function LandingPage() {
  const { user } = useAuth();

  /** Give the browser tab and search results a descriptive title. */
  useEffect(() => {
    document.title = `${APP_NAME}: Forms, donations, volunteers and impact reports for non-profits`;
  }, []);

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Skip link: lets keyboard users jump past the header. Visible only when focused. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-md focus:bg-background focus:border focus:shadow"
      >
        Skip to content
      </a>

      {/* ===== Header ===== */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-lg bg-background/80 border-b">
        <nav className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-6 py-3" aria-label="Main">
          {/* Logo links home, the usual convention. */}
          <a href="/" className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <LogoMark />
            <span className="font-serif font-bold text-lg tracking-tight" data-testid="text-app-name">
              {APP_NAME}
            </span>
          </a>

          {/* Section links (hidden on small screens to keep the header uncluttered). */}
          <ul className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="hover:text-foreground transition-colors">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {/* Signed-in visitors get a direct way back into the app instead of
                being asked to sign in again. */}
            {user ? (
              <LinkButton href="/dashboard" size="sm" data-testid="button-open-dashboard">
                Open dashboard
              </LinkButton>
            ) : (
              <>
                <LinkButton href="/login" variant="ghost" size="sm" data-testid="button-login">
                  Sign In
                </LinkButton>
                <LinkButton href="/signup" size="sm" data-testid="button-signup">
                  Get Started Free
                </LinkButton>
              </>
            )}
          </div>
        </nav>
      </header>

      <main id="main">
        {/* ===== Hero ===== */}
        <section className="pt-32 pb-24 px-6 relative overflow-hidden">
          {/* Background glow, purely decorative. */}
          <div className="absolute inset-0 -z-10" aria-hidden="true">
            <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] max-w-full h-[600px] bg-primary/5 rounded-full blur-3xl" />
            <div className="absolute top-40 right-0 w-64 h-64 bg-chart-2/5 rounded-full blur-2xl" />
          </div>

          <div className="max-w-6xl mx-auto">
            <div className="max-w-3xl mx-auto text-center space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border bg-muted/60 text-sm text-muted-foreground">
                <Heart className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Built exclusively for non-profits
              </div>

              <h1
                className="text-5xl sm:text-6xl lg:text-7xl font-serif font-bold tracking-tight leading-[1.05]"
                data-testid="text-hero-title"
              >
                Collect data.
                <br />
                Track impact.
                <br />
                <span className="text-primary">Amplify your mission.</span>
              </h1>

              <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
                {APP_NAME} gives non-profits one place to manage forms, donations, volunteer hours, inventory, and visual
                impact reports: everything you need for grant applications and board reporting.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3">
                <LinkButton href={user ? "/dashboard" : "/signup"} size="lg" className="text-base px-8" data-testid="button-get-started">
                  {user ? "Open dashboard" : "Get Started Free"} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </LinkButton>
                {!user && (
                  <LinkButton href="/login" size="lg" variant="outline" className="text-base px-8">
                    Sign In
                  </LinkButton>
                )}
              </div>

              <ul className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground pt-2">
                {TRUST_POINTS.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>

            <DashboardMockup />
          </div>
        </section>

        {/* ===== Features ===== */}
        {/* scroll-mt keeps the fixed header from covering the heading after an in-page jump. */}
        <section id="features" className="py-24 px-6 bg-muted/30 scroll-mt-16" aria-labelledby="features-heading">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16 space-y-3">
              <Eyebrow>Everything you need</Eyebrow>
              <h2 id="features-heading" className="text-4xl font-serif font-bold">
                Tools built for your mission
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto text-lg">
                Replace the spreadsheets, Google Forms, and disconnected tools with one platform made for non-profits.
              </p>
            </div>

            {/* Cards are informational, so the hover "lift" effect that suggested
                they were clickable has been removed. */}
            <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.title}>
                    <Card className="p-5 space-y-3 border-0 shadow-sm bg-background h-full">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${feature.color}`}>
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <h3 className="font-semibold">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ===== Reports showcase ===== */}
        <section id="reports" className="py-24 px-6 scroll-mt-16" aria-labelledby="reports-heading">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6">
              <Eyebrow>Impact Reporting</Eyebrow>
              <h2 id="reports-heading" className="text-4xl font-serif font-bold leading-tight">
                Beautiful reports for every stakeholder
              </h2>
              {/* "Generate visual report types covering" was missing a word; now "five". */}
              <p className="text-muted-foreground text-lg leading-relaxed">
                Generate five visual reports covering impact, donations, volunteer hours, inventory, and form submissions.
                Every report exports to PDF and CSV, ready for your board, donors, and grant applications.
              </p>
              <ul className="space-y-3 pt-2">
                {REPORT_HIGHLIGHTS.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <LinkButton href="/signup">
                Start Generating Reports <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </LinkButton>
            </div>

            {/* Report types. The original showed a hover border and an arrow that
                appeared on hover, but nothing happened on click; those are removed. */}
            <ul className="space-y-3">
              {REPORT_TYPES.map((r) => {
                const Icon = r.icon;
                return (
                  <li key={r.label} className="flex items-center gap-4 p-4 rounded-xl border bg-card">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="font-medium text-sm">{r.label}</h3>
                      <p className="text-xs text-muted-foreground">{r.desc}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ===== Forms showcase ===== */}
        <section id="forms" className="py-24 px-6 bg-muted/30 scroll-mt-16" aria-labelledby="forms-heading">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
            {/* Field types. Shown after the text on mobile, to the left on desktop. */}
            <ul className="space-y-3 order-2 lg:order-1">
              {FORM_CAPABILITIES.map((cap) => {
                const Icon = cap.icon;
                return (
                  <li key={cap.title}>
                    <Card className="p-4 flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-md flex items-center justify-center shrink-0 ${cap.color}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-sm font-medium">{cap.title}</h3>
                        <p className="text-xs text-muted-foreground">{cap.desc}</p>
                      </div>
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                    </Card>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-6 order-1 lg:order-2">
              <Eyebrow>Form Builder</Eyebrow>
              <h2 id="forms-heading" className="text-4xl font-serif font-bold leading-tight">
                Forms that go beyond text fields
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Collect richer data from your community. Add photo upload and voice memo fields to any form. Chain forms
                together for multi-step intake workflows. Share a public link: no login required for respondents.
              </p>
              <LinkButton href="/signup">
                Build Your First Form <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </LinkButton>
            </div>
          </div>
        </section>

        {/* ===== Pricing =====
            Plain background. The original used the same gray as the forms
            section directly above, so the two sections ran together with no
            visible break. */}
        <section id="pricing" className="py-24 px-6 scroll-mt-16" aria-labelledby="pricing-heading">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-14 space-y-3">
              <Eyebrow>Pricing</Eyebrow>
              <h2 id="pricing-heading" className="text-4xl font-serif font-bold">
                Priced for non-profit budgets
              </h2>
              <p className="text-muted-foreground text-lg">
                Spend your funds on your mission, not your tools. Every plan starts with 30 days free, no card needed.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              {PLANS.map((plan) => (
                <Card
                  key={plan.name}
                  className={`p-8 flex flex-col gap-6 ${plan.highlight ? "border-primary ring-2 ring-primary shadow-lg" : ""}`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xl font-serif font-bold">{plan.name}</h3>
                      {plan.badge && (
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary text-primary-foreground">
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <p className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">{plan.price}</span>
                      <span className="text-muted-foreground text-sm">/{plan.period}</span>
                    </p>
                  </div>

                  <ul className="space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {/* mt-auto lines up both buttons at the bottom even though the
                      feature lists are different lengths. */}
                  <LinkButton
                    href="/signup"
                    className="w-full mt-auto"
                    variant={plan.highlight ? "default" : "outline"}
                    size="lg"
                  >
                    {plan.cta} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </LinkButton>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* ===== Final call to action ===== */}
        <section className="py-24 px-6 bg-muted/30" aria-labelledby="cta-heading">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="flex justify-center">
              <LogoMark size="lg" />
            </div>
            <h2 id="cta-heading" className="text-4xl sm:text-5xl font-serif font-bold">
              Ready to amplify your impact?
            </h2>
            <p className="text-muted-foreground text-xl leading-relaxed">
              Join non-profits using {APP_NAME} to collect data, track donations, log volunteer hours, and generate the
              reports that win grants.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <LinkButton
                href={user ? "/dashboard" : "/signup"}
                size="lg"
                className="text-base px-10"
                data-testid="button-cta-bottom"
              >
                {user ? "Open dashboard" : "Get Started Free"} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </LinkButton>
              {!user && (
                <LinkButton href="/login" size="lg" variant="outline" className="text-base px-10">
                  Sign In
                </LinkButton>
              )}
            </div>
            <p className="text-sm text-muted-foreground">No credit card required. Cancel anytime.</p>
          </div>
        </section>
      </main>

      {/* ===== Footer ===== */}
      <footer className="py-10 px-6 border-t">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <LogoMark size="sm" />
            <span className="font-serif font-bold text-foreground">{APP_NAME}</span>
            <span>Built for non-profits</span>
          </div>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <li>
                <a href="/login" className="hover:text-foreground transition-colors">
                  Sign In
                </a>
              </li>
              <li>
                <a href="/signup" className="hover:text-foreground transition-colors">
                  Sign Up
                </a>
              </li>
              <li>
                <a href="/feedback" className="hover:text-foreground transition-colors">
                  Contact
                </a>
              </li>
              <li>
                <a href="/terms" className="hover:text-foreground transition-colors">
                  Terms
                </a>
              </li>
              <li>
                <a href="/privacy" className="hover:text-foreground transition-colors">
                  Privacy
                </a>
              </li>
              <li>
                <a href="/refunds" className="hover:text-foreground transition-colors">
                  Refunds
                </a>
              </li>
            </ul>
          </nav>
          <p>
            &copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}