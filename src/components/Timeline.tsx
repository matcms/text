import React, { useRef, useState, useEffect, useMemo } from "react";
import { useEditor } from "@/hooks/useEditorState";
import { Button } from "@/components/ui/button";
import {
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  Music,
  Scissors,
  Timer,
  Zap,
} from "lucide-react";

interface TimelineProps {
  messages: any[];
  chatId: string;
  currentTime: number;
  onTimeChange: (time: number) => void;
  isPlaying: boolean;
  onPlayPause: () => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  messages,
  chatId,
  currentTime,
  onTimeChange,
  isPlaying,
  onPlayPause,
}) => {
  const { getEffectiveDuration, edits, selectedMsgKey, setSelectedMsgKey } = useEditor();

  const [zoom, setZoom] = useState(80);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);

  const segments = useMemo(() => {
    let acc = 0;
    return messages.map((msg) => {
      const duration = getEffectiveDuration(chatId, msg);
      const start = acc;
      const end = acc + duration;
      acc = end;
      const key = `${chatId}_${msg.id}`;
      const edit = edits[key] || {};
      return {
        msg,
        key,
        start,
        end,
        duration,
        hasSfx: !!edit.sfx,
        hasTrim: edit.trimStart !== undefined || edit.trimEnd !== undefined,
        hasSpeed: edit.speed !== undefined && edit.speed !== 1.0,
        hasDelay: (edit.delay !== undefined && edit.delay > 0),
      };
    });
  }, [messages, chatId, edits, getEffectiveDuration]);

  const totalDuration = useMemo(() =>
    segments.length === 0 ? 0 : segments[segments.length - 1].end,
    [segments]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePlayhead(e);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    updatePlayhead(e);
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const updatePlayhead = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const time = Math.max(0, Math.min(totalDuration, x / zoom));
    onTimeChange(time);
  };

  const handleZoomIn = () => setZoom((z) => Math.min(300, z + 20));
  const handleZoomOut = () => setZoom((z) => Math.max(30, z - 20));

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) handleZoomIn();
      else handleZoomOut();
    }
  };

  const rulerMarks = useMemo(() => {
    const marks: number[] = [];
    const step = totalDuration > 60 ? 5 : 1;
    for (let i = 0; i <= totalDuration + 1; i += step) marks.push(i);
    return marks;
  }, [totalDuration]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1);
    return m > 0 ? `${m}:${sec.padStart(4, "0")}` : `${sec}s`;
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden select-none">
      {/* Controls bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/60">
        <div className="flex items-center gap-3">
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700"
            onClick={onPlayPause}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-300 bg-zinc-950/60 px-3 py-1.5 rounded-lg border border-zinc-800">
            <span className="text-purple-400 font-bold">{formatTime(currentTime)}</span>
            <span className="text-zinc-600">/</span>
            <span className="text-zinc-400">{formatTime(totalDuration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-1 text-zinc-400">
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg hover:bg-zinc-800" onClick={handleZoomOut}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-[10px] text-zinc-500 w-16 text-center font-mono">{zoom}px/s</span>
          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg hover:bg-zinc-800" onClick={handleZoomIn}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <span className="text-[9px] text-zinc-600 ml-1 hidden sm:inline">Ctrl+Scroll</span>
        </div>
      </div>

      {/* Tip: if nothing selected */}
      {!selectedMsgKey && (
        <div className="px-4 py-2 bg-zinc-900/20 border-b border-zinc-800/40">
          <span className="text-[10px] text-zinc-500">
            💡 Clique em um bloco para editar delay, velocidade, volume e SFX
          </span>
        </div>
      )}

      {/* Timeline body */}
      <div
        ref={timelineRef}
        onWheel={handleWheel}
        className="relative overflow-x-auto overflow-y-hidden bg-zinc-950/50"
        style={{ height: 148 }}
      >
        <div className="relative" style={{ width: `${Math.max(500, totalDuration * zoom + 80)}px`, height: "100%" }}>
          {/* Ruler */}
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="h-7 border-b border-zinc-800 bg-zinc-900/60 relative cursor-ew-resize"
          >
            {rulerMarks.map((sec) => (
              <div key={sec} className="absolute top-0 bottom-0 border-l border-zinc-800/50" style={{ left: `${sec * zoom}px` }}>
                <span className="absolute top-1 left-1 text-[8px] font-mono text-zinc-600">{sec}s</span>
              </div>
            ))}
            {/* Playhead indicator on ruler */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500/80 pointer-events-none"
              style={{ left: `${currentTime * zoom}px` }}
            />
          </div>

          {/* Blocks track */}
          <div className="relative" style={{ height: "116px", paddingTop: "10px", paddingBottom: "10px" }}>
            {segments.map((seg, idx) => {
              const isSelected = selectedMsgKey === seg.key;
              const left = seg.start * zoom;
              const width = Math.max(2, seg.duration * zoom);
              const isShort = width < 60;

              const getSenderName = (msg: any, index: number) => {
                let name = msg.displayName || msg.voiceName || "";
                if (name) return name;
                for (let i = index - 1; i >= 0; i--) {
                  const p = messages[i];
                  if (p.side === msg.side && p.type === "text") {
                    return p.displayName || p.voiceName || "";
                  }
                }
                if (msg.side === "1") return "Contato";
                if (msg.side === "2") return "Você";
                return "Sistema";
              };

              return (
                <div
                  key={seg.key}
                  onClick={() => setSelectedMsgKey(isSelected ? null : seg.key)}
                  className={`absolute rounded-xl border cursor-pointer transition-all duration-150 flex flex-col justify-between overflow-hidden ${
                    isSelected
                      ? "bg-gradient-to-b from-purple-600/40 to-purple-800/20 border-purple-500 shadow-lg shadow-purple-600/20 ring-1 ring-purple-500/40"
                      : "bg-zinc-900/70 border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/80"
                  }`}
                  style={{ left, width, top: 0, bottom: 0 }}
                >
                  {!isShort && (
                    <div className="flex justify-between items-start gap-0.5 px-2 pt-2">
                      <span className={`text-[10px] font-bold truncate ${isSelected ? "text-purple-200" : "text-zinc-300"}`}>
                        {getSenderName(seg.msg, idx)}
                      </span>
                      <span className="text-[9px] font-mono text-zinc-500 shrink-0 bg-zinc-950/50 px-1 rounded">
                        {Math.round(seg.duration * 10) / 10}s
                      </span>
                    </div>
                  )}

                  {!isShort && (
                    <div className="px-2 pb-0.5">
                      <span className={`text-[9px] truncate block ${isSelected ? "text-purple-300/80" : "text-zinc-500"}`}>
                        {seg.msg.text || "[Mídia]"}
                      </span>
                    </div>
                  )}

                  {/* Edit badges */}
                  <div className="flex items-center gap-1 px-2 pb-2 flex-wrap">
                    {seg.hasSfx && (
                      <span className="flex items-center gap-0.5 text-[8px] bg-purple-500/25 text-purple-300 border border-purple-500/30 px-1 py-0.5 rounded-md">
                        <Music className="h-2 w-2" />{!isShort && " SFX"}
                      </span>
                    )}
                    {seg.hasTrim && (
                      <span className="flex items-center gap-0.5 text-[8px] bg-rose-500/25 text-rose-300 border border-rose-500/30 px-1 py-0.5 rounded-md">
                        <Scissors className="h-2 w-2" />{!isShort && " Trim"}
                      </span>
                    )}
                    {seg.hasSpeed && (
                      <span className="flex items-center gap-0.5 text-[8px] bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 px-1 py-0.5 rounded-md">
                        <Zap className="h-2 w-2" />{!isShort && ` ${edits[seg.key]?.speed?.toFixed(1)}x`}
                      </span>
                    )}
                    {seg.hasDelay && (
                      <span className="flex items-center gap-0.5 text-[8px] bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 px-1 py-0.5 rounded-md">
                        <Timer className="h-2 w-2" />{!isShort && ` +${edits[seg.key]?.delay}ms`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Playhead */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none"
            style={{ left: `${currentTime * zoom}px` }}
          >
            <div className="w-3 h-3 bg-red-500 rounded-full -ml-[5px] -mt-[2px] border border-white/20 shadow-md shadow-red-500/50" />
          </div>
        </div>
      </div>
    </div>
  );
};
