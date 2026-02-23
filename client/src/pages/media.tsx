import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Upload, Image, Mic, Trash2, Play, Pause, Download, Search } from "lucide-react";

interface MediaItem {
  id: string;
  file_name: string;
  file_type: string;
  file_url: string;
  file_size: number | null;
  media_type: "image" | "audio";
  notes: string | null;
  created_at: string;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AudioPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  };

  return (
    <div className="flex items-center gap-2">
      <audio ref={audioRef} src={url} onEnded={() => setPlaying(false)} />
      <Button variant="outline" size="icon" className="h-8 w-8" onClick={toggle}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <span className="text-xs text-muted-foreground">{playing ? "Playing..." : "Play"}</span>
    </div>
  );
}

export default function MediaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [filter, setFilter] = useState<"all" | "image" | "audio">("all");
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadItems = async () => {
    if (!user) return;
    setIsLoading(true);
    const { data } = await supabase.from("media_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setItems(data ?? []);
    setIsLoading(false);
  };

  useEffect(() => { loadItems(); }, [user]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !user) return;
    setIsUploading(true);

    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const isAudio = file.type.startsWith("audio/");
      if (!isImage && !isAudio) {
        toast({ title: "Unsupported file type", description: "Only images and audio files are supported.", variant: "destructive" });
        continue;
      }

      const path = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("media").upload(path, file);
      if (uploadError) { toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" }); continue; }

      const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(path);

      await supabase.from("media_items").insert({
        user_id: user.id,
        file_name: file.name,
        file_type: file.type,
        file_url: publicUrl,
        file_size: file.size,
        media_type: isImage ? "image" : "audio",
      });
    }

    setIsUploading(false);
    loadItems();
    toast({ title: "Upload complete" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (item: MediaItem) => {
    const path = item.file_url.split("/media/")[1];
    await supabase.storage.from("media").remove([path]);
    await supabase.from("media_items").delete().eq("id", item.id);
    toast({ title: "Deleted" });
    loadItems();
  };

  const filtered = items.filter((i) => {
    if (filter !== "all" && i.media_type !== filter) return false;
    if (search && !i.file_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Media Library</h1>
          <p className="text-muted-foreground">Photos and voice memos from your organization</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" multiple accept="image/*,audio/*" className="hidden" onChange={handleUpload} />
          <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            <Upload className="mr-1 h-4 w-4" />
            {isUploading ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search files..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1 border rounded-md overflow-hidden">
          {(["all", "image", "audio"] as const).map((f) => (
            <Button key={f} variant={filter === f ? "default" : "ghost"} size="sm" onClick={() => setFilter(f)} className="rounded-none capitalize">
              {f === "image" ? <><Image className="mr-1 h-3.5 w-3.5" />Images</> : f === "audio" ? <><Mic className="mr-1 h-3.5 w-3.5" />Audio</> : "All"}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3,4].map((i) => <Card key={i} className="p-4"><Skeleton className="h-40 w-full" /></Card>)}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((item) => (
            <Card key={item.id} className="overflow-hidden hover-elevate">
              {item.media_type === "image" ? (
                <div className="aspect-video bg-muted overflow-hidden">
                  <img src={item.file_url} alt={item.file_name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="aspect-video bg-muted flex items-center justify-center">
                  <Mic className="h-12 w-12 text-muted-foreground" />
                </div>
              )}
              <div className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium truncate">{item.file_name}</p>
                  <Badge variant={item.media_type === "image" ? "default" : "secondary"} className="shrink-0 text-xs">
                    {item.media_type}
                  </Badge>
                </div>
                {item.file_size && <p className="text-xs text-muted-foreground">{formatBytes(item.file_size)}</p>}
                {item.media_type === "audio" && <AudioPlayer url={item.file_url} />}
                <div className="flex items-center gap-1 pt-1 border-t">
                  <a href={item.file_url} download={item.file_name} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm"><Download className="h-3.5 w-3.5" /></Button>
                  </a>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(item)} className="ml-auto">
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Upload className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No media yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Upload photos and voice memos from your organization's activities.</p>
          </div>
          <Button onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-1 h-4 w-4" /> Upload Files
          </Button>
        </div>
      )}
    </div>
  );
}
