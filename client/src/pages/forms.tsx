/**
 * FormsPage
 *
 * Lists the current user's forms and lets them create, edit, preview, fill,
 * share, duplicate and archive forms. Creating or editing a form swaps the
 * list for the FormBuilder view on the same page.
 *
 * Main pieces in this file:
 *   - Helpers and constants (field types, settings access, id generation)
 *   - OptionsInput: text box for dropdown options (comma-separated)
 *   - FormBuilder: the create/edit screen for a single form
 *   - FormsPage: the list of form cards, preview dialog, and archive dialog
 *
 * Backend assumptions (Supabase table "forms"):
 *   - Columns: id, user_id, title, description, fields (json), settings (json),
 *     is_published, is_archived, response_count, created_at.
 *   - Forms belong to the organization. Row Level Security shares them with
 *     every member (viewers read only) and lets anyone read rows where
 *     is_published = true (for the public submit page). user_id records who
 *     created the form; it isn't used for access.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { friendlyWriteError } from "@/lib/db-errors";
import { Link } from "wouter";
import {
  Plus,
  FileText,
  Trash2,
  Copy,
  Pencil,
  Eye,
  Send,
  Link2,
  // Renamed so it does not shadow the browser's built-in Image constructor.
  Image as ImageIcon,
  Mic,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Type,
  AlignLeft,
  Hash,
  Mail,
  Calendar,
  List,
  CheckSquare,
  type LucideIcon,
} from "lucide-react";
import type { Form, FormField } from "@/types/database";

// ===========================================================================
// Types
// ===========================================================================

/**
 * Shape of the forms.settings JSON column.
 * The index signature keeps any other settings the backend stores, so
 * spreading existing settings on save never drops unknown keys.
 */
interface FormSettings {
  /** Id of the form respondents are sent to after submitting this one. */
  followUpFormId?: string | null;
  [key: string]: unknown;
}

// ===========================================================================
// Constants
// ===========================================================================

/**
 * Field types available in the builder.
 *
 * The original labels used emojis. They are removed and each type now has a
 * lucide icon rendered next to the label instead.
 */
const FIELD_TYPES: { value: FormField["type"]; label: string; icon: LucideIcon }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "textarea", label: "Long text", icon: AlignLeft },
  { value: "number", label: "Number", icon: Hash },
  { value: "email", label: "Email", icon: Mail },
  { value: "date", label: "Date", icon: Calendar },
  { value: "select", label: "Dropdown", icon: List },
  { value: "checkbox", label: "Checkbox", icon: CheckSquare },
  { value: "image", label: "Photo upload", icon: ImageIcon },
  { value: "audio", label: "Voice memo", icon: Mic },
];

/** Field types that are uploads. These cannot be marked required in this builder. */
const MEDIA_TYPES = new Set<FormField["type"]>(["image", "audio"]);

/** Field types where a custom placeholder makes sense. */
const PLACEHOLDER_TYPES = new Set<FormField["type"]>(["text", "textarea", "number", "email"]);

/**
 * Radix Select throws an error if a SelectItem has value="" (the original
 * "No follow-up form" item did this). This sentinel stands in for "none"
 * and is converted back to an empty string on change.
 */
const NO_FOLLOW_UP = "__none__";

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Generate a unique id for a new field.
 * Prefers crypto.randomUUID (collision-safe); falls back to Math.random on
 * very old browsers or non-secure (http) contexts where it is unavailable.
 */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 11);
}

/** Read a form's settings safely, replacing the scattered `as any` casts. */
const getSettings = (form?: Form | null): FormSettings => (form?.settings as FormSettings | null) ?? {};

/** Read a form's fields safely; the column can be null on old rows. */
const getFields = (form?: Form | null): FormField[] => (form?.fields as FormField[] | null) ?? [];

/** Split "a, b, , c" into ["a", "b", "c"], trimming and removing duplicates. */
const parseOptions = (text: string): string[] =>
  Array.from(new Set(text.split(",").map((s) => s.trim()).filter(Boolean)));

