import { useState, useEffect, useRef } from "react";
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
import { CheckCircle2, FileText, Layers, Image, Mic, Square, Play, Pause } from "lucide-react";
import type { Form, FormField } from "@/types/database";

function ImageUploadField({ fieldId, value, onChange }: { fieldId: string; value: File | null; onChange: (f: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File | null) => {
    onChange(file);
    if (file) setPreview(URL.createObjectURL(file));
    else setPreview(null);
  };

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      {preview ? (
        <div className="relative">
          <img src={preview} alt="Preview" className="w-full max-h-48 object-cover rounded-md border" />
          <Button variant="destructive" size="sm" className="absolute top-2 right-2" onClick={() => handleFile(null)}>Remove</Button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} className="w-full p-8 border-2 border-dashed rounded-md flex flex-col items-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition-colors">
          <Image className="h-8 w-8" />
          <span className="text-sm">Click to upload a photo</span>
          <span className="text-xs">JPG, PNG, GIF up to 10MB</span>
        </button>
      )}
    </div>
  );
}

function AudioRecordField({ fieldId, value, onChange }: { fieldId: string; value: File | null; onChange: (f: File | null) => void }) {
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `voice-memo-${Date.now()}.webm`, { type: "audio/webm" });
        onChange(file);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch {
      toast({ title: "Microphone access denied", description: "Please allow microphone access to record a voice memo.", variant: "destructive" });
    }
  };

  const stopRecording = () => {
    mediaRef.current?.stop();
    setRecording(false);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  };

  return (
    <div className="space-y-3">
      <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0] ?? null;
        onChange(file);
        if (file) setAudioUrl(URL.createObjectURL(file));
      }} />

      {audioUrl ? (
        <div className="flex items-center gap-3 p-3 border rounded-md bg-muted/50">
          <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} />
          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={togglePlay}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <span className="text-sm text-muted-foreground flex-1">Voice memo recorded</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); setAudioUrl(null); }}>Remove</Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="button" variant={recording ? "destructive" : "outline"} onClick={recording ? stopRecording : startRecording} className="flex-1">
            {recording ? <><Square className="mr-2 h-4 w-4" /> Stop Recording</> : <><Mic className="mr-2 h-4 w-4" /> Record Voice Memo</>}
          </Button>
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>Upload Audio</Button>
        </div>
      )}
      {recording && <p className="text-xs text-destructive animate-pulse">● Recording in progress...</p>}
    </div>
  );
}

export default function SubmitFormPage() {
  const params = useParams<{ id: string }>();
  const formId = params.id;
  const { toast } = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [fileData, setFileData] = useState<Record<string, File | null>>({});
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
  const updateFile = (fieldId: string, file: File | null) => setFileData((prev) => ({ ...prev, [fieldId]: file }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = fields.filter((f) => f.required && f.type !== "image" && f.type !== "audio" && !formData[f.id] && formData[f.id] !== false && formData[f.id] !== 0);
    if (missing.length > 0) {
      toast({ title: "Required fields missing", description: `Please fill in: ${missing.map((f) => f.label).join(", ")}`, variant: "destructive" });
      return;
    }

    setIsSubmitting(true);

    // Upload any files first
    const uploadedUrls: Record<string, string> = {};
    for (const [fieldId, file] of Object.entries(fileData)) {
      if (!file) continue;
      const path = `public/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("media").upload(path, file);
      if (error) { toast({ title: "File upload failed", description: error.message, variant: "destructive" }); setIsSubmitting(false); return; }
      const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(path);
      uploadedUrls[fieldId] = publicUrl;
    }

    const finalData = { ...formData, ...uploadedUrls };
    const { error } = await supabase.from("form_submissions").insert({ form_id: formId, data: finalData });
    setIsSubmitting(false);

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else {
      setSubmitted(true);
      // Redirect to follow-up form if set
      const followUpFormId = (form?.settings as any)?.followUpFormId;
      if (followUpFormId) {
        setTimeout(() => { window.location.href = `/forms/${followUpFormId}/submit`; }, 2000);
      }
    }
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

  const followUpFormId = (form?.settings as any)?.followUpFormId;

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 text-center space-y-4">
          <div className="h-14 w-14 rounded-full bg-chart-3/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-7 w-7 text-chart-3" />
          </div>
          <h2 className="text-xl font-semibold">Thank You!</h2>
          <p className="text-sm text-muted-foreground">Your response has been recorded.</p>
          {followUpFormId ? (
            <p className="text-sm text-primary animate-pulse">Taking you to the next form...</p>
          ) : (
            <Button variant="outline" onClick={() => { setSubmitted(false); setFormData({}); setFileData({}); }} data-testid="button-submit-another">
              Submit Another Response
            </Button>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6 min-h-screen">
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
              {field.type !== "checkbox" && (
                <Label htmlFor={`field-${field.id}`}>
                  {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
              )}
              {(field.type === "text" || field.type === "email") && (
                <Input id={`field-${field.id}`} type={field.type === "email" ? "email" : "text"} placeholder={field.placeholder ?? field.label} value={formData[field.id] ?? ""} onChange={(e) => updateField(field.id, e.target.value)} />
              )}
              {field.type === "textarea" && (
                <Textarea id={`field-${field.id}`} placeholder={field.placeholder ?? field.label} value={formData[field.id] ?? ""} onChange={(e) => updateField(field.id, e.target.value)} />
              )}
              {field.type === "number" && (
                <Input id={`field-${field.id}`} type="number" placeholder="0" value={formData[field.id] ?? ""} onChange={(e) => updateField(field.id, e.target.value ? parseFloat(e.target.value) : "")} />
              )}
              {field.type === "date" && (
                <Input id={`field-${field.id}`} type="date" value={formData[field.id] ?? ""} onChange={(e) => updateField(field.id, e.target.value)} />
              )}
              {field.type === "checkbox" && (
                <div className="flex items-center gap-2">
                  <Checkbox id={`field-${field.id}`} checked={!!formData[field.id]} onCheckedChange={(checked) => updateField(field.id, !!checked)} />
                  <Label htmlFor={`field-${field.id}`} className="text-sm cursor-pointer">
                    {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                  </Label>
                </div>
              )}
              {(field.type === "select") && (
                <Select value={formData[field.id] ?? ""} onValueChange={(v) => updateField(field.id, v)}>
                  <SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger>
                  <SelectContent>
                    {field.options?.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {field.type === "image" && (
                <ImageUploadField fieldId={field.id} value={fileData[field.id] ?? null} onChange={(f) => updateFile(field.id, f)} />
              )}
              {field.type === "audio" && (
                <AudioRecordField fieldId={field.id} value={fileData[field.id] ?? null} onChange={(f) => updateFile(field.id, f)} />
              )}
              {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
            </div>
          ))}

          {followUpFormId && (
            <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-md text-xs text-primary">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              After submitting you'll be taken to a follow-up form
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-submit-form">
            {isSubmitting ? "Submitting..." : "Submit"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
