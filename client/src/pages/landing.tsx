import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  BarChart3, FileText, Package, ArrowRight, Heart, Shield,
  DollarSign, Clock, Image, Link2, MessageSquare, FolderOpen,
  CheckCircle2, TrendingUp, Users, Mic, ChevronRight
} from "lucide-react";

const FEATURES = [
  {
    icon: FileText,
    title: "Smart Form Builder",
    desc: "Create volunteer sign-ups, intake forms, and surveys with photo upload and voice memo fields. Connect forms in sequences automatically.",
    color: "bg-blue-500/10 text-blue-600",
  },
  {
    icon: DollarSign,
    title: "Donation Log",
    desc: "Record every donation with donor name, amount, campaign, and payment method. Visualize fundraising trends and export for grant reporting.",
    color: "bg-emerald-500/10 text-emerald-600",
  },
  {
    icon: Clock,
    title: "Volunteer Hours Tracker",
    desc: "Log volunteer hours by person and activity. See your top contributors and total impact hours: essential for grant applications.",
    color: "bg-violet-500/10 text-violet-600",
  },
  {
    icon: Package,
    title: "Inventory Management",
    desc: "Track donated supplies with real-time quantity controls. Get instant red alerts when stock runs low, with a custom threshold per item.",
    color: "bg-orange-500/10 text-orange-600",
  },
  {
    icon: BarChart3,
    title: "Visual Impact Reports",
    desc: "Five report types: Impact Overview, Donations, Volunteer Hours, Inventory, and Form Submissions: all with charts and PDF export.",
    color: "bg-rose-500/10 text-rose-600",
  },
  {
    icon: Image,
    title: "Media Library",
    desc: "Upload and organize photos and voice memos from your programs. Attach media directly to form submissions for richer data collection.",
    color: "bg-cyan-500/10 text-cyan-600",
  },
  {
    icon: FolderOpen,
    title: "Link Organizer",
    desc: "Save grant portals, partner websites, and resources in collapsible folders. Everything your team needs, always one click away.",
    color: "bg-amber-500/10 text-amber-600",
  },
  {
    icon: TrendingUp,
    title: "Live Dashboard",
    desc: "See total raised, volunteer hours, submissions, and low-stock alerts the moment you log in. Real data, not placeholders.",
    color: "bg-indigo-500/10 text-indigo-600",
  },
];

