/**
 * LoginPage
 *
 * Email and password sign-in through Supabase Auth.
 *
 * Flow:
 *   1. If the visitor already has a session, send them straight on.
 *   2. Otherwise they enter email and password and submit.
 *   3. On success, redirect to the page they were trying to reach
 *      (?redirect=/some/path) or to the dashboard ("/").
 *   4. On failure, show a clear message. For unconfirmed accounts, offer to
 *      resend the confirmation email.
 *
 * Related pages:
 *   - /forgot-password (receives ?email= so the address carries over)
 *   - /signup (receives ?redirect= so the user lands in the right place after)
 */

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppLogo } from "@/components/app-logo";
import { supabase } from "@/lib/supabase";
import { ArrowRight, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";

// ===========================================================================
// Helpers
// ===========================================================================

/** Simple email format check: something@something.something, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where to send the user after signing in.
 *
 * Reads ?redirect= from the URL so a user who was bounced to login from a
 * protected page lands back on it. Only same-site paths are allowed: the
 * value must start with a single "/". This blocks open-redirect attacks such
 * as ?redirect=https://evil.example or ?redirect=//evil.example, which could
 * be used in phishing links that appear to come from your site.
 */
const getRedirectTarget = (): string => {
  const target = new URLSearchParams(window.location.search).get("redirect");
  if (target && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\")) {
    return target;
  }
  return "/";
};

/** Read an email from the URL (e.g. after sign-up or a password reset) to pre-fill the field. */
const getEmailFromUrl = (): string => new URLSearchParams(window.location.search).get("email") ?? "";

/** The kinds of sign-in failure the page handles differently. */
type LoginErrorKind = "credentials" | "unconfirmed" | "rate_limited" | "other";

/**
 * Sort a Supabase auth error into one of the kinds above.
 * The original showed error.message as-is; Supabase's wording is terse
 * ("Invalid login credentials") and gives no next step.
 */
const classifyError = (err: { message?: string; status?: number }): LoginErrorKind => {
  const msg = err.message?.toLowerCase() ?? "";
  if (msg.includes("invalid login credentials")) return "credentials";
  if (msg.includes("email not confirmed")) return "unconfirmed";
  if (err.status === 429 || msg.includes("rate limit") || msg.includes("too many")) return "rate_limited";
  return "other";
};

/** User-facing text for each error kind. */
const ERROR_MESSAGES: Record<LoginErrorKind, string> = {
  // Deliberately does not say which of the two was wrong, so the form cannot
  // be used to find out whether an email has an account.
  credentials: "That email and password don't match. Check them and try again, or reset your password.",
  unconfirmed: "Please confirm your email address first. Check your inbox for the confirmation link.",
  rate_limited: "Too many sign-in attempts. Please wait a minute and try again.",
  other: "We couldn't sign you in right now. Please try again in a moment.",
};

// ===========================================================================
// Component
// ===========================================================================

export default function LoginPage() {
  // ----- Form state -----
  const [email, setEmail] = useState(getEmailFromUrl);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  /** Email format errors only show after the user leaves the field. */
  const [emailTouched, setEmailTouched] = useState(false);
  /** True while Caps Lock is on and the password field has focus. */
  const [capsLockOn, setCapsLockOn] = useState(false);

  // ----- Request state -----
  const [isLoading, setIsLoading] = useState(false);
  /** True while checking for an existing session on first load. */
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [errorKind, setErrorKind] = useState<LoginErrorKind | null>(null);

  // ----- Resend confirmation email state -----
  const [isResending, setIsResending] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  /**
   * Skip the login form if the user is already signed in.
   * Without this, a signed-in user who opened /login (from a bookmark or the
   * back button) saw the form for no reason.
   */
  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session) {
          window.location.replace(getRedirectTarget());
        } else {
          setIsCheckingSession(false);
        }
      })
      .catch(() => {
        // If the check fails, just show the form.
        if (!cancelled) setIsCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  const trimmedEmail = email.trim();
  const isEmailValid = EMAIL_PATTERN.test(trimmedEmail);
  const showEmailError = emailTouched && trimmedEmail !== "" && !isEmailValid;
  const formValid = isEmailValid && password.length > 0;

  // -------------------------------------------------------------------------
  // Sign in
  // -------------------------------------------------------------------------

  /**
   * Submit email and password to Supabase.
   *
   * Fixes over the original:
   * - try/catch so a network failure shows a message instead of leaving the
   *   button stuck on "Signing in...".
   * - On success, the loading state stays on until the page changes, so the
   *   button does not flash back to "Sign in" just before the redirect.
   * - Uses location.replace so the Back button does not return to the login form.
   * - Honors ?redirect= (safely) instead of always going to "/".
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    if (!formValid || isLoading) return;

    setIsLoading(true);
    setErrorKind(null);
    setResendSent(false);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });

      if (error) {
        setErrorKind(classifyError(error));
        setIsLoading(false);
        return;
      }

      // Success: leave isLoading true; the page is about to change.
      window.location.replace(getRedirectTarget());
    } catch {
      setErrorKind("other");
      setIsLoading(false);
    }
  };

  /**
   * Resend the sign-up confirmation email for an unconfirmed account.
   * Only shown when sign-in failed with "Email not confirmed".
   */
  const resendConfirmation = async () => {
    if (!isEmailValid || isResending) return;
    setIsResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email: trimmedEmail });
      if (error) {
        setErrorKind(classifyError(error) === "rate_limited" ? "rate_limited" : "other");
      } else {
        setResendSent(true);
      }
    } catch {
      setErrorKind("other");
    } finally {
      setIsResending(false);
    }
  };

  /** Clear a stale error as soon as the user starts correcting their input. */
  const clearError = () => {
    if (errorKind) setErrorKind(null);
    if (resendSent) setResendSent(false);
  };

  /**
   * Detect Caps Lock from keyboard events in the password field.
   * A common cause of "wrong password" that users can't see because the
   * characters are hidden.
   */
  const checkCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(e.getModifierState?.("CapsLock") ?? false);
  };

  // Links to related pages, carrying context across.
  const forgotPasswordHref = trimmedEmail
    ? `/forgot-password?email=${encodeURIComponent(trimmedEmail)}`
    : "/forgot-password";
  const redirectTarget = getRedirectTarget();
  const signupHref = redirectTarget !== "/" ? `/signup?redirect=${encodeURIComponent(redirectTarget)}` : "/signup";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Blank screen (with theme background) while checking for an existing session,
  // so signed-in users do not see the form flash before redirecting.
  if (isCheckingSession) {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }

  return (
    // "relative" anchors the absolutely positioned theme toggle to this container.
    <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md space-y-6">
        {/* ===== Logo and heading ===== */}
        <div className="text-center space-y-2">
          <AppLogo className="h-12 w-12 mx-auto" />
          <h1 className="text-2xl font-serif font-bold" data-testid="text-login-title">
            Welcome back
          </h1>
          <p className="text-muted-foreground text-sm">Sign in to your HumMotion account</p>
        </div>

        {/* ===== Form ===== */}
        <Card className="p-6">
          {/* noValidate: we show our own inline errors instead of browser popups. */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Sign-in error. role="alert" makes screen readers announce it immediately. */}
            {errorKind && (
              <div
                role="alert"
                className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm"
                data-testid="text-login-error"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <div className="space-y-2">
                  <span>{ERROR_MESSAGES[errorKind]}</span>
                  {/* Unconfirmed accounts get a one-click way to fix it. */}
                  {errorKind === "unconfirmed" && (
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={resendConfirmation}
                        disabled={isResending}
                      >
                        {isResending ? "Sending..." : "Resend confirmation email"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Confirmation that the resend worked. */}
            {resendSent && (
              <div
                role="status"
                className="flex items-start gap-2 p-3 rounded-md bg-chart-2/10 text-sm"
              >
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-chart-2" aria-hidden="true" />
                <span>Confirmation email sent to {trimmedEmail}. Check your inbox and spam folder.</span>
              </div>
            )}

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                placeholder="you@organization.org"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearError();
                }}
                onBlur={() => setEmailTouched(true)}
                autoComplete="email"
                // Start in the password field if the email was pre-filled from the URL.
                autoFocus={!email}
                aria-invalid={showEmailError}
                aria-describedby={showEmailError ? "email-error" : undefined}
                data-testid="input-email"
              />
              {showEmailError && (
                <p id="email-error" className="text-xs text-destructive">
                  Enter a valid email address.
                </p>
              )}
            </div>

            {/* Password, with show/hide toggle and forgot-password link */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="password">Password</Label>
                {/* This link was missing; users who forgot their password had no way to reset it. */}
                <a
                  href={forgotPasswordHref}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearError();
                  }}
                  onKeyDown={checkCapsLock}
                  onKeyUp={checkCapsLock}
                  onBlur={() => setCapsLockOn(false)}
                  autoComplete="current-password"
                  autoFocus={Boolean(email)}
                  // Right padding keeps typed text from running under the eye button.
                  className="pr-10"
                  aria-describedby={capsLockOn ? "caps-lock-warning" : undefined}
                  data-testid="input-password"
                />
                {/* The original had tabIndex={-1} and no label, so keyboard and
                    screen reader users could not use it. It is now reachable
                    and announces what it does and its current state. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
              {capsLockOn && (
                <p id="caps-lock-warning" className="text-xs text-amber-700 dark:text-amber-400">
                  Caps Lock is on.
                </p>
              )}
            </div>

            {/* Submit. Stays enabled while the email is merely untouched so pressing
                Enter can trigger validation messages. */}
            <Button
              type="submit"
              className="w-full"
              disabled={!trimmedEmail || !password || isLoading}
              data-testid="button-login"
            >
              {isLoading ? "Signing in..." : "Sign in"}
              {!isLoading && <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />}
            </Button>
          </form>
        </Card>

        {/* ===== Link to sign up ===== */}
        <p className="text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <a href={signupHref} className="text-foreground font-medium hover:underline" data-testid="link-signup">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}