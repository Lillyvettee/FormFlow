/**
 * FormNotificationsEditor
 *
 * The "Email notifications" section of the form builder: who on the team is
 * emailed about each new response, and whether respondents get a
 * confirmation (at the address they enter in one of the form's email
 * questions). The emails are sent by the form-notify function.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail } from "lucide-react";
import type { FormField } from "@/types/database";

export interface NotificationsDraft {
  staffEmails: string;
  confirm: boolean;
  confirmEmailFieldId: string;
  confirmMessage: string;
  includeAnswers: boolean;
}

export const MAX_STAFF_EMAILS = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a@x.org, b@y.org" -> ["a@x.org", "b@y.org"] */
export const parseEmails = (text: string): string[] =>
  Array.from(new Set(text.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)));

/** Problems to show, or null when it can be saved. */
export function notificationErrors(draft: NotificationsDraft, emailFields: FormField[]): { staff: string | null; confirm: string | null } | null {
  const emails = parseEmails(draft.staffEmails);
  const bad = emails.filter((e) => !EMAIL.test(e));
  const staff = bad.length
    ? `Check ${bad.length === 1 ? "this address" : "these addresses"}: ${bad.join(", ")}`
    : emails.length > MAX_STAFF_EMAILS
      ? `Up to ${MAX_STAFF_EMAILS} addresses.`
      : null;
  const confirm = draft.confirm && !emailFields.some((f) => f.id === draft.confirmEmailFieldId) ? "Choose the question that asks for their email." : null;
  return staff || confirm ? { staff, confirm } : null;
}

export function FormNotificationsEditor({
  value,
  onChange,
  fields,
  showErrors,
}: {
  value: NotificationsDraft;
  onChange: (next: NotificationsDraft) => void;
  fields: FormField[];
  showErrors: boolean;
}) {
  const [open, setOpen] = useState(Boolean(value.staffEmails.trim() || value.confirm));
  const set = (patch: Partial<NotificationsDraft>) => onChange({ ...value, ...patch });
  const emailFields = fields.filter((f) => f.type === "email");
  const errors = showErrors ? notificationErrors(value, emailFields) : null;

  return (
    <div className="space-y-4 p-4 border rounded-md bg-muted/30">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="text-sm font-medium">Email notifications</h2>
          </div>
          <p className="text-xs text-muted-foreground">Get an email for each new response, and send respondents a confirmation.</p>
        </div>
        <Switch checked={open} onCheckedChange={(on) => { setOpen(on); if (!on) set({ staffEmails: "", confirm: false }); }} aria-label="Email notifications" />
      </div>

      {open && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="notify-staff">Email our team about each response (optional)</Label>
            <Input
              id="notify-staff"
              value={value.staffEmails}
              onChange={(e) => set({ staffEmails: e.target.value })}
              placeholder="you@yourorg.org, coordinator@yourorg.org"
              aria-invalid={Boolean(errors?.staff)}
            />
            <p className={`text-xs ${errors?.staff ? "text-destructive" : "text-muted-foreground"}`}>
              {errors?.staff ?? `Up to ${MAX_STAFF_EMAILS} addresses, separated by commas. Each email includes the answers.`}
            </p>
          </div>

          <div className="space-y-3 rounded-md border bg-background p-3">
            <div className="flex items-center gap-2">
              <Switch id="notify-confirm" checked={value.confirm} onCheckedChange={(on) => set({ confirm: on })} disabled={!emailFields.length} />
              <Label htmlFor="notify-confirm">Send respondents a confirmation email</Label>
            </div>
            {!emailFields.length ? (
              <p className="text-xs text-muted-foreground">Add an Email question to the form first; the confirmation goes to the address they enter there.</p>
            ) : (
              value.confirm && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="notify-field">Send it to the address entered in</Label>
                    <Select value={value.confirmEmailFieldId || undefined} onValueChange={(v) => set({ confirmEmailFieldId: v })}>
                      <SelectTrigger id="notify-field" aria-invalid={Boolean(errors?.confirm)}>
                        <SelectValue placeholder="Choose a question..." />
                      </SelectTrigger>
                      <SelectContent>
                        {emailFields.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.label || "Untitled email question"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors?.confirm && <p className="text-xs text-destructive">{errors.confirm}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="notify-message">Message (optional)</Label>
                    <Textarea
                      id="notify-message"
                      value={value.confirmMessage}
                      onChange={(e) => set({ confirmMessage: e.target.value })}
                      maxLength={2000}
                      rows={3}
                      placeholder="Thank you! We received your response and will be in touch within 2 business days."
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={value.includeAnswers} onCheckedChange={(on) => set({ includeAnswers: on })} />
                    Include a copy of their answers
                  </label>
                </>
              )
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Emails come from your HumMotion sender address. If they don't arrive, check spam, and ask your HumMotion admin to confirm email sending is set up.
          </p>
        </>
      )}
    </div>
  );
}
