import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Settings, Building2, Crown, Check, UserCog, Lock, Eye, EyeOff, AlertCircle, Trash2 } from "lucide-react";

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

function hexToHsl(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function applyBrandingColor(hex: string) {
  const hsl = hexToHsl(hex);
  document.documentElement.style.setProperty("--primary", hsl);
  document.documentElement.style.setProperty("--ring", hsl);
}

export default function SettingsPage() {
  const { toast } = useToast();
  const { user, logout } = useAuth();

  const [fullName, setFullName] = useState("");
  const [profileOrg, setProfileOrg] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#1a56db");
  const [logoUrl, setLogoUrl] = useState("");
  const [isSavingBranding, setIsSavingBranding] = useState(false);
  const [brandingLoading, setBrandingLoading] = useState(true);

  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.user_metadata?.full_name ?? "");
      setProfileOrg(user.user_metadata?.organization_name ?? "");
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase.from("organization_settings").select("*").eq("user_id", user.id).single();
      if (data) {
        setCompanyName(data.organization_name ?? "");
        setPrimaryColor(data.primary_color ?? "#1a56db");
        setLogoUrl(data.logo_url ?? "");
        applyBrandingColor(data.primary_color ?? "#1a56db");
      }
      setBrandingLoading(false);
    };
    load();
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setIsSavingProfile(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: fullName, organization_name: profileOrg } });
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
      primary_color: primaryColor,
      logo_url: logoUrl || null,
    });
    setIsSavingBranding(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      applyBrandingColor(primaryColor);
      toast({ title: "Branding saved" });
    }
  };

  const passwordValid =
    newPassword.length >= 8 &&
    /[A-Z]/.test(newPassword) &&
    /[a-z]/.test(newPassword) &&
    /\d/.test(newPassword) &&
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword);
  const passwordsMatch = newPassword === confirmNewPassword;

  const changePassword = async () => {
    if (!passwordValid || !passwordsMatch) return;
    setIsSavingPassword(true);
    setPasswordError("");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsSavingPassword(false);
    if (error) { setPasswordError(error.message); }
    else { setNewPassword(""); setConfirmNewPassword(""); toast({ title: "Password updated" }); }
  };

  const deleteAccount = async () => {
    if (!user || deleteConfirm !== "DELETE") return;
    setIsDeleting(true);
    // Delete all user data then sign out
    await supabase.from("forms").delete().eq("user_id", user.id);
    await supabase.from("inventory_items").delete().eq("user_id", user.id);
    await supabase.from("links").delete().eq("user_id", user.id);
    await supabase.from("media_items").delete().eq("user_id", user.id);
    await supabase.from("organization_settings").delete().eq("user_id", user.id);
    await supabase.auth.signOut();
    window.location.href = "/";
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
          <div><h2 className="font-semibold text-lg">Profile</h2><p className="text-sm text-muted-foreground">Update your personal information</p></div>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email ?? ""} disabled className="bg-muted" />
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>
          <div className="space-y-2">
            <Label>Organization <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input value={profileOrg} onChange={(e) => setProfileOrg(e.target.value)} placeholder="Your non-profit name" />
          </div>
          <Button onClick={saveProfile} disabled={!fullName.trim() || isSavingProfile}>
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
          <div><h2 className="font-semibold text-lg">Change Password</h2><p className="text-sm text-muted-foreground">Must include uppercase, lowercase, number, and special character</p></div>
        </div>
        <div className="space-y-4">
          {passwordError && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><span>{passwordError}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label>New Password</Label>
            <div className="relative">
              <Input type={showNewPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0" onClick={() => setShowNewPassword(!showNewPassword)} tabIndex={-1}>
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {newPassword && !passwordValid && <p className="text-xs text-destructive">Must be 8+ chars with uppercase, lowercase, number, and special character (!@#$%...)</p>}
          </div>
          <div className="space-y-2">
            <Label>Confirm New Password</Label>
            <Input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} />
            {confirmNewPassword && !passwordsMatch && <p className="text-xs text-destructive">Passwords do not match</p>}
          </div>
          <Button onClick={changePassword} disabled={!passwordValid || !passwordsMatch || isSavingPassword}>
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
          <div><h2 className="font-semibold text-lg">Organization Branding</h2><p className="text-sm text-muted-foreground">Customize your organization's appearance</p></div>
        </div>
        {brandingLoading ? (
          <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Organization Name</Label>
              <Input placeholder="Your non-profit name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Logo URL</Label>
              <Input placeholder="https://example.com/logo.png" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              {logoUrl && <div className="mt-2 p-3 border rounded-md inline-block"><img src={logoUrl} alt="Logo preview" className="h-10 max-w-48 object-contain" /></div>}
            </div>
            <div className="space-y-3">
              <Label>Theme Color <span className="text-muted-foreground font-normal text-xs">(applies immediately across the app)</span></Label>
              <div className="flex flex-wrap gap-2">
                {THEME_COLORS.map((color) => (
                  <button
                    key={color.value}
                    className="relative h-9 w-9 rounded-md border-2 transition-all"
                    style={{ backgroundColor: color.value, borderColor: primaryColor === color.value ? color.value : "transparent", outline: primaryColor === color.value ? `2px solid ${color.value}` : "none", outlineOffset: "2px" }}
                    onClick={() => { setPrimaryColor(color.value); applyBrandingColor(color.value); }}
                    title={color.name}
                  >
                    {primaryColor === color.value && <Check className="h-4 w-4 text-white absolute inset-0 m-auto" />}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Label className="text-xs text-muted-foreground">Custom color:</Label>
                <input type="color" value={primaryColor} onChange={(e) => { setPrimaryColor(e.target.value); applyBrandingColor(e.target.value); }} className="h-8 w-16 rounded cursor-pointer border" />
                <span className="text-xs text-muted-foreground font-mono">{primaryColor}</span>
              </div>
            </div>
            <Button onClick={saveBranding} disabled={isSavingBranding}>
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
          <div><h2 className="font-semibold text-lg">Plan</h2><p className="text-sm text-muted-foreground">Choose the right plan for your organization</p></div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="p-5 hover-elevate cursor-pointer">
            <h3 className="font-semibold text-lg">Starter</h3>
            <p className="text-3xl font-bold mt-2">$5<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
            <p className="text-sm text-muted-foreground mt-2">Billed monthly</p>
            <ul className="mt-4 space-y-1.5 text-sm">
              <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Unlimited forms</li>
              <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Impact reports & PDF export</li>
              <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-primary" /> Media library</li>
            </ul>
          </Card>
          <Card className="p-5 hover-elevate cursor-pointer ring-2 ring-primary">
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

      {/* Account + Delete */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <div><h2 className="font-semibold text-lg">Account</h2><p className="text-sm text-muted-foreground">Your account details</p></div>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4 py-2 border-b">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{user?.email}</span>
          </div>
          <div className="flex items-center gap-3 pt-3">
            <Button variant="outline" onClick={() => logout()}>Sign Out</Button>
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)} className="ml-auto">
              <Trash2 className="mr-1 h-4 w-4" /> Delete Account
            </Button>
          </div>
        </div>
      </Card>

      {/* Feedback */}
      <div className="text-center">
        <a href="/feedback" className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4">
          Give feedback or report a bug
        </a>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">This will permanently delete your account and all your data including forms, submissions, inventory, and media. <strong>This cannot be undone.</strong></p>
            <div className="space-y-2">
              <Label>Type <strong>DELETE</strong> to confirm</Label>
              <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE" className="border-destructive" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setDeleteConfirm(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={deleteAccount} disabled={deleteConfirm !== "DELETE" || isDeleting}>
              {isDeleting ? "Deleting..." : "Delete My Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
