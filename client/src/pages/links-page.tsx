/**
 * LinksPage
 *
 * A bookmark manager for partner websites, grant portals and other resources.
 * Links are stored in the Supabase "links" table and grouped into folders.
 *
 * How folders work:
 *   Folders are not a separate table. A folder is simply the `category` value
 *   shared by one or more links. That means:
 *     - Creating a folder opens the "Add link" dialog with the folder pre-filled;
 *       the folder appears once its first link is saved.
 *     - Renaming a folder updates the category on every link in it.
 *     - Deleting a folder moves its links to Uncategorized (links are kept).
 *     - Links with no category are shown under "Uncategorized".
 *
 * Customizable fields (lib/tracker-fields.ts): fields can be renamed, the
 * description and folder hidden, and the organization's own fields added.
 * With the folder field hidden, folders are not shown and every link is in
 * one list; saved folder values are kept.
 *
 * Read-only mode (viewers, or an ended trial): add, edit, delete and folder
 * buttons are hidden; searching, opening and copying links still work.
 *
 * Backend assumptions:
 *   - Columns: id, user_id, title, url, description, category, created_at.
 *   - Row Level Security limits rows to the user's organization and blocks
 *     changes from viewers, so folders are shared by the whole team. user_id
 *     records who added the link; it isn't used for access.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { friendlyWriteError } from "@/lib/db-errors";
import {
  Plus,
  LinkIcon,
  Trash2,
  Pencil,
  ExternalLink,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Copy,
  Search,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { CustomFieldInputs } from "@/components/custom-field-inputs";
import { CustomizeFieldsButton } from "@/components/customize-fields-dialog";
import { useTrackerFields, prepareCustomValues, customOf, formatCustomValue, type CustomValues } from "@/lib/tracker-fields";
import type { Link as LinkRecord } from "@/types/database";

/** A saved link, plus the organization's own fields (migration 011; missing on older databases). */
type Link = LinkRecord & { custom?: CustomValues | null };

// ===========================================================================
// Constants
// ===========================================================================

/**
 * Internal key for links with no folder.
 *
 * The original grouped them under the literal string "Uncategorized", so a
 * real folder named "Uncategorized" got merged with them and could not be
 * renamed or deleted. This key can never collide with a real folder name.
 */
const UNCATEGORIZED_KEY = "\u0000uncategorized";
const UNCATEGORIZED_LABEL = "Uncategorized";

/** localStorage key that remembers which folders are collapsed. */
const COLLAPSED_STORAGE_KEY = "links-collapsed-folders";

const MAX_TITLE_LENGTH = 150;
const MAX_FOLDER_LENGTH = 60;

/**
 * Settings for the shared confirmation dialog (used for deleting a link
 * and deleting a folder), so each confirm does not need its own dialog.
 */
interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

/** Whether the folder dialog is creating a new folder or renaming one. */
type FolderDialogState = { mode: "create" } | { mode: "rename"; folder: string } | null;

// ===========================================================================
// URL helpers
// ===========================================================================

/** Schemes that can run code or open local files when clicked. Always rejected. */
const DANGEROUS_SCHEME = /^\s*(javascript|data|vbscript|file):/i;

/**
 * Turn user input into a clean http(s) URL, or null if it is not valid.
 *
 * Fixes over the original, which only checked url.startsWith("http"):
 * - "httpbin.org" started with "http" and was saved with no scheme, so the
 *   link opened as a broken relative path inside the app.
 * - "javascript:..." links were accepted. Clicking one would run code in
 *   the app, which is a cross-site scripting risk.
 * - Plain words like "hello" were saved as "https://hello".
 */
