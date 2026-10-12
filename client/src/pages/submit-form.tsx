/**
 * SubmitFormPage
 *
 * Public page where anyone with the link fills out a published form.
 * Route: /forms/:id/submit. No sign-in required.
 *
 * Flow:
 *   1. Load the form (only if it is published).
 *   2. Respondent fills in fields, including optional photo and voice memo uploads.
 *   3. On submit: validate, upload files to Supabase Storage, then save the
 *      answers to form_submissions. If saving fails, uploaded files are removed.
 *   4. Show a thank-you screen. If the form has a follow-up form, count down
 *      and continue to it (with a button to go immediately).
 *
 * Backend assumptions:
 *   - forms: anonymous users can SELECT rows where is_published = true.
 *   - form_submissions: anonymous users can INSERT (but not read).
 *   - Storage bucket "media": anonymous users can upload under "public/".
 *     Files are stored at public/<formId>/<random id>.<ext>, which still sits
 *     under the "public/" folder that existing storage policies expect.
 */

import { useState, useEffect, useRef, useCallback } from "react";
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
import {
  CheckCircle2,
  FileText,
  Layers,
  // Renamed so it does not shadow the browser's built-in Image constructor.
  Image as ImageIcon,
  Mic,
  Square,
  Play,
  Pause,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import type { Form, FormField } from "@/types/database";

// ===========================================================================
// Constants
// ===========================================================================

/** Shown in the small header above the form. Keep in sync with the landing page. */
const APP_NAME = "HumMotion";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB, matches the hint shown to respondents
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB
/** Recordings stop automatically after this long, to keep uploads a reasonable size. */
const MAX_RECORDING_SECONDS = 5 * 60;
/** Seconds before moving on to a follow-up form. */
const FOLLOW_UP_DELAY_SECONDS = 3;

const STORAGE_BUCKET = "media";

/** Simple email format check: something@something.something, no spaces. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Answers keyed by field id. */
type Answers = Record<string, string | number | boolean | undefined>;

// ===========================================================================
// Helpers
// ===========================================================================

/** Random id for file names. Falls back where crypto.randomUUID is unavailable (http pages). */
const randomId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Pick a safe file extension from the file's type or name.
 * The original used the respondent's original file name in the storage path.
 * Names with spaces, accents or symbols ("Photo (1).HEIC") could fail to
 * upload or produce broken links, and two files uploaded in the same
 * millisecond could overwrite each other.
 */
const safeExtension = (file: File): string => {
  const fromType = file.type.split("/")[1]?.split(";")[0];
  const fromName = file.name.includes(".") ? file.name.split(".").pop() : undefined;
  const ext = (fromType || fromName || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext.slice(0, 8) || "bin";
};

/** "2.4 MB" style size for messages. */
const formatBytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** "1:05" style duration. */
const formatDuration = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * Pick an audio format this browser can record. Safari records MP4/AAC, not
 * WebM. The original always labeled recordings "audio/webm", so Safari
 * recordings were saved with the wrong type and often would not play back.
 */
const pickRecordingMimeType = (): string | undefined => {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
};

/** Read the follow-up form id from a form's settings without `as any`. */
const getFollowUpId = (form: Form | null): string | null =>
  ((form?.settings as { followUpFormId?: string | null } | null)?.followUpFormId ?? null) || null;

// ===========================================================================
// ImageUploadField
// ===========================================================================

/**
 * Photo picker with a preview.
 *
 * Fixes over the original:
 * - The Remove button had no type, so inside the <form> it defaulted to
 *   type="submit": clicking Remove submitted the whole form.
 * - The "up to 10MB" limit and image-only rule were shown but not enforced.
 * - Preview URLs were never released, leaking memory with each new photo.
 * - Picking the same file again after removing it did nothing, because the
 *   input still held the old value.
 */
function ImageUploadField({
  fieldId,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  fieldId: string;
  value: File | null;
  onChange: (f: File | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Create a preview URL for the current file, and release it when it changes or unmounts.
  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const handleFile = (file: File | null) => {
    setError("");
    if (inputRef.current) inputRef.current.value = ""; // allow re-selecting the same file
    if (!file) {
      onChange(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("That file isn't an image. Please choose a JPG, PNG or GIF.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`That photo is ${formatBytes(file.size)}. Please choose one under ${formatBytes(MAX_IMAGE_BYTES)}.`);
      return;
    }
    onChange(file);
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      {preview ? (
        <div className="relative">
          <img src={preview} alt="Selected photo preview" className="w-full max-h-48 object-cover rounded-md border" />
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="absolute top-2 right-2"
            onClick={() => handleFile(null)}
          >
            Remove photo
          </Button>
        </div>
      ) : (
        <button
          id={`field-${fieldId}`}
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={`w-full p-8 border-2 border-dashed rounded-md flex flex-col items-center gap-2 text-muted-foreground hover:border-primary hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            invalid ? "border-destructive" : ""
          }`}
        >
          <ImageIcon className="h-8 w-8" aria-hidden="true" />
          <span className="text-sm">Choose a photo</span>
          <span className="text-xs">JPG, PNG or GIF, up to 10 MB</span>
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ===========================================================================
// AudioRecordField
// ===========================================================================

/**
 * Record a voice memo in the browser, or upload an audio file.
 *
 * Fixes over the original:
 * - Records in a format the browser actually supports (see pickRecordingMimeType).
 * - The microphone is released if the respondent leaves the page mid-recording.
 *   Previously the browser's "recording" indicator could stay on.
 * - Shows elapsed time, and stops automatically at MAX_RECORDING_SECONDS.
 * - Uploaded files are checked for type and size.
 * - Playback errors (e.g. unsupported format) are caught instead of
 *   leaving the button stuck on "Pause".
 * - Audio URLs are released when replaced or removed.
 */
function AudioRecordField({
  fieldId,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  fieldId: string;
  value: File | null;
  onChange: (f: File | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Playback URL for the current file; released when it changes or unmounts.
  useEffect(() => {
    if (!value) {
      setAudioUrl(null);
      setPlaying(false);
      return;
    }
    const url = URL.createObjectURL(value);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  /** Turn off the microphone. */
  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Release the microphone if the component unmounts while recording.
  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      releaseMic();
    };
  }, []);

  /** Stop recording; the onstop handler turns the chunks into a file. */
  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  }, []);

  // Tick the timer while recording, and stop automatically at the limit.
  useEffect(() => {
    if (!recording) return;
    if (elapsed >= MAX_RECORDING_SECONDS) {
      stopRecording();
      toast({ title: "Recording stopped", description: `Voice memos can be up to ${MAX_RECORDING_SECONDS / 60} minutes.` });
      return;
    }
    const timer = setTimeout(() => setElapsed((s) => s + 1), 1000);
    return () => clearTimeout(timer);
  }, [recording, elapsed, stopRecording, toast]);

  const startRecording = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Recording isn't supported in this browser. You can upload an audio file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        releaseMic();
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size === 0) {
          setError("Nothing was recorded. Please try again.");
          return;
        }
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        onChange(new File([blob], `voice-memo.${ext}`, { type }));
      };

      recorder.start();
      recorderRef.current = recorder;
      setElapsed(0);
      setRecording(true);
    } catch {
      releaseMic();
      toast({
        title: "Microphone access denied",
        description: "Allow microphone access to record, or upload an audio file instead.",
        variant: "destructive",
      });
    }
  };

  /** Validate and accept an uploaded audio file. */
  const handleUpload = (file: File | null) => {
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setError("That file isn't audio. Please choose an MP3, M4A, WAV or similar.");
      return;
    }
    if (file.size > MAX_AUDIO_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. Please choose one under ${formatBytes(MAX_AUDIO_BYTES)}.`);
      return;
    }
    onChange(file);
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setError("This recording can't be played in this browser, but it will still be submitted.");
    }
  };

  const removeAudio = () => {
    audioRef.current?.pause();
    setPlaying(false);
    setError("");
    onChange(null);
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
      />

      {audioUrl ? (
        <div className="flex items-center gap-3 p-3 border rounded-md bg-muted/50">
          <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} preload="metadata" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={togglePlay}
            aria-label={playing ? "Pause voice memo" : "Play voice memo"}
          >
            {playing ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
          </Button>
          <span className="text-sm text-muted-foreground flex-1">Voice memo ready</span>
          <Button type="button" variant="ghost" size="sm" onClick={removeAudio}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            id={`field-${fieldId}`}
            type="button"
            variant={recording ? "destructive" : "outline"}
            onClick={recording ? stopRecording : startRecording}
            className={`flex-1 ${invalid ? "border-destructive" : ""}`}
            aria-invalid={invalid}
            aria-describedby={describedBy}
          >
            {recording ? (
              <>
                <Square className="mr-2 h-4 w-4" aria-hidden="true" /> Stop recording
              </>
            ) : (
              <>
                <Mic className="mr-2 h-4 w-4" aria-hidden="true" /> Record voice memo
              </>
            )}
          </Button>
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={recording}>
            Upload audio
          </Button>
        </div>
      )}

      {/* Recording indicator. The original used a "●" text symbol; this is a
          styled dot instead, hidden from screen readers, with the time read out. */}
      {recording && (
        <p className="flex items-center gap-2 text-xs text-destructive" role="status">
          <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" aria-hidden="true" />
          Recording {formatDuration(elapsed)} of {formatDuration(MAX_RECORDING_SECONDS)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ===========================================================================
// Page component
// ===========================================================================

export default function SubmitFormPage() {
  const params = useParams<{ id: string }>();
  const formId = params.id;
  const { toast } = useToast();

  // ----- Data -----
  const [form, setForm] = useState<Form | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // ----- Answers -----
  const [answers, setAnswers] = useState<Answers>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  /** Inline error per field id; shown after the first submit attempt. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /**
   * Honeypot: a hidden field real people never see or fill in. Simple spam
   * bots fill every field, so a value here means the submission is a bot.
   */
  const [honeypot, setHoneypot] = useState("");

  // ----- Submit state -----
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [followUpCountdown, setFollowUpCountdown] = useState(FOLLOW_UP_DELAY_SECONDS);

  const fields = (form?.fields as FormField[] | null) ?? [];
  const followUpFormId = getFollowUpId(form);

  // -------------------------------------------------------------------------
  // Load the form
  // -------------------------------------------------------------------------

  /**
   * Load the published form.
   * Fixes: ignores results that arrive after the id changed (e.g. when a
   * follow-up form loads), handles a missing id, and uses maybeSingle so
   * "no such form" is not treated as a server error.
   */
  useEffect(() => {
    if (!formId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setNotFound(false);
      try {
        const { data, error } = await supabase
          .from("forms")
          .select("*")
          .eq("id", formId)
          .eq("is_published", true)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) setNotFound(true);
        else setForm(data);
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [formId]);

  // Show the form's title in the browser tab.
  useEffect(() => {
    if (form?.title) document.title = form.title;
  }, [form?.title]);

  /**
   * Warn before leaving with a half-filled form (closing the tab, refreshing).
   * Long intake forms are frustrating to lose.
   */
  const hasProgress =
    !submitted &&
    (Object.values(answers).some((v) => v !== "" && v !== undefined && v !== false) ||
      Object.values(files).some(Boolean));

  useEffect(() => {
    if (!hasProgress) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasProgress]);

  // -------------------------------------------------------------------------
  // Follow-up redirect
  // -------------------------------------------------------------------------

  /**
   * After a successful submit, count down and go to the follow-up form.
   * The timer is cleared if the page unmounts. The original used a bare
   * setTimeout with no cleanup and no way to go sooner.
   */
  useEffect(() => {
    if (!submitted || !followUpFormId) return;
    if (followUpCountdown <= 0) {
      window.location.href = `/forms/${followUpFormId}/submit`;
      return;
    }
    const timer = setTimeout(() => setFollowUpCountdown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [submitted, followUpFormId, followUpCountdown]);

  // -------------------------------------------------------------------------
  // Answer updates
  // -------------------------------------------------------------------------

  /** Set an answer and clear that field's error. */
  const updateAnswer = (fieldId: string, value: Answers[string]) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    if (fieldErrors[fieldId]) setFieldErrors(({ [fieldId]: _removed, ...rest }) => rest);
  };

  const updateFile = (fieldId: string, file: File | null) => {
    setFiles((prev) => ({ ...prev, [fieldId]: file }));
    if (fieldErrors[fieldId]) setFieldErrors(({ [fieldId]: _removed, ...rest }) => rest);
  };

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Check every field and return a message per invalid field id.
   *
   * Fixes over the original:
   * - A required checkbox (like "I agree to the terms") passed while
   *   unchecked, because `false` was explicitly allowed through.
   * - Text containing only spaces counted as filled in.
   * - Email fields were not checked for a valid address.
   * - Required photo/voice fields were never checked.
   * - Errors now appear next to each field, not only in a toast.
   */
  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    for (const field of fields) {
      const value = answers[field.id];
      const isMedia = field.type === "image" || field.type === "audio";

      if (field.required) {
        if (isMedia && !files[field.id]) {
          errors[field.id] = field.type === "image" ? "Please add a photo." : "Please add a voice memo.";
          continue;
        }
        if (field.type === "checkbox" && value !== true) {
          errors[field.id] = "Please check this box to continue.";
          continue;
        }
        if (!isMedia && field.type !== "checkbox" && (value === undefined || String(value).trim() === "")) {
          errors[field.id] = "This field is required.";
          continue;
        }
      }

      if (field.type === "email" && typeof value === "string" && value.trim() && !EMAIL_PATTERN.test(value.trim())) {
        errors[field.id] = "Please enter a valid email address.";
      }
      if (field.type === "number" && value !== undefined && value !== "" && !Number.isFinite(Number(value))) {
        errors[field.id] = "Please enter a number.";
      }
    }
    return errors;
  };

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  /**
   * Validate, upload files, then save the submission.
   *
   * Fixes over the original:
   * - Guards against double submission.
   * - Uploads use safe, unique file names (see safeExtension / randomId).
   * - If any upload or the final save fails, files already uploaded for this
   *   attempt are deleted, so failed attempts do not leave orphaned files.
   * - try/finally so "Submitting..." always clears, even on network errors.
   * - Text answers are trimmed before saving.
   * - Focus moves to the first invalid field so keyboard and screen reader
   *   users land where the problem is.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !form) return;
    setSubmitError("");

    const errors = validate();
    setFieldErrors(errors);
    const firstInvalid = fields.find((f) => errors[f.id]);
    if (firstInvalid) {
      document.getElementById(`field-${firstInvalid.id}`)?.focus();
      toast({
        title: "Please check the form",
        description: `${Object.keys(errors).length} ${Object.keys(errors).length === 1 ? "field needs" : "fields need"} attention.`,
        variant: "destructive",
      });
      return;
    }

    // Bot filled in the hidden honeypot: pretend it worked, save nothing.
    if (honeypot) {
      setSubmitted(true);
      return;
    }

    setIsSubmitting(true);
    const uploadedPaths: string[] = [];

    try {
      // 1. Upload files.
      const fileUrls: Record<string, string> = {};
      for (const field of fields) {
        const file = files[field.id];
        if (!file) continue;
        const path = `public/${form.id}/${randomId()}.${safeExtension(file)}`;
        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (uploadError) throw new Error(`Couldn't upload "${field.label}": ${uploadError.message}`);
        uploadedPaths.push(path);
        fileUrls[field.id] = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      }

      // 2. Clean up answers: trim text, drop empty values, keep only current fields.
      const cleaned: Record<string, string | number | boolean> = {};
      for (const field of fields) {
        const value = answers[field.id];
        if (value === undefined || value === "") continue;
        cleaned[field.id] = typeof value === "string" ? value.trim() : value;
      }

      // 3. Save the submission.
      const { error: insertError } = await supabase
        .from("form_submissions")
        .insert({ form_id: form.id, data: { ...cleaned, ...fileUrls } });
      if (insertError) throw new Error(insertError.message);

      setSubmitted(true);
      setFollowUpCountdown(FOLLOW_UP_DELAY_SECONDS);
    } catch (err) {
      // Remove anything uploaded during this failed attempt.
      if (uploadedPaths.length) {
        supabase.storage.from(STORAGE_BUCKET).remove(uploadedPaths).catch(() => {});
      }
      setSubmitError(
        err instanceof Error && err.message
          ? `Your response wasn't sent. ${err.message}`
          : "Your response wasn't sent. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Clear everything for another response. */
  const resetForAnother = () => {
    setAnswers({});
    setFiles({});
    setFieldErrors({});
    setSubmitError("");
    setSubmitted(false);
    window.scrollTo({ top: 0 });
  };

  // -------------------------------------------------------------------------
  // Render: loading
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6" aria-busy="true">
        <Card className="w-full max-w-xl p-8 space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: not found / unpublished
  // -------------------------------------------------------------------------

  if (notFound || !form) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 text-center space-y-3">
          <FileText className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Form not found</h1>
          <p className="text-sm text-muted-foreground">
            This form may have been removed or is no longer accepting responses. Check the link with the person who
            shared it.
          </p>
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: thank you
  // -------------------------------------------------------------------------

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card role="status" className="w-full max-w-md p-8 text-center space-y-4">
          <div className="h-14 w-14 rounded-full bg-chart-3/10 flex items-center justify-center mx-auto" aria-hidden="true">
            <CheckCircle2 className="h-7 w-7 text-chart-3" />
          </div>
          <h1 className="text-xl font-semibold">Thank you</h1>
          <p className="text-sm text-muted-foreground">Your response has been recorded.</p>
          {followUpFormId ? (
            <div className="space-y-3">
              <p className="text-sm text-primary">
                Taking you to the next form in {followUpCountdown} {followUpCountdown === 1 ? "second" : "seconds"}...
              </p>
              <Button asChild>
                <a href={`/forms/${followUpFormId}/submit`}>
                  Continue now <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={resetForAnother} data-testid="button-submit-another">
              Submit another response
            </Button>
          )}
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: the form
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6 min-h-screen">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <Layers className="h-4 w-4" aria-hidden="true" />
        <span>{APP_NAME}</span>
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold" data-testid="text-submit-form-title">
          {form.title}
        </h1>
        {form.description && <p className="text-muted-foreground whitespace-pre-line">{form.description}</p>}
        {fields.some((f) => f.required) && (
          <p className="text-xs text-muted-foreground pt-1">
            Fields marked <span className="text-destructive">*</span> are required.
          </p>
        )}
      </div>

      <Card className="p-6">
        {/* noValidate: we show our own inline errors instead of browser popups. */}
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {submitError && (
            <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}

          {fields.length === 0 && <p className="text-sm text-muted-foreground">This form has no questions yet.</p>}

          {fields.map((field) => {
            const inputId = `field-${field.id}`;
            const error = fieldErrors[field.id];
            const errorId = error ? `${inputId}-error` : undefined;
            const helpId = field.helpText ? `${inputId}-help` : undefined;
            const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;
            const textValue = answers[field.id];
            const placeholder = field.placeholder || undefined;

            return (
              <div key={field.id} className="space-y-2">
                {/* Checkbox fields put their label beside the box instead of above. */}
                {field.type !== "checkbox" && (
                  <Label htmlFor={inputId}>
                    {field.label}
                    {field.required && (
                      <span className="text-destructive ml-0.5" aria-hidden="true">
                        *
                      </span>
                    )}
                  </Label>
                )}

                {(field.type === "text" || field.type === "email") && (
                  <Input
                    id={inputId}
                    type={field.type === "email" ? "email" : "text"}
                    inputMode={field.type === "email" ? "email" : undefined}
                    autoComplete={field.type === "email" ? "email" : undefined}
                    placeholder={placeholder}
                    value={typeof textValue === "string" ? textValue : ""}
                    onChange={(e) => updateAnswer(field.id, e.target.value)}
                    maxLength={500}
                    aria-required={field.required}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                  />
                )}

                {field.type === "textarea" && (
                  <Textarea
                    id={inputId}
                    placeholder={placeholder}
                    value={typeof textValue === "string" ? textValue : ""}
                    onChange={(e) => updateAnswer(field.id, e.target.value)}
                    maxLength={5000}
                    aria-required={field.required}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                  />
                )}

                {/* Number kept as typed text while editing, so "1." or "-" mid-typing
                    is not wiped out; converted to a number on save. */}
                {field.type === "number" && (
                  <Input
                    id={inputId}
                    type="number"
                    inputMode="decimal"
                    placeholder={placeholder ?? "0"}
                    value={textValue === undefined ? "" : String(textValue)}
                    onChange={(e) =>
                      updateAnswer(field.id, e.target.value === "" ? "" : Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : e.target.value)
                    }
                    aria-required={field.required}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                  />
                )}

                {field.type === "date" && (
                  <Input
                    id={inputId}
                    type="date"
                    value={typeof textValue === "string" ? textValue : ""}
                    onChange={(e) => updateAnswer(field.id, e.target.value)}
                    aria-required={field.required}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                  />
                )}

                {field.type === "checkbox" && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={inputId}
                      checked={answers[field.id] === true}
                      onCheckedChange={(checked) => updateAnswer(field.id, checked === true)}
                      aria-required={field.required}
                      aria-invalid={Boolean(error)}
                      aria-describedby={describedBy}
                    />
                    <Label htmlFor={inputId} className="text-sm cursor-pointer">
                      {field.label}
                      {field.required && (
                        <span className="text-destructive ml-0.5" aria-hidden="true">
                          *
                        </span>
                      )}
                    </Label>
                  </div>
                )}

                {field.type === "select" && (
                  <Select
                    value={typeof textValue === "string" ? textValue : ""}
                    onValueChange={(v) => updateAnswer(field.id, v)}
                  >
                    <SelectTrigger
                      id={inputId}
                      aria-required={field.required}
                      aria-invalid={Boolean(error)}
                      aria-describedby={describedBy}
                      className={error ? "border-destructive" : ""}
                    >
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {field.type === "image" && (
                  <ImageUploadField
                    fieldId={field.id}
                    value={files[field.id] ?? null}
                    onChange={(f) => updateFile(field.id, f)}
                    invalid={Boolean(error)}
                    describedBy={describedBy}
                  />
                )}

                {field.type === "audio" && (
                  <AudioRecordField
                    fieldId={field.id}
                    value={files[field.id] ?? null}
                    onChange={(f) => updateFile(field.id, f)}
                    invalid={Boolean(error)}
                    describedBy={describedBy}
                  />
                )}

                {field.helpText && (
                  <p id={helpId} className="text-xs text-muted-foreground">
                    {field.helpText}
                  </p>
                )}
                {error && (
                  <p id={errorId} className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
            );
          })}

          {/* Honeypot. Visually hidden and skipped by keyboard and screen readers,
              so only bots fill it in. Not display:none, which some bots detect. */}
          <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
            <label htmlFor="website-field">Leave this field empty</label>
            <input
              id="website-field"
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          {followUpFormId && (
            <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-md text-xs text-primary">
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              After submitting, you'll continue to a follow-up form.
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting || fields.length === 0} data-testid="button-submit-form">
            {isSubmitting ? "Submitting..." : "Submit"}
          </Button>
        </form>
      </Card>
    </div>
  );
}