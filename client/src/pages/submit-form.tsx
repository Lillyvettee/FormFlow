import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, FileText, Layers } from "lucide-react";
import type { Form, FormField } from "@/types/database";

export default function SubmitFormPage() {
  const params = useParams<{ id: string }>();
  const formId = params.id;
  const { toast } = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitted, setSubmitted] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.from("forms").select("*").eq("id", formId).eq("is_published", true).single();
      if (error || !data) { setNotFound(true); }
      else { setForm(data); }
      setIsLoading(false);
    };
    load();
  }, [formId]);

  const fields = (form?.fields as FormField[]) ?? [];
  const updateField = (fieldId: string, value: any) => setFormData((prev) => ({ ...prev, [fieldId]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = fields.filter((f) => f.required && !formData[f.id] && formData[f.id] !== false && formData[f.id] !== 0);
    if (missing.length > 0) {
      toast({ title: "Required fields missing", description: `Please fill in: ${missing.map((f) => f.label).join(", ")}`, variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    const { error } = await supabase.from("form_submissions").insert({ form_id: formId, data: formData });
    setIsSubmitting(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { setSubmitted(true); }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-xl p-8 space-y-4">
          <Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
        </Card>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 text-center space-y-3">
          <FileText className="h-10 w-10 text-muted-foreground mx-auto" />
          <h2 className="text-lg font-semibold">Form Not Found</h2>
          <p className="text-sm text-muted-foreground">This form may have been removed or is not published.</p>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 text-center space-y-4">
          <div className="h-14 w-14 rounded-full bg-chart-3/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-7 w-7 text-chart-3" />
          </div>
          <h2 className="text-xl font-semibold">Thank You!</h2>
          <p className="text-sm text-muted-foreground">Your response has been recorded.</p>
          <Button variant="outline" onClick={() => { setSubmitted(false); setFormData({}); }} data-testid="button-submit-another">
            Submit Another Response
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Layers className="h-4 w-4" /><span>FormFlow</span>
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold" data-testid="text-submit-form-title">{form?.title}</h1>
        {form?.description && <p className="text-muted-foreground">{form.description}</p>}
      </div>
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {fields.map((field) => (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={`field-${field.id}`}>
                {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
              </Label>
              {(field.type === "text" || field.type === "email") && (
                <Input id={`field-${field.id}`} type={field.type === "email" ? "email" : "text"} placeholder={field.placeholder ?? field.label} value={formData[field.id] ?? ""} onChange={(e) => updateField(field.id, e.target.value)} data-testid={`input-submit-${field.id}`} />
              )}
              {field.type === "textarea" && (
                <Textarea id={`field-${field.id}`} placeholder={field.placeholder ?? field.label} value={formData[field.id] ?? ""} onChange={(e) => updateField(field.id, e.target.value)} />
              )}
              {field.type === "number" && (
                <Input id={`field-${field.id}`} type="number" placeholder="0" value={formData[field.id] ?? ""} onChange={(e) => updateField(field.id, e.target.value ? parseFloat(e.target.value) : "")} data-testid={`input-submit-${field.id}`} />
              )}
              {field.type === "date" && (
                <Input id={`field-${field.id}`} type="date" value={formData[field.id] ?? ""} onChange={(e) => updateField(field.id, e.target.value)} data-testid={`input-submit-${field.id}`} />
              )}
              {field.type === "checkbox" && (
                <div className="flex items-center gap-2">
                  <Checkbox id={`field-${field.id}`} checked={!!formData[field.id]} onCheckedChange={(checked) => updateField(field.id, !!checked)} data-testid={`checkbox-submit-${field.id}`} />
                  <Label htmlFor={`field-${field.id}`} className="text-sm text-muted-foreground cursor-pointer">{field.label}</Label>
                </div>
              )}
              {(field.type === "select" || field.type === "dropdown") && (
                <Select value={formData[field.id] ?? ""} onValueChange={(v) => updateField(field.id, v)}>
                  <SelectTrigger data-testid={`select-submit-${field.id}`}><SelectValue placeholder="Select an option" /></SelectTrigger>
                  <SelectContent>
                    {field.options?.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
          <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-submit-form">
            {isSubmitting ? "Submitting..." : "Submit"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
