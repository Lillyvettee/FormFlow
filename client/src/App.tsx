/**
 * App
 *
 * Top-level providers and routing.
 *
 * Route layout:
 *
 *   Full-page routes (work whether or not you're signed in):
 *     /invite/:token     accept a team invitation
 *     /login, /signup    shown to signed-out visitors;
 *                        signed-in users are sent to the dashboard instead
 *     /forgot-password
 *     /reset-password    where password reset emails land
 *     /delete-account    where account deletion confirmation emails land
 *     /terms, /privacy, /refunds   legal pages (linked from landing, signup
 *                        and the Plan section)
 *
 *   Signed in:
 *     The sidebar layout, wrapped in OrganizationGate, so the app only appears
 *     once the user belongs to an organization. Dashboard is at "/".
 *
 *   Signed out:
 *     Public form submission, the feedback page, and the landing page for
 *     everything else.
 *
 * Providers:
 *   OrganizationProvider sits inside the theme/tooltip providers and wraps all
 *   routes, so the invite page (outside the gate) can use it too.
 */

import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { OrganizationProvider } from "@/hooks/use-organization";
import { OrganizationGate } from "@/components/organization-gate";
import { BillingBanner } from "@/components/billing-banner";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import FormsPage from "@/pages/forms";
import ReportsPage from "@/pages/reports";
import LinksPage from "@/pages/links-page";
import InventoryPage from "@/pages/inventory";
import SettingsPage from "@/pages/settings";
import SubmitFormPage from "@/pages/submit-form";
import SignupPage from "@/pages/signup";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import DeleteAccountPage from "@/pages/delete-account";
import FeedbackPage from "@/pages/feedback";
import MediaPage from "@/pages/media";
import DonationsPage from "@/pages/donations";
import VolunteerHoursPage from "@/pages/volunteer-hours";
import TeamPage from "@/pages/team";
import AcceptInvitePage from "@/pages/accept-invite";
import TermsPage from "@/pages/terms";
import PrivacyPage from "@/pages/privacy";
import RefundsPage from "@/pages/refunds";

// ===========================================================================
// Signed-in area
// ===========================================================================

/** Pages inside the sidebar layout. */
function AuthenticatedRouter() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/forms" component={FormsPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/links" component={LinksPage} />
      <Route path="/inventory" component={InventoryPage} />
      <Route path="/media" component={MediaPage} />
      <Route path="/donations" component={DonationsPage} />
      <Route path="/volunteer-hours" component={VolunteerHoursPage} />
      <Route path="/team" component={TeamPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/feedback" component={FeedbackPage} />
      <Route path="/forms/:id/submit" component={SubmitFormPage} />
      {/* Old bookmarks or links to /dashboard land on the dashboard. */}
      <Route path="/dashboard">
        <Redirect to="/" replace />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * Sidebar layout for signed-in users.
 *
 * OrganizationGate wraps the whole layout, so someone without an
 * organization sees the full-page setup screen rather than a sidebar full of
 * links that would not work yet.
 *
 * BillingBanner shows trial days left, read-only mode or a failed payment.
 */
function AuthenticatedLayout() {
  return (
    <OrganizationGate>
      <SidebarProvider>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <BillingBanner />
            <header className="flex items-center justify-between gap-4 p-3 border-b shrink-0 sticky top-0 z-50 bg-background/80 backdrop-blur-lg">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <ThemeToggle />
            </header>
            <main className="flex-1 overflow-auto">
              <AuthenticatedRouter />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </OrganizationGate>
  );
}

// ===========================================================================
// Signed-out area
// ===========================================================================

/**
 * Pages for signed-out visitors. Login, signup and forgot-password moved to
 * the top-level router (see AppContent) because invite links need them to
 * work for everyone.
 */
function UnauthenticatedRouter() {
  return (
    <Switch>
      <Route path="/forms/:id/submit" component={SubmitFormPage} />
      {/* The landing page footer links "Contact" here; the page supports signed-out visitors. */}
      <Route path="/feedback" component={FeedbackPage} />
      <Route component={LandingPage} />
    </Switch>
  );
}

// ===========================================================================
// Top-level routing
// ===========================================================================

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background" aria-busy="true">
        <div className="space-y-4 text-center">
          <Skeleton className="h-10 w-10 rounded-md mx-auto" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  /**
   * A real (non-demo) account. Demo visitors are signed in too, but as
   * temporary anonymous users, and they still need the login and signup
   * pages so they can switch to a real account.
   */
  const hasRealAccount = Boolean(user && !user.is_anonymous);

  return (
    <Switch>
      {/* Full-page routes that work for everyone. */}
      <Route path="/invite/:token" component={AcceptInvitePage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/delete-account" component={DeleteAccountPage} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/refunds" component={RefundsPage} />

      {/* Signed-in users go to the dashboard instead of seeing login/signup.
          Each page also honors ?redirect=, which is how invite links send
          people back to /invite/:token after they sign in. */}
      <Route path="/login">{hasRealAccount ? <Redirect to="/" replace /> : <LoginPage />}</Route>
      <Route path="/signup">{hasRealAccount ? <Redirect to="/" replace /> : <SignupPage />}</Route>

      {/* Everything else depends on whether someone is signed in. */}
      <Route>{user ? <AuthenticatedLayout /> : <UnauthenticatedRouter />}</Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <OrganizationProvider>
            <AppContent />
          </OrganizationProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;