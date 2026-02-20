import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import {
  Plus, LinkIcon, ExternalLink, Trash2, Pencil, Globe,
  FolderOpen, FolderPlus, ChevronDown, ChevronRight, Folder,
  Star, Heart, Bookmark, FileText, Mail, Phone, Home, Briefcase,
  Gift, Award, Target, Zap, Shield, Users, Calendar, DollarSign,
  Handshake, BarChart3, Lightbulb, Key, PenLine, PartyPopper,
  Sprout, CheckCircle, Rocket, MessageCircle, Megaphone, GraduationCap,
  Stethoscope, PawPrint, Recycle, Camera, type LucideIcon
} from "lucide-react";
import type { Link as LinkType } from "@shared/schema";

const ICON_OPTIONS: { value: string; label: string; Icon: LucideIcon }[] = [
  { value: "globe", label: "Globe", Icon: Globe },
  { value: "link", label: "Link", Icon: LinkIcon },
  { value: "star", label: "Star", Icon: Star },
  { value: "heart", label: "Heart", Icon: Heart },
  { value: "bookmark", label: "Bookmark", Icon: Bookmark },
  { value: "file", label: "File", Icon: FileText },
  { value: "mail", label: "Mail", Icon: Mail },
  { value: "phone", label: "Phone", Icon: Phone },
  { value: "home", label: "Home", Icon: Home },
  { value: "briefcase", label: "Briefcase", Icon: Briefcase },
  { value: "gift", label: "Gift", Icon: Gift },
  { value: "award", label: "Award", Icon: Award },
  { value: "target", label: "Target", Icon: Target },
  { value: "zap", label: "Lightning", Icon: Zap },
  { value: "shield", label: "Shield", Icon: Shield },
  { value: "users", label: "People", Icon: Users },
  { value: "calendar", label: "Calendar", Icon: Calendar },
  { value: "dollar", label: "Dollar", Icon: DollarSign },
  { value: "handshake", label: "Handshake", Icon: Handshake },
  { value: "chart", label: "Chart", Icon: BarChart3 },
  { value: "lightbulb", label: "Idea", Icon: Lightbulb },
  { value: "key", label: "Key", Icon: Key },
  { value: "pen", label: "Pen", Icon: PenLine },
  { value: "party", label: "Celebrate", Icon: PartyPopper },
  { value: "sprout", label: "Growth", Icon: Sprout },
  { value: "check", label: "Check", Icon: CheckCircle },
  { value: "rocket", label: "Rocket", Icon: Rocket },
  { value: "message", label: "Message", Icon: MessageCircle },
  { value: "megaphone", label: "Announce", Icon: Megaphone },
  { value: "graduation", label: "Education", Icon: GraduationCap },
  { value: "health", label: "Health", Icon: Stethoscope },
  { value: "paw", label: "Animals", Icon: PawPrint },
  { value: "recycle", label: "Recycle", Icon: Recycle },
  { value: "camera", label: "Photo", Icon: Camera },
];

function getIconComponent(iconValue: string | null | undefined): LucideIcon {
  if (!iconValue) return Globe;
  const found = ICON_OPTIONS.find((o) => o.value === iconValue);
  return found ? found.Icon : Globe;
}

function LinkIconDisplay({ icon, className = "h-5 w-5" }: { icon?: string | null; className?: string }) {
  const IconComp = getIconComponent(icon);
  return <IconComp className={`${className} text-primary`} />;
}

