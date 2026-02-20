import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { BarChart3, FileText, Package, ArrowRight, Heart, Shield, Zap, Users, Globe, ClipboardList } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-lg bg-background/80 border-b">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <Heart className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg tracking-tight" data-testid="text-app-name">FormFlow</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a href="/login">
              <Button variant="outline" data-testid="button-login">Sign In</Button>
            </a>
            <a href="/signup">
              <Button data-testid="button-signup">Sign Up</Button>
            </a>
          </div>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <div className="space-y-4">
              <p className="text-sm font-medium text-muted-foreground tracking-wider uppercase">Built for Non-Profits</p>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-serif font-bold tracking-tight leading-tight" data-testid="text-hero-title">
                Collect data.<br />
                Track resources.<br />
                <span className="text-primary">Amplify your mission.</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-md leading-relaxed">
                The all-in-one platform designed for non-profits to create forms, manage donations and supplies, generate impact reports, and keep your organization running smoothly.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a href="/signup">
                <Button size="lg" data-testid="button-get-started">
                  Get Started Free
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5" />
                <span>Secure & Private</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                <span>Non-profit pricing</span>
              </div>
            </div>
          </div>
          <div className="hidden lg:block">
            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-tr from-primary/10 via-transparent to-primary/5 rounded-2xl" />
              <Card className="relative p-6 space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b">
                  <div className="h-3 w-3 rounded-full bg-destructive/60" />
                  <div className="h-3 w-3 rounded-full bg-chart-4/60" />
                  <div className="h-3 w-3 rounded-full bg-chart-2/60" />
                  <span className="ml-2 text-sm text-muted-foreground">Dashboard Preview</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Active Forms", value: "8", icon: ClipboardList },
                    { label: "Responses", value: "1,024", icon: Users },
                    { label: "Supplies", value: "142", icon: Package },
                  ].map((item) => (
                    <div key={item.label} className="p-3 rounded-md bg-muted/50 space-y-1.5">
                      <item.icon className="h-4 w-4 text-muted-foreground" />
                      <p className="text-xl font-bold">{item.value}</p>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {[
                    { w: 75, label: "Volunteer Sign-Up" },
                    { w: 60, label: "Donation Intake" },
                    { w: 45, label: "Event Registration" },
                    { w: 30, label: "Feedback Survey" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="h-2 rounded-full bg-primary/20" style={{ width: `${item.w}%` }}>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${item.w + 10}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{item.label}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-6 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14 space-y-3">
            <h2 className="text-3xl font-serif font-bold">Tools built for your mission</h2>
            <p className="text-muted-foreground max-w-lg mx-auto">Powerful, affordable tools to collect data, track supplies and donations, and generate impact reports for your non-profit.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: FileText,
                title: "Form Builder",
                desc: "Create volunteer sign-ups, donation forms, event registrations, and surveys. Collect the data your organization needs.",
              },
              {
                icon: BarChart3,
                title: "Impact Reports",
                desc: "Generate reports with charts to share with your board, donors, and stakeholders. Export to CSV for grant applications.",
              },
              {
                icon: Package,
                title: "Resource Tracking",
                desc: "Track donated supplies, equipment, and inventory. Monitor quantities, values, and supplier contacts in one place.",
              },
              {
                icon: Globe,
                title: "Link Management",
                desc: "Organize partner websites, grant portals, donor resources, and community links. Keep everything your team needs at hand.",
              },
              {
                icon: Users,
                title: "Team Friendly",
                desc: "Simple enough for any team member to use. No technical skills needed to create forms or view reports.",
              },
              {
                icon: Heart,
                title: "Non-Profit Pricing",
                desc: "Affordable plans designed specifically for non-profit budgets. Focus your funds on your mission, not your tools.",
              },
            ].map((feature) => (
              <Card key={feature.title} className="p-6 space-y-3 hover-elevate">
                <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-lg">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-3xl font-serif font-bold">Ready to empower your non-profit?</h2>
          <p className="text-muted-foreground text-lg">Join organizations that use FormFlow to streamline operations, collect data, and measure their impact.</p>
          <a href="/signup">
            <Button size="lg" data-testid="button-cta-bottom">
              Start Free Today
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </a>
        </div>
      </section>

      <footer className="py-8 px-6 border-t">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4" />
            <span>FormFlow</span>
          </div>
          <p>&copy; {new Date().getFullYear()} FormFlow. Built for non-profits.</p>
        </div>
      </footer>
    </div>
  );
}
