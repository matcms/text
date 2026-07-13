import React, { createContext, useContext, useState, useRef, useEffect } from "react";
import { MessageEdit, processAudio, getAudioDuration } from "@/lib/audio-processor";
import { getSFX } from "@/lib/sfx-storage";
import { StoredProject } from "@/lib/projects-db";

export interface GlobalEdits {
  delay: number; // global delay between messages in ms
  speed: number; // global voice speed (0.5 to 2.0)
  volume: number; // global voice volume (0 to 1.5)
  trimStart?: number; // global trim start of entire video in seconds
  trimEnd?: number; // global trim end of entire video in seconds
}

export interface ProcessedAudio {
  audioUrl: string;
  duration: number; // seconds
  originalUrl: string;
}

interface EditorContextProps {
  edits: Record<string, MessageEdit>;
  globalEdits: GlobalEdits;
  processedAudios: Record<string, ProcessedAudio>;
  processingStatus: Record<string, boolean>;
  selectedMsgKey: string | null;
  setSelectedMsgKey: (key: string | null) => void;
  updateMessageEdit: (chatId: string, msgId: number, originalAudioUrl: string | null, patch: Partial<MessageEdit>) => void;
  updateGlobalEdits: (patch: Partial<GlobalEdits>) => void;
  triggerAudioProcessing: (chatId: string, msgId: number, originalAudioUrl: string) => Promise<void>;
  resetEdits: () => void;
  getEffectiveDuration: (chatId: string, msg: any) => number;
  videoDurations: Record<string, number>;
  setVideoDuration: (url: string, duration: number) => void;
  loadProjectEdits: (project: StoredProject) => void;
  audioDurations: Record<string, number>;
  cacheAudioDuration: (url: string) => void;
}

const EditorContext = createContext<EditorContextProps | undefined>(undefined);

