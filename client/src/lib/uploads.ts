/**
 * Private form uploads (migration 014).
 *
 * Photos and voice memos sent through forms are stored in the private
 * form-uploads bucket. A response saves a reference like
 * "hm-file://form-uploads/<form id>/<file>", not a public link. To show a
 * file, the app asks for a link that works for one hour, and only for
 * members of the form's organization.
 *
 * Older responses saved public links (https://...) to the media bucket;
 * those keep working as they are.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const FORM_UPLOADS_BUCKET = "form-uploads";
const PREFIX = `hm-file://${FORM_UPLOADS_BUCKET}/`;
const LINK_SECONDS = 60 * 60;

/** The reference saved in a response for a private upload. */
export const privateFileRef = (path: string): string => `${PREFIX}${path}`;

export const isPrivateFileRef = (value: unknown): value is string => typeof value === "string" && value.startsWith(PREFIX);

/** Text used wherever a private file can't be opened directly (CSV, emails). */
export const PRIVATE_FILE_TEXT = "File uploaded (open it in HumMotion)";

/** Recently made links, reused until shortly before they expire. */
const cache = new Map<string, { url: string; expires: number }>();

/** A link that can be opened now, or null. Public links are returned as they are. */
export async function fileLink(value: string): Promise<string | null> {
  if (!isPrivateFileRef(value)) return /^https:\/\//.test(value) ? value : null;
  const path = value.slice(PREFIX.length);
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabase.storage.from(FORM_UPLOADS_BUCKET).createSignedUrl(path, LINK_SECONDS);
  if (error || !data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, expires: Date.now() + LINK_SECONDS * 1000 });
  return data.signedUrl;
}

/** fileLink as a hook: null while loading or when the file can't be opened. */
export function useFileLink(value: string | null | undefined): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setState({ url: null, failed: false });
      return;
    }
    fileLink(value).then((url) => {
      if (!cancelled) setState({ url, failed: !url });
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return state;
}
