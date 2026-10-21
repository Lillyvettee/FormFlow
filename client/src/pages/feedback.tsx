/**
 * FeedbackPage
 *
 * A contact form where users can send a bug report, general feedback, a
 * feature request, or anything else. Submissions are inserted into the
 * Supabase "feedback" table. After a successful send, a thank-you screen
 * replaces the form, with an option to send another message.
 *
 * Works for both signed-in and signed-out visitors:
 *   - Signed in: user_id is attached and the email is pre-filled from the account.
 *   - Signed out: user_id is null, so an email address is required for a reply.
 *
 * Backend assumptions:
 *   - Table "feedback" has columns: user_id (nullable), email, type, subject, message.
 *   - Row Level Security allows INSERT for the roles that use this page
 *     (anon and/or authenticated), and does NOT allow SELECT for regular users,
 *     so people cannot read each other's feedback.
 */

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, MessageSquare, Bug, Lightbulb, Heart, type LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** The categories a submission can belong to. Stored as-is in feedback.type. */
type FeedbackType = "bug" | "feedback" | "feature" | "other";

interface FeedbackTypeOption {
  value: FeedbackType;
  label: string;
  icon: LucideIcon;
  /** Placeholder for the subject field when this type is selected. */
  subjectPlaceholder: string;
  /** Placeholder for the message field when this type is selected. */
  messagePlaceholder: string;
}

/**
 * Feedback categories shown as selectable tiles.
 *
 * The original labels contained emojis and the imported icons were never
 * rendered. Emojis are removed and the lucide icons are now displayed instead.
 * Placeholders live here too, replacing the nested ternaries in the JSX, so
 * adding a new type only means adding one entry to this list.
 */
const FEEDBACK_TYPES: FeedbackTypeOption[] = [
  {
    value: "bug",
    label: "Bug report",
    icon: Bug,
    subjectPlaceholder: "Describe the bug briefly...",
    messagePlaceholder:
      "Steps to reproduce the bug:\n1. Go to...\n2. Click...\n3. See error...\n\nWhat did you expect to happen?",
  },
  {
    value: "feedback",
    label: "General feedback",
    icon: MessageSquare,
    subjectPlaceholder: "What's on your mind?",
    messagePlaceholder: "Tell us more...",
  },
  {
    value: "feature",
    label: "Feature request",
    icon: Lightbulb,
    subjectPlaceholder: "What would you like to see?",
    messagePlaceholder: "Describe the feature and how it would help your organization...",
  },
  {
    value: "other",
    label: "Other",
    icon: Heart,
    subjectPlaceholder: "What's on your mind?",
    messagePlaceholder: "Tell us more...",
  },
];

/** Field length limits, enforced in the inputs and shown as counters. */
const MAX_SUBJECT_LENGTH = 150;
const MAX_MESSAGE_LENGTH = 5000;

/**
 * Basic email format check: something@something.something with no spaces.
 * Intentionally simple; the browser's type="email" check plus this is enough
 * to catch typos without rejecting unusual but valid addresses.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** The form's card on its own page; just a plain block inside Settings' card. */