export const useEditor = () => {
  const context = useContext(EditorContext);
  if (!context) throw new Error("useEditor must be used within an EditorProvider");
  return context;
};

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [edits, setEdits] = useState<Record<string, MessageEdit>>({});
  const [globalEdits, setGlobalEdits] = useState<GlobalEdits>({
    delay: 0,
    speed: 1.0,
    volume: 1.0,
  });
  const [processedAudios, setProcessedAudios] = useState<Record<string, ProcessedAudio>>({});
  const [processingStatus, setProcessingStatus] = useState<Record<string, boolean>>({});
  const [selectedMsgKey, setSelectedMsgKey] = useState<string | null>(null);
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
  const audioDurationFetching = useRef<Record<string, boolean>>({});

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const editsRef = useRef(edits);
  editsRef.current = edits;

  const setVideoDuration = (url: string, duration: number) => {
    setVideoDurations((prev) => ({ ...prev, [url]: duration }));
  };

  const cacheAudioDuration = (url: string) => {
    if (!url || audioDurations[url] || audioDurationFetching.current[url]) return;
    audioDurationFetching.current[url] = true;
    getAudioDuration(url).then((d) => {
      if (d && d > 0) {
        setAudioDurations((prev) => ({ ...prev, [url]: d }));
      }
      audioDurationFetching.current[url] = false;
    }).catch(() => {
      audioDurationFetching.current[url] = false;
    });
  };

  const resetEdits = () => {
    setEdits({});
    setGlobalEdits({ delay: 0, speed: 1.0, volume: 1.0 });
    setProcessedAudios({});
    setProcessingStatus({});
    setSelectedMsgKey(null);
  };

  const loadProjectEdits = (project: any) => {
    if (project.edits) setEdits(project.edits);
    if (project.globalEdits) setGlobalEdits(project.globalEdits);
    if (project.processedAudioDurations) {
      const mockProcessed: Record<string, ProcessedAudio> = {};
      Object.entries(project.processedAudioDurations).forEach(([key, duration]) => {
        mockProcessed[key] = {
          audioUrl: "", // mock URL
          duration: duration as number,
          originalUrl: "",
        };
      });
      setProcessedAudios(mockProcessed);
    }
  };

  // Helper to fetch SFX blob (either native or from IndexedDB)
  const getSfxBlobHelper = async (sfxId: string): Promise<Blob | null> => {
    try {
      // 1. Try IndexedDB
      const sfx = await getSFX(sfxId);
      if (sfx) return sfx.blob;
      return null;
    } catch {
      return null;
    }
  };

  const triggerAudioProcessing = async (chatId: string, msgId: number, originalAudioUrl: string) => {
    const key = `${chatId}_${msgId}`;
    const edit = editsRef.current[key] || {};

    setProcessingStatus((prev) => ({ ...prev, [key]: true }));

    try {
      const result = await processAudio(originalAudioUrl, edit, getSfxBlobHelper);
      setProcessedAudios((prev) => ({
        ...prev,
        [key]: {
          audioUrl: result.audioUrl,
          duration: result.duration,
          originalUrl: originalAudioUrl,
        },
      }));
    } catch (err) {
      console.error(`Failed to process audio for ${key}:`, err);
    } finally {
      setProcessingStatus((prev) => ({ ...prev, [key]: false }));
    }
  };

  const updateMessageEdit = (
    chatId: string,
    msgId: number,
    originalAudioUrl: string | null,
    patch: Partial<MessageEdit>
  ) => {
    const key = `${chatId}_${msgId}`;
    setEdits((prev) => {
      const current = prev[key] || {};
      const updated = { ...current, ...patch };
      
      // If sfx is null, clean it up
      if (patch.hasOwnProperty("sfx") && patch.sfx === null) {
        delete updated.sfx;
      }
      
      return { ...prev, [key]: updated };
    });

    // If there is an original audio, debounce the FFmpeg processing
    if (originalAudioUrl) {
      if (debounceTimers.current[key]) {
        clearTimeout(debounceTimers.current[key]);
      }

      debounceTimers.current[key] = setTimeout(() => {
        triggerAudioProcessing(chatId, msgId, originalAudioUrl);
      }, 300); // 300ms debounce
    }
  };

  const updateGlobalEdits = (patch: Partial<GlobalEdits>) => {
    setGlobalEdits((prev) => ({ ...prev, ...patch }));
  };

  // Calculates the actual visible duration of a message bar in the timeline
  const getEffectiveDuration = (chatId: string, msg: any): number => {
    const key = `${chatId}_${msg.id}`;
    const edit = edits[key] || {};
    
    // Base timing
    let duration = 2.0; // Default for images or empty messages
    
    if (msg.type === "text") {
      const processed = processedAudios[key];
      if (processed) {
        duration = processed.duration;
      } else if (msg.audioUrl) {
        const speed = edit.speed !== undefined ? edit.speed : globalEdits.speed;
        // Use real cached duration if available
        const cachedDur = audioDurations[msg.audioUrl];
        if (cachedDur && cachedDur > 0) {
          duration = cachedDur / (speed || 1.0);
        } else {
          // Trigger async cache fetch if not yet fetched
          cacheAudioDuration(msg.audioUrl);
          duration = 2.5 / (speed || 1.0); // Temporary fallback until cache populates
        }
      }
    } else if (msg.type === "video") {
      duration = videoDurations[msg.videoUrl] || 3.0;
    }

    // Apply delay offset
    const delay = edit.delay !== undefined ? edit.delay : globalEdits.delay;
    return Math.max(0.1, duration + delay / 1000);
  };

  // Auto-cleanup object URLs when component unmounts
  useEffect(() => {
    return () => {
      Object.values(processedAudios).forEach((a) => {
        try {
          URL.revokeObjectURL(a.audioUrl);
        } catch {}
      });
    };
  }, [processedAudios]);

  return (
    <EditorContext.Provider
      value={{
        edits,
        globalEdits,
        processedAudios,
        processingStatus,
        selectedMsgKey,
        setSelectedMsgKey,
        updateMessageEdit,
        updateGlobalEdits,
        triggerAudioProcessing,
        resetEdits,
        getEffectiveDuration,
        videoDurations,
        setVideoDuration,
        loadProjectEdits,
        audioDurations,
        cacheAudioDuration,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
};
