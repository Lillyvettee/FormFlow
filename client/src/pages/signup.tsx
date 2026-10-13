/**
 * SignupPage
 *
 * Creates a new account with Supabase Auth.
 *
 * Flow:
 *   1. If the visitor is already signed in, send them straight on.
 *   2. They fill in name, email, password and (optionally) organization.
 *   3. Supabase creates the account. Then either:
 *        - Email confirmation is ON (the default): show "Check your email",
 *          with a button to resend the link.
 *        - Email confirmation is OFF: Supabase signs them in right away, so
 *          redirect into the app.
 *
 * Works with the Login page:
 *   - ?redirect=/some/path is carried through, so after confirming their
 *     email and signing in, users land where they were originally headed.
 *   - The confirmation link opens /login with the email pre-filled.
 *
 * Supabase setup this page depends on:
 *   - <origin>/login must be in Authentication > URL Configuration > Redirect
 *     URLs, or Supabase ignores emailRedirectTo and uses the Site URL.
 */

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { PASSWORD_RULES } from "@/lib/password-rules";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppLogo } from "@/components/app-logo";
import { ArrowRight, Check, X, Eye, EyeOff, AlertCircle, Mail } from "lucide-react";

// ===========================================================================
// Constants and helpers
// ===========================================================================

/** Simple email format check: something@something.something, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Seconds before another confirmation email can be sent (Supabase's default limit). */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Where to go after signing in, from ?redirect=. Only same-site paths are
 * allowed (must start with a single "/"), which blocks open-redirect tricks
 * like ?redirect=//evil.example. Matches the Login page.
 */