export default function LinksPage() {
  const { toast } = useToast();
  const { data: links, isLoading } = useQuery<LinkType[]>({ queryKey: ["/api/links"] });
  const [showDialog, setShowDialog] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkType | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("");
  const [folder, setFolder] = useState("");
  const [icon, setIcon] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  const existingFolders = useMemo(() => {
    if (!links) return [];
    const folders = new Set(links.map((l) => l.folder).filter(Boolean) as string[]);
    return Array.from(folders).sort();
  }, [links]);

  const groupedLinks = useMemo(() => {
    if (!links) return { unfiled: [], folders: {} as Record<string, LinkType[]> };

    const folders: Record<string, LinkType[]> = {};
    const unfiled: LinkType[] = [];

    links.forEach((link) => {
      if (link.folder) {
        if (!folders[link.folder]) folders[link.folder] = [];
        folders[link.folder].push(link);
      } else {
        unfiled.push(link);
      }
    });

    return { unfiled, folders };
  }, [links]);

  const filteredLinks = useMemo(() => {
    if (!links) return [];
    if (selectedFolder === null) return links;
    if (selectedFolder === "__unfiled__") return groupedLinks.unfiled;
    return groupedLinks.folders[selectedFolder] || [];
  }, [links, selectedFolder, groupedLinks]);

  const resetForm = () => {
    setTitle("");
    setUrl("");
    setCategory("");
    setFolder("");
    setIcon("");
    setNewFolderName("");
    setShowNewFolder(false);
    setEditingLink(null);
    setShowDialog(false);
  };

  const openEdit = (link: LinkType) => {
    setEditingLink(link);
    setTitle(link.title);
    setUrl(link.url);
    setCategory(link.category || "");
    setFolder(link.folder || "");
    setIcon(link.icon || "");
    setShowDialog(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const finalFolder = showNewFolder && newFolderName.trim() ? newFolderName.trim() : (folder || null);
      const payload = {
        title,
        url,
        category: category || null,
        folder: finalFolder,
        icon: icon || null,
      };
      if (editingLink) {
        return apiRequest("PATCH", `/api/links/${editingLink.id}`, payload);
      }
      return apiRequest("POST", "/api/links", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      toast({ title: editingLink ? "Link updated" : "Link added" });
      resetForm();
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/links/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      toast({ title: "Link deleted" });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleFolder = (folderName: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return next;
    });
  };

  const addLinkToFolder = (folderName: string) => {
    setFolder(folderName);
    setShowDialog(true);
  };

  const selectedIconOption = ICON_OPTIONS.find((o) => o.value === icon);

  const renderLinkCard = (link: LinkType) => (
    <Card key={link.id} className="p-4 hover-elevate" data-testid={`card-link-${link.id}`}>
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <LinkIconDisplay icon={link.icon} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold truncate text-sm" data-testid={`text-link-title-${link.id}`}>{link.title}</h3>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:underline truncate block mt-0.5"
            data-testid={`link-url-${link.id}`}
          >
            {link.url}
          </a>
          {link.category && (
            <Badge variant="secondary" className="mt-1.5">{link.category}</Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 mt-3 pt-2.5 border-t">
        <a href={link.url} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="sm" data-testid={`button-open-link-${link.id}`}>
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Open
          </Button>
        </a>
        <Button variant="ghost" size="sm" onClick={() => openEdit(link)} data-testid={`button-edit-link-${link.id}`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(link.id)} data-testid={`button-delete-link-${link.id}`}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
    </Card>
  );

  const folderNames = Object.keys(groupedLinks.folders).sort();
  const hasFolders = folderNames.length > 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold" data-testid="text-links-title">Links</h1>
          <p className="text-muted-foreground">Organize partner sites, grant portals, and community resources</p>
        </div>
        <Button onClick={() => setShowDialog(true)} data-testid="button-add-link">
          <Plus className="mr-1 h-4 w-4" />
          Add Link
        </Button>
      </div>

      {hasFolders && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={selectedFolder === null ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedFolder(null)}
            data-testid="button-filter-all"
          >
            All
          </Button>
          {folderNames.map((f) => (
            <Button
              key={f}
              variant={selectedFolder === f ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedFolder(selectedFolder === f ? null : f)}
              data-testid={`button-filter-folder-${f}`}
            >
              <Folder className="mr-1 h-3.5 w-3.5" />
              {f}
            </Button>
          ))}
          {groupedLinks.unfiled.length > 0 && (
            <Button
              variant={selectedFolder === "__unfiled__" ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedFolder(selectedFolder === "__unfiled__" ? null : "__unfiled__")}
              data-testid="button-filter-unfiled"
            >
              Unfiled
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5"><Skeleton className="h-20 w-full" /></Card>
          ))}
        </div>
      ) : links && links.length > 0 ? (
        selectedFolder !== null ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredLinks.map(renderLinkCard)}
          </div>
        ) : (
          <div className="space-y-6">
            {folderNames.map((folderName) => {
              const folderLinks = groupedLinks.folders[folderName];
              const isCollapsed = collapsedFolders.has(folderName);
              return (
                <div key={folderName} data-testid={`folder-${folderName}`}>
                  <div className="group flex items-center gap-2 mb-3">
                    <button
                      onClick={() => toggleFolder(folderName)}
                      className="flex items-center gap-2 flex-1 text-left"
                      data-testid={`button-toggle-folder-${folderName}`}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                      <FolderOpen className="h-4 w-4 text-primary" />
                      <span className="font-semibold">{folderName}</span>
                      <Badge variant="secondary">{folderLinks.length}</Badge>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="invisible group-hover:visible"
                      onClick={() => addLinkToFolder(folderName)}
                      data-testid={`button-add-to-folder-${folderName}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {!isCollapsed && (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pl-6">
                      {folderLinks.map(renderLinkCard)}
                    </div>
                  )}
                </div>
              );
            })}

            {groupedLinks.unfiled.length > 0 && (
              <div data-testid="folder-unfiled">
                {hasFolders && (
                  <div className="flex items-center gap-2 mb-3">
                    <LinkIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-muted-foreground">Unfiled</span>
                    <Badge variant="secondary">{groupedLinks.unfiled.length}</Badge>
                  </div>
                )}
                <div className={`grid sm:grid-cols-2 lg:grid-cols-3 gap-4 ${hasFolders ? "pl-6" : ""}`}>
                  {groupedLinks.unfiled.map(renderLinkCard)}
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <LinkIcon className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No links saved</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Save partner websites, grant portals, donor resources, and community links.</p>
          </div>
          <Button onClick={() => setShowDialog(true)} data-testid="button-add-first-link">
            <Plus className="mr-1 h-4 w-4" />
            Add First Link
          </Button>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingLink ? "Edit Link" : "Add New Link"}</DialogTitle>
            <DialogDescription>
              {editingLink ? "Update your saved link details." : "Save a partner site, grant portal, or community resource."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="link-title">Title</Label>
              <Input id="link-title" placeholder="e.g. Supplier Portal" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-link-title" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="link-url">URL</Label>
              <Input id="link-url" placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} data-testid="input-link-url" />
            </div>

            <div className="space-y-2">
              <Label>Icon</Label>
              <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start" data-testid="button-pick-icon">
                    {selectedIconOption ? (
                      <selectedIconOption.Icon className="mr-2 h-4 w-4 text-primary" />
                    ) : (
                      <Globe className="mr-2 h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">{selectedIconOption ? selectedIconOption.label : "Pick an icon"}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80" align="start">
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Choose an icon</p>
                    <div className="grid grid-cols-7 gap-1">
                      {ICON_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`h-9 w-9 flex items-center justify-center rounded-md hover-elevate ${icon === opt.value ? "bg-primary/10 ring-1 ring-primary" : ""}`}
                          onClick={() => { setIcon(opt.value); setIconPickerOpen(false); }}
                          title={opt.label}
                          data-testid={`button-icon-${opt.value}`}
                        >
                          <opt.Icon className="h-4 w-4" />
                        </button>
                      ))}
                    </div>
                    {icon && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => { setIcon(""); setIconPickerOpen(false); }}
                        data-testid="button-clear-icon"
                      >
                        Clear icon
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label>Folder</Label>
              {!showNewFolder ? (
                <div className="flex gap-2">
                  <Select
                    value={folder || "__none__"}
                    onValueChange={(val) => setFolder(val === "__none__" ? "" : val)}
                  >
                    <SelectTrigger className="flex-1" data-testid="select-folder">
                      <SelectValue placeholder="No folder" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No folder</SelectItem>
                      {existingFolders.map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowNewFolder(true)}
                    data-testid="button-new-folder"
                  >
                    <FolderPlus className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="New folder name..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    data-testid="input-new-folder"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowNewFolder(false); setNewFolderName(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="link-category">Category (optional)</Label>
              <Input id="link-category" placeholder="e.g. Suppliers" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="input-link-category" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!title.trim() || !url.trim() || saveMutation.isPending}
              data-testid="button-save-link"
            >
              {saveMutation.isPending ? "Saving..." : editingLink ? "Update" : "Add Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