const normalizeUrl = (raw: string): string | null => {
  let value = raw.trim();
  if (!value || DANGEROUS_SCHEME.test(value)) return null;

  // Add https:// unless the input already has a scheme followed by "//".
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    // Require a real-looking host: has a dot (example.org) or is localhost.
    if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

/**
 * Return the URL only if it is safe to put in an href, otherwise undefined.
 * Protects against bad rows that were saved before this validation existed
 * or were inserted some other way.
 */
const safeHref = (url: string): string | undefined => {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};

/** "https://www.grants.gov/search" -> "grants.gov". Shown under each title. */
const getHostname = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Comparable form of a URL for duplicate detection (no trailing slash, lowercase host). */
const urlKey = (url: string): string => url.toLowerCase().replace(/\/+$/, "");

// ===========================================================================
// Folder helpers
// ===========================================================================

/** Trim and collapse repeated spaces in a folder name. */
const cleanFolderName = (name: string): string => name.trim().replace(/\s+/g, " ");

/** Display name for a group key. */
const folderLabel = (key: string): string => (key === UNCATEGORIZED_KEY ? UNCATEGORIZED_LABEL : key);

/** Read the saved collapsed folders, ignoring bad values or blocked storage. */
const loadCollapsed = (): Set<string> => {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
};

// ===========================================================================
// Component
// ===========================================================================

export default function LinksPage() {
  const { user } = useAuth();
  const { canEdit } = useOrganization();
  /** Import window (CSV or Excel). */
  const [showImport, setShowImport] = useState(false);
  const { toast } = useToast();
  /** Renamed, hidden and custom fields for this organization. */
  const fields = useTrackerFields("links");
  const showsDescription = fields.shows("description");
  /** With the folder field hidden, folder UI goes away and links show as one list. */
  const showsFolders = fields.shows("category");

  // ----- Data state -----
  const [links, setLinks] = useState<Link[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ----- View state -----
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(loadCollapsed);
  const [searchQuery, setSearchQuery] = useState("");

  // ----- Add/edit link dialog state -----
  const [showDialog, setShowDialog] = useState(false);
  /** When non-null, the dialog edits this link instead of creating a new one. */
  const [editingLink, setEditingLink] = useState<Link | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [customValues, setCustomValues] = useState<CustomValues>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  /** URL errors only show after the user leaves the field or tries to save. */
  const [urlTouched, setUrlTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // ----- Folder dialog state (create or rename) -----
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null);
  const [folderNameInput, setFolderNameInput] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  // ----- Shared confirmation dialog state -----
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  /**
   * Load all of the user's links.
   *
   * Fixes over the original:
   * - Errors were ignored; they now show a toast.
   * - With no user, the loading skeleton never went away.
   * - useCallback so it can be an effect dependency.
   */
  const loadLinks = useCallback(async () => {
    if (!user) {
      setLinks([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const { data, error } = await supabase
      .from("links")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Could not load links", description: error.message, variant: "destructive" });
    } else {
      setLinks(data ?? []);
    }
    setIsLoading(false);
  }, [user, toast]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  /** Save collapsed folders so the page reopens the way the user left it. */
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(collapsedFolders)));
    } catch {
      // Not critical if it can't be saved.
    }
  }, [collapsedFolders]);

  // -------------------------------------------------------------------------
  // Derived data (memoized)
  // -------------------------------------------------------------------------

  /** Every folder name in use, sorted alphabetically. */
  const existingFolders = useMemo(
    () =>
      Array.from(new Set(links.map((l) => l.category).filter((c): c is string => Boolean(c)))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [links],
  );

  /**
   * Match a typed folder name to an existing one, ignoring case.
   * Without this, "Grants" and "grants" became two separate folders.
   */
  const resolveFolderName = useCallback(
    (input: string): string => {
      const cleaned = cleanFolderName(input);
      return existingFolders.find((f) => f.toLowerCase() === cleaned.toLowerCase()) ?? cleaned;
    },
    [existingFolders],
  );

  /** Links matching the search box (title, URL, shown description or folder, custom values). */
  const filteredLinks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => {
      const custom = customOf(l);
      return [
        l.title,
        l.url,
        showsDescription ? l.description : null,
        showsFolders ? l.category : null,
        ...fields.custom.map((f) => formatCustomValue(f, custom[f.id])),
      ].some((field) => field?.toLowerCase().includes(q));
    });
  }, [links, searchQuery, showsDescription, showsFolders, fields.custom]);

  /**
   * Links grouped by folder. Folders are sorted A to Z with Uncategorized
   * last; links inside each folder are sorted by title. With the folder
   * field hidden, every link goes in one group (shown without a header).
   */
  const sortedGroups = useMemo(() => {
    const grouped = new Map<string, Link[]>();
    for (const link of filteredLinks) {
      const key = (showsFolders && link.category) || UNCATEGORIZED_KEY;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(link);
    }
    return Array.from(grouped.entries())
      .map(([key, items]) => [key, [...items].sort((a, b) => a.title.localeCompare(b.title))] as const)
      .sort(([a], [b]) => {
        if (a === UNCATEGORIZED_KEY) return 1;
        if (b === UNCATEGORIZED_KEY) return -1;
        return a.localeCompare(b);
      });
  }, [filteredLinks, showsFolders]);

  // -------------------------------------------------------------------------
  // Link form helpers and validation
  // -------------------------------------------------------------------------

  /** Clear the form and close the add/edit dialog. */
  const resetForm = () => {
    setTitle("");
    setUrl("");
    setDescription("");
    setCategory("");
    setCustomValues({});
    setCustomErrors({});
    setUrlTouched(false);
    setEditingLink(null);
    setShowDialog(false);
  };

  /**
   * Open the dialog for a new link, optionally inside a folder.
   * Clears any leftover edit state first; the original could open
   * "Add link" while still pointing at a previously edited link.
   */
  const openCreate = (folder = "") => {
    setTitle("");
    setUrl("");
    setDescription("");
    setCustomValues({});
    setCustomErrors({});
    setUrlTouched(false);
    setEditingLink(null);
    setCategory(folder);
    setShowDialog(true);
  };

  /** Open the dialog pre-filled with an existing link. */
  const openEdit = (link: Link) => {
    setEditingLink(link);
    setTitle(link.title);
    setUrl(link.url);
    setDescription(link.description ?? "");
    setCategory(link.category ?? "");
    setCustomValues(customOf(link));
    setCustomErrors({});
    setUrlTouched(false);
    setShowDialog(true);
  };

  const normalizedUrl = normalizeUrl(url);
  const urlError = url.trim() === "" ? null : normalizedUrl ? null : "Enter a valid web address, like grants.gov.";

  /** Folder names that would be confused with the built-in Uncategorized group. */
  const isReservedFolder = (name: string) => cleanFolderName(name).toLowerCase() === UNCATEGORIZED_LABEL.toLowerCase();
  // Only checked while the folder field is shown; a hidden folder is never sent on save.
  const categoryError = showsFolders && isReservedFolder(category) ? `Leave the folder blank to use ${UNCATEGORIZED_LABEL}.` : null;

  /**
   * Another saved link with the same address, if any. This is a warning
   * only; saving is still allowed (the same site can be useful twice).
   */
  const duplicateLink = normalizedUrl
    ? links.find((l) => l.id !== editingLink?.id && urlKey(l.url) === urlKey(normalizedUrl))
    : undefined;

  const isFormValid = title.trim() !== "" && normalizedUrl !== null && !categoryError;

  // -------------------------------------------------------------------------
  // Create / update link
  // -------------------------------------------------------------------------

  /**
   * Insert a new link or update the one being edited.
   *
   * Fixes over the original:
   * - URLs are validated and normalized (see normalizeUrl).
   * - Title and description are trimmed; folder names are matched to
   *   existing folders case-insensitively.
   * - try/finally so the Saving state always clears, even if the request throws.
   * - Editing keeps the original creator: user_id is only set on new links.
   */
  const handleSave = async () => {
    setUrlTouched(true);
    if (!user || !isFormValid || !normalizedUrl || isSaving) return;

    // Custom fields: show problems under each field and stop.
    const prepared = prepareCustomValues(fields.custom, customValues);
    setCustomErrors(prepared.errors);
    if (Object.keys(prepared.errors).length > 0) return;

    setIsSaving(true);
    try {
      const folder = showsFolders && category.trim() ? resolveFolderName(category) : null;
      // Hidden fields are left out so an edit keeps their saved values.
      const payload = {
        title: title.trim(),
        url: normalizedUrl,
        ...(showsDescription ? { description: description.trim() || null } : {}),
        ...(showsFolders ? { category: folder } : {}),
        // Only once migration 011 has added the column.
        ...(fields.isAvailable ? { custom: prepared.values } : {}),
      };

      const { error } = editingLink
        ? await supabase.from("links").update(payload).eq("id", editingLink.id)
        : await supabase.from("links").insert({ ...payload, user_id: user.id });

      if (error) {
        toast({ title: "Could not save link", description: friendlyWriteError(error), variant: "destructive" });
        return;
      }

      toast({ title: editingLink ? "Link updated" : "Link added" });

      // Make sure the folder the link went into is expanded so the user sees it.
      if (folder) {
        setCollapsedFolders((prev) => {
          if (!prev.has(folder)) return prev;
          const next = new Set(prev);
          next.delete(folder);
          return next;
        });
      }

      resetForm();
      await loadLinks();
    } catch (err) {
      toast({
        title: "Could not save link",
        description: friendlyWriteError(err as { message?: string; code?: string }, "Check your connection and try again."),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Delete link / delete folder (both go through the confirmation dialog)
  // -------------------------------------------------------------------------

  /** Ask before deleting a link. The original deleted on a single click. */
  const requestDeleteLink = (link: Link) => {
    setConfirmState({
      title: "Delete this link?",
      description: `"${link.title}" will be permanently removed.`,
      confirmLabel: "Delete link",
      onConfirm: async () => {
        if (!user) return;
        const { error } = await supabase.from("links").delete().eq("id", link.id);
        if (error) throw error;
        toast({ title: "Link deleted" });
        await loadLinks();
      },
    });
  };

  /**
   * Ask before removing a folder. Its links are moved to Uncategorized, not
   * deleted. The original ran immediately on one click and used user!,
   * which would crash if the session had expired.
   */
  const requestDeleteFolder = (folder: string, count: number) => {
    setConfirmState({
      title: `Remove the "${folder}" folder?`,
      description: `Its ${count} ${count === 1 ? "link" : "links"} will be moved to ${UNCATEGORIZED_LABEL}. No links are deleted.`,
      confirmLabel: "Remove folder",
      onConfirm: async () => {
        if (!user) return;
        const { error } = await supabase
          .from("links")
          .update({ category: null })
          .eq("category", folder);
        if (error) throw error;
        toast({ title: "Folder removed", description: `Links moved to ${UNCATEGORIZED_LABEL}.` });
        await loadLinks();
      },
    });
  };

  /** Run the pending confirmation action, showing any error as a toast. */
  const runConfirm = async () => {
    if (!confirmState) return;
    setIsConfirming(true);
    try {
      await confirmState.onConfirm();
      setConfirmState(null);
    } catch (err) {
      toast({
        title: "Something went wrong",
        description: friendlyWriteError(err as { message?: string; code?: string }, "Check your connection and try again."),
        variant: "destructive",
      });
    } finally {
      setIsConfirming(false);
    }
  };

  // -------------------------------------------------------------------------
  // Folder create / rename
  // -------------------------------------------------------------------------

  const openCreateFolder = () => {
    setFolderNameInput("");
    setFolderDialog({ mode: "create" });
  };

  const openRenameFolder = (folder: string) => {
    setFolderNameInput(folder);
    setFolderDialog({ mode: "rename", folder });
  };

  const closeFolderDialog = () => {
    if (isRenaming) return;
    setFolderDialog(null);
    setFolderNameInput("");
  };

  const cleanedFolderInput = cleanFolderName(folderNameInput);
  const folderInputError = isReservedFolder(folderNameInput)
    ? `"${UNCATEGORIZED_LABEL}" is reserved for links without a folder.`
    : null;
  /** In rename mode, typing the name of a different existing folder merges the two. */
  const renameMergeTarget =
    folderDialog?.mode === "rename"
      ? existingFolders.find(
          (f) => f !== folderDialog.folder && f.toLowerCase() === cleanedFolderInput.toLowerCase(),
        )
      : undefined;

  /**
   * Submit the folder dialog.
   * - Create: opens "Add link" with the folder filled in (the folder exists
   *   once a link is saved in it). Reuses an existing folder's spelling.
   * - Rename: updates the category on every link in the folder.
   */
  const submitFolderDialog = async () => {
    if (!folderDialog || !cleanedFolderInput || folderInputError) return;

    if (folderDialog.mode === "create") {
      const folder = resolveFolderName(cleanedFolderInput);
      setFolderDialog(null);
      setFolderNameInput("");
      openCreate(folder);
      return;
    }

    // Rename
    const oldName = folderDialog.folder;
    const newName = renameMergeTarget ?? cleanedFolderInput;
    if (!user || newName === oldName) {
      closeFolderDialog();
      return;
    }

    setIsRenaming(true);
    try {
      const { error } = await supabase
        .from("links")
        .update({ category: newName })
        .eq("category", oldName);

      if (error) {
        toast({ title: "Could not rename folder", description: friendlyWriteError(error), variant: "destructive" });
        return;
      }

      // Carry the collapsed state over to the new name.
      setCollapsedFolders((prev) => {
        if (!prev.has(oldName)) return prev;
        const next = new Set(prev);
        next.delete(oldName);
        next.add(newName);
        return next;
      });

      toast({ title: renameMergeTarget ? `Merged into "${newName}"` : "Folder renamed" });
      setFolderDialog(null);
      setFolderNameInput("");
      await loadLinks();
    } catch (err) {
      toast({
        title: "Could not rename folder",
        description: friendlyWriteError(err as { message?: string; code?: string }, "Check your connection and try again."),
        variant: "destructive",
      });
    } finally {
      setIsRenaming(false);
    }
  };

  // -------------------------------------------------------------------------
  // Misc actions
  // -------------------------------------------------------------------------

  /** Expand or collapse a folder. */
  const toggleFolder = (key: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Copy a link's address. Falls back to showing it if the clipboard is blocked. */
  const copyLink = async (link: Link) => {
    try {
      await navigator.clipboard.writeText(link.url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Couldn't copy automatically", description: link.url });
    }
  };

  const isSearching = searchQuery.trim() !== "";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ===== Header ===== */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Links</h1>
          <p className="text-muted-foreground">Organize partner websites, grant portals, and resources</p>
        </div>
        {showImport && <ImportDialog kind="links" onClose={() => setShowImport(false)} onImported={loadLinks} />}
        <div className="flex flex-wrap items-center gap-2">
          {/* Renders only for owners and admins. */}
          <CustomizeFieldsButton fields={fields} />
          {canEdit && (
            <>
              {showsFolders && (
                <Button variant="outline" onClick={openCreateFolder}>
                  <FolderPlus className="mr-1 h-4 w-4" aria-hidden="true" /> New folder
                </Button>
              )}
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <Upload className="mr-1 h-4 w-4" aria-hidden="true" /> Import
              </Button>
              <Button onClick={() => openCreate()}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add link
              </Button>
            </>
          )}
        </div>
      </div>
      <ReadOnlyNotice />

      {/* ===== Search (only once there are links) ===== */}
      {!isLoading && links.length > 0 && (
        <div className="relative max-w-sm">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder={`Search ${[fields.label("title"), fields.label("url"), showsDescription && fields.label("description"), showsFolders && fields.label("category")]
              .filter(Boolean)
              .join(", ")
              .toLowerCase()}`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            aria-label="Search links"
          />
        </div>
      )}

      {/* ===== Main content: loading, empty, no matches, or folders ===== */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-20 w-full" />
            </Card>
          ))}
        </div>
      ) : links.length === 0 ? (
        // Empty state: no links at all yet.
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <LinkIcon className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No links saved</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {canEdit
                ? "Save partner websites, grant portals, and resources your team needs."
                : "Links will appear here once they are added."}
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => openCreate()}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add first link
            </Button>
          )}
        </div>
      ) : sortedGroups.length === 0 ? (
        // Links exist, but the search hides all of them.
        <div className="text-center py-16 space-y-3">
          <p className="text-muted-foreground">No links match "{searchQuery}".</p>
          <Button variant="outline" onClick={() => setSearchQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedGroups.map(([folderKey, folderLinks]) => {
            const label = folderLabel(folderKey);
            const isUncategorized = folderKey === UNCATEGORIZED_KEY;
            // While searching, show every match instead of hiding results in collapsed folders.
            // With folders hidden there is one list and nothing to collapse.
            const isCollapsed = showsFolders && !isSearching && collapsedFolders.has(folderKey);
            const panelId = `folder-panel-${encodeURIComponent(label)}`;

            return (
              <section
                key={folderKey}
                className="space-y-3"
                aria-label={showsFolders ? `${label} folder` : "Links"}
              >
                {/* ----- Folder header (not shown when the folder field is hidden) ----- */}
                {showsFolders && (
                  <div className="flex items-center justify-between gap-2">
                    {/* aria-expanded + aria-controls tell screen readers this toggles the list below. */}
                    <button
                      type="button"
                      onClick={() => toggleFolder(folderKey)}
                      aria-expanded={!isCollapsed}
                      aria-controls={panelId}
                      className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors group rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                      )}
                      <Folder className="h-4 w-4 text-primary" aria-hidden="true" />
                      <span>{label}</span>
                      <span className="text-muted-foreground font-normal">({folderLinks.length})</span>
                    </button>

                    {/* Folder actions (hidden when read-only). Uncategorized is not a real folder, so it only gets "Add". */}
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => openCreate(isUncategorized ? "" : folderKey)}
                        >
                          <Plus className="mr-1 h-3 w-3" aria-hidden="true" /> Add to folder
                        </Button>
                        {!isUncategorized && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7"
                              onClick={() => openRenameFolder(folderKey)}
                              aria-label={`Rename ${label} folder`}
                              title="Rename folder"
                            >
                              <Pencil className="h-3 w-3" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-destructive hover:text-destructive"
                              onClick={() =>
                                requestDeleteFolder(folderKey, links.filter((l) => l.category === folderKey).length)
                              }
                              aria-label={`Remove ${label} folder`}
                              title="Remove folder"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden="true" />
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ----- Link cards ----- */}
                {!isCollapsed && (
                  <div id={panelId} className={`grid sm:grid-cols-2 lg:grid-cols-3 gap-4 ${showsFolders ? "pl-6" : ""}`}>
                    {folderLinks.map((link) => {
                      const href = safeHref(link.url);
                      const custom = customOf(link);
                      /** Custom fields that have a value on this link. */
                      const customItems = fields.custom
                        .map((f) => ({ field: f, text: formatCustomValue(f, custom[f.id]) }))
                        .filter((item) => item.text !== "");
                      return (
                        <Card key={link.id} className="p-5 hover-elevate flex flex-col">
                          {/* Icon and actions */}
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                              <LinkIcon className="h-4 w-4 text-primary" aria-hidden="true" />
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => copyLink(link)}
                                aria-label={`Copy address of ${link.title}`}
                                title="Copy address"
                              >
                                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                              {canEdit && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => openEdit(link)}
                                    aria-label={`Edit ${link.title}`}
                                    title="Edit"
                                  >
                                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => requestDeleteLink(link)}
                                    aria-label={`Delete ${link.title}`}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Title, site name and description */}
                          <h3 className="font-semibold truncate" title={link.title}>
                            {link.title}
                          </h3>
                          <p className="text-xs text-muted-foreground truncate">{getHostname(link.url)}</p>
                          {showsDescription && link.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{link.description}</p>
                          )}
                          {/* The organization's own fields, compactly as "Label: value". */}
                          {customItems.length > 0 && (
                            <dl className="mt-2 space-y-0.5 text-xs">
                              {customItems.map(({ field, text }) => (
                                <div key={field.id} className="flex gap-1 min-w-0">
                                  <dt className="text-muted-foreground shrink-0">{field.label}:</dt>
                                  <dd className="truncate" title={text}>
                                    {text}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          )}

                          {/* Open link. Only rendered for safe http(s) addresses. */}
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-auto pt-3 flex items-center gap-1 text-xs text-primary hover:underline w-fit"
                            >
                              <ExternalLink className="h-3 w-3" aria-hidden="true" /> Visit link
                              <span className="sr-only">(opens in a new tab)</span>
                            </a>
                          ) : (
                            <p className="mt-auto pt-3 flex items-center gap-1 text-xs text-destructive">
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Invalid address.{canEdit && " Edit to fix."}
                            </p>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* ===== Folder dialog (create or rename) ===== */}
      <Dialog open={folderDialog !== null} onOpenChange={(open) => !open && closeFolderDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{folderDialog?.mode === "rename" ? "Rename folder" : "Create new folder"}</DialogTitle>
            <DialogDescription>
              {folderDialog?.mode === "rename"
                ? "All links in this folder will move to the new name."
                : "You'll add the first link next. The folder is saved along with it."}
            </DialogDescription>
          </DialogHeader>

          {/* A real <form> so Enter submits, replacing the manual onKeyDown handler. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitFolderDialog();
            }}
          >
            <div className="space-y-2 py-2">
              <Label htmlFor="folder-name">Folder name</Label>
              <Input
                id="folder-name"
                placeholder="Grants, Partners, Resources..."
                value={folderNameInput}
                onChange={(e) => setFolderNameInput(e.target.value)}
                maxLength={MAX_FOLDER_LENGTH}
                aria-invalid={Boolean(folderInputError)}
                autoFocus
              />
              {folderInputError && <p className="text-xs text-destructive">{folderInputError}</p>}
              {renameMergeTarget && (
                <p className="text-xs text-muted-foreground">
                  A folder named "{renameMergeTarget}" already exists. Its links and these will be combined.
                </p>
              )}
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={closeFolderDialog} disabled={isRenaming}>
                Cancel
              </Button>
              <Button type="submit" disabled={!cleanedFolderInput || Boolean(folderInputError) || isRenaming}>
                {folderDialog?.mode === "rename"
                  ? isRenaming
                    ? "Saving..."
                    : renameMergeTarget
                      ? "Merge folders"
                      : "Rename folder"
                  : "Create folder"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== Add / edit link dialog ===== */}
      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          // Block closing mid-save so the form is not wiped while a request is in flight.
          if (!open && !isSaving) resetForm();
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLink ? "Edit link" : "Add link"}</DialogTitle>
          </DialogHeader>

          {/* A real <form> so pressing Enter in a field saves the link. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
            noValidate
          >
            <div className="space-y-4 py-2">
              {/* Title (required) */}
              <div className="space-y-2">
                <Label htmlFor="link-title">{fields.label("title")}</Label>
                <Input
                  id="link-title"
                  placeholder="Grant Portal, Partner Website..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={MAX_TITLE_LENGTH}
                  autoFocus
                />
              </div>

              {/* URL (required, validated) */}
              <div className="space-y-2">
                <Label htmlFor="link-url">{fields.label("url")}</Label>
                <Input
                  id="link-url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="grants.gov or https://..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => setUrlTouched(true)}
                  aria-invalid={urlTouched && Boolean(urlError)}
                  aria-describedby="link-url-help"
                />
                <p
                  id="link-url-help"
                  className={`text-xs ${urlTouched && urlError ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {urlTouched && urlError ? urlError : "https:// is added automatically if you leave it off."}
                </p>
                {/* Non-blocking heads-up about a duplicate. */}
                {duplicateLink && (
                  <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                    You already saved this address as "{duplicateLink.title}"
                    {showsFolders && duplicateLink.category ? ` in ${duplicateLink.category}` : ""}.
                  </p>
                )}
              </div>

              {/* Description (hideable) */}
              {showsDescription && (
                <div className="space-y-2">
                  <Label htmlFor="link-description">
                    {fields.label("description")} <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Textarea
                    id="link-description"
                    placeholder="What is this link for?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                  />
                </div>
              )}

              {/* Folder: free text with suggestions, plus quick-pick chips. Hideable; when hidden, an
                 edited link keeps its saved folder because category is left out of the update. */}
              {showsFolders && (
                <div className="space-y-2">
                  <Label htmlFor="link-folder">
                    {fields.label("category")} <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="link-folder"
                    placeholder="Type a folder name or leave blank"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    list="folder-suggestions"
                    maxLength={MAX_FOLDER_LENGTH}
                    aria-invalid={Boolean(categoryError)}
                  />
                  <datalist id="folder-suggestions">
                    {existingFolders.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                  {categoryError && <p className="text-xs text-destructive">{categoryError}</p>}

                  {/* Chips: clicking the selected chip again clears it (moves to Uncategorized). */}
                  {existingFolders.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1" role="group" aria-label="Choose an existing folder">
                      {existingFolders.map((f) => {
                        const isSelected = cleanFolderName(category).toLowerCase() === f.toLowerCase();
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setCategory(isSelected ? "" : f)}
                            aria-pressed={isSelected}
                            className={`text-xs px-2 py-1 rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                              isSelected ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary"
                            }`}
                          >
                            {f}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* The organization's own fields */}
              <CustomFieldInputs
                fields={fields.custom}
                values={customValues}
                onChange={setCustomValues}
                errors={customErrors}
                idPrefix="link-custom"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={resetForm} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim() || !url.trim() || Boolean(categoryError) || isSaving}>
                {isSaving ? "Saving..." : editingLink ? "Save changes" : "Add link"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== Shared confirmation dialog (delete link / remove folder) ===== */}
      <Dialog
        open={confirmState !== null}
        onOpenChange={(open) => {
          if (!open && !isConfirming) setConfirmState(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmState?.title}</DialogTitle>
            <DialogDescription>{confirmState?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmState(null)} disabled={isConfirming}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={runConfirm} disabled={isConfirming}>
              {isConfirming ? "Working..." : confirmState?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}