/** Build the public URL people use to fill out a form. */
const getShareUrl = (formId: string): string => `${window.location.origin}/forms/${formId}/submit`;

// ===========================================================================
// OptionsInput
// ===========================================================================

/**
 * Text input for a dropdown field's options, entered as a comma-separated list.
 *
 * Bug in the original: the input's value was rebuilt from the parsed options
 * array on every keystroke. Typing a comma immediately got stripped back out,
 * so it was impossible to type a second option. This component keeps the raw
 * text in local state while typing, reports parsed options to the parent on
 * every change (so Save always has the latest list), and tidies the text up
 * when the input loses focus.
 */
function OptionsInput({
  id,
  options,
  onChange,
  testId,
}: {
  id: string;
  options: string[];
  onChange: (options: string[]) => void;
  testId: string;
}) {
  const [text, setText] = useState(options.join(", "));

  return (
    <Input
      id={id}
      placeholder="Option 1, Option 2, Option 3"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseOptions(e.target.value));
      }}
      onBlur={() => setText(parseOptions(text).join(", "))}
      className="mt-1"
      data-testid={testId}
    />
  );
}

// ===========================================================================
// FormBuilder
// ===========================================================================

/**
 * Create/edit screen for a single form.
 *
 * Props:
 *   form      - the form being edited, or undefined when creating a new one
 *   userId    - owner id written to the row
 *   allForms  - the user's other forms, used for the follow-up form picker
 *   onClose   - leave the builder (after save or cancel)
 *   onSaved   - reload the list after a successful save
 */
