/**
 * ResetPasswordPage
 *
 * Where the link in a password reset email lands (see forgot-password.tsx).
 * Route: /reset-password, a full-page route outside the sidebar layout.
 *
 * Flow:
 *   1. The email link brings ?token_hash=...&type=recovery (see the Reset
 *      Password email template in BILLING_SETUP.md). Nothing is used up
 *      until the person presses Continue, which calls verifyOtp and signs
 *      them in for this one purpose.
 *
 *      Why the extra click: email security scanners (Outlook Safe Links,
 *      Mimecast, ...) open every link in an email to check it. With the old
 *      one-click link the scanner used up the one-time link first, and the
 *      person got "expired". Scanners load pages but don't press buttons.
 *
 *      Links in the old format (#access_token=... from Supabase's default
 *      template) still work: the Supabase client picks up the session from
 *      the URL by itself (detectSessionInUrl in lib/supabase.ts).
 *   2. They choose a new password, checked against the same rules as sign-up.
 *   3. On success they go to the dashboard, already signed in.
 *
 * Expired or already-used links come back with an error in the URL instead
 * of a session; this page explains that and offers a new link.
 *
 * Supabase setup: <origin>/reset-password must be listed under
 * Authentication > URL Configuration > Redirect URLs.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppLogo } from "@/components/app-logo";
import { supabase } from "@/lib/supabase";
import { PASSWORD_RULES } from "@/lib/password-rules";
import { AlertCircle, Check, X, Eye, EyeOff } from "lucide-react";

/** Error details Supabase puts in the URL when a link is expired or invalid. */
const linkErrorFromUrl = (): string | null => {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  return params.get("error_description") ?? params.get("error");
};

/** The one-time code from a link in the new format, if this is one. */
const recoveryTokenFromUrl = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  return params.get("type") === "recovery" ? params.get("token_hash") : null;
};

export default function ResetPasswordPage() {
  /**
   * "checking" until we know whether the link signed someone in;
   * "confirm" while a new-format link waits for the Continue button.
   */
  const [linkState, setLinkState] = useState<"checking" | "confirm" | "valid" | "invalid">("checking");
  const [isVerifying, setIsVerifying] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // -------------------------------------------------------------------------
  // Check the link
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (linkErrorFromUrl()) {
      setLinkState("invalid");
      return;
    }
    if (recoveryTokenFromUrl()) {
      setLinkState("confirm");
      return;
    }
    let cancelled = false;
    // getSession waits for the client to finish reading the session from the URL.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setLinkState(data.session ? "valid" : "invalid");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Continue: use the one-time code now that a person (not a scanner) clicked. */
  const verifyLink = async () => {
    const tokenHash = recoveryTokenFromUrl();
    if (!tokenHash || isVerifying) return;
    setIsVerifying(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
      // Drop the used code from the address bar so a refresh doesn't retry it.
      window.history.replaceState(null, "", window.location.pathname);
      setLinkState(verifyError ? "invalid" : "valid");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------
  const passwordValid = PASSWORD_RULES.every((rule) => rule.test(password));
  const passwordsMatch = password === confirmPassword;
  const showMismatch = confirmPassword !== "" && !passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordValid || !passwordsMatch || isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          updateError.message.toLowerCase().includes("different")
            ? "Choose a password you haven't used before."
            : "Couldn't save your new password. The link may have expired; request a new one.",
        );
        setIsSaving(false);
        return;
      }
      // Full reload so the app starts fresh with the signed-in user.
      window.location.replace("/");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setIsSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <AppLogo className="h-12 w-12 mx-auto" />
          <h1 className="text-2xl font-serif font-bold">Choose a new password</h1>
        </div>

        <Card className="p-6">
          {linkState === "checking" ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : linkState === "confirm" ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">Press Continue to choose your new password.</p>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button className="w-full" onClick={verifyLink} disabled={isVerifying} data-testid="button-continue-reset">
                {isVerifying ? "Checking link..." : "Continue"}
              </Button>
            </div>
          ) : linkState === "invalid" ? (
            <div className="space-y-4 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                This reset link has expired or was already used. Links work once and only for a short time, so request
                a new one and use the newest email.
              </p>
              <Button asChild className="w-full">
                <a href="/forgot-password">Send a new link</a>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {error && (
                <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby="password-rules"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
                <ul id="password-rules" className="space-y-1 text-xs">
                  {PASSWORD_RULES.map((rule) => {
                    const ok = rule.test(password);
                    return (
                      <li key={rule.label} className={`flex items-center gap-1.5 ${ok ? "text-chart-2" : "text-muted-foreground"}`}>
                        {ok ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : <X className="h-3 w-3 shrink-0" aria-hidden="true" />}
                        {rule.label}
                        <span className="sr-only">{ok ? "(met)" : "(not met)"}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={showMismatch}
                  aria-describedby={showMismatch ? "confirm-error" : undefined}
                />
                {showMismatch && (
                  <p id="confirm-error" className="text-xs text-destructive">
                    Passwords don't match.
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={!passwordValid || !passwordsMatch || isSaving}>
                {isSaving ? "Saving..." : "Save new password"}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
