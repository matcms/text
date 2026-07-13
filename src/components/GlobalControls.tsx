import React from "react";
import { useEditor } from "@/hooks/useEditorState";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Zap, Volume2 } from "lucide-react";
import { toast } from "sonner";

export const GlobalControls: React.FC<{
  messages: any[];
  chatId: string;
}> = ({ messages, chatId }) => {
  const { globalEdits, updateGlobalEdits, updateMessageEdit } = useEditor();

  const handleApplySpeedToAll = () => {
    messages.forEach((msg) => {
      if (msg.type === "text" && msg.audioUrl) {
        updateMessageEdit(chatId, msg.id, msg.audioUrl, { speed: globalEdits.speed });
      }
    });
    toast.success(`Velocidade ${globalEdits.speed.toFixed(2)}x aplicada a todas!`);
  };

  const handleApplyVolumeToAll = () => {
    messages.forEach((msg) => {
      if (msg.type === "text" && msg.audioUrl) {
        updateMessageEdit(chatId, msg.id, msg.audioUrl, { volume: globalEdits.volume });
      }
    });
    toast.success(`Volume ${Math.round(globalEdits.volume * 100)}% aplicado a todas!`);
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-zinc-800/60 bg-zinc-900/60">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Configurações Globais (aplicam a todas as mensagens)
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-zinc-800">
        {/* Velocidade Global */}
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                <Zap className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <span className="text-xs font-semibold text-zinc-200">Velocidade da Voz</span>
            </div>
            <span className="text-sm font-bold text-emerald-400 font-mono">{globalEdits.speed.toFixed(2)}x</span>
          </div>
          <Slider
            min={0.5} max={2.0} step={0.05}
            value={[globalEdits.speed]}
            onValueChange={(val) => updateGlobalEdits({ speed: val[0] })}
            className="py-1"
          />
          <div className="flex justify-between items-center">
            <div className="flex gap-1">
              {[0.75, 1.0, 1.25, 1.5].map(v => (
                <button key={v}
                  onClick={() => updateGlobalEdits({ speed: v })}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-all ${Math.abs(globalEdits.speed - v) < 0.01 ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"}`}>
                  {v}x
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost"
              className="h-5 px-2 text-[9px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-md"
              onClick={handleApplySpeedToAll}>
              Aplicar a todas
            </Button>
          </div>
        </div>

        {/* Volume Global */}
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                <Volume2 className="h-3.5 w-3.5 text-amber-400" />
              </div>
              <span className="text-xs font-semibold text-zinc-200">Volume Global</span>
            </div>
            <span className="text-sm font-bold text-amber-400 font-mono">{Math.round(globalEdits.volume * 100)}%</span>
          </div>
          <Slider
            min={0.0} max={1.5} step={0.05}
            value={[globalEdits.volume]}
            onValueChange={(val) => updateGlobalEdits({ volume: val[0] })}
            className="py-1"
          />
          <div className="flex justify-between items-center">
            <div className="flex gap-1">
              {[0.5, 1.0, 1.25, 1.5].map(v => (
                <button key={v}
                  onClick={() => updateGlobalEdits({ volume: v })}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-all ${Math.abs(globalEdits.volume - v) < 0.01 ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"}`}>
                  {Math.round(v * 100)}%
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost"
              className="h-5 px-2 text-[9px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-md"
              onClick={handleApplyVolumeToAll}>
              Aplicar a todas
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
