/**
 * ShareFormDialog
 *
 * Opened from a form's share button on the Forms page. Gives the public link
 * to send to people, and the code to paste into a website so the form shows
 * on that page (see embedCode in lib/form-appearance.ts).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { embedCode, getEmbedUrl, getShareUrl } from "@/lib/form-appearance";
import { AlertTriangle, Check, Copy, ExternalLink } from "lucide-react";
import type { Form } from "@/types/database";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the text is selectable in the box next to this button.
      setFailed(true);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={label} title={failed ? "Select the text and copy it manually" : undefined}>
      {copied ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? "Copied" : failed ? "Copy manually" : "Copy"}
    </Button>
  );
}

export function ShareFormDialog({ form, onClose }: { form: Form | null; onClose: () => void }) {
  if (!form) return null;
  const link = getShareUrl(form.id);
  const code = embedCode(form.id, form.title);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share "{form.title}"</DialogTitle>
          <DialogDescription>Send people a link, or put the form right on your website.</DialogDescription>
        </DialogHeader>

        {!form.is_published && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-amber-500/10 text-amber-900 dark:text-amber-200 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>This form is a draft. Publish it (Edit, then turn on Published) or people will see "Form not found".</span>
          </div>
        )}

        <div className="space-y-5">
          {/* ----- Link ----- */}
          <div className="space-y-2">
            <Label htmlFor="share-link">Link</Label>
            <div className="flex gap-2">
              <Input id="share-link" readOnly value={link} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
              <CopyButton text={link} label="Copy link" />
            </div>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-4 hover:no-underline"
            >
              Open the form <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>

          {/* ----- Embed ----- */}
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <Label htmlFor="share-embed">Embed on your website</Label>
              <CopyButton text={code} label="Copy embed code" />
            </div>
            <Textarea
              id="share-embed"
              readOnly
              value={code}
              onFocus={(e) => e.target.select()}
              rows={6}
              className="font-mono text-xs"
              aria-describedby="share-embed-help"
            />
            <div id="share-embed-help" className="text-xs text-muted-foreground space-y-1">
              <p>Paste this where the form should appear. The form grows to fit, so there's no scrollbar inside it.</p>
              <p>
                WordPress: a <strong>Custom HTML</strong> block. Squarespace: a <strong>Code</strong> block. Wix:{" "}
                <strong>Embed HTML</strong>. Google Sites: <strong>Embed &gt; Embed code</strong>.
              </p>
              <p>
                If your site only accepts a link, use{" "}
                <span className="font-mono break-all">{getEmbedUrl(form.id)}</span>.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
