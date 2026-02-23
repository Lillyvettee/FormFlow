import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Plus, LinkIcon, Trash2, Pencil, ExternalLink, Folder, FolderPlus, ChevronDown, ChevronRight } from "lucide-react";
import type { Link } from "@/types/database";

export default function LinksPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<Link[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [editingLink, setEditingLink] = useState<Link | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadLinks = async () => {
    if (!user) return;
    setIsLoading(true);
    const { data } = await supabase.from("links").select("*").eq("user_id", user.id).order("category", { ascending: true }).order("created_at", { ascending: false });
    setLinks(data ?? []);
    setIsLoading(false);
  };

  useEffect(() => { loadLinks(); }, [user]);

  const resetForm = () => {
    setTitle(""); setUrl(""); setDescription(""); setCategory("");
    setEditingLink(null); setShowDialog(false);
  };

  const openEdit = (link: Link) => {
    setEditingLink(link);
    setTitle(link.title); setUrl(link.url);
    setDescription(link.description ?? ""); setCategory(link.category ?? "");
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!user || !title.trim() || !url.trim()) return;
    setIsSaving(true);
    const finalUrl = url.startsWith("http") ? url : `https://${url}`;
    const payload = { title, url: finalUrl, description: description || null, category: category.trim() || null, user_id: user.id };

    if (editingLink) {
      const { error } = await supabase.from("links").update(payload).eq("id", editingLink.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Link updated" }); resetForm(); loadLinks(); }
    } else {
      const { error } = await supabase.from("links").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Link added" }); resetForm(); loadLinks(); }
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("links").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Link deleted" }); loadLinks(); }
  };

  const handleDeleteFolder = async (folderName: string) => {
    // Move all links in this folder to uncategorized
    const { error } = await supabase.from("links").update({ category: null }).eq("user_id", user!.id).eq("category", folderName);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Folder removed", description: "Links moved to Uncategorized" }); loadLinks(); }
  };

  const createFolder = () => {
    if (!newFolderName.trim()) return;
    setCategory(newFolderName.trim());
    setNewFolderName("");
    setShowFolderDialog(false);
    setShowDialog(true);
  };

  const toggleFolder = (name: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Get all unique folder names for the category dropdown
  const existingFolders = Array.from(new Set(links.map(l => l.category).filter(Boolean) as string[])).sort();

  const grouped = links.reduce((acc, link) => {
    const key = link.category ?? "Uncategorized";
    if (!acc[key]) acc[key] = [];
    acc[key].push(link);
    return acc;
  }, {} as Record<string, Link[]>);

  // Sort so Uncategorized is last
  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Links</h1>
          <p className="text-muted-foreground">Organize partner websites, grant portals, and resources</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowFolderDialog(true)}>
            <FolderPlus className="mr-1 h-4 w-4" /> New Folder
          </Button>
          <Button onClick={() => setShowDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add Link
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Card key={i} className="p-5"><Skeleton className="h-20 w-full" /></Card>)}
        </div>
      ) : links.length > 0 ? (
        <div className="space-y-4">
          {sortedGroups.map(([folderName, folderLinks]) => {
            const isCollapsed = collapsedFolders.has(folderName);
            const isUncategorized = folderName === "Uncategorized";
            return (
              <div key={folderName} className="space-y-3">
                {/* Folder header */}
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => toggleFolder(folderName)}
                    className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors group"
                  >
                    {isCollapsed
                      ? <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                      : <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                    }
                    <Folder className="h-4 w-4 text-primary" />
                    <span>{folderName}</span>
                    <span className="text-muted-foreground font-normal">({folderLinks.length})</span>
                  </button>
                  {!isUncategorized && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => { setCategory(folderName); setShowDialog(true); }}
                      >
                        <Plus className="mr-1 h-3 w-3" /> Add to folder
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteFolder(folderName)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Links grid */}
                {!isCollapsed && (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pl-6">
                    {folderLinks.map((link) => (
                      <Card key={link.id} className="p-5 hover-elevate">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <LinkIcon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(link)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(link.id)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        <h3 className="font-semibold truncate">{link.title}</h3>
                        {link.description && <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{link.description}</p>}
                        <a href={link.url} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline">
                          <ExternalLink className="h-3 w-3" /> Visit Link
                        </a>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <LinkIcon className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No links saved</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Save partner websites, grant portals, and resources your team needs.</p>
          </div>
          <Button onClick={() => setShowDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add First Link
          </Button>
        </div>
      )}

      {/* New Folder dialog */}
      <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create New Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Folder Name</Label>
              <Input
                placeholder="Grants, Partners, Resources..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createFolder(); }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowFolderDialog(false); setNewFolderName(""); }}>Cancel</Button>
            <Button onClick={createFolder} disabled={!newFolderName.trim()}>Create Folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Link dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingLink ? "Edit Link" : "Add Link"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input placeholder="Grant Portal, Partner Website..." value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>URL</Label>
              <Input placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea placeholder="What is this link for?" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Folder <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder="Type a folder name or leave blank"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="folder-suggestions"
              />
              {existingFolders.length > 0 && (
                <datalist id="folder-suggestions">
                  {existingFolders.map(f => <option key={f} value={f} />)}
                </datalist>
              )}
              {existingFolders.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {existingFolders.map(f => (
                    <button key={f} type="button" onClick={() => setCategory(f)}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${category === f ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary"}`}>
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button onClick={handleSave} disabled={!title.trim() || !url.trim() || isSaving}>
              {isSaving ? "Saving..." : editingLink ? "Update" : "Add Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
