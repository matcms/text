import React, { useEffect, useState } from "react";
import { useEditor } from "@/hooks/useEditorState";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SFXLibrary } from "./SFXLibrary";
import {
  Timer,
  Zap,
  Volume2,
  Scissors,
  Music,
  Trash2,
  Play,
  Pause,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { getAudioDuration } from "@/lib/audio-processor";

interface MessageEditPanelProps {
  chatId: string;
  msg: any;
  onClose: () => void;
  onUploadImage?: (file: File) => void;
  onUploadVideo?: (file: File) => void;
  chatMessages?: any[];
  contactName?: string;
}

function SectionCard({
  icon,
  label,
  color,
  badge,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-zinc-900/60 hover:bg-zinc-900 transition-colors group"
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-6 h-6 rounded-lg ${color} flex items-center justify-center`}>
            {icon}
          </div>
          <span className="text-xs font-semibold text-zinc-200">{label}</span>
          {badge && (
            <span className="text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded-md font-mono">
              {badge}
            </span>
          )}
        </div>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
        )}
      </button>
      {open && <div className="px-4 py-4 space-y-3 bg-zinc-950/40">{children}</div>}
    </div>
  );
}

export const MessageEditPanel: React.FC<MessageEditPanelProps> = ({
  chatId,
  msg,
  onClose,
  onUploadImage,
  onUploadVideo,
  chatMessages,
  contactName,
}) => {
  const key = `${chatId}_${msg.id}`;
  const { edits, updateMessageEdit, processingStatus, processedAudios } = useEditor();

  const edit = edits[key] || {};
  const [originalDuration, setOriginalDuration] = useState(0);
  const [sfxModalOpen, setSfxModalOpen] = useState(false);
  const [playingSfx, setPlayingSfx] = useState(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (msg.type === "text" && msg.audioUrl) {
      getAudioDuration(msg.audioUrl).then((d) => setOriginalDuration(d || 3.0));
    }
  }, [msg.audioUrl, msg.type]);

  useEffect(() => {
    return () => { if (audioRef) audioRef.pause(); };
  }, [audioRef]);

  const msgDelay = edit.delay !== undefined ? edit.delay : 0;
  const msgSpeed = edit.speed !== undefined ? edit.speed : 1.0;
  const msgVolume = edit.volume !== undefined ? edit.volume : 1.0;
  const msgTrimStart = edit.trimStart !== undefined ? edit.trimStart : 0;
  const msgTrimEnd = edit.trimEnd !== undefined ? edit.trimEnd : originalDuration;

  const isProcessing = processingStatus[key] || false;
  const hasProcessedAudio = !!processedAudios[key];

  const handlePlayProcessed = () => {
    if (playingSfx) {
      if (audioRef) audioRef.pause();
      setPlayingSfx(false);
      return;
    }
    const audioUrl = processedAudios[key]?.audioUrl || msg.audioUrl;
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    setAudioRef(audio);
    setPlayingSfx(true);
    audio.play().catch(() => setPlayingSfx(false));
    audio.onended = () => setPlayingSfx(false);
  };

  const handleSelectSFX = (sfxId: string) => {
    updateMessageEdit(chatId, msg.id, msg.audioUrl || null, {
      sfx: { sfxId, volume: 0.8, delay: 0, loop: false },
    });
    setSfxModalOpen(false);
    toast.success("Efeito sonoro adicionado!");
  };

  const handleRemoveSFX = () => {
    updateMessageEdit(chatId, msg.id, msg.audioUrl || null, { sfx: null });
    toast.info("Efeito sonoro removido.");
  };

  const getSenderName = () => {
    let name = msg.displayName || msg.voiceName || "";
    if (name) return name;
    
    if (chatMessages) {
      const idx = chatMessages.findIndex((m: any) => m.id === msg.id);
      if (idx !== -1) {
        for (let i = idx - 1; i >= 0; i--) {
          const p = chatMessages[i];
          if (p.side === msg.side && p.type === "text") {
            return p.displayName || p.voiceName || "";
          }
        }
      }
    }
    
    if (msg.side === "1") return contactName || "Contato";
    if (msg.side === "2") return "Você";
    return "Sistema";
  };

  const hasAudio = msg.type === "text" && msg.audioUrl;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 border-l border-zinc-800 overflow-hidden">
      {/* Sticky Header */}
      <div className="flex items-start justify-between px-4 py-3.5 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-purple-400 mb-0.5">
            Edição do Balão
          </div>
          <div className="text-xs font-semibold text-zinc-200 truncate max-w-[220px]">
            {getSenderName()}
          </div>
          {msg.text && (
            <div className="text-[10px] text-zinc-500 truncate max-w-[220px] mt-0.5">
              "{msg.text.substring(0, 40)}{msg.text.length > 40 ? "…" : ""}"
            </div>
          )}
        </div>
        <Button
          variant="ghost" size="icon"
          onClick={onClose}
          className="h-7 w-7 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 shrink-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">

        {/* Image Preview & Upload */}
        {msg.type === "image" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 space-y-3">
            <span className="text-[10px] font-semibold text-zinc-350 block">Imagem do Balão</span>
            {msg.imageUrl ? (
              <div className="relative aspect-video rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
                <img src={msg.imageUrl} className="w-full h-full object-contain" alt="Preview" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center aspect-video rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 text-center p-4">
                <span className="text-zinc-500 text-xs">Sem imagem selecionada</span>
              </div>
            )}
            {onUploadImage && (
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUploadImage(file);
                  }}
                  className="hidden"
                  id="edit-panel-image-upload"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-zinc-800 text-xs font-semibold hover:bg-zinc-900"
                  onClick={() => document.getElementById("edit-panel-image-upload")?.click()}
                >
                  Alterar Imagem
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Video Preview & Upload */}
        {msg.type === "video" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 space-y-3">
            <span className="text-[10px] font-semibold text-zinc-350 block">Vídeo do Balão</span>
            {msg.videoUrl ? (
              <div className="relative aspect-video rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950">
                <video src={msg.videoUrl} className="w-full h-full object-contain" controls />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center aspect-video rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 text-center p-4">
                <span className="text-zinc-500 text-xs">Sem vídeo selecionado</span>
              </div>
            )}
            {onUploadVideo && (
              <div>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUploadVideo(file);
                  }}
                  className="hidden"
                  id="edit-panel-video-upload"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-zinc-800 text-xs font-semibold hover:bg-zinc-900"
                  onClick={() => document.getElementById("edit-panel-video-upload")?.click()}
                >
                  Alterar Vídeo
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Audio Preview */}
        {hasAudio && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold text-zinc-300">Preview do Áudio</div>
              <div className="text-[9px] text-zinc-500 mt-0.5">
                {isProcessing
                  ? "Processando edições…"
                  : hasProcessedAudio
                  ? "✓ Áudio com edições aplicadas"
                  : "Original (sem edições)"}
              </div>
            </div>
            <Button
              size="sm"
              variant={hasProcessedAudio ? "default" : "outline"}
              className="h-8 shrink-0 gap-1.5 text-xs rounded-lg border-zinc-700"
              disabled={isProcessing}
              onClick={handlePlayProcessed}
            >
              {isProcessing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : playingSfx ? (
                <><Pause className="h-3.5 w-3.5" /> Pausar</>
              ) : (
                <><Play className="h-3.5 w-3.5" /> Ouvir</>
              )}
            </Button>
          </div>
        )}

        {/* Pausa */}
        <SectionCard
          icon={<Timer className="h-3.5 w-3.5 text-indigo-400" />}
          color="bg-indigo-500/15 border border-indigo-500/20"
          label="Pausa após o Balão"
          badge={msgDelay > 0 ? `+${msgDelay}ms` : undefined}
          defaultOpen={true}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-400">Tempo de espera antes da próxima mensagem</span>
              <div className="flex items-center gap-1">
                <Input
                  type="number" min={0} max={3000}
                  value={msgDelay}
                  onChange={(e) => updateMessageEdit(chatId, msg.id, msg.audioUrl || null, { delay: Math.max(0, Number(e.target.value)) })}
                  className="w-14 h-7 text-center bg-zinc-900 border-zinc-700 text-xs font-mono rounded-lg px-1"
                />
                <span className="text-[10px] text-zinc-500 font-mono">ms</span>
              </div>
            </div>
            <Slider min={0} max={3000} step={50}
              value={[Math.max(0, msgDelay)]}
              onValueChange={(val) => updateMessageEdit(chatId, msg.id, msg.audioUrl || null, { delay: val[0] })}
            />
            <div className="flex gap-1.5">
              {[0, 500, 1000, 1500, 2000].map((v) => (
                <button key={v} onClick={() => updateMessageEdit(chatId, msg.id, msg.audioUrl || null, { delay: v })}
                  className={`flex-1 text-[9px] py-1 rounded-lg border transition-all ${msgDelay === v ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-300" : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"}`}>
                  {v === 0 ? "Sem pausa" : `${v}ms`}
                </button>
              ))}
            </div>
          </div>
        </SectionCard>

        {hasAudio && (
          <>
            {/* Velocidade */}
            <SectionCard
              icon={<Zap className="h-3.5 w-3.5 text-emerald-400" />}
              color="bg-emerald-500/15 border border-emerald-500/20"
              label="Velocidade da Voz"
              badge={msgSpeed !== 1.0 ? `${msgSpeed.toFixed(2)}x` : undefined}
              defaultOpen={true}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400">Velocidade de reprodução da fala</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono">{msgSpeed.toFixed(2)}x</span>
                </div>
                <Slider min={0.5} max={2.0} step={0.05}
                  value={[msgSpeed]}
                  onValueChange={(val) => updateMessageEdit(chatId, msg.id, msg.audioUrl, { speed: val[0] })}
                />
                <div className="flex gap-1.5">
                  {[0.75, 1.0, 1.25, 1.5, 2.0].map((v) => (
                    <button key={v} onClick={() => updateMessageEdit(chatId, msg.id, msg.audioUrl, { speed: v })}
                      className={`flex-1 text-[9px] py-1 rounded-lg border transition-all ${Math.abs(msgSpeed - v) < 0.01 ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"}`}>
                      {v}x
                    </button>
                  ))}
                </div>
              </div>
            </SectionCard>

            {/* Volume */}
            <SectionCard
              icon={<Volume2 className="h-3.5 w-3.5 text-amber-400" />}
              color="bg-amber-500/15 border border-amber-500/20"
              label="Volume do Balão"
              badge={msgVolume !== 1.0 ? `${Math.round(msgVolume * 100)}%` : undefined}
              defaultOpen={true}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400">Ganho de volume desta mensagem</span>
                  <span className="text-sm font-bold text-amber-400 font-mono">{Math.round(msgVolume * 100)}%</span>
                </div>
                <Slider min={0.0} max={1.5} step={0.05}
                  value={[msgVolume]}
                  onValueChange={(val) => updateMessageEdit(chatId, msg.id, msg.audioUrl, { volume: val[0] })}
                />
                <div className="flex gap-1.5">
                  {[0.5, 0.75, 1.0, 1.25, 1.5].map((v) => (
                    <button key={v} onClick={() => updateMessageEdit(chatId, msg.id, msg.audioUrl, { volume: v })}
                      className={`flex-1 text-[9px] py-1 rounded-lg border transition-all ${Math.abs(msgVolume - v) < 0.01 ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"}`}>
                      {Math.round(v * 100)}%
                    </button>
                  ))}
                </div>
              </div>
            </SectionCard>

            {/* Trim */}
            <SectionCard
              icon={<Scissors className="h-3.5 w-3.5 text-rose-400" />}
              color="bg-rose-500/15 border border-rose-500/20"
              label="Corte do Áudio"
              badge={(edit.trimStart !== undefined || edit.trimEnd !== undefined) ? "Ativo" : undefined}
              defaultOpen={false}
            >
              <div className="space-y-3">
                <div className="text-[9px] text-zinc-500">
                  Duração original: <span className="text-zinc-300 font-mono">{originalDuration.toFixed(2)}s</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-zinc-400 font-medium block">Início (seg)</label>
                    <Input
                      type="number" min={0} max={msgTrimEnd} step={0.1}
                      value={msgTrimStart.toFixed(1)}
                      onChange={(e) => updateMessageEdit(chatId, msg.id, msg.audioUrl, { trimStart: Math.max(0, Number(e.target.value)) })}
                      className="bg-zinc-900 border-zinc-700 text-xs h-9 text-center rounded-lg font-mono"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-zinc-400 font-medium block">Fim (seg)</label>
                    <Input
                      type="number" min={msgTrimStart} max={originalDuration} step={0.1}
                      value={msgTrimEnd.toFixed(1)}
                      onChange={(e) => updateMessageEdit(chatId, msg.id, msg.audioUrl, { trimEnd: Math.min(originalDuration, Number(e.target.value)) })}
                      className="bg-zinc-900 border-zinc-700 text-xs h-9 text-center rounded-lg font-mono"
                    />
                  </div>
                </div>
                {(edit.trimStart !== undefined || edit.trimEnd !== undefined) && (
                  <Button variant="ghost" size="sm"
                    className="w-full h-7 text-[10px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg"
                    onClick={() => updateMessageEdit(chatId, msg.id, msg.audioUrl, { trimStart: undefined, trimEnd: undefined })}>
                    <X className="h-3 w-3 mr-1" /> Remover corte
                  </Button>
                )}
              </div>
            </SectionCard>

            {/* SFX */}
            <SectionCard
              icon={<Music className="h-3.5 w-3.5 text-purple-400" />}
              color="bg-purple-500/15 border border-purple-500/20"
              label="Efeito Sonoro (SFX)"
              badge={edit.sfx ? edit.sfx.sfxId : undefined}
              defaultOpen={true}
            >
              {edit.sfx ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg bg-purple-500/10 border border-purple-500/20 px-3 py-2">
                    <div>
                      <div className="text-[9px] text-purple-400 uppercase tracking-wider">SFX Ativo</div>
                      <div className="text-xs font-bold text-zinc-200">{edit.sfx.sfxId}</div>
                    </div>
                    <Button size="icon" variant="ghost"
                      className="h-7 w-7 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                      onClick={handleRemoveSFX}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-400">Volume do SFX</span>
                      <span className="text-[10px] font-bold text-zinc-300 font-mono">{Math.round(edit.sfx.volume * 100)}%</span>
                    </div>
                    <Slider min={0} max={1} step={0.05}
                      value={[edit.sfx.volume]}
                      onValueChange={(val) => {
                        if (edit.sfx) updateMessageEdit(chatId, msg.id, msg.audioUrl, { sfx: { ...edit.sfx!, volume: val[0] } });
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-zinc-400">Delay do SFX</span>
                      <div className="flex items-center gap-1">
                        <Input type="number" value={edit.sfx.delay}
                          onChange={(e) => {
                            if (edit.sfx) updateMessageEdit(chatId, msg.id, msg.audioUrl, { sfx: { ...edit.sfx!, delay: Number(e.target.value) } });
                          }}
                          className="w-14 h-6 bg-zinc-900 border-zinc-700 text-[9px] text-center px-1 rounded-md font-mono"
                        />
                        <span className="text-[9px] text-zinc-500 font-mono">ms</span>
                      </div>
                    </div>
                    <Slider min={-1000} max={3000} step={50}
                      value={[edit.sfx.delay]}
                      onValueChange={(val) => {
                        if (edit.sfx) updateMessageEdit(chatId, msg.id, msg.audioUrl, { sfx: { ...edit.sfx!, delay: val[0] } });
                      }}
                    />
                  </div>

                  <div className="flex justify-between items-center rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2">
                    <span className="text-[10px] text-zinc-400">Repetir (Loop)</span>
                    <Switch
                      checked={edit.sfx.loop}
                      onCheckedChange={(checked) => {
                        if (edit.sfx) updateMessageEdit(chatId, msg.id, msg.audioUrl, { sfx: { ...edit.sfx!, loop: checked } });
                      }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setSfxModalOpen(true)}
                  className="w-full py-4 rounded-xl border-2 border-dashed border-zinc-700 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all group flex flex-col items-center gap-2"
                >
                  <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                    <Music className="h-4 w-4 text-purple-400" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-zinc-300 group-hover:text-purple-300 transition-colors">Adicionar Efeito Sonoro</div>
                    <div className="text-[9px] text-zinc-500 mt-0.5">Clique para abrir a biblioteca de SFX</div>
                  </div>
                </button>
              )}
            </SectionCard>
          </>
        )}

        {!hasAudio && msg.type !== "image" && msg.type !== "video" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-4 text-center">
            <div className="text-[10px] text-zinc-500">Esta mensagem não tem áudio gerado. Apenas a pausa está disponível.</div>
          </div>
        )}
      </div>

      <SFXLibrary open={sfxModalOpen} onClose={() => setSfxModalOpen(false)} onSelect={handleSelectSFX} />
    </div>
  );
};