function FormWrapper({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  return embedded ? <div>{children}</div> : <Card className="p-6">{children}</Card>;
}

/**
 * embedded: shown inside Settings (Feedback & contact), which supplies the
 * heading and card, so this leaves out its own page padding, title and card.
 */
export default function FeedbackPage({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();

  // ----- Form state -----
  const [type, setType] = useState<FeedbackType>("feedback");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");

  /** Tracks whether the user has typed in the email field, so we never overwrite their edit. */
  const [emailTouched, setEmailTouched] = useState(false);

  // ----- Request state -----
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  /**
   * Pre-fill the email once the signed-in user loads.
   *
   * The original only read user?.email in the initial useState call. Auth
   * usually resolves AFTER the first render, so the field stayed empty for
   * most signed-in users. This fills it in when the user becomes available,
   * unless the person has already typed their own address.
   */
  useEffect(() => {
    if (user?.email && !emailTouched) {
      setEmail(user.email);
    }
  }, [user?.email, emailTouched]);

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  const trimmedEmail = email.trim();

  /**
   * An email is required so the team can actually reply (the footer promises
   * a response within 1-2 business days). The original allowed it to be blank
   * or malformed.
   */
  const emailError: string | null =
    trimmedEmail === ""
      ? "Enter an email so we can reply."
      : !EMAIL_PATTERN.test(trimmedEmail)
        ? "Enter a valid email address."
        : null;

  const isFormValid = subject.trim() !== "" && message.trim() !== "" && emailError === null;

  /** The currently selected type's config, used for placeholders. */
  const selectedType = FEEDBACK_TYPES.find((ft) => ft.value === type) ?? FEEDBACK_TYPES[1];

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  /**
   * Insert the feedback row.
   *
   * Fixes over the original:
   * - try/finally ensures "Sending..." always clears, even on a network
   *   failure that throws instead of returning an error object.
   * - Guards against double submission (pressing Enter twice quickly).
   * - Validates email as well as subject and message.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("feedback").insert({
        user_id: user?.id ?? null,
        email: trimmedEmail,
        type,
        subject: subject.trim(),
        message: message.trim(),
      });

      if (error) {
        toast({ title: "Could not send feedback", description: error.message, variant: "destructive" });
        return;
      }

      setSubmitted(true);
    } catch (err) {
      toast({
        title: "Could not send feedback",
        description: err instanceof Error ? err.message : "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Return from the thank-you screen to a fresh form. The email is kept for convenience. */
  const resetForm = () => {
    setSubmitted(false);
    setSubject("");
    setMessage("");
    setType("feedback");
  };

  // -------------------------------------------------------------------------
  // Render: thank-you screen
  // -------------------------------------------------------------------------

  if (submitted) {
    return (
      // role="status" announces the confirmation to screen reader users.
      <div
        role="status"
        className={`flex flex-col items-center justify-center space-y-4 text-center ${embedded ? "py-6" : "p-6 max-w-2xl mx-auto min-h-[60vh]"}`}
      >
        <div className="h-16 w-16 rounded-full bg-chart-2/10 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-chart-2" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-serif font-bold">Thank you</h2>
        <p className="text-muted-foreground">
          Your feedback has been received. We read every submission and use it to improve HumMotion. We'll reply to{" "}
          <span className="font-medium text-foreground">{trimmedEmail}</span> if we need more details.
        </p>
        <Button variant="outline" onClick={resetForm}>
          Send another
        </Button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: form
  // -------------------------------------------------------------------------

  return (
    <div className={embedded ? "space-y-5" : "p-6 space-y-6 max-w-2xl mx-auto"}>
      {/* ===== Header ===== */}
      {!embedded && (
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Feedback & Contact</h1>
          <p className="text-muted-foreground">Report a bug, suggest a feature, or just say hello</p>
        </div>
      )}

      {/* ===== Feedback type selector =====
          Exposed as a radio group so screen readers announce it as
          "one choice out of four" and report which one is selected. */}
      <div role="radiogroup" aria-label="Feedback type" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {FEEDBACK_TYPES.map((ft) => {
          const Icon = ft.icon;
          const isSelected = type === ft.value;
          return (
            <button
              key={ft.value}
              // type="button" prevents this from ever acting as a submit button
              // if the layout changes and it ends up inside the <form>.
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setType(ft.value)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-md border text-sm font-medium transition-colors text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isSelected ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/50"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {ft.label}
            </button>
          );
        })}
      </div>

      {/* ===== Form ===== */}
      <FormWrapper embedded={embedded}>
        {/* noValidate: we show our own inline errors instead of the browser's popups. */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Email (required). Error only shows after the user has interacted
              with the field, so the form does not open covered in red. */}
          <div className="space-y-2">
            <Label htmlFor="feedback-email">Your email</Label>
            <Input
              id="feedback-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailTouched(true);
              }}
              onBlur={() => setEmailTouched(true)}
              placeholder="you@organization.org"
              aria-invalid={emailTouched && emailError !== null}
              aria-describedby={emailTouched && emailError ? "feedback-email-error" : undefined}
            />
            {emailTouched && emailError && (
              <p id="feedback-email-error" className="text-xs text-destructive">
                {emailError}
              </p>
            )}
          </div>

          {/* Subject (required), with a live character count. */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="feedback-subject">Subject</Label>
              <span className="text-xs text-muted-foreground">
                {subject.length}/{MAX_SUBJECT_LENGTH}
              </span>
            </div>
            <Input
              id="feedback-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={selectedType.subjectPlaceholder}
              maxLength={MAX_SUBJECT_LENGTH}
            />
          </div>

          {/* Message (required), with a live character count. */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="feedback-message">Message</Label>
              <span className="text-xs text-muted-foreground">
                {message.length}/{MAX_MESSAGE_LENGTH}
              </span>
            </div>
            <Textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={selectedType.messagePlaceholder}
              maxLength={MAX_MESSAGE_LENGTH}
              className="min-h-[150px]"
            />
          </div>

          <Button type="submit" className="w-full" disabled={!isFormValid || isSubmitting}>
            {isSubmitting ? "Sending..." : "Send feedback"}
          </Button>
        </form>
      </FormWrapper>

      {/* ===== Response-time note ===== */}
      <p className="text-center text-xs text-muted-foreground">
        We typically respond within 1-2 business days. For urgent issues, include "URGENT" in your subject.
      </p>
    </div>
  );
}