const PLANS = [
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
    cta: "Start Free",
    highlight: false,
  },
  {
    name: "Mission",
    price: "$3",
    period: "per month, billed annually",
    badge: "Save 40%",
    features: [
      "Everything in Starter",
      "Custom organization branding",
      "Priority support",
      "Early access to new features",
    ],
    cta: "Get Mission Plan",
    highlight: true,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-lg bg-background/80 border-b">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <Heart className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-serif font-bold text-lg tracking-tight" data-testid="text-app-name">FormFlow</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a href="/login"><Button variant="ghost" size="sm" data-testid="button-login">Sign In</Button></a>
            <a href="/signup"><Button size="sm" data-testid="button-signup">Get Started Free</Button></a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute top-40 right-0 w-64 h-64 bg-chart-2/5 rounded-full blur-2xl" />
        </div>

        <div className="max-w-6xl mx-auto">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border bg-muted/60 text-sm text-muted-foreground">
              <Heart className="h-3.5 w-3.5 text-primary" />
              Built exclusively for non-profits
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-serif font-bold tracking-tight leading-[1.05]" data-testid="text-hero-title">
              Collect data.<br />
              Track impact.<br />
              <span className="text-primary">Amplify your mission.</span>
            </h1>

            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              FormFlow gives non-profits one place to manage forms, donations, volunteer hours, inventory, and visual impact reports: everything you need for grant applications and board reporting.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <a href="/signup">
                <Button size="lg" className="text-base px-8" data-testid="button-get-started">
                  Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
              <a href="/login">
                <Button size="lg" variant="outline" className="text-base px-8">
                  Sign In
                </Button>
              </a>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground pt-2">
              {[
                { icon: Shield, label: "Secure & private" },
                { icon: DollarSign, label: "Non-profit pricing" },
                { icon: CheckCircle2, label: "No credit card needed" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hero dashboard mockup */}
          <div className="mt-16 relative max-w-5xl mx-auto">
            <div className="absolute -inset-4 bg-gradient-to-b from-primary/8 to-transparent rounded-3xl blur-2xl" />
            <Card className="relative overflow-hidden border shadow-2xl">
              {/* Fake browser bar */}
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/60 border-b">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-destructive/50" />
                  <div className="h-3 w-3 rounded-full bg-chart-4/50" />
                  <div className="h-3 w-3 rounded-full bg-chart-2/50" />
                </div>
                <div className="flex-1 mx-4 h-6 bg-background rounded-md flex items-center px-3">
                  <span className="text-xs text-muted-foreground">app.formflow.org/dashboard</span>
                </div>
              </div>
              {/* Dashboard preview */}
              <div className="p-6 bg-background space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-serif font-bold text-lg">Good morning, Sarah 👋</p>
                    <p className="text-sm text-muted-foreground">Here's your organization's impact at a glance</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Total Raised", value: "$24,850", icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
                    { label: "Volunteer Hours", value: "1,284", icon: Clock, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30" },
                    { label: "Form Submissions", value: "647", icon: FileText, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/30" },
                    { label: "Active Forms", value: "12", icon: BarChart3, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/30" },
                  ].map(stat => (
                    <div key={stat.label} className="p-3 rounded-lg border bg-card space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">{stat.label}</p>
                        <div className={`h-7 w-7 rounded-md ${stat.bg} flex items-center justify-center`}>
                          <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
                        </div>
                      </div>
                      <p className="text-xl font-bold">{stat.value}</p>
                    </div>
                  ))}
                </div>
                {/* Fake chart bars */}
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-medium mb-3">Submissions: Last 14 Days</p>
                  <div className="flex items-end gap-1.5 h-20">
                    {[3, 5, 4, 8, 6, 12, 9, 7, 11, 14, 10, 8, 13, 16].map((h, i) => (
                      <div key={i} className="flex-1 rounded-t-sm bg-primary/80 transition-all" style={{ height: `${(h / 16) * 100}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="py-24 px-6 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16 space-y-3">
            <p className="text-sm font-medium text-primary uppercase tracking-widest">Everything you need</p>
            <h2 className="text-4xl font-serif font-bold">Tools built for your mission</h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg">
              Replace the spreadsheets, Google Forms, and disconnected tools with one platform made for non-profits.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="p-5 space-y-3 hover-elevate border-0 shadow-sm bg-background">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${feature.color}`}>
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Report showcase */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-6">
            <p className="text-sm font-medium text-primary uppercase tracking-widest">Impact Reporting</p>
            <h2 className="text-4xl font-serif font-bold leading-tight">Beautiful reports for every stakeholder</h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Generate visual report types covering Impact Overview, Donations, Volunteer Hours, Inventory, and Form Submissions. Every report exports to PDF and CSV, ready for your board, donors, and grant applications.
            </p>
            <div className="space-y-3 pt-2">
              {[
                "Donation trends with area charts",
                "Top volunteer leaderboards",
                "Form response breakdowns with pie charts",
                "Inventory stock level alerts",
                "One-click PDF with your org's branding",
              ].map(item => (
                <div key={item} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <a href="/signup">
              <Button>
                Start Generating Reports <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>

          {/* Report type pills */}
          <div className="space-y-3">
            {[
              { icon: TrendingUp, label: "📊 Impact Overview", desc: "Total raised, hours, submissions at a glance" },
              { icon: DollarSign, label: "💰 Donation Report", desc: "Trends, campaigns, payment methods" },
              { icon: Clock, label: "⏱️ Volunteer Hours Report", desc: "Top volunteers, activities, hours over time" },
              { icon: Package, label: "📦 Inventory Report", desc: "Stock levels, categories, restock alerts" },
              { icon: FileText, label: "📋 Form Submissions Report", desc: "Per-field charts, response timeline, raw data" },
            ].map((r, i) => (
              <div key={r.label} className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors group">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                  <r.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.desc}</p>
                </div>
                <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Media / Forms showcase */}
      <section className="py-24 px-6 bg-muted/30">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: form field types */}
          <div className="space-y-3 order-2 lg:order-1">
            <Card className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Text, Email, Number, Date</p>
                <p className="text-xs text-muted-foreground">Standard form fields</p>
              </div>
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-cyan-500/10 flex items-center justify-center shrink-0">
                <Image className="h-4 w-4 text-cyan-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Photo Upload</p>
                <p className="text-xs text-muted-foreground">Respondents upload images directly from their phone</p>
              </div>
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0">
                <Mic className="h-4 w-4 text-violet-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Voice Memo</p>
                <p className="text-xs text-muted-foreground">Record or upload audio directly in the form</p>
              </div>
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-rose-500/10 flex items-center justify-center shrink-0">
                <Link2 className="h-4 w-4 text-rose-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Connected Form Sequences</p>
                <p className="text-xs text-muted-foreground">Chain forms together: submit one, get routed to the next</p>
              </div>
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            </Card>
          </div>

          <div className="space-y-6 order-1 lg:order-2">
            <p className="text-sm font-medium text-primary uppercase tracking-widest">Form Builder</p>
            <h2 className="text-4xl font-serif font-bold leading-tight">Forms that go beyond text fields</h2>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Collect richer data from your community. Add photo upload and voice memo fields to any form. Chain forms together for multi-step intake workflows. Share a public link: no login required for respondents.
            </p>
            <a href="/signup">
              <Button>
                Build Your First Form <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-24 px-6 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14 space-y-3">
            <p className="text-sm font-medium text-primary uppercase tracking-widest">Pricing</p>
            <h2 className="text-4xl font-serif font-bold">Priced for non-profit budgets</h2>
            <p className="text-muted-foreground text-lg">Spend your funds on your mission, not your tools.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {PLANS.map((plan) => (
              <Card key={plan.name} className={`p-8 space-y-6 ${plan.highlight ? "border-primary ring-2 ring-primary shadow-lg" : ""}`}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xl font-serif font-bold">{plan.name}</h3>
                    {plan.badge && (
                      <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary text-primary-foreground">{plan.badge}</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground text-sm">/{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <a href="/signup" className="block">
                  <Button className="w-full" variant={plan.highlight ? "default" : "outline"} size="lg">
                    {plan.cta} <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </a>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center space-y-8">
          <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center mx-auto">
            <Heart className="h-8 w-8 text-primary-foreground" />
          </div>
          <h2 className="text-4xl sm:text-5xl font-serif font-bold">Ready to amplify your impact?</h2>
          <p className="text-muted-foreground text-xl leading-relaxed">
            Join non-profits using FormFlow to collect data, track donations, log volunteer hours, and generate the reports that win grants.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a href="/signup">
              <Button size="lg" className="text-base px-10" data-testid="button-cta-bottom">
                Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <a href="/login">
              <Button size="lg" variant="outline" className="text-base px-10">
                Sign In
              </Button>
            </a>
          </div>
          <p className="text-sm text-muted-foreground">No credit card required · Cancel anytime</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
              <Heart className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-serif font-bold text-foreground">FormFlow</span>
            <span>· Built for non-profits</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/login" className="hover:text-foreground transition-colors">Sign In</a>
            <a href="/signup" className="hover:text-foreground transition-colors">Sign Up</a>
            <a href="/feedback" className="hover:text-foreground transition-colors">Contact</a>
          </div>
          <p>&copy; {new Date().getFullYear()} FormFlow. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
