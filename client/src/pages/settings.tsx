/**
 * SettingsPage
 *
 * Settings for the signed-in user and their organization, in six sections:
 *   1. Profile    the user's full name (Supabase Auth user metadata)
 *   2. Password   change password, after confirming the current one
 *   3. Branding   the organization's logo and theme color, stored in
 *                 "organization_settings" (one row per organization).
 *                 Everyone can see it; only owners and admins can change it.
 *   4. Plan       free trial, subscription and checkout (PlanSection)
 *   5. Account    email, organization, role and sign out
 *   6. Delete account (DeleteAccountSection; confirmed by email)
 *
 * Team accounts:
 *   The organization NAME has one home: the organizations table, edited on
 *   the Team page. This page shows it but no longer stores its own copy.
 *   Before team accounts, the name was kept in three places (profile,
 *   branding and team), which could disagree.
 *
 * Backend assumptions (from team-accounts-migration.sql):
 *   - organization_settings has a unique index on organization_id, which the
 *     branding upsert relies on.
 *   - Security rules let members read branding and only owners/admins write it.
 *   - Optional: the update_my_display_name function (see the comment on
 *     saveProfile) keeps your name on the Team page in sync.
 */

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization, ROLE_LABELS } from "@/hooks/use-organization";
import { PlanSection } from "@/components/plan-section";
import { DeleteAccountSection } from "@/components/delete-account-section";
import { supabase } from "@/lib/supabase";
import { PASSWORD_RULES } from "@/lib/password-rules";
import {
  Settings,
  Building2,
  Check,
  X,
  UserCog,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  ImageOff,
  Users,
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
  const { organization, role, isAdmin, refresh: refreshOrganization } = useOrganization();

  // ----- Profile -----
  const [fullName, setFullName] = useState("");
  /** Last saved name, used to tell whether there are unsaved changes. */
  const [savedFullName, setSavedFullName] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // ----- Branding (the organization's; the name lives on the Team page) -----
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_COLOR);
  const [logoUrl, setLogoUrl] = useState("");
  const [savedBranding, setSavedBranding] = useState({ primaryColor: DEFAULT_COLOR, logoUrl: "" });
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
    setFullName(name);
    setSavedFullName(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // -------------------------------------------------------------------------
  // Load branding
  // -------------------------------------------------------------------------

  /**
   * Load the organization's branding row.
   *
   * Filtered by organization_id so the query is explicit (security rules also
   * limit it to the user's organization). maybeSingle() returns null when no
   * branding has been saved yet, which is normal for a new organization.
   * Reloads if the organization changes (for example after joining a team).
   */
  useEffect(() => {
    if (!organization) {
      setBrandingLoading(false);
      return;
    }
    let cancelled = false;

    const loadSettings = async () => {
      setBrandingLoading(true);
      setBrandingLoadError("");
      try {
        const { data, error } = await supabase
          .from("organization_settings")
          .select("primary_color, logo_url")
          .eq("organization_id", organization.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;

        const loaded = {
          primaryColor:
            data?.primary_color && HEX_COLOR_PATTERN.test(data.primary_color) ? data.primary_color : DEFAULT_COLOR,
          logoUrl: data?.logo_url ?? "",
        };
        setPrimaryColor(loaded.primaryColor);
        setLogoUrl(loaded.logoUrl);
        setSavedBranding(loaded);
      } catch (err) {
        if (!cancelled) {
          setBrandingLoadError(
            err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "Unknown error",
          );
        }
      } finally {
        if (!cancelled) setBrandingLoading(false);
      }
    };

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, [organization?.id]);

  // Reset the broken-image flag whenever the logo URL changes, so a fixed URL gets a fresh try.
  useEffect(() => setLogoBroken(false), [logoUrl]);

  // -------------------------------------------------------------------------
  // Save profile
  // -------------------------------------------------------------------------

  const profileDirty = fullName.trim() !== savedFullName;

  /**
   * Save the user's name.
   *
   * The name is stored in two places: the auth user's metadata (used across
   * the app) and the user's row on the team list, which copies it when they
   * join. The second update keeps the Team page from showing an old name.
   * It needs this small function in Supabase (run once in the SQL Editor):
   *
   *   create or replace function public.update_my_display_name(p_name text)
   *   returns void language sql security definer set search_path = public as $$
   *     update organization_members set display_name = nullif(left(trim(p_name), 100), '')
   *     where user_id = auth.uid();
   *   $$;
   *   revoke execute on function public.update_my_display_name(text) from public, anon;
   *   grant execute on function public.update_my_display_name(text) to authenticated;
   *
   * If the function does not exist yet, the profile still saves; only the
   * team list keeps the old name.
   */
  const saveProfile = async () => {
    if (!user || !fullName.trim() || isSavingProfile) return;
    setIsSavingProfile(true);
    try {
      const name = fullName.trim();
      const { error } = await supabase.auth.updateUser({ data: { full_name: name } });
      if (error) {
        toast({ title: "Could not update profile", description: error.message, variant: "destructive" });
        return;
      }
      // Keep the Team page in sync. Not critical, so failures are ignored.
      await supabase.rpc("update_my_display_name", { p_name: name }).then(
        () => undefined,
        () => undefined,
      );
      setFullName(name);
      setSavedFullName(name);
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
    primaryColor.toLowerCase() !== savedBranding.primaryColor.toLowerCase() || logoUrl.trim() !== savedBranding.logoUrl;

  /**
   * Insert or update the organization's branding row (one per organization).
   *
   * onConflict: "organization_id" updates the existing row instead of adding
   * a new one each save. user_id records who last changed the branding.
   * organization_name is written too, purely to keep that older column in
   * step with the real name in the organizations table.
   *
   * Only owners and admins reach this (the form is read-only for others),
   * and the database rejects anyone else regardless.
   */
  const saveBranding = async () => {
    if (!user || !organization || !isAdmin || logoError || colorError || isSavingBranding) return;
    setIsSavingBranding(true);
    try {
      const next = {
        primaryColor: primaryColor.toLowerCase(),
        logoUrl: logoUrl.trim(),
      };
      const { error } = await supabase.from("organization_settings").upsert(
        {
          organization_id: organization.id,
          user_id: user.id,
          organization_name: organization.name,
          primary_color: next.primaryColor,
          logo_url: next.logoUrl || null,
        },
        { onConflict: "organization_id" },
      );
      if (error) {
        toast({ title: "Could not save branding", description: error.message, variant: "destructive" });
        return;
      }
      setLogoUrl(next.logoUrl);
      setSavedBranding(next);
      // Re-theme the app and update the sidebar logo right away.
      await refreshOrganization();
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
        <p className="text-muted-foreground">Manage your account, your organization's branding, and your plan</p>
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

        {/* Non-admins see the branding but cannot change it. */}
        {!isAdmin && !brandingLoading && !brandingLoadError && (
          <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Only owners and admins can change branding. Your role is{" "}
            <span className="font-medium text-foreground">{role ? ROLE_LABELS[role] : "unknown"}</span>.
          </p>
        )}

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
            {/* A disabled fieldset makes every control inside read-only for non-admins. */}
            <fieldset disabled={!isAdmin || isSavingBranding} className="space-y-5 disabled:opacity-90">
            {/* Organization name: shown here, edited on the Team page (its one home). */}
            <div className="space-y-1">
              <p className="text-sm font-medium">Organization name</p>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span data-testid="text-company-name">{organization?.name ?? "-"}</span>
                {isAdmin && (
                  <a href="/team" className="text-sm text-primary hover:underline">
                    Change on Team page
                  </a>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Shown publicly on your forms and reports.</p>
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
            </fieldset>

            {/* Save button only for those who can save. */}
            {isAdmin && (
              <Button
                type="submit"
                disabled={!brandingDirty || Boolean(logoError) || Boolean(colorError) || isSavingBranding}
                data-testid="button-save-settings"
              >
                {isSavingBranding ? "Saving..." : brandingDirty ? "Save branding" : "Saved"}
              </Button>
            )}
          </form>
        )}
      </Card>

      {/* ===== Plan ===== */}
      <PlanSection />

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
          {/* Organization and role, with a link to manage the team. */}
          <div className="flex items-center justify-between gap-4 py-2 border-b">
            <span className="text-muted-foreground">Organization</span>
            <span className="font-medium text-right">
              {organization?.name ?? "-"}
              {role && <span className="ml-2 text-xs font-normal text-muted-foreground">({ROLE_LABELS[role]})</span>}
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
          <div className="pt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="/team">
                <Users className="mr-1 h-4 w-4" aria-hidden="true" /> Manage team
              </a>
            </Button>
            <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut} data-testid="button-logout-settings">
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </div>
      </Card>

      {/* ===== Delete account ===== */}
      <DeleteAccountSection />
    </div>
  );
}