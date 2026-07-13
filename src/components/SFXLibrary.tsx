import React, { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { listSFXs, saveSFX, deleteSFX, calculateStorageUsage, UserSFX } from "@/lib/sfx-storage";
import { Music, Play, Pause, Trash2, Upload, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface SFXLibraryProps {
  open: boolean;
  onClose: () => void;
  onSelect: (sfxId: string) => void;
}

const MAX_STORAGE_BYTES = 200 * 1024 * 1024; // 200MB
const MAX_FILE_COUNT = 50;

const NATIVE_SFX_PRESETS = [
  { id: "notification", name: "Notification (Mensagem)", duration: "0.8s", desc: "Som clássico de nova mensagem recebida" },
  { id: "typing", name: "Typing (Digitação)", duration: "1.5s", desc: "Teclas do teclado digitando rápido" },
  { id: "swoosh", name: "Swoosh (Transição)", duration: "0.5s", desc: "Efeito sonoro de transição rápida" },
  { id: "laugh", name: "Laugh (Risada)", duration: "1.2s", desc: "Risada curta de fundo" },
];

export const SFXLibrary: React.FC<SFXLibraryProps> = ({ open, onClose, onSelect }) => {
  const [userSfxs, setUserSfxs] = useState<UserSFX[]>([]);
  const [storageUsage, setStorageUsage] = useState({ count: 0, totalBytes: 0 });
  const [uploading, setUploading] = useState(false);
  const [playingSfxId, setPlayingSfxId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);

  const refreshSFXList = async () => {
    try {
      const list = await listSFXs();
      setUserSfxs(list);
      const usage = await calculateStorageUsage();
      setStorageUsage(usage);
    } catch (err) {
      console.error("Failed to load user SFXs", err);
    }
  };

  useEffect(() => {
    if (open) {
      refreshSFXList();
    }
  }, [open]);

  // Clean up preview audio on unmount
  useEffect(() => {
    return () => {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
        audioPreviewRef.current = null;
      }
    };
  }, []);

  const playPreview = (sfxId: string, isNative: boolean) => {
    if (playingSfxId === sfxId) {
      if (audioPreviewRef.current) {
        audioPreviewRef.current.pause();
      }
      setPlayingSfxId(null);
      return;
    }

    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
    }

    let url = "";
    if (isNative) {
      url = `/sfx/${sfxId}.mp3`;
    } else {
      const sfx = userSfxs.find((x) => x.id === sfxId);
      if (sfx) {
        url = URL.createObjectURL(sfx.blob);
      }
    }

    if (!url) return;

    const audio = new Audio(url);
    audioPreviewRef.current = audio;
    setPlayingSfxId(sfxId);

    audio.play().catch((err) => {
      console.error("Audio preview failed:", err);
      toast.error("Erro ao reproduzir áudio.");
      setPlayingSfxId(null);
    });

    audio.onended = () => {
      setPlayingSfxId(null);
      if (!isNative) URL.revokeObjectURL(url);
    };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size and count
    if (storageUsage.count >= MAX_FILE_COUNT) {
      toast.error(`Limite atingido! Você pode ter no máximo ${MAX_FILE_COUNT} arquivos.`);
      return;
    }
    if (storageUsage.totalBytes + file.size > MAX_STORAGE_BYTES) {
      toast.error("Limite atingido! O upload ultrapassará a cota máxima de 200MB.");
      return;
    }

    const validTypes = ["audio/mp3", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/x-png"];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["mp3", "wav", "ogg"].includes(ext || "")) {
      toast.error("Formato inválido! Envie apenas arquivos .mp3, .wav ou .ogg");
      return;
    }

    setUploading(true);
    try {
      // Decode duration
      const duration = await new Promise<number>((resolve) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
          resolve(audio.duration || 0);
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          resolve(0);
          URL.revokeObjectURL(url);
        };
      });

      const newSfx: UserSFX = {
        id: crypto.randomUUID(),
        name: file.name.substring(0, file.name.lastIndexOf(".")),
        duration,
        blob: file,
        createdAt: Date.now(),
      };

      await saveSFX(newSfx);
      toast.success("Áudio importado com sucesso!");
      await refreshSFXList();
    } catch (err) {
      console.error("Upload failed", err);
      toast.error("Erro ao salvar áudio.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Tem certeza que deseja excluir este áudio?")) return;
    try {
      await deleteSFX(id);
      toast.success("Áudio deletado!");
      await refreshSFXList();
      if (playingSfxId === id) {
        if (audioPreviewRef.current) audioPreviewRef.current.pause();
        setPlayingSfxId(null);
      }
    } catch (err) {
      console.error("Delete failed", err);
      toast.error("Erro ao excluir áudio.");
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = 2;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  const storagePercentage = (storageUsage.totalBytes / MAX_STORAGE_BYTES) * 100;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Music className="h-5 w-5 text-purple-400" />
            Biblioteca de SFX (Efeitos Sonoros)
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            Adicione sons de notificação, risadas ou uploads customizados às mensagens.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="native" className="mt-4">
          <TabsList className="bg-zinc-900 border border-zinc-800 w-full justify-start p-1 rounded-lg">
            <TabsTrigger value="native" className="text-xs font-semibold px-4">Sons Nativos</TabsTrigger>
            <TabsTrigger value="user" className="text-xs font-semibold px-4">Meus Sons ({userSfxs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="native" className="space-y-3 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-1">
              {NATIVE_SFX_PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  onClick={() => onSelect(preset.id)}
                  className="flex items-start justify-between p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/60 transition-all cursor-pointer group"
                >
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-zinc-200 group-hover:text-purple-400 transition-colors">
                      {preset.name}
                    </div>
                    <div className="text-[10px] text-zinc-400">{preset.desc}</div>
                    <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 mt-1">
                      {preset.duration}
                    </span>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 hover:bg-zinc-800 hover:text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      playPreview(preset.id, true);
                    }}
                  >
                    {playingSfxId === preset.id ? (
                      <Pause className="h-4 w-4 text-purple-400 animate-pulse" />
                    ) : (
                      <Play className="h-4 w-4 text-zinc-400" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="user" className="space-y-4 mt-4">
            {/* Upload Area */}
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/10 p-5 items-center justify-center">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".mp3,.wav,.ogg"
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                className="border-zinc-800 text-xs font-medium cursor-pointer"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Processando...
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5 mr-1.5" /> Fazer Upload de Som
                  </>
                )}
              </Button>
              <div className="text-[10px] text-zinc-400 text-center">
                Formatos: .mp3, .wav, .ogg (Max 200MB total)
              </div>
            </div>

            {/* Storage Progress */}
            <div className="space-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/20 p-4">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-zinc-400 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5 text-zinc-400" />
                  Uso do IndexedDB
                </span>
                <span className="font-semibold text-zinc-300">
                  {formatSize(storageUsage.totalBytes)} / 200 MB ({storageUsage.count}/50 sons)
                </span>
              </div>
              <Progress value={storagePercentage} className="h-1 bg-zinc-850" />
            </div>

            {/* User uploaded sounds list */}
            {userSfxs.length === 0 ? (
              <div className="text-center py-6 text-xs text-zinc-400">
                Nenhum som carregado ainda. Faça upload de arquivos acima!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-1">
                {userSfxs.map((sfx) => (
                  <div
                    key={sfx.id}
                    onClick={() => onSelect(sfx.id)}
                    className="flex items-center justify-between p-3 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/60 transition-all cursor-pointer group"
                  >
                    <div className="space-y-1 truncate pr-2">
                      <div className="text-xs font-bold text-zinc-200 truncate group-hover:text-purple-400 transition-colors">
                        {sfx.name}
                      </div>
                      <div className="text-[9px] text-zinc-400 flex items-center gap-2">
                        <span>{sfx.duration.toFixed(1)}s</span>
                        <span>•</span>
                        <span>{formatSize(sfx.blob.size)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 hover:bg-zinc-800 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          playPreview(sfx.id, false);
                        }}
                      >
                        {playingSfxId === sfx.id ? (
                          <Pause className="h-4 w-4 text-purple-400 animate-pulse" />
                        ) : (
                          <Play className="h-4 w-4 text-zinc-400" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 hover:bg-red-950/20 hover:text-red-400"
                        onClick={(e) => handleDelete(sfx.id, e)}
                      >
                        <Trash2 className="h-4 w-4 text-zinc-400 group-hover:text-red-400" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