const getRedirectTarget = (): string => {
  const target = new URLSearchParams(window.location.search).get("redirect");
  if (target && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\")) return target;
  return "/";
};

/**
 * Link to the login page that carries the email and redirect along, so the
 * user does not retype their email and still lands in the right place.
 */
const buildLoginHref = (email: string): string => {
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  const redirect = getRedirectTarget();
  if (redirect !== "/") params.set("redirect", redirect);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
};

/**
 * Turn a Supabase sign-up error into a clear message with a next step.
 * The original showed error.message as-is.
 */
const friendlySignupError = (err: { message?: string; status?: number }): string => {
  const msg = err.message?.toLowerCase() ?? "";
  if (msg.includes("already registered") || msg.includes("already exists")) {
    return "An account with this email already exists. Sign in instead, or reset your password if you've forgotten it.";
  }
  if (err.status === 429 || msg.includes("rate limit") || msg.includes("security purposes")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (msg.includes("password")) {
    // Covers Supabase's own password policy, such as leaked-password checks.
    return err.message ?? "Please choose a stronger password.";
  }
  return "We couldn't create your account right now. Please try again in a moment.";
};

// ===========================================================================
// Small components
// ===========================================================================

/** Logo mark; decorative, so hidden from screen readers. */
function LogoMark() {
  return <AppLogo className="h-12 w-12 mx-auto" />;
}

/** Red error banner. role="alert" makes screen readers announce it immediately. */
function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm text-left">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

/**
 * Strength bar and checklist shown under the password field.
 * The checklist now uses a check or an X (the original used a warning icon
 * for unmet rules, which read as an error before the user had finished
 * typing), and screen readers hear "met" or "not met" for each rule.
 */
function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const results = PASSWORD_RULES.map((rule) => ({ label: rule.label, valid: rule.test(password) }));
  const passed = results.filter((r) => r.valid).length;
  const total = results.length;

  // Color and word for the bar, so strength is not conveyed by color alone.
  const level =
    passed <= 2
      ? { color: "bg-destructive", word: "Weak" }
      : passed < total
        ? { color: "bg-chart-4", word: "Almost there" }
        : { color: "bg-chart-2", word: "Strong" };

  return (
    <div className="space-y-2 mt-2" id="password-rules">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 flex-1" aria-hidden="true">
          {results.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${i < passed ? level.color : "bg-muted"}`}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground w-20 text-right">{level.word}</span>
      </div>
      <ul className="space-y-0.5" aria-live="polite">
        {results.map((r) => (
          <li key={r.label} className="flex items-center gap-1.5 text-xs">
            {r.valid ? (
              <Check className="h-3 w-3 text-chart-2 shrink-0" aria-hidden="true" />
            ) : (
              <X className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
            )}
            <span className={r.valid ? "text-chart-2" : "text-muted-foreground"}>
              {r.label}
              <span className="sr-only">{r.valid ? " (met)" : " (not met)"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===========================================================================
// Page component
// ===========================================================================

export default function SignupPage() {
  // ----- Form state -----
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  /** One toggle shows or hides both password fields, so they can be compared. */
  const [showPasswords, setShowPasswords] = useState(false);
  /** Email errors only show after the user leaves the field, not mid-typing. */
  const [emailTouched, setEmailTouched] = useState(false);

  // ----- Request state -----
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [serverError, setServerError] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  // ----- Resend confirmation state -----
  const [cooldown, setCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");

  /** Skip the form if the visitor is already signed in. */
  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session) window.location.replace(getRedirectTarget());
        else setIsCheckingSession(false);
      })
      .catch(() => {
        if (!cancelled) setIsCheckingSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Count the resend cooldown down once per second. */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validate the trimmed email. The original checked the raw value, so a
   * pasted address with a stray space was rejected even though the submit
   * would have trimmed it.
   */
  const trimmedEmail = email.trim();
  const emailValid = EMAIL_PATTERN.test(trimmedEmail);
  const showEmailError = emailTouched && trimmedEmail !== "" && !emailValid;
  const passwordValid = PASSWORD_RULES.every((rule) => rule.test(password));
  const passwordsMatch = password === confirmPassword;
  const formValid =
    firstName.trim() !== "" &&
    lastName.trim() !== "" &&
    emailValid &&
    passwordValid &&
    confirmPassword !== "" &&
    passwordsMatch;

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  /**
   * Create the account.
   *
   * Fixes over the original:
   * - try/catch so a network failure shows a message instead of leaving the
   *   button stuck on "Creating Account...".
   * - If email confirmation is turned off, Supabase signs the user in
   *   immediately; the original still said "Check your email". It now
   *   redirects into the app.
   * - The confirmation link now opens the login page with the email filled in
   *   (emailRedirectTo), instead of the default Site URL.
   * - First and last name are stored separately as well as combined, so
   *   other pages can use either.
   * - Errors are mapped to clear messages.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    if (!formValid || isLoading) return;

    setIsLoading(true);
    setServerError("");

    try {
      const first = firstName.trim();
      const last = lastName.trim();
      const { data, error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}${buildLoginHref(trimmedEmail)}`,
          data: {
            first_name: first,
            last_name: last,
            full_name: `${first} ${last}`,
            organization_name: companyName.trim() || null,
          },
        },
      });

      if (error) {
        setServerError(friendlySignupError(error));
        setIsLoading(false);
        return;
      }

      // Confirmation disabled: the user is already signed in.
      if (data.session) {
        window.location.replace(getRedirectTarget());
        return; // Keep the loading state while the page changes.
      }

      // Confirmation enabled: show the "check your email" screen.
      // Note: if this email is ALREADY registered, Supabase deliberately
      // returns success without sending anything (so attackers cannot learn
      // which emails have accounts). The confirmation screen covers this
      // case with sign-in and password-reset links.
      setPassword("");
      setConfirmPassword("");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setEmailSent(true);
      setIsLoading(false);
    } catch {
      setServerError("Couldn't reach the server. Check your connection and try again.");
      setIsLoading(false);
    }
  };

  /** Resend the confirmation email from the "check your email" screen. */
  const resendConfirmation = async () => {
    if (cooldown > 0 || isResending) return;
    setIsResending(true);
    setResendMessage("");
    setServerError("");
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: trimmedEmail,
        options: { emailRedirectTo: `${window.location.origin}${buildLoginHref(trimmedEmail)}` },
      });
      if (error) {
        setServerError(friendlySignupError(error));
      } else {
        setResendMessage("Sent. It can take a few minutes to arrive.");
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch {
      setServerError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsResending(false);
    }
  };

  /** Go back to the form to fix a mistyped email. Names and organization are kept. */
  const useDifferentEmail = () => {
    setEmailSent(false);
    setServerError("");
    setResendMessage("");
    setEmailTouched(false);
  };

  const loginHref = buildLoginHref(trimmedEmail);

  // -------------------------------------------------------------------------
  // Render: blank while checking for an existing session
  // -------------------------------------------------------------------------

  if (isCheckingSession) {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }

  // -------------------------------------------------------------------------
  // Render: check your email
  // -------------------------------------------------------------------------

  if (emailSent) {
    return (
      // "relative" anchors the absolutely positioned theme toggle to this container.
      <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        <div role="status" className="w-full max-w-md text-center space-y-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto" aria-hidden="true">
            <Mail className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-serif font-bold">Check your email</h1>
          <p className="text-muted-foreground">
            We sent a confirmation link to <strong className="text-foreground break-all">{trimmedEmail}</strong>. Click it
            to activate your account.
          </p>
          <p className="text-sm text-muted-foreground">
            Don't see it? Check your spam folder. If you already have an account with this email, no new link is sent:{" "}
            <a href={loginHref} className="text-foreground font-medium hover:underline">
              sign in
            </a>{" "}
            or{" "}
            <a
              href={`/forgot-password?email=${encodeURIComponent(trimmedEmail)}`}
              className="text-foreground font-medium hover:underline"
            >
              reset your password
            </a>
            .
          </p>

          {serverError && <ErrorBanner message={serverError} />}
          {resendMessage && <p className="text-sm text-chart-2">{resendMessage}</p>}

          <div className="flex flex-col items-center gap-2 pt-2">
            <Button variant="outline" onClick={resendConfirmation} disabled={cooldown > 0 || isResending}>
              {isResending ? "Sending..." : cooldown > 0 ? `Resend link in ${cooldown}s` : "Resend confirmation link"}
            </Button>
            <Button variant="ghost" onClick={useDifferentEmail}>
              Use a different email
            </Button>
          </div>

          <p className="text-sm text-muted-foreground pt-2">
            Already confirmed?{" "}
            <a href={loginHref} className="text-foreground font-medium hover:underline">
              Log in
            </a>
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: sign-up form
  // -------------------------------------------------------------------------

  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md space-y-6">
        {/* ===== Heading ===== */}
        <div className="text-center space-y-2">
          <LogoMark />
          <h1 className="text-2xl font-serif font-bold" data-testid="text-signup-title">
            Create your account
          </h1>
          <p className="text-muted-foreground text-sm">Start collecting data and amplifying your mission</p>
        </div>

        {/* ===== Form ===== */}
        <Card className="p-6">
          {/* noValidate: we show our own inline errors instead of browser popups. */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {serverError && <ErrorBanner message={serverError} />}

            {/* Name. autoComplete values let browsers and password managers fill these in. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="first-name">First name</Label>
                <Input
                  id="first-name"
                  placeholder="Jane"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  maxLength={60}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last-name">Last name</Label>
                <Input
                  id="last-name"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  maxLength={60}
                />
              </div>
            </div>

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
                  if (serverError) setServerError("");
                }}
                onBlur={() => setEmailTouched(true)}
                autoComplete="email"
                aria-invalid={showEmailError}
                aria-describedby={showEmailError ? "email-error" : undefined}
              />
              {showEmailError && (
                <p id="email-error" className="text-xs text-destructive">
                  Please enter a valid email address
                </p>
              )}
            </div>

            {/* Password with show/hide toggle and strength checklist.
                The toggle was tabIndex={-1} with no label before, so keyboard and
                screen reader users could not use it. */}
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPasswords ? "text" : "password"}
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                  aria-invalid={password !== "" && !passwordValid}
                  aria-describedby={password ? "password-rules" : undefined}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  onClick={() => setShowPasswords((s) => !s)}
                  aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
                  aria-pressed={showPasswords}
                >
                  {showPasswords ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </div>
              <PasswordStrength password={password} />
            </div>

            {/* Confirm password. Follows the same show/hide setting as the field above. */}
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type={showPasswords ? "text" : "password"}
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={confirmPassword !== "" && !passwordsMatch}
                aria-describedby={confirmPassword && !passwordsMatch ? "confirm-error" : undefined}
              />
              {confirmPassword && !passwordsMatch && (
                <p id="confirm-error" className="text-xs text-destructive">
                  Passwords do not match
                </p>
              )}
            </div>

            {/* Organization (optional) */}
            <div className="space-y-2">
              <Label htmlFor="company">
                Organization name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="company"
                placeholder="Your non-profit name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                autoComplete="organization"
                maxLength={150}
              />
            </div>

            <Button type="submit" className="w-full" disabled={!formValid || isLoading}>
              {isLoading ? "Creating account..." : "Create account"}
              {!isLoading && <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />}
            </Button>

            {/* Legal links open in a new tab so a half-filled form isn't lost. */}
            <p className="text-xs text-muted-foreground text-center">
              By creating an account you agree to the{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                Privacy Policy
              </a>
              .
            </p>
          </form>
        </Card>

        {/* ===== Link to log in (keeps email and redirect) ===== */}
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href={loginHref} className="text-foreground font-medium hover:underline">
            Log in
          </a>
        </p>
      </div>
    </div>
  );
}