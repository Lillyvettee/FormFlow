import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Settings, Building2, Crown, Check, UserCog, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import type { UserSettings, Subscription } from "@shared/schema";

const THEME_COLORS = [
  { name: "Blue", value: "#1a56db" },
  { name: "Indigo", value: "#4f46e5" },
  { name: "Violet", value: "#7c3aed" },
  { name: "Rose", value: "#e11d48" },
  { name: "Emerald", value: "#059669" },
  { name: "Amber", value: "#d97706" },
  { name: "Slate", value: "#475569" },
  { name: "Teal", value: "#0d9488" },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: settings, isLoading: settingsLoading } = useQuery<UserSettings>({ queryKey: ["/api/settings"] });
  const { data: subscription, isLoading: subLoading } = useQuery<Subscription>({ queryKey: ["/api/subscription"] });

  const [companyName, setCompanyName] = useState("");
  const [themeColor, setThemeColor] = useState("#1a56db");
  const [logoUrl, setLogoUrl] = useState("");

  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profileCompany, setProfileCompany] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    if (settings) {
      setCompanyName(settings.companyName || "");
      setThemeColor(settings.themeColor || "#1a56db");
      setLogoUrl(settings.logoUrl || "");
    }
  }, [settings]);

  useEffect(() => {
    if (user) {
      setProfileFirstName(user.firstName || "");
      setProfileLastName(user.lastName || "");
      setProfilePhone((user as any).phone || "");
      setProfileCompany((user as any).companyName || "");
    }
  }, [user]);

  const hasPasswordAuth = !!(user as any)?.hasPassword;

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PUT", "/api/settings", {
        companyName: companyName || null,
        themeColor,
        logoUrl: logoUrl || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: async (plan: string) => {
      return apiRequest("POST", "/api/subscription", { plan });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      toast({ title: "Subscription updated" });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const profileMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", "/api/auth/profile", {
        firstName: profileFirstName.trim(),
        lastName: profileLastName.trim(),
        phone: profilePhone.trim() || null,
        companyName: profileCompany.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Profile updated" });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/auth/change-password", {
        currentPassword,
        newPassword,
        confirmPassword: confirmNewPassword,
      });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordError("");
      toast({ title: "Password updated" });
    },
    onError: (error: Error) => {
      const msg = error.message.replace(/^\d+:\s*/, "");
      setPasswordError(msg);
    },
  });

  const passwordValid =
    newPassword.length >= 8 &&
    /[A-Z]/.test(newPassword) &&
    /[a-z]/.test(newPassword) &&
    /\d/.test(newPassword);
  const passwordsMatch = newPassword === confirmNewPassword;
  const canChangePassword = currentPassword && passwordValid && passwordsMatch;

  const isLoading = settingsLoading || subLoading;

  return (
    <div className="p-6 space-y-8 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold" data-testid="text-settings-title">Settings</h1>
        <p className="text-muted-foreground">Manage your account, branding, and plan</p>
      </div>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
            <UserCog className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Profile</h2>
            <p className="text-sm text-muted-foreground">Update your personal information</p>
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="profile-first-name">First Name</Label>
                <Input
                  id="profile-first-name"
                  value={profileFirstName}
                  onChange={(e) => setProfileFirstName(e.target.value)}
                  data-testid="input-profile-first-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-last-name">Last Name</Label>
                <Input
                  id="profile-last-name"
                  value={profileLastName}
                  onChange={(e) => setProfileLastName(e.target.value)}
                  data-testid="input-profile-last-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                value={user?.email || ""}
                disabled
                className="bg-muted"
                data-testid="input-profile-email"
              />
              <p className="text-xs text-muted-foreground">Email cannot be changed</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-phone">Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="profile-phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={profilePhone}
                onChange={(e) => setProfilePhone(e.target.value)}
                data-testid="input-profile-phone"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-company">Organization <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="profile-company"
                placeholder="Your non-profit name"
                value={profileCompany}
                onChange={(e) => setProfileCompany(e.target.value)}
                data-testid="input-profile-company"
              />
            </div>
            <Button
              onClick={() => profileMutation.mutate()}
              disabled={!profileFirstName.trim() || !profileLastName.trim() || profileMutation.isPending}
              data-testid="button-save-profile"
            >
              {profileMutation.isPending ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        )}
      </Card>

      {hasPasswordAuth && (
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-lg">Change Password</h2>
              <p className="text-sm text-muted-foreground">Update your account password</p>
            </div>
          </div>
          <div className="space-y-4">
            {passwordError && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm" data-testid="text-password-error">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrentPassword ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  data-testid="input-current-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  tabIndex={-1}
                >
                  {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNewPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  data-testid="input-new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  tabIndex={-1}
                >
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {newPassword && !passwordValid && (
                <p className="text-xs text-destructive">
                  Must be 8+ chars with uppercase, lowercase, and a number
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-new-password">Confirm New Password</Label>
              <Input
                id="confirm-new-password"
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                data-testid="input-confirm-new-password"
              />
              {confirmNewPassword && !passwordsMatch && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
            <Button
              onClick={() => passwordMutation.mutate()}
              disabled={!canChangePassword || passwordMutation.isPending}
              data-testid="button-change-password"
            >
              {passwordMutation.isPending ? "Updating..." : "Change Password"}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Organization Branding</h2>
            <p className="text-sm text-muted-foreground">Customize your organization's appearance</p>
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="company-name">Organization Name</Label>
              <Input
                id="company-name"
                placeholder="Your non-profit name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                data-testid="input-company-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="logo-url">Logo URL</Label>
              <Input
                id="logo-url"
                placeholder="https://example.com/logo.png"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                data-testid="input-logo-url"
              />
              {logoUrl && (
                <div className="mt-2 p-3 border rounded-md inline-block">
                  <img src={logoUrl} alt="Logo preview" className="h-10 max-w-48 object-contain" />
                </div>
              )}
            </div>
            <div className="space-y-3">
              <Label>Theme Color</Label>
              <div className="flex flex-wrap gap-2">
                {THEME_COLORS.map((color) => (
                  <button
                    key={color.value}
                    className="relative h-9 w-9 rounded-md border-2 transition-all"
                    style={{
                      backgroundColor: color.value,
                      borderColor: themeColor === color.value ? color.value : "transparent",
                    }}
                    onClick={() => setThemeColor(color.value)}
                    title={color.name}
                    data-testid={`button-color-${color.name.toLowerCase()}`}
                  >
                    {themeColor === color.value && (
                      <Check className="h-4 w-4 text-white absolute inset-0 m-auto" />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-settings">
              {saveMutation.isPending ? "Saving..." : "Save Branding"}
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Crown className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Plan</h2>
            <p className="text-sm text-muted-foreground">Choose the right plan for your organization</p>
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-5">
            {subscription && (
              <div className="flex items-center gap-3">
                <Badge variant="default">
                  {subscription.plan === "yearly" ? "Yearly Plan" : "Monthly Plan"}
                </Badge>
                <Badge variant="secondary">{subscription.status}</Badge>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <Card className={`p-5 cursor-pointer hover-elevate ${subscription?.plan === "monthly" ? "ring-2 ring-primary" : ""}`} onClick={() => subscribeMutation.mutate("monthly")} data-testid="card-plan-monthly">
                <h3 className="font-semibold text-lg">Starter</h3>
                <p className="text-3xl font-bold mt-2">$5<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <p className="text-sm text-muted-foreground mt-2">Billed monthly, cancel anytime</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Unlimited forms & surveys</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Impact reports & CSV export</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Resource tracking</li>
                </ul>
              </Card>
              <Card className={`p-5 cursor-pointer hover-elevate ${subscription?.plan === "yearly" ? "ring-2 ring-primary" : ""}`} onClick={() => subscribeMutation.mutate("yearly")} data-testid="card-plan-yearly">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-lg">Mission</h3>
                  <Badge variant="default">Save 40%</Badge>
                </div>
                <p className="text-3xl font-bold mt-2">$3<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <p className="text-sm text-muted-foreground mt-2">Billed $36/year</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Everything in Starter</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Priority support</li>
                  <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Custom organization branding</li>
                </ul>
              </Card>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Account</h2>
            <p className="text-sm text-muted-foreground">Your account details</p>
          </div>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4 py-2 border-b">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium" data-testid="text-account-name">{user?.firstName} {user?.lastName}</span>
          </div>
          <div className="flex items-center justify-between gap-4 py-2 border-b">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium" data-testid="text-account-email">{user?.email}</span>
          </div>
          <div className="pt-3">
            <a href="/api/logout">
              <Button variant="outline" data-testid="button-logout-settings">Sign Out</Button>
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}
