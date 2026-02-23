import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
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
import FeedbackPage from "@/pages/feedback";
import MediaPage from "@/pages/media";
import DonationsPage from "@/pages/donations";
import VolunteerHoursPage from "@/pages/volunteer-hours";

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
      <Route path="/settings" component={SettingsPage} />
      <Route path="/feedback" component={FeedbackPage} />
      <Route path="/forms/:id/submit" component={SubmitFormPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
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
  );
}

function UnauthenticatedRouter() {
  return (
    <Switch>
      <Route path="/signup" component={SignupPage} />
      <Route path="/login" component={LoginPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/forms/:id/submit" component={SubmitFormPage} />
      <Route component={LandingPage} />
    </Switch>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="space-y-4 text-center">
          <Skeleton className="h-10 w-10 rounded-md mx-auto" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  return user ? <AuthenticatedLayout /> : <UnauthenticatedRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <AppContent />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