function FormBuilder({
  form,
  userId,
  allForms,
  onClose,
  onSaved,
}: {
  form?: Form;
  userId: string;
  allForms: Form[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();

  // ----- Form state, pre-filled when editing -----
  const [title, setTitle] = useState(form?.title ?? "");
  const [description, setDescription] = useState(form?.description ?? "");
  const [fields, setFields] = useState<FormField[]>(getFields(form));
  const [isPublished, setIsPublished] = useState(form?.is_published ?? false);
  const [followUpFormId, setFollowUpFormId] = useState<string>(getSettings(form).followUpFormId ?? "");
  const [isSaving, setIsSaving] = useState(false);

  /** Validation messages are hidden until the user first tries to save. */
  const [showErrors, setShowErrors] = useState(false);

  /**
   * Snapshot of the starting values, captured once. Compared against the
   * current values to detect unsaved changes when the user clicks Cancel.
   */
  const [initialSnapshot] = useState(() =>
    JSON.stringify({
      title: form?.title ?? "",
      description: form?.description ?? "",
      fields: getFields(form),
      isPublished: form?.is_published ?? false,
      followUpFormId: getSettings(form).followUpFormId ?? "",
    }),
  );
  const isDirty =
    JSON.stringify({ title, description, fields, isPublished, followUpFormId }) !== initialSnapshot;

  // Start at the top of the page when the builder opens.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  // -------------------------------------------------------------------------
  // Field operations
  // All updates use the functional setState form so rapid edits never work
  // from a stale copy of the fields array.
  // -------------------------------------------------------------------------

  /** Append a new blank text field. */
  const addField = () => {
    setFields((prev) => [
      ...prev,
      { id: generateId(), label: "", type: "text", required: false, options: [], placeholder: "" },
    ]);
  };

  /** Merge changes into the field at `index`. */
  const updateField = (index: number, updates: Partial<FormField>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

  /**
   * Change a field's type.
   * Media fields cannot be required here (the switch is hidden for them), so
   * required is reset to false. The original left it set invisibly, which
   * could make a form impossible to submit.
   */
  const changeFieldType = (index: number, type: FormField["type"]) => {
    updateField(index, { type, ...(MEDIA_TYPES.has(type) ? { required: false } : {}) });
  };

  const removeField = (index: number) => setFields((prev) => prev.filter((_, i) => i !== index));

  /**
   * Move a field up (-1) or down (+1).
   * Replaces the original drag handle, which looked draggable but did nothing.
   * Buttons also work with a keyboard and on touch screens.
   */
  const moveField = (index: number, direction: -1 | 1) => {
    setFields((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // -------------------------------------------------------------------------
  // Follow-up form options
  // -------------------------------------------------------------------------

  /**
   * True if linking to `candidateId` would create a loop, such as
   * A -> B -> A, which would bounce respondents between forms forever.
   * Walks the candidate's follow-up chain looking for this form.
   */
  const createsCycle = (candidateId: string): boolean => {
    if (!form) return false; // A brand-new form cannot be in anyone's chain yet.
    const visited = new Set<string>();
    let current: string | null = candidateId;
    while (current) {
      if (current === form.id) return true;
      if (visited.has(current)) return false; // Existing loop elsewhere; not ours.
      visited.add(current);
      const next = allForms.find((f) => f.id === current);
      current = next ? getSettings(next).followUpFormId ?? null : null;
    }
    return false;
  };

  /**
   * Forms this one can link to: not itself, not one that would create a loop,
   * and published. The currently selected form is always included, even if
   * it has since been unpublished, so the picker does not show blank.
   */
  const linkableForms = allForms.filter(
    (f) => f.id !== form?.id && (f.is_published || f.id === followUpFormId) && !createsCycle(f.id),
  );

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /** One message (or null) per field, in the same order as `fields`. */
  const fieldErrors = fields.map((f) => {
    if (!f.label.trim()) return "Add a label for this field.";
    if (f.type === "select" && (f.options?.length ?? 0) === 0) return "Add at least one option.";
    return null;
  });

  const titleError = !title.trim() ? "Give your form a name." : null;
  const publishError = isPublished && fields.length === 0 ? "Add at least one field before publishing." : null;
  const hasErrors = Boolean(titleError || publishError || fieldErrors.some(Boolean));

  // -------------------------------------------------------------------------
  // Save / cancel
  // -------------------------------------------------------------------------

  /**
   * Insert or update the form.
   *
   * Fixes over the original:
   * - Validates labels, dropdown options and publishing with no fields.
   * - Trims all text before saving, and drops options from non-dropdown fields.
   * - try/finally so the Saving state always clears, even if the request throws.
   * - Refuses to save without a user id instead of writing user_id "".
   * - Editing keeps the original creator: user_id is only set on new forms.
   */
  const handleSave = async () => {
    setShowErrors(true);
    if (hasErrors || isSaving) return;
    if (!userId) {
      toast({ title: "You're signed out", description: "Sign in again to save this form.", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const cleanFields: FormField[] = fields.map((f) => ({
        ...f,
        label: f.label.trim(),
        placeholder: f.placeholder?.trim() ?? "",
        options: f.type === "select" ? f.options ?? [] : [],
      }));

      // Spread existing settings first so unrelated keys are preserved.
      const settings: FormSettings = { ...getSettings(form), followUpFormId: followUpFormId || null };

      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        fields: cleanFields,
        is_published: isPublished,
        settings,
      };

      const { error } = form
        ? await supabase.from("forms").update(payload).eq("id", form.id)
        : await supabase.from("forms").insert({ ...payload, user_id: userId });

      if (error) {
        toast({ title: "Could not save form", description: friendlyWriteError(error), variant: "destructive" });
        return;
      }

      toast({ title: form ? "Form updated" : "Form created" });
      onSaved();
      onClose();
    } catch (err) {
      toast({
        title: "Could not save form",
        description: err instanceof Error ? err.message : "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  /** Leave the builder, asking first if there are unsaved changes. */
  const handleCancel = () => {
    if (isDirty && !window.confirm("Discard your unsaved changes?")) return;
    onClose();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* ===== Name and published toggle ===== */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="form-name">Form name</Label>
          <Input
            id="form-name"
            placeholder="e.g. Volunteer Sign-Up"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={150}
            aria-invalid={showErrors && Boolean(titleError)}
            data-testid="input-form-name"
          />
          {showErrors && titleError && <p className="text-xs text-destructive">{titleError}</p>}
        </div>
        <div className="space-y-1 sm:pt-7">
          <div className="flex items-center gap-3 sm:justify-end">
            <Label htmlFor="form-published">Published</Label>
            <Switch
              id="form-published"
              checked={isPublished}
              onCheckedChange={setIsPublished}
              data-testid="switch-published"
            />
          </div>
          {showErrors && publishError && <p className="text-xs text-destructive sm:text-right">{publishError}</p>}
        </div>
      </div>

      {/* ===== Description ===== */}
      <div className="space-y-2">
        <Label htmlFor="form-description">Description</Label>
        <Textarea
          id="form-description"
          placeholder="What is this form for?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          data-testid="input-form-description"
        />
      </div>

      {/* ===== Follow-up form connection ===== */}
      <div className="space-y-2 p-4 border rounded-md bg-muted/30">
        <div className="flex items-center gap-2 mb-1">
          <ArrowRight className="h-4 w-4 text-primary" aria-hidden="true" />
          <Label htmlFor="form-follow-up">Connect to follow-up form</Label>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          After submitting this form, respondents will be directed to another form automatically.
        </p>
        <Select
          value={followUpFormId || NO_FOLLOW_UP}
          onValueChange={(v) => setFollowUpFormId(v === NO_FOLLOW_UP ? "" : v)}
        >
          <SelectTrigger id="form-follow-up">
            <SelectValue placeholder="No follow-up form" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FOLLOW_UP}>No follow-up form</SelectItem>
            {linkableForms.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.title}
                {!f.is_published && " (draft)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {linkableForms.length === 0 && (
          <p className="text-xs text-muted-foreground">Publish other forms first to connect them here.</p>
        )}
      </div>

      {/* ===== Fields ===== */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Form fields</h2>
          <Button variant="outline" size="sm" onClick={addField} data-testid="button-add-field">
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Add field
          </Button>
        </div>

        {fields.length === 0 ? (
          // Empty state for a form with no fields yet.
          <div className="text-center py-10 border border-dashed rounded-md">
            <p className="text-sm text-muted-foreground mb-3">No fields added yet</p>
            <Button variant="outline" size="sm" onClick={addField} data-testid="button-add-first-field">
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Add first field
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => {
              const error = showErrors ? fieldErrors[index] : null;
              const fieldName = field.label.trim() || `field ${index + 1}`;

              return (
                <Card key={field.id} className={`p-4 ${error ? "border-destructive" : ""}`}>
                  <div className="flex items-start gap-3">
                    {/* Reorder controls. Disabled at the ends of the list. */}
                    <div className="flex flex-col shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => moveField(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move ${fieldName} up`}
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => moveField(index, 1)}
                        disabled={index === fields.length - 1}
                        aria-label={`Move ${fieldName} down`}
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>

                    <div className="flex-1 grid gap-3 sm:grid-cols-3">
                      {/* Field label */}
                      <Input
                        placeholder="Field label"
                        value={field.label}
                        onChange={(e) => updateField(index, { label: e.target.value })}
                        maxLength={200}
                        aria-label={`Label for field ${index + 1}`}
                        aria-invalid={Boolean(error)}
                        data-testid={`input-field-label-${index}`}
                      />

                      {/* Field type, shown with its icon */}
                      <Select
                        value={field.type}
                        onValueChange={(v) => changeFieldType(index, v as FormField["type"])}
                      >
                        <SelectTrigger
                          aria-label={`Type for ${fieldName}`}
                          data-testid={`select-field-type-${index}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((t) => {
                            const Icon = t.icon;
                            return (
                              <SelectItem key={t.value} value={t.value}>
                                <span className="flex items-center gap-2">
                                  <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                                  {t.label}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>

                      {/* Required toggle (hidden for media fields) and remove button */}
                      <div className="flex items-center gap-3">
                        {!MEDIA_TYPES.has(field.type) && (
                          <div className="flex items-center gap-1.5">
                            <Switch
                              id={`field-required-${field.id}`}
                              checked={field.required}
                              onCheckedChange={(v) => updateField(index, { required: v })}
                              data-testid={`switch-required-${index}`}
                            />
                            <Label htmlFor={`field-required-${field.id}`} className="text-xs">
                              Required
                            </Label>
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeField(index)}
                          aria-label={`Remove ${fieldName}`}
                          data-testid={`button-remove-field-${index}`}
                          className="ml-auto"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Placeholder text, for field types that display one */}
                  {PLACEHOLDER_TYPES.has(field.type) && (
                    <div className="mt-3 ml-9">
                      <Label htmlFor={`field-placeholder-${field.id}`} className="text-xs text-muted-foreground">
                        Placeholder text (optional)
                      </Label>
                      <Input
                        id={`field-placeholder-${field.id}`}
                        placeholder="Hint shown inside the empty field"
                        value={field.placeholder ?? ""}
                        onChange={(e) => updateField(index, { placeholder: e.target.value })}
                        maxLength={200}
                        className="mt-1"
                      />
                    </div>
                  )}

                  {/* Dropdown options. Keyed by field id so switching type resets its text. */}
                  {field.type === "select" && (
                    <div className="mt-3 ml-9">
                      <Label htmlFor={`field-options-${field.id}`} className="text-xs text-muted-foreground">
                        Options (comma-separated)
                      </Label>
                      <OptionsInput
                        key={field.id}
                        id={`field-options-${field.id}`}
                        options={field.options ?? []}
                        onChange={(options) => updateField(index, { options })}
                        testId={`input-field-options-${index}`}
                      />
                    </div>
                  )}

                  {/* Explanatory notes for media fields */}
                  {field.type === "image" && (
                    <div className="mt-3 ml-9 flex items-center gap-2 text-xs text-muted-foreground">
                      <ImageIcon className="h-4 w-4" aria-hidden="true" />
                      Respondents will be able to upload a photo (JPG, PNG, GIF)
                    </div>
                  )}
                  {field.type === "audio" && (
                    <div className="mt-3 ml-9 flex items-center gap-2 text-xs text-muted-foreground">
                      <Mic className="h-4 w-4" aria-hidden="true" />
                      Respondents will be able to record or upload a voice memo
                    </div>
                  )}

                  {error && <p className="mt-2 ml-9 text-xs text-destructive">{error}</p>}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== Actions ===== */}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        {showErrors && hasErrors && (
          <p role="alert" className="mr-auto text-sm text-destructive">
            Fix the highlighted items before saving.
          </p>
        )}
        <Button variant="outline" onClick={handleCancel} disabled={isSaving} data-testid="button-cancel-form">
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-form">
          {isSaving ? "Saving..." : form ? "Save changes" : "Create form"}
        </Button>
      </div>
    </div>
  );
}

// ===========================================================================
// FormsPage
// ===========================================================================

export default function FormsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  /** False for viewers and read-only organizations; hides every create/edit/delete control. */
  const { canEdit } = useOrganization();

  // ----- Data state -----
  const [forms, setForms] = useState<Form[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ----- View state -----
  /** Form open in the builder for editing; null when creating or on the list view. */
  const [editingForm, setEditingForm] = useState<Form | null>(null);
  /** True when the builder is open to create a new form. */
  const [showBuilder, setShowBuilder] = useState(false);
  const [previewForm, setPreviewForm] = useState<Form | null>(null);

  // ----- Archive confirmation state -----
  const [pendingArchive, setPendingArchive] = useState<Form | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  /** Id of the form currently being duplicated, to disable its button meanwhile. */
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  /**
   * Load the user's non-archived forms, newest first.
   *
   * Fixes over the original:
   * - Errors were ignored; they now show a toast.
   * - With no user, the loading skeleton never went away.
   * - useCallback so it can be an effect dependency.
   */
  const loadForms = useCallback(async () => {
    if (!user) {
      setForms([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const { data, error } = await supabase
      .from("forms")
      .select("*")
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Could not load forms", description: error.message, variant: "destructive" });
    } else {
      setForms(data ?? []);
    }
    setIsLoading(false);
  }, [user, toast]);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  /** Lookup table from id to form, so each card can find its follow-up form quickly. */
  const formsById = useMemo(() => new Map(forms.map((f) => [f.id, f])), [forms]);

  // -------------------------------------------------------------------------
  // Card actions
  // -------------------------------------------------------------------------

  /**
   * Copy the public submit link to the clipboard.
   *
   * The original did not await the clipboard call, so failures (blocked
   * permission, non-https page) went unnoticed and the toast still said
   * "copied". Failures now show the link so it can be copied by hand.
   */
  const handleShare = async (form: Form) => {
    const url = getShareUrl(form.id);
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied",
        description: form.is_published
          ? "Share this link with anyone."
          : "This form is a draft. Publish it so people can open the link.",
      });
    } catch {
      toast({ title: "Couldn't copy automatically", description: `Copy this link: ${url}` });
    }
  };

  /**
   * Make an unpublished copy of a form.
   *
   * Fixes over the original:
   * - Copies settings too (the follow-up link was being lost).
   * - Gives each copied field a fresh id, so responses to the copy can never
   *   be confused with responses to the original.
   */
  const handleDuplicate = async (form: Form) => {
    if (!user || duplicatingId) return;

    setDuplicatingId(form.id);
    try {
      const { error } = await supabase.from("forms").insert({
        title: `${form.title} (Copy)`,
        description: form.description,
        fields: getFields(form).map((f) => ({ ...f, id: generateId() })),
        settings: getSettings(form),
        is_published: false,
        user_id: user.id,
      });

      if (error) {
        toast({ title: "Could not duplicate form", description: friendlyWriteError(error), variant: "destructive" });
        return;
      }
      toast({ title: "Form duplicated" });
      await loadForms();
    } finally {
      setDuplicatingId(null);
    }
  };

  /**
   * Archive the form held in pendingArchive.
   *
   * Changes from the original:
   * - Asks for confirmation first (it used to delete on a single click).
   * - Archives instead of hard-deleting. The list already filters on
   *   is_archived, and a hard delete could also remove or orphan the form's
   *   responses. Archived rows can be restored in the database if needed.
   * - Clears the follow-up link on any form that pointed at the archived one,
   *   so respondents are not sent to a form that is no longer available.
   */
  const confirmArchive = async () => {
    if (!user || !pendingArchive) return;

    setIsArchiving(true);
    try {
      const { error } = await supabase
        .from("forms")
        .update({ is_archived: true, is_published: false })
        .eq("id", pendingArchive.id);

      if (error) {
        toast({ title: "Could not delete form", description: friendlyWriteError(error), variant: "destructive" });
        return;
      }

      // Unlink forms that used the archived form as their follow-up.
      // The archive already succeeded, so a failure here is reported but not fatal.
      const linkedForms = forms.filter((f) => getSettings(f).followUpFormId === pendingArchive.id);
      const unlinkResults = await Promise.all(
        linkedForms.map((f) =>
          supabase
            .from("forms")
            .update({ settings: { ...getSettings(f), followUpFormId: null } })
            .eq("id", f.id),
        ),
      );
      const unlinkError = unlinkResults.find((r) => r.error)?.error;
      if (unlinkError) {
        toast({
          title: "Could not unlink follow-up forms",
          description: friendlyWriteError(unlinkError),
          variant: "destructive",
        });
      }

      toast({ title: "Form deleted" });
      setPendingArchive(null);
      await loadForms();
    } catch (err) {
      toast({
        title: "Could not delete form",
        description: err instanceof Error ? err.message : "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsArchiving(false);
    }
  };

  /** Close the builder and return to the list. */
  const closeBuilder = () => {
    setShowBuilder(false);
    setEditingForm(null);
  };

  // -------------------------------------------------------------------------
  // Render: builder view
  // -------------------------------------------------------------------------

  // The builder is only reachable when the user can edit.
  if (canEdit && (showBuilder || editingForm)) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-serif font-bold mb-6" data-testid="text-form-builder-title">
          {editingForm ? "Edit form" : "Create new form"}
        </h1>
        {/* key forces a fresh builder (clean state) when switching between forms. */}
        <FormBuilder
          key={editingForm?.id ?? "new"}
          form={editingForm ?? undefined}
          userId={user?.id ?? ""}
          allForms={forms}
          onClose={closeBuilder}
          onSaved={loadForms}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: list view
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ===== Header ===== */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold" data-testid="text-forms-title">
            Forms
          </h1>
          <p className="text-muted-foreground">Create volunteer sign-ups, donation forms, surveys, and more</p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowBuilder(true)} data-testid="button-create-form">
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> New form
          </Button>
        )}
      </div>

      <ReadOnlyNotice />

      {/* ===== Form cards (or loading / empty states) ===== */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-24 w-full" />
            </Card>
          ))}
        </div>
      ) : forms.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forms.map((form) => {
            const followUpId = getSettings(form).followUpFormId;
            const followUp = followUpId ? formsById.get(followUpId) : undefined;
            const fields = getFields(form);
            const hasMedia = fields.some((f) => MEDIA_TYPES.has(f.type));
            const responseCount = form.response_count ?? 0;

            return (
              <Card
                key={form.id}
                className="p-5 space-y-4 hover-elevate flex flex-col"
                data-testid={`card-form-${form.id}`}
              >
                {/* Title, description and status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate" title={form.title} data-testid={`text-form-name-${form.id}`}>
                      {form.title}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                      {form.description || "No description"}
                    </p>
                  </div>
                  <Badge variant={form.is_published ? "default" : "secondary"} className="shrink-0">
                    {form.is_published ? "Published" : "Draft"}
                  </Badge>
                </div>

                {/* Counts and feature badges. Singular/plural handled for 1. */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {fields.length} {fields.length === 1 ? "field" : "fields"}, {responseCount}{" "}
                    {responseCount === 1 ? "response" : "responses"}
                  </span>
                  {hasMedia && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <ImageIcon className="h-3 w-3" aria-hidden="true" /> Media
                    </Badge>
                  )}
                  {followUp && (
                    <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30">
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">Follow-up form:</span> {followUp.title}
                    </Badge>
                  )}
                </div>

                {/* Actions. mt-auto pins this row to the bottom so cards line up. */}
                <div className="flex items-center gap-1.5 pt-1 border-t flex-wrap mt-auto">
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingForm(form)}
                      data-testid={`button-edit-form-${form.id}`}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Edit
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreviewForm(form)}
                    data-testid={`button-preview-form-${form.id}`}
                  >
                    <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Preview
                  </Button>
                  {/* asChild puts the button styles on the link itself. The original
                      nested a <button> inside an <a>, which is invalid HTML. */}
                  <Button asChild variant="ghost" size="sm" data-testid={`button-fill-form-${form.id}`}>
                    <Link href={`/forms/${form.id}/submit`}>
                      <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Fill
                    </Link>
                  </Button>

                  {/* Icon-only buttons need aria-label for screen readers and
                      title for a hover tooltip, since there is no visible text. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleShare(form)}
                    aria-label={`Copy share link for ${form.title}`}
                    title="Copy share link"
                  >
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  {canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDuplicate(form)}
                        disabled={duplicatingId === form.id}
                        aria-label={`Duplicate ${form.title}`}
                        title="Duplicate"
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingArchive(form)}
                        aria-label={`Delete ${form.title}`}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        // Empty state: the user has no forms yet.
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <FileText className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No forms yet</h3>
            {canEdit && (
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Create your first form to collect volunteer information, event registrations, or community feedback.
              </p>
            )}
          </div>
          {canEdit && (
            <Button onClick={() => setShowBuilder(true)} data-testid="button-create-first-form">
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Create first form
            </Button>
          )}
        </div>
      )}

      {/* ===== Preview dialog =====
          Read-only rendering of the form as respondents will see it.
          onOpenChange only clears state on close; the original cleared it on any change. */}
      <Dialog open={previewForm !== null} onOpenChange={(open) => !open && setPreviewForm(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewForm?.title}</DialogTitle>
            {previewForm?.description && <DialogDescription>{previewForm.description}</DialogDescription>}
          </DialogHeader>

          {previewForm && (
            <div className="space-y-4 py-2">
              {getFields(previewForm).length === 0 && (
                <p className="text-sm text-muted-foreground">This form has no fields yet.</p>
              )}

              {getFields(previewForm).map((field) => (
                <div key={field.id} className="space-y-1.5">
                  {/* Checkbox fields show their label beside the box instead of above it. */}
                  {field.type !== "checkbox" && (
                    <Label>
                      {field.label}
                      {field.required && (
                        <span className="text-destructive ml-0.5" aria-label="required">
                          *
                        </span>
                      )}
                    </Label>
                  )}

                  {field.type === "text" && <Input placeholder={field.placeholder || field.label} disabled />}
                  {field.type === "number" && <Input type="number" placeholder={field.placeholder || "0"} disabled />}
                  {field.type === "date" && <Input type="date" disabled />}
                  {field.type === "email" && (
                    <Input type="email" placeholder={field.placeholder || "email@example.com"} disabled />
                  )}
                  {field.type === "textarea" && <Textarea placeholder={field.placeholder || field.label} disabled />}
                  {field.type === "checkbox" && (
                    <div className="flex items-center gap-2">
                      <input type="checkbox" disabled className="h-4 w-4" />
                      <span className="text-sm">
                        {field.label}
                        {field.required && <span className="text-destructive ml-0.5">*</span>}
                      </span>
                    </div>
                  )}
                  {field.type === "select" && (
                    <Select disabled>
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {field.type === "image" && (
                    <div className="flex items-center gap-2 p-3 border border-dashed rounded-md text-sm text-muted-foreground">
                      <ImageIcon className="h-4 w-4" aria-hidden="true" /> Photo upload field
                    </div>
                  )}
                  {field.type === "audio" && (
                    <div className="flex items-center gap-2 p-3 border border-dashed rounded-md text-sm text-muted-foreground">
                      <Mic className="h-4 w-4" aria-hidden="true" /> Voice memo field
                    </div>
                  )}
                </div>
              ))}

              {/* Names the follow-up form when it can be found, instead of "another form". */}
              {getSettings(previewForm).followUpFormId && (
                <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-md text-sm text-primary">
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  After submitting, respondents will be taken to{" "}
                  {formsById.get(getSettings(previewForm).followUpFormId!)?.title ?? "another form"}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewForm(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Delete (archive) confirmation dialog ===== */}
      <Dialog
        open={canEdit && pendingArchive !== null}
        onOpenChange={(open) => {
          if (!open && !isArchiving) setPendingArchive(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this form?</DialogTitle>
            <DialogDescription>
              "{pendingArchive?.title}" will be removed from your forms and its share link will stop working. Its{" "}
              {pendingArchive?.response_count ?? 0} existing responses are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingArchive(null)} disabled={isArchiving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmArchive} disabled={isArchiving}>
              {isArchiving ? "Deleting..." : "Delete form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}