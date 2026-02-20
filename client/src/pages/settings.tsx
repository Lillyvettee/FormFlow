import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Settings, Building2, Crown, Check, UserCog, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";

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
  const { user, logout } = useAuth();

  // Profile
  const [fullName, setFullName] = useState("");
  const [profileOrg, setProfileOrg] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Branding
  const [companyName, setCompanyName] = useState("");
  const [themeColor, setThemeColor] = useState("#1a56db");
  const [logoUrl, setLogoUrl] = useState("");
  const [isSavingBranding, setIsSavingBranding] = useState(false);
  const [brandingLoading, setBrandingLoading] = useState(true);

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.user_metadata?.full_name ?? "");
      setProfileOrg(user.user_metadata?.organization_name ?? "");
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const loadSettings = async () => {
      const { data } = await supabase.from("organization_settings").select("*").eq("user_id", user.id).single();
      if (data) {
        setCompanyName(data.organization_name ?? "");
        setThemeColor(data.theme_color ?? "#1a56db");
        setLogoUrl(data.logo_url ?? "");
      }
      setBrandingLoading(false);
    };
    loadSettings();
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setIsSavingProfile(true);
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName, organization_name: profileOrg },
    });
    setIsSavingProfile(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Profile updated" }); }
  };

  const saveBranding = async () => {
    if (!user) return;
    setIsSavingBranding(true);
    const { error } = await supabase.from("organization_settings").upsert({
      user_id: user.id,
      organization_name: companyName || null,
      theme_color: themeColor,
      logo_url: logoUrl || null,
    });
    setIsSavingBranding(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Branding saved" }); }
  };

  const passwordValid = newPassword.length >= 8 && /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) && /\d/.test(newPassword);
  const passwordsMatch = newPassword === confirmNewPassword;
  const canChangePassword = passwordValid && passwordsMatch;

  const changePassword = async () => {
    if (!canChangePassword) return;
    setIsSavingPassword(true);
    setPasswordError("");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsSavingPassword(false);
    if (error) { setPasswordError(error.message); }
    else { setNewPassword(""); setConfirmNewPassword(""); toast({ title: "Password updated" }); }
  };

  return (
    <div className="p-6 space-y-8 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold" data-testid="text-settings-title">Settings</h1>
        <p className="text-muted-foreground">Manage your account, branding, and plan</p>
      </div>

      {/* Profile */}
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
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" data-testid="input-profile-first-name" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email ?? ""} disabled className="bg-muted" data-testid="input-profile-email" />
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>
          <div className="space-y-2">
            <Label>Organization <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input value={profileOrg} onChange={(e) => setProfileOrg(e.target.value)} placeholder="Your non-profit name" />
          </div>
          <Button onClick={saveProfile} disabled={!fullName.trim() || isSavingProfile} data-testid="button-save-profile">
            {isSavingProfile ? "Saving..." : "Save Profile"}
          </Button>
        </div>
      </Card>

      {/* Change Password */}
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
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{passwordError}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label>New Password</Label>
            <div className="relative">
              <Input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="input-new-password"
              />
              <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowNewPassword(!showNewPassword)} tabIndex={-1}>
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {newPassword && !passwordValid && (
              <p className="text-xs text-destructive">Must be 8+ chars with uppercase, lowercase, and a number</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Confirm New Password</Label>
            <Input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} data-testid="input-confirm-new-password" />
            {confirmNewPassword && !passwordsMatch && <p className="text-xs text-destructive">Passwords do not match</p>}
          </div>
          <Button onClick={changePassword} disabled={!canChangePassword || isSavingPassword} data-testid="button-change-password">
            {isSavingPassword ? "Updating..." : "Change Password"}
          </Button>
        </div>
      </Card>

      {/* Branding */}
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
        {brandingLoading ? (
          <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Organization Name</Label>
              <Input placeholder="Your non-profit name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} data-testid="input-company-name" />
            </div>
            <div className="space-y-2">
              <Label>Logo URL</Label>
              <Input placeholder="https://example.com/logo.png" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} data-testid="input-logo-url" />
              {logoUrl && <div className="mt-2 p-3 border rounded-md inline-block"><img src={logoUrl} alt="Logo preview" className="h-10 max-w-48 object-contain" /></div>}
            </div>
            <div className="space-y-3">
              <Label>Theme Color</Label>
              <div className="flex flex-wrap gap-2">
                {THEME_COLORS.map((color) => (
                  <button
                    key={color.value}
                    className="relative h-9 w-9 rounded-md border-2 transition-all"
                    style={{ backgroundColor: color.value, borderColor: themeColor === color.value ? color.value : "transparent" }}
                    onClick={() => setThemeColor(color.value)}
                    title={color.name}
                    data-testid={`button-color-${color.name.toLowerCase()}`}
                  >
                    {themeColor === color.value && <Check className="h-4 w-4 text-white absolute inset-0 m-auto" />}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={saveBranding} disabled={isSavingBranding} data-testid="button-save-settings">
              {isSavingBranding ? "Saving..." : "Save Branding"}
            </Button>
          </div>
        )}
      </Card>

      {/* Plan */}
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
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="p-5 hover-elevate cursor-pointer" data-testid="card-plan-monthly">
            <h3 className="font-semibold text-lg">Starter</h3>
            <p className="text-3xl font-bold mt-2">$5<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            <p className="text-sm text-muted-foreground mt-2">Billed monthly</p>
            <ul className="mt-4 space-y-1.5 text-sm">
              <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Unlimited forms</li>
              <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Impact reports</li>
              <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Resource tracking</li>
            </ul>
          </Card>
          <Card className="p-5 hover-elevate cursor-pointer" data-testid="card-plan-yearly">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-lg">Mission</h3>
              <Badge variant="default">Save 40%</Badge>
            </div>
            <p className="text-3xl font-bold mt-2">$3<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            <p className="text-sm text-muted-foreground mt-2">Billed $36/year</p>
            <ul className="mt-4 space-y-1.5 text-sm">
              <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Everything in Starter</li>
              <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Priority support</li>
              <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Custom branding</li>
            </ul>
          </Card>
        </div>
      </Card>

      {/* Account */}
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
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium" data-testid="text-account-email">{user?.email}</span>
          </div>
          <div className="pt-3">
            <Button variant="outline" onClick={() => logout()} data-testid="button-logout-settings">Sign Out</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
