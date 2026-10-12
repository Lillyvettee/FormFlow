/**
 * SettingsPage
 *
 * Account settings for the signed-in user, in five sections:
 *   1. Profile    full name and organization, stored in Supabase Auth user metadata
 *   2. Password   change password, after confirming the current one
 *   3. Branding   organization name, logo and theme color, stored in the
 *                 "organization_settings" table (one row per user)
 *   4. Plan       pricing overview
 *   5. Account    email and sign out
 *
 * Backend assumptions:
 *   - organization_settings has a UNIQUE constraint on user_id. The branding
 *     upsert relies on it (see saveBranding). If it is missing, add it with:
 *       alter table organization_settings add constraint organization_settings_user_id_key unique (user_id);
 *   - Row Level Security restricts organization_settings rows to their owner.
 */

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
import {
  Settings,
  Building2,
  Crown,
  Check,
  X,
  UserCog,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  ImageOff,
  type LucideIcon,
} from "lucide-react";

// ===========================================================================
// Constants
// ===========================================================================

/** Preset theme colors. A custom color can also be entered (see the color input). */
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

const DEFAULT_COLOR = THEME_COLORS[0].value;

/** Accepts "#1a56db" style hex colors only. */
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** Password rules, shown as a live checklist under the field. */
const PASSWORD_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { label: "An uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "A lowercase letter", test: (pw) => /[a-z]/.test(pw) },
  { label: "A number", test: (pw) => /\d/.test(pw) },
];

/** Pricing shown in the Plan section. Kept as data so prices live in one place. */
const PLANS = [
  {
    id: "monthly",
    name: "Starter",
    price: "$5",
    billing: "Billed monthly",
    badge: null,
    features: ["Unlimited forms", "Impact reports", "Resource tracking"],
  },
  {
    id: "yearly",
    name: "Mission",
    price: "$3",
    billing: "Billed $36/year",
    badge: "Save 40%",
    features: ["Everything in Starter", "Priority support", "Custom branding"],
  },
];

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Returns an error message for a logo URL, or null if it is acceptable.
 * Only https is allowed: an http image on an https site is blocked or flagged
 * as insecure by browsers, so the logo would silently fail to show.
 */
const validateLogoUrl = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "Use an https:// address so the logo loads securely.";
    return null;
  } catch {
    return "Enter a full web address, starting with https://";
  }
};

// ===========================================================================
// Small presentational components
// ===========================================================================

