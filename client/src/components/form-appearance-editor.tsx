/**
 * FormAppearanceEditor
 *
 * The "Appearance" section of the form builder: background color, accent
 * color (buttons and highlights) and logo for one form. Empty values mean
 * "use the organization's branding" (Settings > Branding).
 *
 * Logos can be uploaded (stored in the "media" bucket under the uploader's
 * own folder, which the storage policies already allow) or linked by URL.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { useOrganization } from "@/hooks/use-organization";
import { HEX_PATTERN, prefersDarkText } from "@/lib/form-appearance";
import { Palette, Upload, X } from "lucide-react";

export interface AppearanceDraft {
  backgroundColor: string;
  primaryColor: string;
  logoUrl: string;
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
/** Shown in the color picker when no accent color is set anywhere. Matches the app's default --primary. */
const APP_DEFAULT_ACCENT = "#0848a9";

/** Errors to show, or null when everything can be saved. */
export function appearanceErrors(draft: AppearanceDraft) {
  const color = (v: string) => (v && !HEX_PATTERN.test(v) ? "Use a color like #1E40AF." : null);
  const logo = draft.logoUrl && !draft.logoUrl.startsWith("https://") ? "Use an https:// link." : null;
  const errors = { backgroundColor: color(draft.backgroundColor), primaryColor: color(draft.primaryColor), logoUrl: logo };
  return Object.values(errors).some(Boolean) ? errors : null;
}

function ColorSetting({
  id,
  label,
  help,
  value,
  fallback,
  error,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  fallback: string;
  error: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={HEX_PATTERN.test(value) ? value : fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-background p-1"
          aria-label={`${label} picker`}
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="Default"
          maxLength={7}
          className="font-mono"
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-help`}
        />
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Reset
          </Button>
        )}
      </div>
      <p id={`${id}-help`} className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>
        {error ?? help}
      </p>
    </div>
  );
}

export function FormAppearanceEditor({
  value,
  onChange,
  userId,
}: {
  value: AppearanceDraft;
  onChange: (next: AppearanceDraft) => void;
  userId: string;
}) {
  const { branding } = useOrganization();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [logoBroken, setLogoBroken] = useState(false);
  const errors = appearanceErrors(value);

  const set = (patch: Partial<AppearanceDraft>) => onChange({ ...value, ...patch });
  const shownLogo = value.logoUrl || branding.logoUrl || "";
  useEffect(() => setLogoBroken(false), [shownLogo]);

  const uploadLogo = async (file: File | null) => {
    if (fileRef.current) fileRef.current.value = ""; // allow picking the same file again
    setUploadError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Choose an image file (PNG, JPG, SVG or GIF).");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setUploadError("Choose an image under 2 MB.");
      return;
    }
    setIsUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
      const path = `${userId}/form-logos/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("media").upload(path, file, { contentType: file.type });
      if (error) throw error;
      set({ logoUrl: supabase.storage.from("media").getPublicUrl(path).data.publicUrl });
    } catch (err) {
      setUploadError(err && typeof err === "object" && "message" in err ? `Upload failed: ${err.message}` : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  // Small live preview of the title area and button.
  const bg = HEX_PATTERN.test(value.backgroundColor) ? value.backgroundColor : null;
  const accent = HEX_PATTERN.test(value.primaryColor) ? value.primaryColor : branding.primaryColor ?? APP_DEFAULT_ACCENT;

  return (
    <div className="space-y-4 p-4 border rounded-md bg-muted/30">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-medium">Appearance</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Leave anything blank to use your organization's branding from Settings.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ColorSetting
          id="form-bg-color"
          label="Background color"
          help="Behind the form, on its page and when embedded."
          value={value.backgroundColor}
          fallback="#f5f5f5"
          error={errors?.backgroundColor ?? null}
          onChange={(v) => set({ backgroundColor: v })}
        />
        <ColorSetting
          id="form-accent-color"
          label="Button color"
          help="The Submit button, links and highlights."
          value={value.primaryColor}
          fallback={branding.primaryColor ?? APP_DEFAULT_ACCENT}
          error={errors?.primaryColor ?? null}
          onChange={(v) => set({ primaryColor: v })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="form-logo-url">Logo</Label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => uploadLogo(e.target.files?.[0] ?? null)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={isUploading}>
            <Upload className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {isUploading ? "Uploading..." : "Upload logo"}
          </Button>
          <span className="text-xs text-muted-foreground">or paste a link:</span>
          <Input
            id="form-logo-url"
            type="url"
            value={value.logoUrl}
            onChange={(e) => set({ logoUrl: e.target.value.trim() })}
            placeholder={branding.logoUrl ? "Using your organization's logo" : "https://example.org/logo.png"}
            className="flex-1 min-w-[12rem]"
            aria-invalid={Boolean(errors?.logoUrl)}
          />
          {value.logoUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ logoUrl: "" })} aria-label="Remove form logo">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
        {(uploadError || errors?.logoUrl) && (
          <p role="alert" className="text-xs text-destructive">
            {uploadError || errors?.logoUrl}
          </p>
        )}
      </div>

      {/* Preview */}
      <div
        className={`rounded-md border p-4 space-y-3 ${bg ? "" : "bg-background"}`}
        style={bg ? { backgroundColor: bg, color: prefersDarkText(bg) ? "#171717" : "#fafafa" } : undefined}
        aria-label="Appearance preview"
      >
        <div className="flex items-center gap-2">
          {shownLogo && !logoBroken ? (
            <img src={shownLogo} alt="" className="h-8 max-w-[120px] object-contain" onError={() => setLogoBroken(true)} />
          ) : (
            <div className="h-8 w-8 rounded-md border border-dashed opacity-60" aria-hidden="true" />
          )}
          <span className="text-sm font-semibold">Preview</span>
        </div>
        <div className="rounded-md bg-card text-card-foreground border p-3 flex items-center justify-between gap-3">
          <div className="h-2 w-24 rounded bg-muted" aria-hidden="true" />
          <span
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ backgroundColor: accent, color: prefersDarkText(accent) ? "#171717" : "#fafafa" }}
          >
            Submit
          </span>
        </div>
        {shownLogo && logoBroken && <p className="text-xs">That logo couldn't be loaded. Check the link.</p>}
      </div>
    </div>
  );
}
