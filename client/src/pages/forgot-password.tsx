/**
 * ForgotPasswordPage
 *
 * Lets a user request a password reset email through Supabase Auth.
 *
 * Flow:
 *   1. User enters their email and submits.
 *   2. Supabase emails a magic link that redirects to /reset-password,
 *      where a separate page lets them choose a new password.
 *   3. This page switches to a "check your email" screen, with options to
 *      resend the link (after a cooldown) or try a different address.
 *
 * Security note on account enumeration:
 *   The confirmation screen never says whether an account exists for the
 *   email. It always shows the same "if an account exists" message, so the
 *   page cannot be used to discover which emails are registered.
 *
 * Supabase setup this page depends on:
 *   - <origin>/reset-password must be listed under Authentication > URL
 *     Configuration > Redirect URLs, or Supabase will ignore redirectTo and
 *     send users to the Site URL instead.
 */

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppLogo } from "@/components/app-logo";
import { supabase } from "@/lib/supabase";
import { ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

/**
 * Seconds to wait before allowing another reset email.
 * Supabase rate-limits reset emails (60 seconds per address by default), so
 * matching that here avoids showing users a confusing rate-limit error.
 */
const RESEND_COOLDOWN_SECONDS = 60;

/** Simple email format check: something@something.something, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Read an email from the URL, e.g. /forgot-password?email=jane@org.org.
 * Lets the login page pass along whatever the user already typed there,
 * so they do not have to enter it twice.
 */
const getEmailFromUrl = (): string => {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("email") ?? "";
};

/**
 * Turn a Supabase auth error into a message that is safe and useful to show.
 *
 * Raw error messages are not shown directly because some can hint at whether
 * an account exists. Rate-limit errors are the exception: the user needs to
 * know to wait, and they reveal nothing about the account.
 */
const toFriendlyError = (err: { message?: string; status?: number }): string => {
  const msg = err.message?.toLowerCase() ?? "";
  // Project-wide cap on emails per hour, not anything this person did.
  if (msg.includes("email rate limit")) {
    return "We're sending a lot of emails right now. Please try again in a little while.";
  }
  // Same address asked again within 60 seconds.
  if (err.status === 429 || msg.includes("rate limit") || msg.includes("security purposes")) {
    return "Too many reset requests. Please wait a minute and try again.";
  }
  return "We couldn't send the reset email right now. Please try again in a moment.";
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ForgotPasswordPage() {
  // ----- Form state -----
  const [email, setEmail] = useState(getEmailFromUrl);
  /** Only show format errors after the user has left the field or tried to submit. */
  const [emailTouched, setEmailTouched] = useState(false);

  // ----- Request state -----
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  /** Seconds left until "Resend link" becomes available again. */
  const [cooldown, setCooldown] = useState(0);

  /**
   * Count the resend cooldown down by one each second.
   * The timer is cleared on every tick and on unmount, so it never leaks.
   */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  const trimmedEmail = email.trim();
  const isEmailValid = EMAIL_PATTERN.test(trimmedEmail);
  const showEmailError = emailTouched && trimmedEmail !== "" && !isEmailValid;

  // -------------------------------------------------------------------------
  // Send / resend
  // -------------------------------------------------------------------------

  /**
   * Ask Supabase to email a reset link.
   *
   * Shared by the initial submit and the "Resend link" button.
   *
   * Fixes over the original:
   * - try/finally so "Sending..." always clears, even if the request throws
   *   (for example, the device is offline).
   * - Validates the email format before calling the API.
   * - Guards against double submission.
   * - Shows a safe, friendly error instead of the raw Supabase message.
   */
  const sendResetEmail = async (): Promise<boolean> => {
    if (!isEmailValid || isLoading) return false;

    setIsLoading(true);
    setError("");
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (authError) {
        setError(toFriendlyError(authError));
        return false;
      }

      setCooldown(RESEND_COOLDOWN_SECONDS);
      return true;
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  /** Form submit: validate, send, and switch to the confirmation screen on success. */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    if (await sendResetEmail()) {
      setSent(true);
    }
  };

  /** Go back to the form so the user can correct a mistyped email. */
  const useDifferentEmail = () => {
    setSent(false);
    setError("");
    setEmailTouched(false);
  };

  // -------------------------------------------------------------------------
  // Render: confirmation screen
  // -------------------------------------------------------------------------

  if (sent) {
    return (
      // "relative" anchors the absolutely positioned theme toggle to this container.
      <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        {/* role="status" announces the confirmation to screen reader users. */}
        <div role="status" className="w-full max-w-md text-center space-y-4">
          <div className="h-14 w-14 rounded-full bg-chart-2/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-7 w-7 text-chart-2" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-serif font-bold">Check your email</h1>

          {/* Wording deliberately avoids confirming that the account exists. */}
          <p className="text-muted-foreground">
            If an account exists for <strong className="text-foreground break-all">{trimmedEmail}</strong>, we've sent
            a link to reset your password. It may take a few minutes to arrive.
          </p>
          <p className="text-sm text-muted-foreground">Don't see it? Check your spam or junk folder.</p>

          {/* Resend errors (such as rate limits) show here, since the form is hidden. */}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm text-left"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col items-center gap-2 pt-2">
            {/* Resend is disabled during the cooldown to match Supabase's rate limit. */}
            <Button variant="ghost" onClick={sendResetEmail} disabled={cooldown > 0 || isLoading}>
              {isLoading ? "Sending..." : cooldown > 0 ? `Resend link in ${cooldown}s` : "Resend link"}
            </Button>
            <Button variant="ghost" onClick={useDifferentEmail} disabled={isLoading}>
              Use a different email
            </Button>

            {/* asChild renders the Button's styles onto the <a>. The original put a
                <button> inside an <a>, which is invalid HTML and creates two
                separate tab stops for one action. */}
            <Button asChild variant="outline" className="mt-2">
              <a href="/login">
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" /> Back to sign in
              </a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: request form
  // -------------------------------------------------------------------------

  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md space-y-6">
        {/* ===== Logo and heading ===== */}
        <div className="text-center space-y-2">
          <AppLogo className="h-12 w-12 mx-auto" />
          <h1 className="text-2xl font-serif font-bold">Reset your password</h1>
          <p className="text-muted-foreground text-sm">Enter your email and we'll send you a reset link</p>
        </div>

        {/* ===== Form ===== */}
        <Card className="p-6">
          {/* noValidate: we show our own inline error instead of the browser's popup. */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Request-level errors. role="alert" makes screen readers read them out immediately. */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                placeholder="you@organization.org"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  // Clear a stale request error as soon as the user edits the address.
                  if (error) setError("");
                }}
                onBlur={() => setEmailTouched(true)}
                aria-invalid={showEmailError}
                aria-describedby={showEmailError ? "email-error" : undefined}
              />
              {showEmailError && (
                <p id="email-error" className="text-xs text-destructive">
                  Enter a valid email address.
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={!trimmedEmail || isLoading}>
              {isLoading ? "Sending..." : "Send reset link"}
            </Button>
          </form>
        </Card>

        {/* ===== Link back to sign in ===== */}
        <p className="text-center text-sm text-muted-foreground">
          Remember your password?{" "}
          <a href="/login" className="text-foreground font-medium hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}