import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { Plus, FileText, Trash2, Copy, GripVertical, Pencil, Eye, Send, Link2, Image, Mic, ArrowRight } from "lucide-react";
import type { Form, FormField } from "@/types/database";

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

const FIELD_TYPES = [
  { value: "text", label: "📝 Text" },
  { value: "textarea", label: "📄 Long Text" },
  { value: "number", label: "🔢 Number" },
  { value: "email", label: "📧 Email" },
  { value: "date", label: "📅 Date" },
  { value: "select", label: "🔽 Dropdown" },
  { value: "checkbox", label: "☑️ Checkbox" },
  { value: "image", label: "🖼️ Photo Upload" },
  { value: "audio", label: "🎤 Voice Memo" },
];

function FormBuilder({ form, userId, allForms, onClose, onSaved }: {
  form?: Form;
  userId: string;
  allForms: Form[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(form?.title ?? "");
  const [description, setDescription] = useState(form?.description ?? "");
  const [fields, setFields] = useState<FormField[]>((form?.fields as FormField[]) ?? []);
  const [isPublished, setIsPublished] = useState(form?.is_published ?? false);
  const [followUpFormId, setFollowUpFormId] = useState<string>((form?.settings as any)?.followUpFormId ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const addField = () => {
    setFields([...fields, { id: generateId(), label: "", type: "text", required: false, options: [], placeholder: "" }]);
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const updated = [...fields];
    updated[index] = { ...updated[index], ...updates };
    setFields(updated);
  };

  const removeField = (index: number) => setFields(fields.filter((_, i) => i !== index));

  const handleSave = async () => {
    if (!title.trim()) return;
    setIsSaving(true);
    const settings = { ...(form?.settings ?? {}), followUpFormId: followUpFormId || null };
    const payload = { title, description: description || null, fields, is_published: isPublished, settings, user_id: userId };

    if (form) {
      const { error } = await supabase.from("forms").update(payload).eq("id", form.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Form updated" }); onSaved(); onClose(); }
    } else {
      const { error } = await supabase.from("forms").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Form created" }); onSaved(); onClose(); }
    }
    setIsSaving(false);
  };

  // Other forms this one can link to (not itself)
  const linkableForms = allForms.filter((f) => f.id !== form?.id && f.is_published);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Form Name</Label>
          <Input placeholder="e.g. Volunteer Sign-Up" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-form-name" />
        </div>
        <div className="flex items-center gap-3 sm:justify-end sm:pt-7">
          <Label>Published</Label>
          <Switch checked={isPublished} onCheckedChange={setIsPublished} data-testid="switch-published" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea placeholder="What is this form for?" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-form-description" />
      </div>

      {/* Follow-up form connection */}
      <div className="space-y-2 p-4 border rounded-md bg-muted/30">
        <div className="flex items-center gap-2 mb-1">
          <ArrowRight className="h-4 w-4 text-primary" />
          <Label>Connect to Follow-Up Form</Label>
        </div>
        <p className="text-xs text-muted-foreground mb-2">After submitting this form, respondents will be directed to another form automatically.</p>
        <Select value={followUpFormId} onValueChange={setFollowUpFormId}>
          <SelectTrigger>
            <SelectValue placeholder="No follow-up form" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No follow-up form</SelectItem>
            {linkableForms.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {linkableForms.length === 0 && (
          <p className="text-xs text-muted-foreground">Publish other forms first to connect them here.</p>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Label>Form Fields</Label>
          <Button variant="outline" size="sm" onClick={addField} data-testid="button-add-field">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Field
          </Button>
        </div>

        {fields.length === 0 ? (
          <div className="text-center py-10 border border-dashed rounded-md">
            <p className="text-sm text-muted-foreground mb-3">No fields added yet</p>
            <Button variant="outline" size="sm" onClick={addField} data-testid="button-add-first-field">
              <Plus className="mr-1 h-3.5 w-3.5" /> Add First Field
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => (
              <Card key={field.id} className="p-4">
                <div className="flex items-start gap-3">
                  <GripVertical className="h-5 w-5 text-muted-foreground mt-1 shrink-0 cursor-grab" />
                  <div className="flex-1 grid gap-3 sm:grid-cols-3">
                    <Input
                      placeholder="Field label"
                      value={field.label}
                      onChange={(e) => updateField(index, { label: e.target.value })}
                      data-testid={`input-field-label-${index}`}
                    />
                    <Select value={field.type} onValueChange={(v) => updateField(index, { type: v as FormField["type"] })}>
                      <SelectTrigger data-testid={`select-field-type-${index}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-3">
                      {field.type !== "image" && field.type !== "audio" && (
                        <div className="flex items-center gap-1.5">
                          <Switch checked={field.required} onCheckedChange={(v) => updateField(index, { required: v })} data-testid={`switch-required-${index}`} />
                          <Label className="text-xs">Required</Label>
                        </div>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => removeField(index)} data-testid={`button-remove-field-${index}`} className="ml-auto">
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </div>

                {field.type === "select" && (
                  <div className="mt-3 ml-8">
                    <Label className="text-xs text-muted-foreground">Options (comma-separated)</Label>
                    <Input
                      placeholder="Option 1, Option 2, Option 3"
                      value={field.options?.join(", ") ?? ""}
                      onChange={(e) => updateField(index, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                      className="mt-1"
                      data-testid={`input-field-options-${index}`}
                    />
                  </div>
                )}

                {field.type === "image" && (
                  <div className="mt-3 ml-8 flex items-center gap-2 text-xs text-muted-foreground">
                    <Image className="h-4 w-4" />
                    Respondents will be able to upload a photo (JPG, PNG, GIF)
                  </div>
                )}

                {field.type === "audio" && (
                  <div className="mt-3 ml-8 flex items-center gap-2 text-xs text-muted-foreground">
                    <Mic className="h-4 w-4" />
                    Respondents will be able to record or upload a voice memo
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <Button variant="outline" onClick={onClose} data-testid="button-cancel-form">Cancel</Button>
        <Button onClick={handleSave} disabled={!title.trim() || isSaving} data-testid="button-save-form">
          {isSaving ? "Saving..." : form ? "Update Form" : "Create Form"}
        </Button>
      </div>
    </div>
  );
}

export default function FormsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [forms, setForms] = useState<Form[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingForm, setEditingForm] = useState<Form | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [previewForm, setPreviewForm] = useState<Form | null>(null);

  const loadForms = async () => {
    if (!user) return;
    setIsLoading(true);
    const { data } = await supabase.from("forms").select("*").eq("user_id", user.id).eq("is_archived", false).order("created_at", { ascending: false });
    setForms(data ?? []);
    setIsLoading(false);
  };

  useEffect(() => { loadForms(); }, [user]);

  const handleShare = (form: Form) => {
    const url = `${window.location.origin}/forms/${form.id}/submit`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied!", description: form.is_published ? "Share this link with anyone." : "Note: publish the form first so people can access it." });
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("forms").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Form deleted" }); loadForms(); }
  };

  const handleDuplicate = async (form: Form) => {
    if (!user) return;
    const { error } = await supabase.from("forms").insert({ title: `${form.title} (Copy)`, description: form.description, fields: form.fields, is_published: false, user_id: user.id });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Form duplicated" }); loadForms(); }
  };

  if (showBuilder || editingForm) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-serif font-bold mb-6" data-testid="text-form-builder-title">
          {editingForm ? "Edit Form" : "Create New Form"}
        </h1>
        <FormBuilder
          form={editingForm ?? undefined}
          userId={user?.id ?? ""}
          allForms={forms}
          onClose={() => { setShowBuilder(false); setEditingForm(null); }}
          onSaved={loadForms}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold" data-testid="text-forms-title">Forms</h1>
          <p className="text-muted-foreground">Create volunteer sign-ups, donation forms, surveys, and more</p>
        </div>
        <Button onClick={() => setShowBuilder(true)} data-testid="button-create-form">
          <Plus className="mr-1 h-4 w-4" /> New Form
        </Button>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Card key={i} className="p-5"><Skeleton className="h-24 w-full" /></Card>)}
        </div>
      ) : forms.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forms.map((form) => {
            const followUpId = (form.settings as any)?.followUpFormId;
            const followUp = followUpId ? forms.find(f => f.id === followUpId) : null;
            const fieldTypes = (form.fields as FormField[]) ?? [];
            const hasMedia = fieldTypes.some(f => f.type === "image" || f.type === "audio");

            return (
              <Card key={form.id} className="p-5 space-y-4 hover-elevate" data-testid={`card-form-${form.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate" data-testid={`text-form-name-${form.id}`}>{form.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{form.description ?? "No description"}</p>
                  </div>
                  <Badge variant={form.is_published ? "default" : "secondary"} className="shrink-0">
                    {form.is_published ? "Published" : "Draft"}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{fieldTypes.length} fields · {form.response_count ?? 0} responses</span>
                  {hasMedia && <Badge variant="outline" className="text-xs gap-1"><Image className="h-3 w-3" /> Media</Badge>}
                  {followUp && (
                    <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30">
                      <ArrowRight className="h-3 w-3" /> {followUp.title}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => setEditingForm(form)} data-testid={`button-edit-form-${form.id}`}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPreviewForm(form)} data-testid={`button-preview-form-${form.id}`}>
                    <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                  </Button>
                  <Link href={`/forms/${form.id}/submit`}>
                    <Button variant="ghost" size="sm" data-testid={`button-fill-form-${form.id}`}>
                      <Send className="mr-1 h-3.5 w-3.5" /> Fill
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => handleShare(form)} title="Copy share link">
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDuplicate(form)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(form.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <FileText className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No forms yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Create your first form to collect volunteer information, event registrations, or community feedback.</p>
          </div>
          <Button onClick={() => setShowBuilder(true)} data-testid="button-create-first-form">
            <Plus className="mr-1 h-4 w-4" /> Create First Form
          </Button>
        </div>
      )}

      {/* Preview dialog */}
      <Dialog open={!!previewForm} onOpenChange={() => setPreviewForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{previewForm?.title}</DialogTitle>
          </DialogHeader>
          {previewForm && (
            <div className="space-y-4 py-2">
              {previewForm.description && <p className="text-sm text-muted-foreground">{previewForm.description}</p>}
              {((previewForm.fields as FormField[]) ?? []).map((field) => (
                <div key={field.id} className="space-y-1.5">
                  <Label>{field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}</Label>
                  {field.type === "text" && <Input placeholder={field.placeholder ?? field.label} disabled />}
                  {field.type === "number" && <Input type="number" placeholder="0" disabled />}
                  {field.type === "date" && <Input type="date" disabled />}
                  {field.type === "email" && <Input type="email" placeholder="email@example.com" disabled />}
                  {field.type === "textarea" && <Textarea placeholder={field.placeholder ?? field.label} disabled />}
                  {field.type === "checkbox" && (
                    <div className="flex items-center gap-2">
                      <input type="checkbox" disabled className="h-4 w-4" />
                      <span className="text-sm text-muted-foreground">{field.label}</span>
                    </div>
                  )}
                  {field.type === "select" && (
                    <Select disabled>
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        {field.options?.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {field.type === "image" && (
                    <div className="flex items-center gap-2 p-3 border border-dashed rounded-md text-sm text-muted-foreground">
                      <Image className="h-4 w-4" /> Photo upload field
                    </div>
                  )}
                  {field.type === "audio" && (
                    <div className="flex items-center gap-2 p-3 border border-dashed rounded-md text-sm text-muted-foreground">
                      <Mic className="h-4 w-4" /> Voice memo field
                    </div>
                  )}
                </div>
              ))}
              {(previewForm.settings as any)?.followUpFormId && (
                <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-md text-sm text-primary">
                  <ArrowRight className="h-4 w-4" />
                  After submitting, respondents will be taken to another form
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewForm(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