/** Heading row used at the top of every settings card. */
function SectionHeader({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
      </div>
      <div>
        <h2 className="font-semibold text-lg">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/** Red error banner. role="alert" makes screen readers announce it. */
function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Password input with a show/hide button.
 * The original button had tabIndex={-1} and no label, so keyboard and screen
 * reader users could not use it.
 */
function PasswordInput({
  id,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  describedBy,
  invalid,
  testId,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete: string;
  describedBy?: string;
  invalid?: boolean;
  testId?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="pr-10"
        aria-describedby={describedBy}
        aria-invalid={invalid}
        data-testid={testId}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0"
        onClick={onToggleShow}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
      >
        {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </Button>
    </div>
  );
}

// ===========================================================================
// Page component
// ===========================================================================

export default function SettingsPage() {
  const { toast } = useToast();
  const { user, logout } = useAuth();

  // ----- Profile -----
  const [fullName, setFullName] = useState("");
  const [profileOrg, setProfileOrg] = useState("");
  /** Last saved values, used to tell whether there are unsaved changes. */
  const [savedProfile, setSavedProfile] = useState({ fullName: "", profileOrg: "" });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // ----- Branding -----
  const [companyName, setCompanyName] = useState("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_COLOR);
  const [logoUrl, setLogoUrl] = useState("");
  const [savedBranding, setSavedBranding] = useState({ companyName: "", primaryColor: DEFAULT_COLOR, logoUrl: "" });
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingLoadError, setBrandingLoadError] = useState("");
  const [isSavingBranding, setIsSavingBranding] = useState(false);
  /** True when the logo preview image failed to load (bad link, not an image, blocked). */
  const [logoBroken, setLogoBroken] = useState(false);

  // ----- Password -----
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  // ----- Account -----
  const [isSigningOut, setIsSigningOut] = useState(false);

  // -------------------------------------------------------------------------
  // Load profile
  // -------------------------------------------------------------------------

  /**
   * Fill the profile form from the user's metadata.
   *
   * Depends on user.id rather than the whole user object. The user object is
   * replaced on every token refresh (about hourly), and the original effect
   * would then wipe out whatever the person was in the middle of typing.
   */
  useEffect(() => {
    if (!user) return;
    const name = user.user_metadata?.full_name ?? "";
    const org = user.user_metadata?.organization_name ?? "";
    setFullName(name);
    setProfileOrg(org);
    setSavedProfile({ fullName: name, profileOrg: org });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // -------------------------------------------------------------------------
  // Load branding
  // -------------------------------------------------------------------------

  /**
   * Load the organization_settings row.
   *
   * Fixes over the original:
   * - .single() returns an error when no row exists yet (every new user).
   *   .maybeSingle() returns null instead, which is the expected case.
   * - Real errors were ignored; they now show in the card.
   * - With no user, the skeleton never went away.
   * - If the organization name has never been set, it is pre-filled from
   *   the profile so the user does not have to type it twice.
   */
  useEffect(() => {
    if (!user) {
      setBrandingLoading(false);
      return;
    }
    let cancelled = false;

    const loadSettings = async () => {
      setBrandingLoading(true);
      setBrandingLoadError("");
      const { data, error } = await supabase
        .from("organization_settings")
        .select("*")
        .maybeSingle();
      if (cancelled) return;

      if (error) {
        setBrandingLoadError(error.message);
      } else {
        const loaded = {
          companyName: data?.organization_name ?? user.user_metadata?.organization_name ?? "",
          primaryColor: data?.primary_color && HEX_COLOR_PATTERN.test(data.primary_color) ? data.primary_color : DEFAULT_COLOR,
          logoUrl: data?.logo_url ?? "",
        };
        setCompanyName(loaded.companyName);
        setPrimaryColor(loaded.primaryColor);
        setLogoUrl(loaded.logoUrl);
        // Saved state reflects what is actually in the database, so a
        // pre-filled name still counts as an unsaved change.
        setSavedBranding({
          companyName: data?.organization_name ?? "",
          primaryColor: loaded.primaryColor,
          logoUrl: loaded.logoUrl,
        });
      }
      setBrandingLoading(false);
    };

    loadSettings();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Reset the broken-image flag whenever the logo URL changes, so a fixed URL gets a fresh try.
  useEffect(() => setLogoBroken(false), [logoUrl]);

  // -------------------------------------------------------------------------
  // Save profile
  // -------------------------------------------------------------------------

  const profileDirty = fullName.trim() !== savedProfile.fullName || profileOrg.trim() !== savedProfile.profileOrg;

  /**
   * Save name and organization to the auth user's metadata.
   * Fixes: trims values, recovers from thrown network errors (try/finally),
   * and the button is disabled when nothing has changed.
   */
  const saveProfile = async () => {
    if (!user || !fullName.trim() || isSavingProfile) return;
    setIsSavingProfile(true);
    try {
      const next = { fullName: fullName.trim(), profileOrg: profileOrg.trim() };
      const { error } = await supabase.auth.updateUser({
        data: { full_name: next.fullName, organization_name: next.profileOrg || null },
      });
      if (error) {
        toast({ title: "Could not update profile", description: error.message, variant: "destructive" });
        return;
      }
      setFullName(next.fullName);
      setProfileOrg(next.profileOrg);
      setSavedProfile(next);
      toast({ title: "Profile updated" });
    } catch (err) {
      toast({
        title: "Could not update profile",
        description: err instanceof Error ? err.message : "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  // -------------------------------------------------------------------------
  // Save branding
  // -------------------------------------------------------------------------

  const logoError = validateLogoUrl(logoUrl);
  const colorError = HEX_COLOR_PATTERN.test(primaryColor) ? null : "Enter a color like #1a56db.";
  const brandingDirty =
    companyName.trim() !== savedBranding.companyName ||
    primaryColor.toLowerCase() !== savedBranding.primaryColor.toLowerCase() ||
    logoUrl.trim() !== savedBranding.logoUrl;

  /**
   * Insert or update the user's branding row.
   *
   * Bug in the original: upsert() without onConflict matches on the primary
   * key. The payload has no id, so every save inserted a NEW row. After the
   * second save, the loader's .single() failed with "multiple rows" and the
   * branding section stopped loading. onConflict: "user_id" updates the
   * existing row instead (requires a unique constraint on user_id; see top).
   */
  const saveBranding = async () => {
    if (!user || logoError || colorError || isSavingBranding) return;
    setIsSavingBranding(true);
    try {
      const next = {
        companyName: companyName.trim(),
        primaryColor: primaryColor.toLowerCase(),
        logoUrl: logoUrl.trim(),
      };
      const { error } = await supabase.from("organization_settings").upsert(
        {
          user_id: user.id,
          organization_name: next.companyName || null,
          primary_color: next.primaryColor,
          logo_url: next.logoUrl || null,
        },
        { onConflict: "user_id" },
      );
      if (error) {
        toast({ title: "Could not save branding", description: error.message, variant: "destructive" });
        return;
      }
      setCompanyName(next.companyName);
      setLogoUrl(next.logoUrl);
      setSavedBranding(next);
      toast({ title: "Branding saved" });
    } catch (err) {
      toast({
        title: "Could not save branding",
        description: err instanceof Error ? err.message : "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSavingBranding(false);
    }
  };

  // -------------------------------------------------------------------------
  // Change password
  // -------------------------------------------------------------------------

  const passwordValid = PASSWORD_RULES.every((rule) => rule.test(newPassword));
  const passwordsMatch = newPassword === confirmNewPassword;
  const sameAsCurrent = newPassword !== "" && newPassword === currentPassword;
  const canChangePassword =
    currentPassword !== "" && passwordValid && confirmNewPassword !== "" && passwordsMatch && !sameAsCurrent;

  /**
   * Change the password after confirming the current one.
   *
   * Security fix: the original changed the password with only an active
   * session. Anyone with brief access to an unlocked, signed-in device could
   * lock the real owner out. The current password is now checked first by
   * signing in with it.
   *
   * After the change, other devices are signed out, so a session someone
   * else may have is ended. This device stays signed in.
   */
  const changePassword = async () => {
    if (!user?.email || !canChangePassword || isSavingPassword) return;
    setIsSavingPassword(true);
    setPasswordError("");

    try {
      // 1. Verify the current password.
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (verifyError) {
        setPasswordError(
          verifyError.message.toLowerCase().includes("invalid login credentials")
            ? "Your current password is incorrect."
            : verifyError.message,
        );
        return;
      }

      // 2. Set the new password.
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setPasswordError(updateError.message);
        return;
      }

      // 3. End sessions on other devices. Not critical if unsupported or it fails.
      try {
        await supabase.auth.signOut({ scope: "others" });
      } catch {
        // Ignore; the password change itself succeeded.
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setShowPasswords(false);
      toast({ title: "Password updated", description: "You've been signed out on your other devices." });
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Check your connection and try again.");
    } finally {
      setIsSavingPassword(false);
    }
  };

  // -------------------------------------------------------------------------
  // Sign out
  // -------------------------------------------------------------------------

  /** Sign out, with a message if it fails instead of silently doing nothing. */
  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await logout();
    } catch (err) {
      toast({
        title: "Could not sign out",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setIsSigningOut(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-8 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold" data-testid="text-settings-title">
          Settings
        </h1>
        <p className="text-muted-foreground">Manage your account, branding, and plan</p>
      </div>

      {/* ===== Profile ===== */}
      <Card className="p-6">
        <SectionHeader icon={UserCog} title="Profile" description="Update your personal information" />
        {/* A real <form> so pressing Enter saves. */}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveProfile();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="profile-name">Full name</Label>
            <Input
              id="profile-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
              maxLength={100}
              data-testid="input-profile-first-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input
              id="profile-email"
              value={user?.email ?? ""}
              disabled
              className="bg-muted"
              aria-describedby="profile-email-help"
              data-testid="input-profile-email"
            />
            <p id="profile-email-help" className="text-xs text-muted-foreground">
              Email cannot be changed
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-org">
              Organization <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="profile-org"
              value={profileOrg}
              onChange={(e) => setProfileOrg(e.target.value)}
              placeholder="Your non-profit name"
              autoComplete="organization"
              maxLength={150}
            />
          </div>
          <Button
            type="submit"
            disabled={!fullName.trim() || !profileDirty || isSavingProfile}
            data-testid="button-save-profile"
          >
            {isSavingProfile ? "Saving..." : profileDirty ? "Save profile" : "Saved"}
          </Button>
        </form>
      </Card>

      {/* ===== Change password ===== */}
      <Card className="p-6">
        <SectionHeader icon={Lock} title="Change password" description="Update your account password" />
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            changePassword();
          }}
        >
          {/* Hidden username field helps password managers save the new
              password against the right account. */}
          <input type="email" value={user?.email ?? ""} autoComplete="username" readOnly hidden />

          {passwordError && <ErrorBanner message={passwordError} />}

          {/* Current password (new; required to confirm it's really you) */}
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput
              id="current-password"
              value={currentPassword}
              onChange={(v) => {
                setCurrentPassword(v);
                setPasswordError("");
              }}
              show={showPasswords}
              onToggleShow={() => setShowPasswords((s) => !s)}
              autoComplete="current-password"
            />
          </div>

          {/* New password with a live checklist of the rules */}
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput
              id="new-password"
              value={newPassword}
              onChange={(v) => {
                setNewPassword(v);
                setPasswordError("");
              }}
              show={showPasswords}
              onToggleShow={() => setShowPasswords((s) => !s)}
              autoComplete="new-password"
              describedBy="new-password-rules"
              invalid={newPassword !== "" && (!passwordValid || sameAsCurrent)}
              testId="input-new-password"
            />
            <ul id="new-password-rules" className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" aria-live="polite">
              {PASSWORD_RULES.map((rule) => {
                const met = rule.test(newPassword);
                return (
                  <li
                    key={rule.label}
                    className={`flex items-center gap-1.5 ${met ? "text-chart-2" : "text-muted-foreground"}`}
                  >
                    {met ? (
                      <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                    ) : (
                      <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      {rule.label}
                      <span className="sr-only">{met ? " (met)" : " (not met)"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {sameAsCurrent && (
              <p className="text-xs text-destructive">Choose a password different from your current one.</p>
            )}
          </div>

          {/* Confirm new password. Uses the same show/hide setting as the fields above. */}
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm new password</Label>
            <Input
              id="confirm-new-password"
              type={showPasswords ? "text" : "password"}
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={confirmNewPassword !== "" && !passwordsMatch}
              aria-describedby={confirmNewPassword && !passwordsMatch ? "confirm-password-error" : undefined}
              data-testid="input-confirm-new-password"
            />
            {confirmNewPassword && !passwordsMatch && (
              <p id="confirm-password-error" className="text-xs text-destructive">
                Passwords do not match
              </p>
            )}
          </div>

          <Button type="submit" disabled={!canChangePassword || isSavingPassword} data-testid="button-change-password">
            {isSavingPassword ? "Updating..." : "Change password"}
          </Button>
        </form>
      </Card>

      {/* ===== Organization branding ===== */}
      <Card className="p-6">
        <SectionHeader
          icon={Building2}
          title="Organization branding"
          description="Customize how your organization appears on forms and reports"
        />

        {brandingLoading ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : brandingLoadError ? (
          <ErrorBanner message={`Could not load branding settings: ${brandingLoadError}. Refresh to try again.`} />
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              saveBranding();
            }}
          >
            {/* Organization name */}
            <div className="space-y-2">
              <Label htmlFor="branding-name">Organization name</Label>
              <Input
                id="branding-name"
                placeholder="Your non-profit name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                maxLength={150}
                aria-describedby="branding-name-help"
                data-testid="input-company-name"
              />
              <p id="branding-name-help" className="text-xs text-muted-foreground">
                Shown publicly on your forms and reports.
              </p>
            </div>

            {/* Logo URL with live preview */}
            <div className="space-y-2">
              <Label htmlFor="branding-logo">Logo URL</Label>
              <Input
                id="branding-logo"
                type="url"
                inputMode="url"
                placeholder="https://example.org/logo.png"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                aria-invalid={Boolean(logoError)}
                aria-describedby="branding-logo-help"
                data-testid="input-logo-url"
              />
              <p id="branding-logo-help" className={`text-xs ${logoError ? "text-destructive" : "text-muted-foreground"}`}>
                {logoError ?? "A link to a PNG, JPG or SVG image. A transparent background looks best."}
              </p>

              {/* Preview. The original showed a broken-image icon for bad links;
                  it now explains the problem instead. */}
              {logoUrl.trim() && !logoError && (
                <div className="mt-2 p-3 border rounded-md inline-flex items-center min-h-[64px]">
                  {logoBroken ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ImageOff className="h-4 w-4" aria-hidden="true" />
                      This image couldn't be loaded. Check that the link opens an image directly.
                    </span>
                  ) : (
                    <img
                      src={logoUrl.trim()}
                      alt="Logo preview"
                      className="h-10 max-w-48 object-contain"
                      referrerPolicy="no-referrer"
                      onError={() => setLogoBroken(true)}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Theme color: presets plus a custom color picker */}
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Theme color</legend>
              <div className="flex flex-wrap items-center gap-2">
                {THEME_COLORS.map((color) => {
                  const isSelected = primaryColor.toLowerCase() === color.value;
                  return (
                    <button
                      key={color.value}
                      type="button"
                      // The original drew the selected border in the swatch's own
                      // color, so it was invisible. A ring with an offset now
                      // shows clearly which color is chosen.
                      className={`relative h-9 w-9 rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        isSelected ? "ring-2 ring-offset-2 ring-foreground" : ""
                      }`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => setPrimaryColor(color.value)}
                      aria-label={color.name}
                      aria-pressed={isSelected}
                      title={color.name}
                      data-testid={`button-color-${color.name.toLowerCase()}`}
                    >
                      {isSelected && <Check className="h-4 w-4 text-white absolute inset-0 m-auto" aria-hidden="true" />}
                    </button>
                  );
                })}

                {/* Custom color. The native picker plus a text box for pasting brand hex codes. */}
                <div className="flex items-center gap-2 ml-1">
                  <input
                    type="color"
                    value={HEX_COLOR_PATTERN.test(primaryColor) ? primaryColor : DEFAULT_COLOR}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-9 cursor-pointer rounded-md border bg-transparent p-0.5"
                    aria-label="Pick a custom color"
                  />
                  <Input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value.trim())}
                    className="h-9 w-28 font-mono text-sm"
                    maxLength={7}
                    aria-label="Custom color hex code"
                    aria-invalid={Boolean(colorError)}
                  />
                </div>
              </div>
              {colorError && <p className="text-xs text-destructive">{colorError}</p>}

              {/* Live preview so the user can judge the color before saving. */}
              {!colorError && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Preview:</span>
                  <span className="px-3 py-1.5 rounded-md text-white font-medium" style={{ backgroundColor: primaryColor }}>
                    Submit
                  </span>
                  <span className="font-medium" style={{ color: primaryColor }}>
                    Link text
                  </span>
                </div>
              )}
            </fieldset>

            <Button
              type="submit"
              disabled={!brandingDirty || Boolean(logoError) || Boolean(colorError) || isSavingBranding}
              data-testid="button-save-settings"
            >
              {isSavingBranding ? "Saving..." : brandingDirty ? "Save branding" : "Saved"}
            </Button>
          </form>
        )}
      </Card>

      {/* ===== Plan =====
          The original cards had cursor-pointer and a hover effect but did
          nothing when clicked, which looks broken. They are now presented as
          plain information. When billing is ready, add a "Choose plan" button
          to each card that starts checkout. */}
      <Card className="p-6">
        <SectionHeader icon={Crown} title="Plan" description="Choose the right plan for your organization" />
        <div className="grid sm:grid-cols-2 gap-4">
          {PLANS.map((plan) => (
            <Card key={plan.id} className="p-5" data-testid={`card-plan-${plan.id}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-lg">{plan.name}</h3>
                {plan.badge && <Badge variant="default">{plan.badge}</Badge>}
              </div>
              <p className="text-3xl font-bold mt-2">
                {plan.price}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-sm text-muted-foreground mt-2">{plan.billing}</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" /> {feature}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Card>

      {/* ===== Account ===== */}
      <Card className="p-6">
        <SectionHeader icon={Settings} title="Account" description="Your account details" />
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4 py-2 border-b">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium break-all" data-testid="text-account-email">
              {user?.email}
            </span>
          </div>
          {user?.created_at && (
            <div className="flex items-center justify-between gap-4 py-2 border-b">
              <span className="text-muted-foreground">Member since</span>
              <span className="font-medium">
                {new Date(user.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </span>
            </div>
          )}
          <div className="pt-3">
            <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut} data-testid="button-logout-settings">
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}