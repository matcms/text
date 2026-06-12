import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { toCanvas } from "html-to-image";
import { Muxer, ArrayBufferTarget } from "webm-muxer";
import { Progress } from "@/components/ui/progress";

const VideoBubble = ({
  src,
  recording,
  className,
  msgId,
  chatId,
}: {
  src: string;
  recording: boolean;
  className: string;
  msgId: number;
  chatId?: string;
}) => {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!src) return;
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.crossOrigin = "anonymous";
    // Seek to a visible frame (e.g., 0.1s)
    video.currentTime = 0.1;
    video.addEventListener("loadeddata", () => {
      setDimensions({
        width: video.videoWidth || 240,
        height: video.videoHeight || 180,
      });
      // Small delay to ensure the frame is decoded
      setTimeout(() => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 240;
          canvas.height = video.videoHeight || 180;
          canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
          setThumbnail(canvas.toDataURL("image/jpeg", 0.8));
        } catch (err) {
          console.warn("Failed to generate video thumbnail:", err);
        }
      }, 100);
    });
  }, [src]);

  if (recording) {
    const width = dimensions?.width || 240;
    const height = dimensions?.height || 180;
    const maxW = 240;
    const maxH = 180;
    let displayW = maxW;
    let displayH = maxH;
    if (width && height) {
      const ratio = width / height;
      if (ratio > maxW / maxH) {
        displayW = maxW;
        displayH = maxW / ratio;
      } else {
        displayH = maxH;
        displayW = maxH * ratio;
      }
    }

    return (
      <div
        className={`${className} video-export-placeholder`}
        data-video-src={src}
        data-msg-id={msgId}
        data-chat-id={chatId}
        style={{
          width: `${displayW}px`,
          height: `${displayH}px`,
          backgroundColor: "transparent",
        }}
      />
    );
  }

  return <video src={src} autoPlay muted={recording} playsInline className={className} />;
};

// Text inside (parens) is shown in the template but skipped in the TTS audio.
const renderCensored = (text: string) => {
  const parts = text.split(/(\([^)]*\))/g);
  return parts.map((p, i) => {
    const m = p.match(/^\(([^)]*)\)$/);
    if (m) {
      return (
        <span
          key={i}
          style={{ background: "#111", color: "#111", borderRadius: 4, padding: "0 4px", filter: "blur(0.5px)" }}
        >
          {m[1]}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
};
// Remove parenthesized segments entirely for TTS (and collapse extra whitespace).
const stripCensors = (text: string) =>
  text.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();

const getVideoDuration = (url: string): Promise<number> => {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.src = url;
    video.preload = "metadata";
    video.addEventListener("loadedmetadata", () => {
      resolve(video.duration || 3.0);
    });
    video.addEventListener("error", () => {
      resolve(3.0);
    });
    setTimeout(() => resolve(3.0), 3000);
  });
};

import {
  ChevronLeft,
  Video,
  Phone,
  Image as ImageIcon,
  Loader2,
  Play,
  Pause,
  Upload,
  Link2,
  ClipboardPaste,
  Plus,
  X,
  User,
  Users,
  Save,
  Trash2,
  FolderOpen,
  Volume2,
  SkipBack,
  SkipForward,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, RefreshCw } from "lucide-react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  saveProject,
  listProjects,
  deleteProject,
  urlToBlob,
  type StoredProject,
  type StoredChat,
  type StoredMsg,
} from "@/lib/projects-db";
import {
  saveBackground,
  listBackgrounds,
  deleteBackground,
  type StoredBackground,
} from "@/lib/backgrounds-db";

const DEFAULT_BACKGROUNDS: StoredBackground[] = [
  { id: "default-purple", type: "color", value: "#9333ea", createdAt: 0 },
  { id: "default-green", type: "color", value: "#16a34a", createdAt: 1 },
  { id: "default-orange", type: "color", value: "#ea580c", createdAt: 2 },
  { id: "default-black", type: "color", value: "#000000", createdAt: 3 },
];

type TextMsg = {
  id: number;
  side: string;
  type: "text";
  voiceName: string;
  displayName?: string;
  text: string;
  spokenText?: string;
  audioUrl: string | null;
};
type ImgMsg = {
  id: number;
  side: string;
  type: "image";
  text: string;
  imageUrl: string | null;
  voiceName?: string;
  displayName?: string;
};
type VideoMsg = {
  id: number;
  side: string;
  type: "video";
  text: string;
  videoUrl: string | null;
  videoType: "mp4" | "gif" | null;
  voiceName?: string;
  displayName?: string;
};
type Msg = TextMsg | ImgMsg | VideoMsg;

type Chat = {
  id: string;
  name: string;
  contactName: string;
  contactPhoto: string | null;
  headerTime: string;
  script: string;
  messages: Msg[];
  voiceMap: Record<string, string>;
  isGroupChat?: boolean;
  groupSubtitle?: string;
  nameColors?: Record<string, string>;
};

const NAME_COLOR_OPTIONS: { label: string; value: string }[] = [
  { label: "Padrão", value: "" },
  { label: "Roxo", value: "#a855f7" },
  { label: "Laranja", value: "#f97316" },
  { label: "Azul", value: "#53bdeb" },
  { label: "Vermelho", value: "#ef4444" },
  { label: "Rosa", value: "#ec4899" },
  { label: "Marrom", value: "#92400e" },
  { label: "Verde claro", value: "#4ade80" },
  { label: "Verde escuro", value: "#15803d" },
  { label: "Amarelo", value: "#facc15" },
];

type ChatTheme = "imessage" | "whatsapp";

const DEFAULT_SCRIPT = `- iMessage: Nate
1: Adam> Dude, we're seriously screwed.
1: Adam> Cancel the Christmas turkey.
1: img: police cruiser on the street
2: Chris> "Us" who, man?`;

const newChat = (i: number): Chat => ({
  id: `chat_${Date.now()}_${i}`,
  name: `Chat ${i}`,
  contactName: "Nate",
  contactPhoto: null,
  headerTime: "23",
  script: DEFAULT_SCRIPT,
  messages: [],
  voiceMap: {},
  isGroupChat: false,
  groupSubtitle: "tap here for group info",
  nameColors: {},
  characterPhotos: {},
});

// Convert base64 (mp3) to blob URL
const base64ToBlobUrl = (b64: string, mime = "audio/mpeg") => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
};

const startOmniVoiceServerFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const { exec } = await import("child_process");
    const cwd = process.cwd();
    const command = `start cmd.exe /k "cd /d ${cwd} && venv\\Scripts\\activate && python tts_server.py"`;
    
    return new Promise((resolve) => {
      exec(command, (error) => {
        if (error) {
          console.error("Erro ao iniciar o servidor OmniVoice:", error);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  });

export default function ChatStoryGenerator() {
  const [elevenKey, setElevenKey] = useState("");
  const [ttsProvider, setTtsProvider] = useState<"elevenlabs" | "omnivoice">("elevenlabs");
  const [omniVoiceUrl, setOmniVoiceUrl] = useState("http://localhost:8000");
  const [chatTheme, setChatTheme] = useState<ChatTheme>("imessage");
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);

  const [chats, setChats] = useState<Chat[]>([newChat(1)]);
  const [activeChatId, setActiveChatId] = useState<string>(chats[0].id);
  const activeChat = chats.find((c) => c.id === activeChatId)!;

  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [visibleMessages, setVisibleMessages] = useState<Msg[]>([]);
  const [playing, setPlaying] = useState(false);
  const [playingChatId, setPlayingChatId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Playback control bar state
  const [currentMsgIndex, setCurrentMsgIndex] = useState(0);
  const [totalMsgCount, setTotalMsgCount] = useState(0);
  const [playbackElapsed, setPlaybackElapsed] = useState(0);
  const stopRequestedRef = useRef(false);
  const seekTargetRef = useRef<number | null>(null);
  const playbackStartTimeRef = useRef(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseAccumulatorRef = useRef(0);

  
  const [messageDelay, setMessageDelay] = useState(0);
  const [isGroupChat, setIsGroupChat] = useState(false);

  // Voice library (persisted)
  type SavedVoice = { name: string; voiceId: string };
  const [savedVoices, setSavedVoices] = useState<SavedVoice[]>([]);
  const [newVoiceName, setNewVoiceName] = useState("");
  const [newVoiceId, setNewVoiceId] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("saved_voices");
      if (raw) setSavedVoices(JSON.parse(raw));
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    localStorage.setItem("saved_voices", JSON.stringify(savedVoices));
  }, [savedVoices]);

  const addSavedVoice = () => {
    const n = newVoiceName.trim();
    const v = newVoiceId.trim();
    if (!n || !v) return;
    setSavedVoices((p) => [...p.filter((x) => x.name !== n), { name: n, voiceId: v }]);
    setNewVoiceName("");
    setNewVoiceId("");
  };
  const removeSavedVoice = (name: string) => {
    setSavedVoices((p) => p.filter((x) => x.name !== name));
  };

  // ElevenLabs voices cache (name -> voice_id)
  const elevenVoicesRef = useRef<Record<string, string> | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatOuterRef = useRef<HTMLDivElement | null>(null);
  const chatInnerRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const phoneRef = previewRef;
  const recordingCtxRef = useRef<{
    audioCtx: AudioContext;
    dest: MediaStreamAudioDestinationNode;
  } | null>(null);
  const [recording, setRecording] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportScroll, setExportScroll] = useState(0);
  const [previewDragOffset, setPreviewDragOffset] = useState(0);
  const dragStateRef = useRef<{ startY: number; startOffset: number } | null>(null);
  const exportProgressRef = useRef<{ done: number; total: number } | null>(null);
  const [exportMeasurements, setExportMeasurements] = useState<Record<string, {height: number, margin: number}[]>>({});
  const [exportStartIndex, setExportStartIndex] = useState(0);

  // Projects (IndexedDB)
  const [projectName, setProjectName] = useState("");
  const [activeTab, setActiveTab] = useState<"editor" | "projects">("editor");
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [savingProject, setSavingProject] = useState(false);
  const [generatedAudios, setGeneratedAudios] = useState<{
    id: string;
    voiceName: string;
    text: string;
    audioUrl: string;
  }[]>([]);

  const refreshProjects = async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      console.error(e);
    }
  };
  useEffect(() => {
    refreshProjects();
  }, []);

  // Backgrounds
  const [backgrounds, setBackgrounds] = useState<StoredBackground[]>(DEFAULT_BACKGROUNDS);
  const [activeBackground, setActiveBackground] = useState<string>("#9333ea");
  const [newColor, setNewColor] = useState<string>("#ff0066");
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await listBackgrounds();
        setBackgrounds([...DEFAULT_BACKGROUNDS, ...stored]);
      } catch (e) {
        console.error("listBackgrounds failed", e);
      }
    })();
  }, []);

  const addColorBackground = async () => {
    const bg: StoredBackground = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: "color",
      value: newColor,
      createdAt: Date.now(),
    };
    try {
      await saveBackground(bg);
    } catch (e) {
      console.error(e);
    }
    setBackgrounds((p) => [...p, bg]);
    setActiveBackground(bg.value);
  };

  const addImageBackground = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      const bg: StoredBackground = {
        id: `i_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "image",
        value: dataUrl,
        createdAt: Date.now(),
      };
      try {
        await saveBackground(bg);
      } catch (e) {
        console.error(e);
      }
      setBackgrounds((p) => [...p, bg]);
      setActiveBackground(bg.value);
    };
    reader.readAsDataURL(file);
  };

  const removeBackground = async (bg: StoredBackground) => {
    if (bg.id.startsWith("default-")) return;
    try {
      await deleteBackground(bg.id);
    } catch (e) {
      console.error(e);
    }
    setBackgrounds((p) => p.filter((x) => x.id !== bg.id));
    if (activeBackground === bg.value) setActiveBackground("#9333ea");
  };

  const handleSaveProject = async () => {
    const name = projectName.trim();
    if (!name) {
      alert("Informe um nome para o projeto.");
      return;
    }
    setSavingProject(true);
    try {
      const storedChats: StoredChat[] = [];
      for (const c of chats) {
        const messages: StoredMsg[] = [];
        for (const m of c.messages) {
          if (m.type === "text") {
            messages.push({
              id: m.id,
              side: m.side,
              type: "text",
              voiceName: m.voiceName,
              text: m.text,
              audioBlob: await urlToBlob(m.audioUrl),
            });
          } else if (m.type === "video") {
            messages.push({
              id: m.id,
              side: m.side,
              type: "video",
              text: m.text,
              videoBlob: await urlToBlob(m.videoUrl),
              videoType: m.videoType,
            });
          } else {
            messages.push({
              id: m.id,
              side: m.side,
              type: "image",
              text: m.text,
              imageBlob: await urlToBlob(m.imageUrl),
            });
          }
        }
        storedChats.push({
          id: c.id,
          name: c.name,
          contactName: c.contactName,
          contactPhotoBlob: await urlToBlob(c.contactPhoto),
          headerTime: c.headerTime,
          script: c.script,
          messages,
          voiceMap: c.voiceMap,
          characterPhotos: c.characterPhotos || {},
        });
      }
      const audioLibrary = [];
      for (const item of generatedAudios) {
        audioLibrary.push({
          voiceName: item.voiceName,
          text: item.text,
          audioBlob: await urlToBlob(item.audioUrl),
        });
      }

      const project: StoredProject = {
        id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        projectName: name,
        theme: chatTheme,
        isGroupChat,
        messageDelay,
        chats: storedChats,
        createdAt: Date.now(),
        audioLibrary,
      };
      await saveProject(project);
      await refreshProjects();
      alert("Projeto salvo!");
    } catch (e) {
      console.error(e);
      alert("Falha ao salvar projeto: " + (e as Error).message);
    } finally {
      setSavingProject(false);
    }
  };

  const handleLoadProject = (p: StoredProject) => {
    const loadedChats: Chat[] = p.chats.map((c) => ({
      id: c.id,
      name: c.name,
      contactName: c.contactName,
      contactPhoto: c.contactPhotoBlob ? URL.createObjectURL(c.contactPhotoBlob) : null,
      headerTime: c.headerTime,
      script: c.script,
      voiceMap: c.voiceMap,
      characterPhotos: c.characterPhotos || {},
      messages: c.messages.map((m) => {
        if (m.type === "text") {
          return {
            id: m.id,
            side: m.side,
            type: "text",
            voiceName: m.voiceName,
            text: m.text,
            audioUrl: m.audioBlob ? URL.createObjectURL(m.audioBlob) : null,
          };
        } else if (m.type === "video") {
          return {
            id: m.id,
            side: m.side,
            type: "video",
            text: m.text,
            videoUrl: m.videoBlob ? URL.createObjectURL(m.videoBlob) : null,
            videoType: m.videoType,
          };
        } else {
          return {
            id: m.id,
            side: m.side,
            type: "image",
            text: m.text,
            imageUrl: m.imageBlob ? URL.createObjectURL(m.imageBlob) : null,
          };
        }
      }),
    }));
    setChats(loadedChats);
    setActiveChatId(loadedChats[0]?.id || "");
    setChatTheme(p.theme);
    setIsGroupChat(p.isGroupChat);
    setMessageDelay(p.messageDelay);
    setProjectName(p.projectName);

    // Extract audios from loaded project and set generatedAudios
    const initialAudios: { id: string; voiceName: string; text: string; audioUrl: string }[] = [];
    
    if (p.audioLibrary) {
      p.audioLibrary.forEach((item) => {
        if (item.audioBlob) {
          const url = URL.createObjectURL(item.audioBlob);
          initialAudios.push({
            id: `${item.voiceName}_${item.text}`,
            voiceName: item.voiceName,
            text: item.text,
            audioUrl: url,
          });
        }
      });
    }

    loadedChats.forEach((c) => {
      c.messages.forEach((m) => {
        if (m.type === "text" && m.audioUrl) {
          initialAudios.push({
            id: `${m.voiceName}_${m.text}`,
            voiceName: m.voiceName,
            text: m.text,
            audioUrl: m.audioUrl,
          });
        }
      });
    });
    const uniqueMap = new Map<string, typeof initialAudios[number]>();
    initialAudios.forEach((x) => uniqueMap.set(`${x.voiceName}_${x.text}`, x));
    setGeneratedAudios(Array.from(uniqueMap.values()));

    setVisibleMessages([]);
    setActiveTab("editor");
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm("Excluir este projeto?")) return;
    await deleteProject(id);
    await refreshProjects();
  };

  useEffect(() => {
    setElevenKey(localStorage.getItem("elevenlabs_api_key") || "");
    setChatTheme((localStorage.getItem("chat_theme") as ChatTheme) || "imessage");
    setTtsProvider((localStorage.getItem("tts_provider") as "elevenlabs" | "omnivoice") || "elevenlabs");
    setOmniVoiceUrl(localStorage.getItem("omnivoice_url") || "http://localhost:8000");
  }, []);
  useEffect(() => {
    localStorage.setItem("elevenlabs_api_key", elevenKey);
  }, [elevenKey]);
  useEffect(() => {
    localStorage.setItem("chat_theme", chatTheme);
  }, [chatTheme]);
  useEffect(() => {
    localStorage.setItem("tts_provider", ttsProvider);
  }, [ttsProvider]);
  useEffect(() => {
    localStorage.setItem("omnivoice_url", omniVoiceUrl);
  }, [omniVoiceUrl]);

  const updateActiveChat = (patch: Partial<Chat>) => {
    setChats((prev) => prev.map((c) => (c.id === activeChatId ? { ...c, ...patch } : c)));
  };
  const updateChatById = (id: string, patch: Partial<Chat>) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const imageMessages = useMemo(
    () => activeChat.messages.filter((m): m is ImgMsg => m.type === "image"),
    [activeChat.messages]
  );

  const videoMessages = useMemo(
    () => activeChat.messages.filter((m): m is VideoMsg => m.type === "video"),
    [activeChat.messages]
  );

  const uniqueCharacters = useMemo(() => {
    const characters = new Set<string>();
    activeChat.messages.forEach((m) => {
      if (m.type === "text") {
        const name = m.displayName || m.voiceName;
        if (name) characters.add(name);
      }
    });
    Object.keys(activeChat.voiceMap).forEach((name) => {
      characters.add(name);
    });
    return Array.from(characters);
  }, [activeChat.messages, activeChat.voiceMap]);

  const allAudiosReady = useMemo(() => {
    const all = chats.flatMap((c) => c.messages);
    const texts = all.filter((m) => m.type === "text") as TextMsg[];
    return texts.length > 0 && texts.every((m) => !!m.audioUrl);
  }, [chats]);

  const parseScript = () => {
    const lines = activeChat.script.split("\n").map((l) => l.trim()).filter(Boolean);

    type Seg = { theme: ChatTheme; contactName: string; lines: string[]; groupMode: boolean | null; headerLine?: string };
    const segs: Seg[] = [];
    let cur: Seg | null = null;
    let unnamedChatCount = 1;

    for (const line of lines) {
      // Check for separator
      if (/^---+\s*$/.test(line)) {
        cur = null;
        continue;
      }

      const headerMatch = line.match(
        /^-\s*(?:(Direct|Group)\s+)?(Header|iMessage|Whatsapp|WhatsApp)\s*:\s*(.+)$/i,
      );

      if (headerMatch) {
        const modeKw = headerMatch[1]?.toLowerCase();
        const kind = headerMatch[2].toLowerCase();
        const name = headerMatch[3].trim();
        const theme: ChatTheme =
          kind === "whatsapp" ? "whatsapp" : kind === "imessage" ? "imessage" : chatTheme;
        const groupMode: boolean | null =
          modeKw === "group" ? true : modeKw === "direct" ? false : null;
        
        cur = { theme, contactName: name, lines: [], groupMode, headerLine: line };
        segs.push(cur);
        continue;
      }

      if (!cur) {
        cur = {
          theme: chatTheme,
          contactName: `Chat ${unnamedChatCount++}`,
          lines: [],
          groupMode: null,
        };
        segs.push(cur);
      }
      cur.lines.push(line);
    }

    if (segs.length === 0) {
      updateActiveChat({ messages: [], voiceMap: {} });
      setVisibleMessages([]);
      return;
    }

    const allOldMessages = chats.flatMap((c) => c.messages || []);

    const buildMessages = (segLines: string[]): Msg[] => {
      const parsed: Msg[] = [];
      let id = 0;
      // Track the last speaker per side so image/video messages inherit the sender
      const lastSpeakerBySide: Record<string, { voiceName: string; displayName?: string }> = {};
      for (const line of segLines) {
        const imgMatch = line.match(/^(\d):\s*img:\s*(.*)$/);
        if (imgMatch) {
          const side = imgMatch[1];
          const text = imgMatch[2];
          const old = allOldMessages.find(
            (o) => o.type === "image" && o.side === side && o.text === text
          ) as ImgMsg | undefined;
          const speaker = lastSpeakerBySide[side];
          parsed.push({
            id: id++,
            side,
            type: "image",
            text,
            imageUrl: old ? old.imageUrl : null,
            voiceName: speaker?.voiceName,
            displayName: speaker?.displayName,
          });
          continue;
        }
        const videoMatch = line.match(/^(\d):\s*video:\s*(.*)$/);
        if (videoMatch) {
          const side = videoMatch[1];
          const text = videoMatch[2];
          const old = allOldMessages.find(
            (o) => o.type === "video" && o.side === side && o.text === text
          ) as VideoMsg | undefined;
          const speaker = lastSpeakerBySide[side];
          parsed.push({
            id: id++,
            side,
            type: "video",
            text,
            videoUrl: old ? old.videoUrl : null,
            videoType: old ? old.videoType : null,
            voiceName: speaker?.voiceName,
            displayName: speaker?.displayName,
          });
          continue;
        }
        const textMatch = line.match(/^(\d):\s*(.+?)>\s*(.*)$/);
        if (textMatch) {
          const side = textMatch[1];
          const raw = textMatch[3];
          const sepIdx = raw.indexOf("==");
          const displayText = sepIdx >= 0 ? raw.slice(0, sepIdx).trim() : raw;
          const spokenText = sepIdx >= 0 ? raw.slice(sepIdx + 2).trim() : undefined;
          const speaker = textMatch[2].trim();
          const dashIdx = speaker.indexOf("-");
          const voiceName = dashIdx >= 0 ? speaker.slice(0, dashIdx).trim() : speaker;
          const displayName = dashIdx >= 0 ? speaker.slice(dashIdx + 1).trim() : undefined;

          // Track speaker for this side
          lastSpeakerBySide[side] = { voiceName, displayName };

          // Look up old audio by side, speaker name and text
          const old = allOldMessages.find(
            (o) =>
              o.type === "text" &&
              o.side === side &&
              o.voiceName.toLowerCase() === voiceName.toLowerCase() &&
              (o.text.toLowerCase() === displayText.toLowerCase() ||
                (o.spokenText && o.spokenText.toLowerCase() === spokenText?.toLowerCase()))
          ) as TextMsg | undefined;

          parsed.push({
            id: id++,
            side,
            type: "text",
            voiceName,
            displayName,
            text: displayText,
            spokenText,
            audioUrl: old ? old.audioUrl : null,
          });
        }
      }
      return parsed;
    };

    setChatTheme(segs[0].theme);

    const newChats: Chat[] = segs.map((s, i) => {
      const messages = buildMessages(s.lines);
      const uniqueNames = Array.from(
        new Set(messages.filter((m): m is TextMsg => m.type === "text").map((m) => m.voiceName))
      );
      const baseMap = i === 0 ? activeChat.voiceMap : {};
      const voiceMap: Record<string, string> = {};
      for (const n of uniqueNames) voiceMap[n] = baseMap[n] || "";

      const resolvedGroup = s.groupMode ?? (i === 0 ? activeChat.isGroupChat ?? isGroupChat : false);

      const segmentScript = [s.headerLine, ...s.lines].filter(Boolean).join("\n");

      if (i === 0) {
        return {
          ...activeChat,
          name: s.contactName,
          contactName: s.contactName,
          messages,
          voiceMap,
          isGroupChat: resolvedGroup,
          script: segmentScript,
        };
      }
      return {
        id: `chat_${Date.now()}_${i}`,
        name: s.contactName,
        contactName: s.contactName,
        contactPhoto: null,
        headerTime: "23",
        script: segmentScript,
        messages,
        voiceMap,
        isGroupChat: resolvedGroup,
        characterPhotos: {},
      };
    });

    const activeIndex = chats.findIndex((c) => c.id === activeChatId);
    const updatedChatsList = [...chats];
    if (activeIndex >= 0) {
      updatedChatsList.splice(activeIndex, 1, ...newChats);
    } else {
      updatedChatsList.push(...newChats);
    }

    setChats(updatedChatsList);
    setActiveChatId(newChats[0].id);
    if (newChats[0].isGroupChat !== undefined) setIsGroupChat(!!newChats[0].isGroupChat);
    setVisibleMessages([]);
  };

  const setImageUrlFor = (id: number, url: string | null) => {
    updateActiveChat({
      messages: activeChat.messages.map((m) =>
        m.id === id && m.type === "image" ? { ...m, imageUrl: url } : m
      ),
    });
  };

  const onUploadImage = (id: number, file: File) => {
    setImageUrlFor(id, URL.createObjectURL(file));
  };

  const detectVideoType = (urlOrFile: string | File): "mp4" | "gif" | null => {
    if (typeof urlOrFile === "string") {
      const clean = urlOrFile.split("?")[0].split("#")[0].toLowerCase();
      if (clean.endsWith(".gif")) return "gif";
      if (clean.endsWith(".mp4") || clean.endsWith(".webm")) return "mp4";
      if (urlOrFile.startsWith("data:")) {
        if (urlOrFile.includes("image/gif")) return "gif";
        if (urlOrFile.includes("video/mp4") || urlOrFile.includes("video/webm")) return "mp4";
      }
      return "mp4";
    } else {
      const mime = urlOrFile.type;
      const name = urlOrFile.name.toLowerCase();
      if (mime.includes("gif") || name.endsWith(".gif")) return "gif";
      if (mime.includes("mp4") || mime.includes("webm") || name.endsWith(".mp4") || name.endsWith(".webm")) return "mp4";
      return "mp4";
    }
  };

  const setVideoUrlFor = (id: number, url: string | null) => {
    const videoType = url ? detectVideoType(url) : null;
    updateActiveChat({
      messages: activeChat.messages.map((m) =>
        m.id === id && m.type === "video" ? { ...m, videoUrl: url, videoType } : m
      ),
    });
  };

  const onUploadVideo = (id: number, file: File) => {
    const url = URL.createObjectURL(file);
    const videoType = detectVideoType(file);
    updateActiveChat({
      messages: activeChat.messages.map((m) =>
        m.id === id && m.type === "video" ? { ...m, videoUrl: url, videoType } : m
      ),
    });
  };

  const onUploadContactPhoto = (file: File) => {
    updateActiveChat({ contactPhoto: URL.createObjectURL(file) });
  };

  const pasteContactPhoto = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const imgType = it.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await it.getType(imgType);
          const file = new File([blob], "contact.png", { type: imgType });
          onUploadContactPhoto(file);
          return;
        }
      }
      const text = await navigator.clipboard.readText();
      if (text && /^https?:\/\//i.test(text.trim())) {
        updateActiveChat({ contactPhoto: text.trim() });
      }
    } catch {
      alert("Não foi possível ler o clipboard.");
    }
  };

  const pasteCharacterPhoto = async (name: string) => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const imgType = it.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await it.getType(imgType);
          const reader = new FileReader();
          reader.onload = () => {
            const b64 = String(reader.result || "");
            updateActiveChat({
              characterPhotos: {
                ...(activeChat.characterPhotos || {}),
                [name]: b64,
              },
            });
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
      const text = await navigator.clipboard.readText();
      if (text && /^https?:\/\//i.test(text.trim())) {
        updateActiveChat({
          characterPhotos: {
            ...(activeChat.characterPhotos || {}),
            [name]: text.trim(),
          },
        });
      }
    } catch {
      alert("Não foi possível ler o clipboard para o personagem.");
    }
  };

  // ---- TTS providers ----
  const fetchElevenVoices = async (): Promise<Record<string, string>> => {
    if (elevenVoicesRef.current) return elevenVoicesRef.current;
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": elevenKey },
    });
    if (!res.ok) throw new Error(`ElevenLabs voices: ${await res.text()}`);
    const json = await res.json();
    const map: Record<string, string> = {};
    for (const v of json.voices || []) {
      map[String(v.name).toLowerCase()] = v.voice_id;
      map[String(v.voice_id).toLowerCase()] = v.voice_id;
    }
    elevenVoicesRef.current = map;
    return map;
  };

  const ttsElevenLabs = async (text: string, voiceId: string): Promise<string> => {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
            use_speaker_boost: true,
            speed: Math.min(1.2, Math.max(0.7, voiceSpeed)),
          },
        }),
      }
    );
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  };

  const findReferenceAudio = async (
    voiceName: string,
    chatId: string,
    localMessagesMap?: Record<string, Msg[]>
  ): Promise<Blob | null> => {
    // 1. Search in the active/current chat messages
    const currentChatMessages = localMessagesMap
      ? localMessagesMap[chatId]
      : chats.find((c) => c.id === chatId)?.messages;

    if (currentChatMessages) {
      for (const msg of currentChatMessages) {
        if (
          msg.type === "text" &&
          msg.voiceName.toLowerCase() === voiceName.toLowerCase() &&
          msg.audioUrl
        ) {
          try {
            const res = await fetch(msg.audioUrl);
            if (res.ok) {
              const blob = await res.blob();
              // A valid audio blob should be larger than 1000 bytes (error JSONs are small)
              if (blob && blob.size > 1000) return blob;
            }
          } catch (err) {
            console.error("Erro ao carregar blob de áudio de referência do chat ativo:", err);
          }
        }
      }
    }

    // 2. Search in other chats if not found in current chat
    if (localMessagesMap) {
      for (const [cId, messages] of Object.entries(localMessagesMap)) {
        if (cId === chatId) continue;
        for (const msg of messages) {
          if (
            msg.type === "text" &&
            msg.voiceName.toLowerCase() === voiceName.toLowerCase() &&
            msg.audioUrl
          ) {
            try {
              const res = await fetch(msg.audioUrl);
              if (res.ok) {
                const blob = await res.blob();
                if (blob && blob.size > 1000) return blob;
              }
            } catch (err) {
              console.error("Erro ao carregar blob de áudio de referência de outro chat:", err);
            }
          }
        }
      }
    } else {
      for (const chat of chats) {
        if (chat.id === chatId) continue;
        for (const msg of chat.messages) {
          if (
            msg.type === "text" &&
            msg.voiceName.toLowerCase() === voiceName.toLowerCase() &&
            msg.audioUrl
          ) {
            try {
              const res = await fetch(msg.audioUrl);
              if (res.ok) {
                const blob = await res.blob();
                // A valid audio blob should be larger than 1000 bytes
                if (blob && blob.size > 1000) return blob;
              }
            } catch (err) {
              console.error("Erro ao carregar blob de áudio de referência de outro chat:", err);
            }
          }
        }
      }
    }

    return null;
  };

  const ttsOmniVoice = async (
    text: string,
    voiceName: string,
    chatId: string,
    localMessagesMap?: Record<string, Msg[]>
  ): Promise<string> => {
    let refBlob = await findReferenceAudio(voiceName, chatId, localMessagesMap);
    if (!refBlob) {
      if (!elevenKey) {
        throw new Error(
          `Nenhum áudio de referência encontrado no histórico para "${voiceName}". Insira sua API Key do ElevenLabs nas configurações para gerar o primeiro áudio de referência automaticamente.`
        );
      }
      const chat = chats.find((c) => c.id === chatId);
      let voiceId = (chat?.voiceMap[voiceName] || "").trim();
      if (!voiceId) {
        const sv = savedVoices.find(
          (v) => v.name.toLowerCase() === voiceName.toLowerCase()
        );
        if (sv) voiceId = sv.voiceId;
      }
      if (!voiceId) voiceId = voiceName.trim();
      if (!voiceId) {
        throw new Error(
          `Nenhum Voice ID encontrado para "${voiceName}". Defina o Voice ID do personagem nas configurações para que a referência possa ser gerada via ElevenLabs.`
        );
      }

      toast.info(`Gerando primeiro áudio de "${voiceName}" via ElevenLabs para servir de referência local...`, {
        duration: 5000,
      });

      const elevenUrl = await ttsElevenLabs(stripCensors(text), voiceId);
      return elevenUrl;
    }

    console.log("Enviando áudio de referência para OmniVoice:", {
      voiceName,
      size: refBlob.size,
      type: refBlob.type
    });

    const formData = new FormData();
    formData.append("text", text);
    formData.append("reference_audio", refBlob, "reference.mp3");

    const res = await fetch(`${omniVoiceUrl}/tts`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsedErr = errText;
      try {
        const json = JSON.parse(errText);
        if (json.error) parsedErr = json.error;
      } catch {}
      throw new Error(`OmniVoice: ${parsedErr}`);
    }

    const blob = await res.blob();
    return URL.createObjectURL(blob);
  };

  // Reusable single-message audio generator (resolves voice from chat voiceMap, savedVoices, or raw id)
  const generateSingleAudio = async (
    text: string,
    voiceIdentifier: string,
    chatId: string
  ): Promise<string> => {
    if (ttsProvider === "omnivoice") {
      return ttsOmniVoice(text, voiceIdentifier, chatId);
    }

    if (!elevenKey) throw new Error("API key do ElevenLabs ausente.");
    const chat = chats.find((c) => c.id === chatId);
    let voiceId = (chat?.voiceMap[voiceIdentifier] || "").trim();
    if (!voiceId) {
      const sv = savedVoices.find(
        (v) => v.name.toLowerCase() === voiceIdentifier.toLowerCase()
      );
      if (sv) voiceId = sv.voiceId;
    }
    if (!voiceId) voiceId = voiceIdentifier.trim();
    if (!voiceId) throw new Error(`Voice ID não encontrado para "${voiceIdentifier}".`);
    return ttsElevenLabs(stripCensors(text), voiceId);
  };

  const [regeneratingMsgId, setRegeneratingMsgId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const updateTextMessage = (msgId: number, patch: Partial<TextMsg>) => {
    updateActiveChat({
      messages: activeChat.messages.map((m) =>
        m.id === msgId && m.type === "text" ? { ...m, ...patch } : m
      ),
    });
  };

  const regenerateOneAudio = async (msgId: number) => {
    const msg = activeChat.messages.find((m) => m.id === msgId && m.type === "text") as
      | TextMsg
      | undefined;
    if (!msg) return;
    setRegeneratingMsgId(msgId);
    try {
      const url = await generateSingleAudio(
        msg.spokenText ?? msg.text,
        msg.voiceName,
        activeChat.id
      );
      updateTextMessage(msgId, { audioUrl: url });
      setGeneratedAudios((prev) => {
        const filtered = prev.filter(
          (x) =>
            !(
              x.voiceName.toLowerCase() === msg.voiceName.toLowerCase() &&
              x.text.toLowerCase() === msg.text.toLowerCase()
            )
        );
        return [
          ...filtered,
          {
            id: `${msg.voiceName}_${msg.text}`,
            voiceName: msg.voiceName,
            text: msg.text,
            audioUrl: url,
          },
        ];
      });
    } catch (e) {
      console.error(e);
      alert(`Falha ao regenerar áudio: ${(e as Error).message}`);
    } finally {
      setRegeneratingMsgId(null);
    }
  };

  const generateAudios = async (resumeOnly?: boolean) => {
    if (ttsProvider === "elevenlabs" && !elevenKey) {
      alert("Por favor, insira sua API key do ElevenLabs");
      return;
    }

    const allTexts = chats.flatMap((c) =>
      c.messages
        .filter((m) => {
          if (m.type !== "text") return false;
          if (resumeOnly && (m as TextMsg).audioUrl) return false;
          return true;
        })
        .map((m) => ({ chatId: c.id, msg: m as TextMsg }))
    );

    if (allTexts.length === 0) {
      if (resumeOnly) {
        alert("Todos os áudios já foram gerados!");
      } else {
        alert("Faça o parse do script primeiro.");
      }
      return;
    }

    setGenerating(true);
    setGenProgress({ done: 0, total: allTexts.length });

    let done = 0;
    const chatMessagesMap: Record<string, Msg[]> = {};
    chats.forEach((c) => (chatMessagesMap[c.id] = [...c.messages]));

    let accumulatedAudios = [...generatedAudios];

    for (const { chatId, msg } of allTexts) {
      const chat = chats.find((c) => c.id === chatId)!;
      const voiceId = (chat.voiceMap[msg.voiceName] || "").trim();
      if (ttsProvider === "elevenlabs" && !voiceId) {
        alert(`Defina o Voice ID para "${msg.voiceName}" no chat "${chat.name}".`);
        setGenerating(false);
        return;
      }
      try {
        let audioUrl: string;
        if (ttsProvider === "omnivoice") {
          audioUrl = await ttsOmniVoice(
            stripCensors(msg.spokenText ?? msg.text),
            msg.voiceName,
            chatId,
            chatMessagesMap
          );
        } else {
          audioUrl = await ttsElevenLabs(stripCensors(msg.spokenText ?? msg.text), voiceId);
        }

        const arr = chatMessagesMap[chatId];
        const idx = arr.findIndex((m) => m.id === msg.id && m.type === "text");
        if (idx >= 0) arr[idx] = { ...(arr[idx] as TextMsg), audioUrl };
        updateChatById(chatId, { messages: [...arr] });

        accumulatedAudios = [
          ...accumulatedAudios.filter(
            (x) =>
              !(
                x.voiceName.toLowerCase() === msg.voiceName.toLowerCase() &&
                x.text.toLowerCase() === msg.text.toLowerCase()
              )
          ),
          {
            id: `${msg.voiceName}_${msg.text}`,
            voiceName: msg.voiceName,
            text: msg.text,
            audioUrl,
          },
        ];
        setGeneratedAudios(accumulatedAudios);

      } catch (e) {
        console.error(e);
        alert(`Falha ao gerar áudio para "${msg.voiceName}": ${msg.text}\n${(e as Error).message}`);
        setGenerating(false);
        return;
      }
      done++;
      setGenProgress({ done, total: allTexts.length });
    }
    setGenerating(false);
  };

  const waitWhilePaused = async () => {
    while (pausedRef.current) {
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const waitInterruptible = async (ms: number) => {
    const start = Date.now();
    let elapsed = 0;
    while (elapsed < ms) {
      if (pausedRef.current) {
        const pauseStart = Date.now();
        await waitWhilePaused();
        // shift start so paused time doesn't count
        const pausedFor = Date.now() - pauseStart;
        // adjust by extending the deadline
        ms += pausedFor;
      }
      const remaining = ms - (Date.now() - start);
      await new Promise((r) => setTimeout(r, Math.min(100, remaining)));
      elapsed = Date.now() - start;
    }
  };

  const playAnimation = async (onFrameReady?: () => Promise<void>) => {
    // Compute total message count across all chats
    const totalMsgs = chats.reduce((sum, c) => sum + c.messages.length, 0);
    setTotalMsgCount(totalMsgs);
    setCurrentMsgIndex(0);
    setPlaybackElapsed(0);
    pauseAccumulatorRef.current = 0;
    stopRequestedRef.current = false;
    seekTargetRef.current = null;
    setPlaying(true);
    setPaused(false);
    pausedRef.current = false;
    playbackStartTimeRef.current = Date.now();

    // Start elapsed timer
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      if (!pausedRef.current) {
        const now = Date.now();
        setPlaybackElapsed(now - playbackStartTimeRef.current - pauseAccumulatorRef.current);
      }
    }, 200);

    const delayMs = Number(messageDelay) || 0;
    const scrollDown = () => {
      const el = chatScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    };
    let globalIdx = 0;
    for (let c = 0; c < chats.length; c++) {
      if (stopRequestedRef.current) break;
      const chat = chats[c];
      setPlayingChatId(chat.id);
      setActiveChatId(chat.id);
      setVisibleMessages([]);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (onFrameReady) await onFrameReady();
      const queue: Msg[] = [];
      for (let i = 0; i < chat.messages.length; i++) {
        if (stopRequestedRef.current) break;

        // Handle seek: if user clicked on progress bar to go to an earlier point
        const seekTarget = seekTargetRef.current;
        if (seekTarget !== null) {
          seekTargetRef.current = null;
          // If seek target is in a previous chat, restart from beginning
          // For simplicity, seeking only within current playback scope
          if (seekTarget < globalIdx) {
            // Rebuild queue up to seekTarget within current chat context
            let targetChatIdx = 0;
            let targetMsgIdx = 0;
            let acc = 0;
            for (let ci = 0; ci < chats.length; ci++) {
              if (acc + chats[ci].messages.length > seekTarget) {
                targetChatIdx = ci;
                targetMsgIdx = seekTarget - acc;
                break;
              }
              acc += chats[ci].messages.length;
            }
            // Jump to the target chat
            c = targetChatIdx;
            const targetChat = chats[c];
            setPlayingChatId(targetChat.id);
            setActiveChatId(targetChat.id);
            queue.length = 0;
            for (let j = 0; j <= targetMsgIdx; j++) {
              queue.push(targetChat.messages[j]);
            }
            setVisibleMessages([...queue]);
            globalIdx = seekTarget + 1;
            setCurrentMsgIndex(globalIdx);
            i = targetMsgIdx;
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            scrollDown();
            if (onFrameReady) await onFrameReady();
            continue;
          } else if (seekTarget > globalIdx) {
            // Fast-forward: skip to target
            while (globalIdx < seekTarget && i < chat.messages.length) {
              queue.push(chat.messages[i]);
              i++;
              globalIdx++;
            }
            setVisibleMessages([...queue]);
            setCurrentMsgIndex(globalIdx);
            i--; // will be incremented by for loop
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            scrollDown();
            if (onFrameReady) await onFrameReady();
            continue;
          }
        }

        await waitWhilePaused();
        if (stopRequestedRef.current) break;
        const msg = chat.messages[i];
        queue.push(msg);
        globalIdx++;
        setCurrentMsgIndex(globalIdx);
        setVisibleMessages([...queue]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        scrollDown();
        // Captura o frame ANTES de tocar o áudio
        if (onFrameReady) await onFrameReady();
        if (msg.type === "text" && msg.audioUrl) {
          const rec = recordingCtxRef.current;
          const audio = new Audio(msg.audioUrl);
          currentAudioRef.current = audio;
          if (rec) {
            try {
              const src = rec.audioCtx.createMediaElementSource(audio);
              src.connect(rec.dest);
              src.connect(rec.audioCtx.destination);
            } catch (err) {
              console.error("audio routing failed", err);
            }
          }
          await new Promise<void>((resolve) => {
            if (audio.readyState >= 1) resolve();
            else audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
          });
          audio.play().catch((err) => console.error("audio play failed", err));
          const durationMs = (audio.duration || 0) * 1000;
          const waitTime = Math.max(0, durationMs + delayMs);
          await waitInterruptible(waitTime);
          currentAudioRef.current = null;
        }
        if (msg.type === "image") {
          await waitInterruptible(2000);
        }
        if (msg.type === "video") {
          const durationSec = msg.videoUrl ? await getVideoDuration(msg.videoUrl) : 3.0;
          await waitInterruptible(durationSec * 1000);
        }
        if (exportProgressRef.current) {
          exportProgressRef.current.done += 1;
          const { done, total } = exportProgressRef.current;
          setExportProgress(total ? (done / total) * 100 : 0);
        }
      }
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    setPlayingChatId(null);
    setPlaying(false);
    setPaused(false);
    pausedRef.current = false;
  };

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (next) {
      // Record when we paused
      (togglePause as any)._pauseStart = Date.now();
    } else {
      // Accumulate paused duration
      const ps = (togglePause as any)._pauseStart;
      if (ps) pauseAccumulatorRef.current += Date.now() - ps;
      (togglePause as any)._pauseStart = null;
    }
    const audio = currentAudioRef.current;
    if (audio) {
      if (next) audio.pause();
      else audio.play().catch(() => {});
    }

    // Play/Pause DOM video elements in preview container
    const videos = previewRef.current?.querySelectorAll("video");
    if (videos) {
      videos.forEach((video) => {
        if (next) video.pause();
        else video.play().catch(() => {});
      });
    }
  };

  const stopPlayback = () => {
    stopRequestedRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    const audio = currentAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      currentAudioRef.current = null;
    }

    // Pause and reset DOM video elements in preview container
    const videos = previewRef.current?.querySelectorAll("video");
    if (videos) {
      videos.forEach((video) => {
        try {
          video.pause();
          video.currentTime = 0;
        } catch {}
      });
    }

    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  const seekTo = (targetIndex: number) => {
    seekTargetRef.current = Math.max(0, Math.min(targetIndex, totalMsgCount));
    // If paused, unpause so seek can process
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
    }
    // Stop current audio if playing
    const audio = currentAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      currentAudioRef.current = null;
    }
  };

  const skipBackward = () => {
    const target = Math.max(0, currentMsgIndex - 5);
    seekTo(target);
  };

  const skipForward = () => {
    const target = Math.min(totalMsgCount, currentMsgIndex + 5);
    seekTo(target);
  };

  const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const exportVideoFast = async (exportAll?: boolean) => {
    if (!previewRef.current) return;
    if (!allAudiosReady) {
      alert("Gere os áudios primeiro.");
      return;
    }

    const messages = exportAll
      ? chats.flatMap((c) => c.messages.map((m) => ({ ...m, chatId: c.id })))
      : displayChat.messages;
    if (messages.length === 0) return;

    if (typeof (window as any).VideoEncoder === "undefined" || typeof (window as any).AudioEncoder === "undefined") {
      alert("Seu navegador não suporta a exportação avançada. Use o Google Chrome no PC.");
      return;
    }

    const videoCache = new Map<string, HTMLVideoElement>();
    const isWA = chatTheme === "whatsapp";

    const getVideoElement = async (url: string): Promise<HTMLVideoElement> => {
      if (videoCache.has(url)) {
        return videoCache.get(url)!;
      }
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.crossOrigin = "anonymous";
      video.playsInline = true;
      videoCache.set(url, video);
      
      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          video.removeEventListener("loadedmetadata", onLoaded);
          video.removeEventListener("error", onError);
          resolve();
        };
        const onError = (e: any) => {
          video.removeEventListener("loadedmetadata", onLoaded);
          video.removeEventListener("error", onError);
          reject(new Error(`Failed to load video: ${url}`));
        };
        video.addEventListener("loadedmetadata", onLoaded);
        video.addEventListener("error", onError);
        
        if (video.readyState >= 1) {
          onLoaded();
        }
      });
      return video;
    };

    const seekVideo = async (video: HTMLVideoElement, time: number) => {
      const duration = video.duration || 1;
      // Seek at most to duration - 0.05 to freeze on the last frame instead of looping.
      // Clamp between 0 and duration, handling very short videos safely.
      const targetTime = Math.max(0, Math.min(time, Math.max(0.01, duration - 0.05)));
      
      return new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
        video.currentTime = targetTime;
        
        setTimeout(() => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        }, 150);
      });
    };

    setRecording(true);
    setExportProgress(1);

    try {
      // 1) Decode and mix audio offline safely
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AC();
      const tracksInfo: { buffer: AudioBuffer | null; duration: number }[] = [];
      const delaySec = (Number(messageDelay) || 0) / 1000;
      let totalDurationSec = 0;

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.type === "image") {
          tracksInfo.push({ buffer: null, duration: 2.0 });
          totalDurationSec += 2.0;
          continue;
        }
        if (msg.type === "video") {
          const url = msg.videoUrl;
          if (url) {
            try {
              const arrayBuffer = await fetch(url).then((r) => r.arrayBuffer());
              const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
              const durationSec = audioBuffer.duration;
              tracksInfo.push({ buffer: audioBuffer, duration: durationSec });
              totalDurationSec += durationSec;
            } catch (videoAudioErr) {
              console.warn(`No audio or failed decoding audio for video ${i}`, videoAudioErr);
              const durationSec = await getVideoDuration(url);
              tracksInfo.push({ buffer: null, duration: durationSec });
              totalDurationSec += durationSec;
            }
          } else {
            tracksInfo.push({ buffer: null, duration: 3.0 });
            totalDurationSec += 3.0;
          }
          continue;
        }
        const url = msg.type === "text" ? (msg as any).audioUrl : null;
        if (!url) {
          tracksInfo.push({ buffer: null, duration: 2.5 });
          totalDurationSec += 2.5;
          continue;
        }
        try {
          const arrayBuffer = await fetch(url).then((r) => r.arrayBuffer());
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          const step = Math.max(0.1, audioBuffer.duration + delaySec);
          tracksInfo.push({ buffer: audioBuffer, duration: step });
          totalDurationSec += step;
        } catch (decodeErr) {
          console.warn(`Error decoding audio for message ${i}`, decodeErr);
          tracksInfo.push({ buffer: null, duration: 2.0 });
          totalDurationSec += 2.0;
        }
      }
      totalDurationSec = Math.max(1, totalDurationSec + 1);

      const offlineCtx = new OfflineAudioContext(
        1,
        Math.ceil(48000 * totalDurationSec),
        48000,
      );
      let currentTime = 0;
      for (const track of tracksInfo) {
        if (track.buffer) {
          const src = offlineCtx.createBufferSource();
          src.buffer = track.buffer;
          src.connect(offlineCtx.destination);
          src.start(currentTime);
        }
        currentTime += track.duration;
      }
      const renderedAudio = await offlineCtx.startRendering();
      try { audioCtx.close(); } catch {}

      const startTimesSec: number[] = [];
      let currentAcc = 0;
      for (let j = 0; j < messages.length; j++) {
        startTimesSec.push(currentAcc);
        currentAcc += tracksInfo[j].duration;
      }

      // 2) Setup muxer + encoders
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "V_VP8", width: 1080, height: 1920 },
        audio: { codec: "A_OPUS", numberOfChannels: 1, sampleRate: 48000 },
      });

      const videoEncoder = new (window as any).VideoEncoder({
        output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
        error: (e: any) => console.error("Video error:", e),
      });
      videoEncoder.configure({
        codec: "vp8",
        width: 1080,
        height: 1920,
        bitrate: 6_000_000,
      });

      const audioEncoder = new (window as any).AudioEncoder({
        output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
        error: (e: any) => console.error("Audio error:", e),
      });
      audioEncoder.configure({
        codec: "opus",
        numberOfChannels: 1,
        sampleRate: 48000,
        bitrate: 128_000,
      });

      // 3) Encode mixed audio
      const channelData = renderedAudio.getChannelData(0);
      const audioChunkSize = 48000;
      for (let i = 0; i < channelData.length; i += audioChunkSize) {
        const chunk = channelData.slice(i, i + audioChunkSize);
        const audioData = new (window as any).AudioData({
          format: "f32-planar",
          sampleRate: 48000,
          numberOfFrames: chunk.length,
          numberOfChannels: 1,
          timestamp: Math.round((i / 48000) * 1_000_000),
          data: chunk,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      }

      // 4) Render frames
      // Measure all messages first to allow O(1) DOM rendering
      const measurementsByChat: Record<string, { height: number; margin: number }[]> = {};
      if (exportAll) {
        for (const chat of chats) {
          setPlayingChatId(chat.id);
          // Wait for DOM to render the messages of this chat
          await new Promise((r) => setTimeout(r, 60));
          const measurements: { height: number; margin: number }[] = [];
          if (chatInnerRef.current) {
            const children = chatInnerRef.current.children;
            for (let j = 0; j < children.length; j++) {
              const style = window.getComputedStyle(children[j]);
              measurements.push({
                height: (children[j] as HTMLElement).offsetHeight,
                margin: parseFloat(style.marginBottom) || 0
              });
            }
          }
          measurementsByChat[chat.id] = measurements;
        }
      } else {
        const measurements: { height: number; margin: number }[] = [];
        if (chatInnerRef.current) {
          const children = chatInnerRef.current.children;
          for (let j = 0; j < children.length; j++) {
            const style = window.getComputedStyle(children[j]);
            measurements.push({
              height: (children[j] as HTMLElement).offsetHeight,
              margin: parseFloat(style.marginBottom) || 0
            });
          }
        }
        measurementsByChat[activeChatId] = measurements;
      }
      setExportMeasurements(measurementsByChat);
      setExportStartIndex(0);

      const initialChatId = exportAll && messages[0] ? (messages[0] as any).chatId : activeChatId;
      setPlayingChatId(initialChatId);
      setPlaying(true);
      setVisibleMessages([]);
      setExportScroll(0);
      if (chatInnerRef.current) chatInnerRef.current.style.transform = "translateY(0px)";
      await new Promise((r) => setTimeout(r, 300));

      const fps = 30;
      let timestampUs = 0;
      let framesEncoded = 0;
      const canvas1080 = document.createElement("canvas");
      canvas1080.width = 1080;
      canvas1080.height = 1920;
      const ctx1080 = canvas1080.getContext("2d")!;

      for (let i = 0; i < messages.length; i++) {
        setExportProgress(10 + (i / messages.length) * 80);
        const msgChatId = (messages[i] as any).chatId || activeChatId;
        if (exportAll) {
          setPlayingChatId(msgChatId);
          const currentChatMessagesCount = messages.slice(0, i + 1).filter((m) => (m as any).chatId === msgChatId).length;
          const localMsgIndex = currentChatMessagesCount - 1;
          setExportStartIndex(Math.max(0, localMsgIndex - 12));
        } else {
          setExportStartIndex(Math.max(0, i - 12));
        }

        const currentChatMessages = exportAll
          ? messages.slice(0, i + 1).filter((m) => (m as any).chatId === msgChatId)
          : messages.slice(0, i + 1);

        setVisibleMessages(currentChatMessages);
        await new Promise((r) => setTimeout(r, 50));

        if (chatOuterRef.current && chatInnerRef.current) {
          const outer = chatOuterRef.current.clientHeight;
          const inner = chatInnerRef.current.scrollHeight;
          if (inner > outer) {
            chatInnerRef.current.style.transform = `translateY(-${inner - outer}px)`;
          } else {
            chatInnerRef.current.style.transform = "translateY(0px)";
          }
        }
        await new Promise((r) => setTimeout(r, 50));

        // Locate and measure video placeholders inside previewRef
        const placeholders = Array.from(
          previewRef.current!.querySelectorAll(".video-export-placeholder")
        ) as HTMLElement[];

        const parentRect = previewRef.current!.getBoundingClientRect();
        const scale = 1080 / (parentRect.width || 1);

        // Bounding rect for scroll container (chatOuterRef) in canvas space
        let outerX = 0, outerY = 0, outerW = 1080, outerH = 1920;
        if (chatOuterRef.current) {
          const outerRect = chatOuterRef.current.getBoundingClientRect();
          outerX = (outerRect.left - parentRect.left) * scale;
          outerY = (outerRect.top - parentRect.top) * scale;
          outerW = outerRect.width * scale;
          outerH = outerRect.height * scale;
        }

        const measuredPlaceholders = placeholders.map((placeholder) => {
          const rect = placeholder.getBoundingClientRect();

          const targetX = (rect.left - parentRect.left) * scale;
          const targetY = (rect.top - parentRect.top) * scale;
          const targetW = rect.width * scale;
          const targetH = rect.height * scale;

          const videoUrl = placeholder.getAttribute("data-video-src") || "";
          const msgIdAttr = placeholder.getAttribute("data-msg-id");
          const msgId = msgIdAttr ? parseInt(msgIdAttr, 10) : -1;
          const msgChatIdAttr = placeholder.getAttribute("data-chat-id");
          const msgIndex = messages.findIndex((m) => {
            if (m.id !== msgId) return false;
            if (msgChatIdAttr && (m as any).chatId && (m as any).chatId !== msgChatIdAttr) return false;
            return true;
          });
          const videoStartSec = msgIndex >= 0 ? startTimesSec[msgIndex] : 0;

          return {
            videoUrl,
            videoStartSec,
            targetX,
            targetY,
            targetW,
            targetH,
          };
        }).filter((item) => !!item.videoUrl);

        // Take ONE static high-res screenshot WITH SAFE FALLBACK
        let tempCanvas: HTMLCanvasElement | null = null;
        try {
          tempCanvas = await toCanvas(previewRef.current!, {
            pixelRatio: 2, // Restored back to 2 since memory is now O(1)
            cacheBust: false, // CRITICAL: true can break blob URIs
            skipFonts: true, // CRITICAL: prevents font loading Event timeouts
            useCORS: true,
            filter: (node: any) => {
              return node?.tagName?.toLowerCase() !== "iframe";
            },
          } as any);
        } catch (imgErr) {
          console.warn("Canvas capture failed for frame", i, ". Reusing previous frame.", imgErr);
        }

        if (tempCanvas) {
          ctx1080.clearRect(0, 0, 1080, 1920);
          ctx1080.drawImage(tempCanvas, 0, 0, 1080, 1920);
          tempCanvas.width = 0;
          tempCanvas.height = 0;
        }

        const durationSec = tracksInfo[i]?.duration || 0;
        const framesToEncode = Math.max(1, Math.round(durationSec * fps));
        const staticBitmap = await createImageBitmap(canvas1080);

        const waitEncoderQueue = async () => {
          while (videoEncoder.encodeQueueSize > 5) {
            await new Promise((r) => setTimeout(r, 20));
          }
        };

        for (let f = 0; f < framesToEncode; f++) {
          // Clear and restore static background
          ctx1080.clearRect(0, 0, 1080, 1920);
          ctx1080.drawImage(staticBitmap, 0, 0);

          if (measuredPlaceholders.length > 0) {
            // Seek all videos in parallel
            await Promise.all(
              measuredPlaceholders.map(async (item) => {
                try {
                  const video = await getVideoElement(item.videoUrl);
                  const currentFrameTimeSec = timestampUs / 1_000_000;
                  const elapsed = currentFrameTimeSec - item.videoStartSec;
                  await seekVideo(video, elapsed);
                } catch (err) {
                  console.warn("Failed to seek video", item.videoUrl, err);
                }
              })
            );

            // Draw video frames on top with rounded borders
            for (const item of measuredPlaceholders) {
              try {
                const video = await getVideoElement(item.videoUrl);
                ctx1080.save();

                // Clip to the scroll container bounds to prevent overflowing the header or phone frame
                if (chatOuterRef.current) {
                  ctx1080.beginPath();
                  ctx1080.rect(outerX, outerY, outerW, outerH);
                  ctx1080.clip();
                }

                ctx1080.beginPath();
                const radius = isWA ? 8 * scale : 16 * scale; // 8px for WA, 16px for iMessage
                if (typeof ctx1080.roundRect === "function") {
                  ctx1080.roundRect(item.targetX, item.targetY, item.targetW, item.targetH, radius);
                } else {
                  const x = item.targetX, y = item.targetY, w = item.targetW, h = item.targetH, r = radius;
                  ctx1080.moveTo(x + r, y);
                  ctx1080.arcTo(x + w, y, x + w, y + h, r);
                  ctx1080.arcTo(x + w, y + h, x, y + h, r);
                  ctx1080.arcTo(x, y + h, x, y, r);
                  ctx1080.arcTo(x, y, x + w, y, r);
                }
                ctx1080.clip();
                ctx1080.drawImage(video, item.targetX, item.targetY, item.targetW, item.targetH);
                ctx1080.restore();
              } catch (err) {
                console.warn("Failed to draw video overlay", item.videoUrl, err);
              }
            }
          }

          await waitEncoderQueue();
          const frame = new (window as any).VideoFrame(canvas1080, { timestamp: Math.round(timestampUs) });
          videoEncoder.encode(frame, { keyFrame: framesEncoded % 60 === 0 });
          frame.close();
          timestampUs += 1_000_000 / fps;
          framesEncoded++;
        }
        staticBitmap.close();
        
        // Let the browser breathe and run Garbage Collection
        await new Promise((r) => setTimeout(r, 100)); // Reduced back to 100ms
      }

      // End padding
      const endBitmap = await createImageBitmap(canvas1080);
      const waitEncoderQueueEnd = async () => {
        while (videoEncoder.encodeQueueSize > 5) {
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      for (let f = 0; f < 30; f++) {
        await waitEncoderQueueEnd();
        const frame = new (window as any).VideoFrame(endBitmap, { timestamp: Math.round(timestampUs) });
        videoEncoder.encode(frame);
        frame.close();
        timestampUs += 1_000_000 / fps;
      }
      endBitmap.close();

      // 5) Finalize
      setExportProgress(95);
      await videoEncoder.flush();
      await audioEncoder.flush();
      muxer.finalize();

      const blob = new Blob([muxer.target.buffer], { type: "video/webm" });
      if (blob.size === 0) {
        alert("O vídeo gerado está vazio. Tente novamente.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const safeName = (projectName.trim() || "chat-story").replace(/[^a-z0-9-_]+/gi, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error("Export Failed:", err);
      let errorMsg = "Erro Desconhecido";
      if (err instanceof Error) {
        errorMsg = err.message;
      } else if (err instanceof Event) {
        errorMsg = `Bloqueio de Segurança/CORS do navegador (Tipo: ${err.type}). Tente usar o Google Chrome no PC.`;
      } else {
        try {
          errorMsg = JSON.stringify(err);
        } catch {
          errorMsg = String(err);
        }
      }
      alert(`Falha na Exportação: ${errorMsg}`);
    } finally {
      // Clean up cached video elements
      if (typeof videoCache !== "undefined" && videoCache) {
        for (const video of videoCache.values()) {
          try {
            video.pause();
            video.src = "";
            video.load();
          } catch {}
        }
        videoCache.clear();
      }

      setRecording(false);
      setExportProgress(0);
      setPlaying(false);
      setPlayingChatId(null);
      setVisibleMessages([]);
      setExportScroll(0);
      if (chatInnerRef.current) chatInnerRef.current.style.transform = "translateY(0px)";
    }
  };

  const addChat = () => {
    const next = newChat(chats.length + 1);
    setChats((p) => [...p, next]);
    setActiveChatId(next.id);
    setVisibleMessages([]);
  };

  const removeChat = (id: string) => {
    if (chats.length === 1) return;
    const remaining = chats.filter((c) => c.id !== id);
    setChats(remaining);
    if (id === activeChatId) setActiveChatId(remaining[0].id);
  };

  const displayChat = playingChatId
    ? chats.find((c) => c.id === playingChatId) || activeChat
    : activeChat;

  const isWA = chatTheme === "whatsapp";
  const effectiveGroupChat = displayChat.isGroupChat ?? isGroupChat;

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as "editor" | "projects")}
      className="min-h-screen"
    >

      <div className="border-b bg-background px-6 pt-4">
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="projects">Meus Projetos ({projects.length})</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="editor" className="mt-0">
        <div className="flex flex-col lg:flex-row">
          {/* LEFT */}
          <div className="w-full lg:w-1/2 overflow-y-auto bg-background p-8 space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Chat Story Generator</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Cole um script com <code>1: NomeDaVoz&gt; texto</code>, gere os áudios e reproduza um vídeo sincronizado.
              </p>
            </div>

            {/* Project name + save */}
            <div className="space-y-2 rounded-lg border p-4">
              <Label>Nome do projeto</Label>
              <div className="flex gap-2">
                <Input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Ex: Story do Nate"
                />
                <Button
                  onClick={handleSaveProject}
                  disabled={savingProject}
                  variant="secondary"
                >
                  {savingProject ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-1" /> Salvar
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Salva script, áudios e imagens localmente (IndexedDB) para você não regerar áudios à toa.
              </p>
            </div>

        {/* Theme + Provider */}
        <div className="space-y-4 rounded-lg border p-4">
          <div className="space-y-2">
            <Label>Chat Theme</Label>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant={chatTheme === "imessage" ? "default" : "outline"}
                onClick={() => setChatTheme("imessage")}
              >
                iMessage
              </Button>
              <Button
                size="sm"
                variant={chatTheme === "whatsapp" ? "default" : "outline"}
                onClick={() => setChatTheme("whatsapp")}
              >
                WhatsApp (Dark)
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Chat Mode</Label>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant={!effectiveGroupChat ? "default" : "outline"}
                onClick={() => {
                  setIsGroupChat(false);
                  updateActiveChat({ isGroupChat: false });
                }}
              >
                Direct Message
              </Button>
              <Button
                size="sm"
                variant={effectiveGroupChat ? "default" : "outline"}
                onClick={() => {
                  setIsGroupChat(true);
                  updateActiveChat({ isGroupChat: true });
                }}
              >
                Group Chat
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Message Delay (ms)</Label>
            <Input
              type="number"
              step={50}
              value={messageDelay}
              onChange={(e) => setMessageDelay(Number(e.target.value) || 0)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              Pausa entre mensagens (0 = sem pausa). Use valores negativos (ex.: -300) para
              sobrepor o áudio à próxima mensagem.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Provedor de Voz (TTS)</Label>
            <select
              className="w-full h-9 rounded-md border border-input bg-transparent px-2 text-xs"
              value={ttsProvider}
              onChange={(e) => setTtsProvider(e.target.value as "elevenlabs" | "omnivoice")}
            >
              <option value="elevenlabs">ElevenLabs (Nuvem / Pago)</option>
              <option value="omnivoice">OmniVoice Local (Gratuito / Open-source)</option>
            </select>
          </div>

          {ttsProvider === "elevenlabs" ? (
            <div className="space-y-2">
              <Label>ElevenLabs API Key</Label>
              <Input
                type="password"
                value={elevenKey}
                onChange={(e) => setElevenKey(e.target.value)}
                placeholder="sk_..."
              />
              <p className="text-xs text-muted-foreground">
                No script use o <strong>voice_id</strong> da voz do ElevenLabs (ex.: <code>21m00Tcm4TlvDq8ikWAM</code>).
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Servidor OmniVoice Local</Label>
              <Input
                type="text"
                value={omniVoiceUrl}
                onChange={(e) => setOmniVoiceUrl(e.target.value)}
                placeholder="http://localhost:8000"
              />
              <p className="text-xs text-muted-foreground">
                O OmniVoice clonará automaticamente as vozes buscando áudios anteriores gerados no histórico do chat.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={async () => {
                  try {
                    const res = await startOmniVoiceServerFn();
                    if ((res as any).success) {
                      alert("Comando enviado! Uma nova janela do CMD deve se abrir em breve com o servidor OmniVoice.");
                    } else {
                      alert(`Erro ao abrir CMD: ${(res as any).error}`);
                    }
                  } catch (err) {
                    alert(`Erro na requisição: ${(err as Error).message}`);
                  }
                }}
              >
                Abrir Terminal e Iniciar Servidor
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Voice Speed</Label>
              <span className="text-xs text-muted-foreground">{voiceSpeed.toFixed(2)}x</span>
            </div>
            <Input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={voiceSpeed}
              onChange={(e) => setVoiceSpeed(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Video Background Manager */}
        <div className="space-y-3 rounded-lg border p-4">
          <Label>Video Background</Label>
          <div className="flex flex-wrap gap-2">
            {backgrounds.map((bg) => {
              const isActive = activeBackground === bg.value;
              const style: CSSProperties =
                bg.type === "color"
                  ? { backgroundColor: bg.value }
                  : {
                      backgroundImage: `url(${bg.value})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    };
              return (
                <div key={bg.id} className="relative">
                  <button
                    type="button"
                    onClick={() => setActiveBackground(bg.value)}
                    className={`w-10 h-10 rounded-md cursor-pointer border-2 transition-all ${
                      isActive
                        ? "border-primary ring-2 ring-primary scale-110"
                        : "border-border hover:border-foreground/40"
                    }`}
                    style={style}
                    title={bg.type === "color" ? bg.value : "Custom image"}
                  />
                  {!bg.id.startsWith("default-") && (
                    <button
                      type="button"
                      onClick={() => removeBackground(bg)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center text-[10px] leading-none"
                      title="Remove"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-10 h-9 rounded cursor-pointer border border-input bg-transparent"
            />
            <Button size="sm" variant="outline" onClick={addColorBackground}>
              Add Color
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={bgFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addImageBackground(f);
                if (bgFileInputRef.current) bgFileInputRef.current.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => bgFileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-1" /> Upload Image
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Imagens são salvas localmente em Base64 (compatível com a exportação offline).
          </p>
        </div>

        {/* Chat tabs */}
        <div className="flex flex-wrap gap-2 items-center">
          {chats.map((c) => (
            <div
              key={c.id}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-sm ${
                c.id === activeChatId ? "bg-primary text-primary-foreground" : "bg-background"
              }`}
            >
              <button
                onClick={() => {
                  setActiveChatId(c.id);
                  setVisibleMessages([]);
                }}
              >
                {c.name}
              </button>
              {chats.length > 1 && (
                <button
                  className="opacity-70 hover:opacity-100"
                  onClick={() => removeChat(c.id)}
                  aria-label="Remove chat"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={addChat}>
            <Plus className="h-3 w-3 mr-1" /> Add chat
          </Button>
        </div>

        {/* Chat name */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Chat label</Label>
            <Input
              value={activeChat.name}
              onChange={(e) => updateActiveChat({ name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Contact name</Label>
            <Input
              value={activeChat.contactName}
              onChange={(e) => updateActiveChat({ contactName: e.target.value })}
            />
          </div>
        </div>

        {/* Contact photo */}
        <div
          className="space-y-2 rounded-lg border p-4"
          tabIndex={0}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const it of Array.from(items)) {
              if (it.type.startsWith("image/")) {
                const file = it.getAsFile();
                if (file) {
                  e.preventDefault();
                  onUploadContactPhoto(file);
                  return;
                }
              }
            }
            const text = e.clipboardData?.getData("text");
            if (text && /^https?:\/\//i.test(text.trim())) {
              e.preventDefault();
              updateActiveChat({ contactPhoto: text.trim() });
            }
          }}
        >
          <Label className="flex items-center gap-2">
            <User className="h-4 w-4" /> Contact photo (opcional)
          </Label>
          <p className="text-xs text-muted-foreground">
            Cole uma imagem (Ctrl/Cmd+V), uma URL, ou envie um arquivo.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {activeChat.contactPhoto ? (
              <img
                src={activeChat.contactPhoto}
                alt="contact"
                className="h-12 w-12 rounded-full object-cover border"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center text-white font-medium">
                {activeChat.contactName.charAt(0).toUpperCase()}
              </div>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadContactPhoto(f);
              }}
            />
            <Button size="sm" variant="outline" onClick={() => photoInputRef.current?.click()}>
              <Upload className="mr-2 h-3 w-3" /> Upload
            </Button>
            <Button size="sm" variant="outline" onClick={pasteContactPhoto}>
              <ClipboardPaste className="mr-2 h-3 w-3" /> Colar
            </Button>
            {activeChat.contactPhoto && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => updateActiveChat({ contactPhoto: null })}
              >
                Remove
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Script</Label>
          <Textarea
            className="min-h-[260px] font-mono text-sm"
            value={activeChat.script}
            onChange={(e) => updateActiveChat({ script: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Formato: <code>- iMessage: nome</code> ou <code>- Whatsapp: nome</code> (define o template). Use <code>- Direct iMessage: nome</code> ou <code>- Group Whatsapp: nome</code> para definir o modo. Linhas: <code>1: NomeDaVoz&gt; texto</code>.
          </p>
        </div>

        <Button onClick={parseScript} className="w-full">
          Parse Script
        </Button>

        {/* Voice library */}
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold text-sm">Biblioteca de vozes</h2>
          <p className="text-xs text-muted-foreground">
            Salve aqui as vozes que você usa com frequência. Depois é só selecionar pelo nome ao mapear personagens.
          </p>
          <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
            <Input
              placeholder="Nome (ex: Adam)"
              value={newVoiceName}
              onChange={(e) => setNewVoiceName(e.target.value)}
            />
            <Input
              className="font-mono text-xs"
              placeholder="voice_id"
              value={newVoiceId}
              onChange={(e) => setNewVoiceId(e.target.value)}
            />
            <Button size="sm" onClick={addSavedVoice}>
              <Plus className="h-3 w-3 mr-1" /> Salvar
            </Button>
          </div>
          {savedVoices.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {savedVoices.map((v) => (
                <div key={v.name} className="flex items-center gap-2 text-xs">
                  <span className="font-medium w-24 truncate">{v.name}</span>
                  <code className="flex-1 truncate text-muted-foreground">{v.voiceId}</code>
                  <button
                    onClick={() => removeSavedVoice(v.name)}
                    className="opacity-60 hover:opacity-100"
                    aria-label="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {uniqueCharacters.length > 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold text-sm">Voice IDs por personagem</h2>
            <p className="text-xs text-muted-foreground">
              Configure as vozes e fotos de cada personagem. Faça upload, use o botão Colar ou selecione a linha do personagem e use <code>Ctrl+V</code>.
            </p>
            {uniqueCharacters.map((name) => {
              const isVoice = name in activeChat.voiceMap;
              const currentId = isVoice ? activeChat.voiceMap[name] : "";
              const matched = savedVoices.find((v) => v.voiceId === currentId);
              const photoInputId = `photo-input-${name}`;
              const photoUrl = activeChat.characterPhotos?.[name];
              return (
                <div
                  key={name}
                  tabIndex={0}
                  className="space-y-2 border-b last:border-b-0 pb-3 last:pb-0 focus:outline-none focus:bg-zinc-800/20 focus-visible:ring-1 focus-visible:ring-zinc-700 rounded-md p-2 -mx-2 transition-all outline-none"
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (const it of Array.from(items)) {
                      if (it.type.startsWith("image/")) {
                        const file = it.getAsFile();
                        if (file) {
                          e.preventDefault();
                          const reader = new FileReader();
                          reader.onload = () => {
                            const b64 = String(reader.result || "");
                            updateActiveChat({
                              characterPhotos: {
                                ...(activeChat.characterPhotos || {}),
                                [name]: b64,
                              },
                            });
                          };
                          reader.readAsDataURL(file);
                          return;
                        }
                      }
                    }
                    const text = e.clipboardData?.getData("text");
                    if (text && /^https?:\/\//i.test(text.trim())) {
                      e.preventDefault();
                      updateActiveChat({
                        characterPhotos: {
                          ...(activeChat.characterPhotos || {}),
                          [name]: text.trim(),
                        },
                      });
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold capitalize">{name}</Label>
                    {!isVoice && (
                      <span className="text-[10px] text-muted-foreground bg-zinc-800 px-1.5 py-0.5 rounded">
                        Nome de Exibição
                      </span>
                    )}
                  </div>
                  
                  {isVoice && (
                    <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                      <Input
                        className="font-mono text-xs"
                        placeholder="Adicionar voice_id manualmente"
                        value={currentId}
                        onChange={(e) =>
                          updateActiveChat({
                            voiceMap: { ...activeChat.voiceMap, [name]: e.target.value },
                          })
                        }
                      />
                      <select
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-xs"
                        value={matched?.name || ""}
                        onChange={(e) => {
                          const sel = savedVoices.find((v) => v.name === e.target.value);
                          if (sel) {
                            updateActiveChat({
                              voiceMap: { ...activeChat.voiceMap, [name]: sel.voiceId },
                            });
                          }
                        }}
                      >
                        <option value="">Selecionar voz...</option>
                        {savedVoices.map((v) => (
                          <option key={v.name} value={v.name}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Avatar upload / remove UI */}
                  <div className="flex items-center gap-2 mt-1">
                    {photoUrl ? (
                      <img
                        src={photoUrl}
                        alt={name}
                        className="h-[28px] w-[28px] rounded-full object-cover border border-zinc-700"
                      />
                    ) : (
                      <div className="h-[28px] w-[28px] rounded-full bg-gradient-to-br from-zinc-600 to-zinc-800 flex items-center justify-center text-white text-[10px] font-semibold uppercase border border-zinc-700">
                        {name.charAt(0)}
                      </div>
                    )}
                    <input
                      id={photoInputId}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          const reader = new FileReader();
                          reader.onload = () => {
                            const b64 = String(reader.result || "");
                            updateActiveChat({
                              characterPhotos: {
                                ...(activeChat.characterPhotos || {}),
                                [name]: b64,
                              },
                            });
                          };
                          reader.readAsDataURL(f);
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 px-2"
                      onClick={() => document.getElementById(photoInputId)?.click()}
                    >
                      <Upload className="mr-1 h-3 w-3" /> Upload Foto
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 px-2"
                      onClick={() => pasteCharacterPhoto(name)}
                    >
                      <ClipboardPaste className="mr-1 h-3 w-3" /> Colar
                    </Button>
                    {photoUrl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 text-xs h-7 px-2"
                        onClick={() => {
                          if (confirm(`Remover a foto de ${name}?`)) {
                            const updated = { ...(activeChat.characterPhotos || {}) };
                            delete updated[name];
                            updateActiveChat({ characterPhotos: updated });
                          }
                        }}
                      >
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}


        {(() => {
          const isGroup = activeChat.isGroupChat ?? isGroupChat;
          if (!isGroup) return null;
          const displayNames = Array.from(
            new Set(
              activeChat.messages
                .filter((m): m is TextMsg => m.type === "text")
                .map((m) => m.displayName || m.voiceName)
                .filter((n): n is string => !!n)
            )
          );
          if (displayNames.length === 0) return null;
          const colors = activeChat.nameColors || {};
          return (
            <div className="space-y-3 rounded-lg border p-4">
              <h2 className="font-semibold text-sm">Cores dos nomes (Group Chat)</h2>
              <p className="text-xs text-muted-foreground">
                Escolha a cor do nome exibido acima das mensagens no chat de grupo.
              </p>
              {displayNames.map((name) => {
                const current = colors[name] || "";
                return (
                  <div key={name} className="flex items-center gap-2">
                    <Label className="text-xs w-24 truncate capitalize">{name}</Label>
                    <div
                      className="h-5 w-5 rounded-full border"
                      style={{
                        backgroundColor:
                          current ||
                          (chatTheme === "whatsapp" ? "#53bdeb" : "#8e8e93"),
                      }}
                    />
                    <select
                      className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-xs"
                      value={current}
                      onChange={(e) =>
                        updateActiveChat({
                          nameColors: { ...colors, [name]: e.target.value },
                        })
                      }
                    >
                      {NAME_COLOR_OPTIONS.map((opt) => (
                        <option key={opt.label} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div className="flex flex-col sm:flex-row gap-2 w-full">
          <Button
            onClick={() => generateAudios(false)}
            disabled={generating}
            className="flex-1 text-xs"
            variant="secondary"
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Gerando {genProgress.done}/{genProgress.total}
              </>
            ) : (
              "Gerar áudios (todos os chats)"
            )}
          </Button>
          <Button
            onClick={() => generateAudios(true)}
            disabled={generating}
            className="flex-1 text-xs"
            variant="outline"
          >
            Continuar de Onde Parou
          </Button>
        </div>

        {/* Post-Generation Editor */}
        {(() => {
          const textMsgs = activeChat.messages.filter(
            (m): m is TextMsg => m.type === "text"
          );
          const hasAnyAudio = textMsgs.some((m) => !!m.audioUrl);
          if (textMsgs.length === 0 || !hasAnyAudio) return null;
          return (
            <Collapsible
              open={editorOpen}
              onOpenChange={setEditorOpen}
              className="rounded-lg border"
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between p-4 text-left">
                <div>
                  <h2 className="font-semibold text-sm">Post-Generation Editor</h2>
                  <p className="text-xs text-muted-foreground">
                    Corrija typos ou troque a voz de mensagens individuais sem regerar tudo.
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${editorOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-4 pb-4 space-y-3">
                {textMsgs.map((msg) => {
                  const isLoading = regeneratingMsgId === msg.id;
                  return (
                    <div key={msg.id} className="rounded-md border p-3 space-y-2">
                      <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                        <div className="space-y-2">
                          <Input
                            className="h-8 text-xs"
                            placeholder="Voz (ex: Adam)"
                            value={msg.voiceName}
                            onChange={(e) =>
                              updateTextMessage(msg.id, { voiceName: e.target.value })
                            }
                          />
                          <Textarea
                            className="text-xs min-h-[60px]"
                            value={msg.text}
                            onChange={(e) =>
                              updateTextMessage(msg.id, {
                                text: e.target.value,
                                spokenText: undefined,
                              })
                            }
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isLoading || !msg.voiceName.trim() || !msg.text.trim()}
                          onClick={() => regenerateOneAudio(msg.id)}
                          title="Regenerar este áudio"
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {msg.audioUrl && (
                        <audio controls src={msg.audioUrl} className="h-8 w-full mt-2" />
                      )}
                    </div>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          );
        })()}

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Volume2 className="h-4 w-4" /> Biblioteca de Áudios ({generatedAudios.length})
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Áudios gerados nesta sessão. Útil para recuperar áudios após re-parsear o script ou vinculá-los manualmente.
          </p>
          
          {generatedAudios.length === 0 ? (
            <p className="text-xs text-muted-foreground italic bg-zinc-900/10 p-3 rounded-md text-center">
              Nenhum áudio gerado nesta sessão ainda.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs h-8"
                  onClick={() => {
                    let count = 0;
                    const updatedMessages = activeChat.messages.map((m) => {
                      if (m.type === "text" && !m.audioUrl) {
                        const match = generatedAudios.find(
                          (g) =>
                            g.voiceName.toLowerCase() === m.voiceName.toLowerCase() &&
                            g.text.toLowerCase() === m.text.toLowerCase()
                        );
                        if (match) {
                          count++;
                          return { ...m, audioUrl: match.audioUrl };
                        }
                      }
                      return m;
                    });
                    if (count > 0) {
                      updateActiveChat({ messages: updatedMessages });
                      alert(`${count} áudio(s) correspondente(s) vinculado(s) ao script!`);
                    } else {
                      alert("Nenhum áudio correspondente pendente encontrado.");
                    }
                  }}
                >
                  Vincular Correspondentes
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-red-500 hover:text-red-700 h-8"
                  onClick={() => {
                    if (confirm("Limpar toda a biblioteca de áudios gerados?")) {
                      setGeneratedAudios([]);
                    }
                  }}
                >
                  Limpar Tudo
                </Button>
              </div>
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {generatedAudios.map((g, idx) => {
                  const isLinked = activeChat.messages.some(
                    (m) => m.type === "text" && m.audioUrl === g.audioUrl
                  );
                  return (
                    <div key={idx} className="rounded-md border p-2.5 space-y-1.5 text-xs bg-zinc-900/10">
                      <div className="flex justify-between items-center font-semibold text-zinc-300">
                        <span className="capitalize">{g.voiceName}</span>
                        {isLinked ? (
                          <span className="text-[10px] text-green-500 bg-green-950/20 px-1.5 py-0.5 rounded border border-green-900/30">
                            Vinculado
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400 bg-zinc-800/50 px-1.5 py-0.5 rounded border border-zinc-700/30">
                            Não Vinculado
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground italic line-clamp-2" title={g.text}>“{g.text}”</p>
                      <audio src={g.audioUrl} controls className="h-6 w-full mt-1" />
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="text-[10px] h-6 flex-1 px-2"
                          disabled={isLinked}
                          onClick={() => {
                            let bound = false;
                            const updatedMessages = activeChat.messages.map((m) => {
                              if (
                                m.type === "text" &&
                                !m.audioUrl &&
                                m.voiceName.toLowerCase() === g.voiceName.toLowerCase() &&
                                m.text.toLowerCase() === g.text.toLowerCase()
                              ) {
                                bound = true;
                                return { ...m, audioUrl: g.audioUrl };
                              }
                              return m;
                            });
                            if (bound) {
                              updateActiveChat({ messages: updatedMessages });
                              alert("Áudio correspondente vinculado com sucesso!");
                            } else {
                              const textMsgsWithoutAudio = activeChat.messages.filter(
                                (m): m is TextMsg => m.type === "text" && !m.audioUrl
                              );
                              if (textMsgsWithoutAudio.length === 0) {
                                alert("Todas as mensagens de texto já possuem áudio.");
                                return;
                              }
                              // Candidate: same voice, or first without audio
                              const candidate = textMsgsWithoutAudio.find(
                                (m) => m.voiceName.toLowerCase() === g.voiceName.toLowerCase()
                              ) || textMsgsWithoutAudio[0];
                              
                              const updated = activeChat.messages.map((m) =>
                                m.id === candidate.id && m.type === "text"
                                  ? { ...m, audioUrl: g.audioUrl }
                                  : m
                              );
                              updateActiveChat({ messages: updated });
                              alert(`Vinculado à linha: "${candidate.voiceName}: ${candidate.text}"`);
                            }
                          }}
                        >
                          {isLinked ? "Vinculado" : "Vincular ao Script"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-[10px] h-6 text-red-500 hover:text-red-700 px-2"
                          onClick={() => {
                            setGeneratedAudios((prev) => prev.filter((_, i) => i !== idx));
                          }}
                        >
                          Excluir
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {imageMessages.length > 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold flex items-center gap-2">
              <ImageIcon className="h-4 w-4" /> Images
            </h2>
            {imageMessages.map((m) => (
              <div
                key={m.id}
                className="space-y-2 rounded-md border p-3"
                tabIndex={0}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  for (const it of Array.from(items)) {
                    if (it.type.startsWith("image/")) {
                      const file = it.getAsFile();
                      if (file) {
                        e.preventDefault();
                        onUploadImage(m.id, file);
                        return;
                      }
                    }
                  }
                  const text = e.clipboardData?.getData("text");
                  if (text && /^https?:\/\//i.test(text.trim())) {
                    e.preventDefault();
                    setImageUrlFor(m.id, text.trim());
                  }
                }}
              >
                <div className="text-xs text-muted-foreground">
                  Side {m.side} — “{m.text}”
                </div>
                <div className="flex gap-2 items-center">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Cole URL ou imagem aqui (Ctrl/Cmd+V)"
                    value={m.imageUrl?.startsWith("blob:") ? "" : m.imageUrl ?? ""}
                    onChange={(e) => setImageUrlFor(m.id, e.target.value || null)}
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    ref={(el) => {
                      fileInputRefs.current[`${activeChatId}_${m.id}`] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUploadImage(m.id, f);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRefs.current[`${activeChatId}_${m.id}`]?.click()}
                  >
                    <Upload className="mr-2 h-3 w-3" /> Upload
                  </Button>
                  {m.imageUrl && (
                    <>
                      <img
                        src={m.imageUrl}
                        alt={m.text}
                        className="h-12 w-12 object-cover rounded-md border"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setImageUrlFor(m.id, null)}
                      >
                        Clear
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {videoMessages.length > 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Video className="h-4 w-4" /> Videos
            </h2>
            {videoMessages.map((m) => (
              <div
                key={m.id}
                className="space-y-2 rounded-md border p-3"
                tabIndex={0}
                onPaste={(e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  for (const it of Array.from(items)) {
                    if (it.type.startsWith("video/") || it.type.startsWith("image/gif")) {
                      const file = it.getAsFile();
                      if (file) {
                        e.preventDefault();
                        onUploadVideo(m.id, file);
                        return;
                      }
                    }
                  }
                  const text = e.clipboardData?.getData("text");
                  if (text && /^https?:\/\//i.test(text.trim())) {
                    e.preventDefault();
                    setVideoUrlFor(m.id, text.trim());
                  }
                }}
              >
                <div className="text-xs text-muted-foreground">
                  Side {m.side} — “{m.text}”
                </div>
                <div className="flex gap-2 items-center">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Cole URL de vídeo ou GIF aqui (Ctrl/Cmd+V)"
                    value={m.videoUrl?.startsWith("blob:") ? "" : m.videoUrl ?? ""}
                    onChange={(e) => setVideoUrlFor(m.id, e.target.value || null)}
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    ref={(el) => {
                      fileInputRefs.current[`${activeChatId}_${m.id}`] = el;
                    }}
                    type="file"
                    accept="video/mp4,video/webm,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onUploadVideo(m.id, f);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRefs.current[`${activeChatId}_${m.id}`]?.click()}
                  >
                    <Upload className="mr-2 h-3 w-3" /> Upload
                  </Button>
                  {m.videoUrl && (
                    <>
                      {m.videoType === "gif" ? (
                        <img
                          src={m.videoUrl}
                          alt={m.text}
                          className="h-12 w-12 object-cover rounded-md border"
                        />
                      ) : (
                        <video
                          src={m.videoUrl}
                          className="h-12 w-12 object-cover rounded-md border"
                        />
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setVideoUrlFor(m.id, null)}
                      >
                        Clear
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={() => playAnimation()}
            disabled={!allAudiosReady || playing || recording}
            className="flex-1"
            size="lg"
          >
            <Play className="mr-2 h-4 w-4" />
            Play vídeo (todos os chats)
          </Button>
        </div>
        </div>

      {/* RIGHT */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 min-h-screen bg-background gap-4">
        <div className="relative aspect-[9/16] w-full max-w-[400px]">
        <div
          ref={previewRef}
          className="w-full h-full flex items-center justify-center relative overflow-hidden"
          style={{
            background: activeBackground.startsWith("data:image")
              ? `url(${activeBackground}) center/cover no-repeat`
              : activeBackground,
          }}
          onWheel={(e) => {
            if (recording) return;
            const outer = chatOuterRef.current?.clientHeight ?? 0;
            const inner = chatInnerRef.current?.scrollHeight ?? 0;
            const max = Math.max(0, inner - outer);
            setPreviewDragOffset((prev) => {
              let next = prev + e.deltaY;
              if (next < 0) next = 0;
              if (next > max) next = max;
              return next;
            });
          }}
        >
        <div
          className="w-[92%] h-fit max-h-[65%] flex flex-col rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden shrink-0"
          style={{ backgroundColor: isWA ? "#0b141a" : "#000000" }}
        >
          {/* Header */}
          <div className="shrink-0 z-10 w-full">
          {isWA ? (
            <div className="bg-[#1f2c34] text-white flex items-center px-3 py-2.5 gap-3 z-10">
              <ChevronLeft className="h-6 w-6 text-[#0A84FF]" />
              {displayChat.contactPhoto ? (
                <img
                  src={displayChat.contactPhoto}
                  alt={displayChat.contactName}
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-zinc-300 to-zinc-500 flex items-center justify-center text-white text-sm font-medium">
                  <User className="h-6 w-6 text-white/80" />
                </div>
              )}
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[17px] font-semibold truncate leading-tight">
                  {displayChat.contactName}
                </span>
                <span className="text-[12px] text-[#8696a0] leading-tight">
                  {effectiveGroupChat ? (
                    <input
                      value={displayChat.groupSubtitle ?? "tap here for group info"}
                      onChange={(e) =>
                        updateChatById(displayChat.id, { groupSubtitle: e.target.value })
                      }
                      className="bg-transparent border-none outline-none text-[12px] text-[#8696a0] w-full p-0"
                    />
                  ) : (
                    "Online"
                  )}
                </span>
              </div>
              <Video className="h-6 w-6 text-[#0A84FF]" strokeWidth={2} />
              <Phone className="h-5 w-5 text-[#0A84FF] ml-2" strokeWidth={2} />
            </div>
          ) : (
            <div className="relative bg-black px-4 pt-3 pb-4">
              <div className="flex items-center gap-1 text-[#0A84FF] absolute left-3 top-1/2 -translate-y-1/2 bg-[#1c1c1e] rounded-full pl-1 pr-3 py-1">
                <ChevronLeft className="h-5 w-5" />
                <input
                  value={displayChat.headerTime}
                  onChange={(e) =>
                    updateChatById(displayChat.id, { headerTime: e.target.value })
                  }
                  className="bg-transparent border-none outline-none text-sm w-12 text-white p-0"
                />
              </div>
              <div className="flex flex-col items-center mx-auto w-fit">
                {effectiveGroupChat ? (
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#7a7a99] to-[#3a3a5a] flex items-center justify-center">
                    <Users className="h-7 w-7 text-white" />
                  </div>
                ) : displayChat.contactPhoto ? (
                  <img
                    src={displayChat.contactPhoto}
                    alt={displayChat.contactName}
                    className="w-14 h-14 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#7a7a99] to-[#3a3a5a] flex items-center justify-center text-white text-xl font-semibold">
                    {displayChat.contactName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-1 bg-[#1c1c1e] rounded-full px-3 py-1">
                  <span className="text-white text-[15px] font-semibold">{displayChat.contactName}</span>
                  <span className="text-[#8e8e93] text-sm">›</span>
                </div>
              </div>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-[#1c1c1e] rounded-full p-2">
                <Video className="h-5 w-5 text-white" />
              </div>
            </div>
          )}
          </div>

          {/* Chat */}
          <div
            ref={(el) => {
              chatOuterRef.current = el;
              chatScrollRef.current = el;
            }}
            className="w-full relative overflow-hidden flex-shrink min-h-0"
            style={{
              ...(isWA
                ? {
                    backgroundImage:
                      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'><g fill='none' stroke='%23ffffff' stroke-opacity='0.04' stroke-width='1.2'><circle cx='30' cy='30' r='10'/><path d='M60 20 q5 10 10 0 t10 0'/><circle cx='110' cy='40' r='6'/><path d='M140 20 l8 8 l-8 8 l-8 -8 z'/><circle cx='160' cy='70' r='4'/><path d='M20 80 q10 -10 20 0 t20 0'/><circle cx='80' cy='100' r='8'/><path d='M120 90 l10 0 l-5 -10 z'/><circle cx='40' cy='140' r='5'/><path d='M70 150 q10 10 20 0 t20 0'/><circle cx='140' cy='130' r='10'/><path d='M170 160 l-10 0 l5 -10 z'/></g></svg>\")",
                    backgroundRepeat: "repeat",
                  }
                : {}),
            }}
          >
            <div
              ref={chatInnerRef}
              className="w-full flex flex-col justify-start pl-1.5 pr-2.5 py-3 gap-0"
              style={{
                transform: `translateY(-${exportScroll + (recording ? 0 : previewDragOffset)}px)`,
              }}
            >
            <AnimatePresence>
              {(playing ? visibleMessages : displayChat.messages).map((m, idx, arr) => {
                if (recording && playing && idx < exportStartIndex) {
                  const msgChatId = (m as any).chatId || displayChat.id;
                  const chatMeas = exportMeasurements[msgChatId] || [];
                  const meas = chatMeas[idx] || { height: 50, margin: 0 };
                  return <div key={m.id} style={{ height: meas.height, marginBottom: meas.margin, flexShrink: 0 }} />;
                }

                const isLastSent =
                  m.side === "2" &&
                  !arr.slice(idx + 1).some((n) => n.side === "2");
                const prev = arr[idx - 1];
                const getSenderName = (msg: Msg, index: number) => {
                  let name = "";
                  if (msg.type === "text") name = msg.displayName || msg.voiceName;
                  else if (msg.type === "image" || msg.type === "video") name = msg.displayName || msg.voiceName || "";
                  
                  // Fallback for loaded projects without voiceName on media
                  if (!name) {
                    for (let i = index - 1; i >= 0; i--) {
                      const p = arr[i];
                      if (p.side === msg.side && p.type === "text") {
                        return p.displayName || p.voiceName || "";
                      }
                    }
                  }
                  return name;
                };
                const senderName = getSenderName(m, idx);
                const prevSenderName = prev ? getSenderName(prev, idx - 1) : "";

                const isLeftSide = effectiveGroupChat ? (m.side !== "2") : (m.side === "1");

                // Sequence checks for Group Chat (side "1")
                const isFirstInSequence = (() => {
                  if (!isLeftSide) return false;
                  const pMsg = arr[idx - 1];
                  if (!pMsg) return true; // First message overall
                  
                  const pMsgLeftSide = effectiveGroupChat ? (pMsg.side !== "2") : (pMsg.side === "1");
                  if (!pMsgLeftSide) return true; // Previous message was from side 2
                  
                  const currentSender = getSenderName(m, idx);
                  const prevSender = pMsg ? getSenderName(pMsg, idx - 1) : "";
                  return currentSender !== prevSender;
                })();

                const isLastInSequence = (() => {
                  if (!isLeftSide) return false;
                  const next = arr[idx + 1];
                  if (!next) return true; // Last message overall
                  
                  const nextLeftSide = effectiveGroupChat ? (next.side !== "2") : (next.side === "1");
                  if (!nextLeftSide) return true; // Next message is on side 2
                  
                  const currentSender = getSenderName(m, idx);
                  const nextSender = next ? getSenderName(next, idx + 1) : "";
                  return currentSender !== nextSender;
                })();

                const isLastInSequenceRight = (() => {
                  if (m.side !== "2") return false;
                  const next = arr[idx + 1];
                  if (!next) return true;
                  return next.side !== "2";
                })();

                const showName =
                  effectiveGroupChat &&
                  isLeftSide &&
                  isFirstInSequence;

                const nameColor =
                  senderName
                    ? displayChat.nameColors?.[senderName] || ""
                    : "";

                const showAvatarPlaceholder = effectiveGroupChat && isLeftSide;
                const avatarUrl = showAvatarPlaceholder && senderName ? (displayChat.characterPhotos?.[senderName] || "") : "";
                const charInitial = senderName ? senderName.charAt(0).toUpperCase() : "";

                const showAvatar = isLastInSequence && effectiveGroupChat;

                const isEndOfBlock = (() => {
                  const next = arr[idx + 1];
                  if (!next) return true; // Last message overall
                  if (next.side !== m.side) return true; // Switches sides (left/right)
                  
                  // Same side. If it's the left side, check if the sender name changed.
                  if (isLeftSide) {
                    const currentSender = getSenderName(m, idx);
                    const nextSender = next ? getSenderName(next, idx + 1) : "";
                    return currentSender !== nextSender;
                  }
                  return false;
                })();

                const spacingClass = isEndOfBlock ? "mb-3.5" : "mb-0.5";

                const renderBubble = () => {
                  if (m.type === "text") {
                    if (isWA) {
                      const bubbleSideClass = m.side === "2"
                        ? `bg-[#005c4b] ml-auto ${isLastInSequenceRight ? "rounded-lg rounded-tr-none wa-tail-right" : "rounded-lg"}`
                        : `bg-[#262d31] ${isLastInSequence ? "rounded-lg rounded-tl-none wa-tail-left" : "rounded-lg"}`;
                      return (
                        <div className={`relative max-w-[80%] py-1.5 px-2.5 text-white text-[15px] leading-snug shadow-sm ${bubbleSideClass}`}>
                          {showName && (
                            <span
                              className="text-[13px] font-bold mb-0.5 capitalize block"
                              style={{ color: nameColor || "#53bdeb" }}
                            >
                              {senderName}
                            </span>
                          )}
                          {renderCensored(m.text)}
                        </div>
                      );
                    } else {
                      const bubbleSideClass = m.side === "2"
                        ? `bg-[#0A84FF] rounded-2xl ${isLastInSequenceRight ? "im-tail-right" : ""}`
                        : `bg-[#262628] rounded-2xl ${isLastInSequence ? "im-tail-left" : ""}`;
                      return (
                        <div className={`relative max-w-[80%] px-3 py-2 text-white text-[15px] leading-snug ${bubbleSideClass}`}>
                          {renderCensored(m.text)}
                        </div>
                      );
                    }


                  } else if (m.type === "image") {
                    if (m.imageUrl) {
                      if (isWA) {
                        return (
                          <div
                            className={`p-1 rounded-lg ${
                              m.side === "2" ? "bg-[#005c4b] ml-auto" : "bg-[#262d31]"
                            }`}
                          >
                            {showName && (
                              <span
                                className="text-[13px] font-bold px-1.5 pt-0.5 pb-1 capitalize block"
                                style={{ color: nameColor || "#53bdeb" }}
                              >
                                {senderName}
                              </span>
                            )}
                            <img
                              src={m.imageUrl}
                              alt={m.text}
                              className="max-w-[240px] max-h-56 object-cover rounded-md"
                            />
                          </div>
                        );
                      } else {
                        return (
                          <img
                            src={m.imageUrl}
                            alt={m.text}
                            className="max-w-[70%] max-h-56 object-cover rounded-2xl"
                          />
                        );
                      }
                    } else {
                      return (
                        <div className={`h-32 w-48 rounded-2xl flex flex-col items-center justify-center text-xs gap-2 p-2 ${
                          isWA ? "bg-[#262d31] text-[#8696a0]" : "bg-zinc-800 text-zinc-300"
                        }`}>
                          <ImageIcon className="h-8 w-8" />
                          <span className="text-center">{m.text}</span>
                        </div>
                      );
                    }
                  } else if (m.type === "video") {
                    if (m.videoUrl) {
                      const isGif = m.videoType === "gif";
                      if (isWA) {
                        return (
                          <div
                            className={`p-1 rounded-lg ${
                              m.side === "2" ? "bg-[#005c4b] ml-auto" : "bg-[#262d31]"
                            }`}
                          >
                            {showName && (
                              <span
                                className="text-[13px] font-bold px-1.5 pt-0.5 pb-1 capitalize block"
                                style={{ color: nameColor || "#53bdeb" }}
                              >
                                {senderName}
                              </span>
                            )}
                            {isGif ? (
                              <img
                                src={m.videoUrl}
                                alt={m.text}
                                className="max-w-[240px] max-h-[180px] object-cover rounded-md"
                              />
                            ) : (
                              <VideoBubble
                                src={m.videoUrl}
                                recording={recording}
                                className="max-w-[240px] max-h-[180px] object-cover rounded-md"
                                msgId={m.id}
                                chatId={displayChat.id}
                              />
                            )}
                          </div>
                        );
                      } else {
                        return isGif ? (
                          <img
                            src={m.videoUrl}
                            alt={m.text}
                            className="max-w-[240px] max-h-[180px] object-cover rounded-2xl"
                          />
                        ) : (
                          <VideoBubble
                            src={m.videoUrl}
                            recording={recording}
                            className="max-w-[240px] max-h-[180px] object-cover rounded-2xl"
                            msgId={m.id}
                            chatId={displayChat.id}
                          />
                        );
                      }
                    } else {
                      return (
                        <div className={`w-[240px] h-[180px] rounded-2xl flex flex-col items-center justify-center text-xs gap-2 p-2 ${
                          isWA ? "bg-[#262d31] text-[#8696a0]" : "bg-zinc-800 text-zinc-300"
                        }`}>
                          <Video className="h-8 w-8" />
                          <span className="text-center truncate max-w-full px-2">{m.text}</span>
                        </div>
                      );
                    }
                  }
                };

                return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: recording ? 1 : 0, y: recording ? 0 : 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: recording ? 0 : 0.3 }}
                  className={`flex flex-col ${spacingClass} ${
                    m.side === "2" ? "items-end" : "items-start"
                  } ${!effectiveGroupChat && m.side === "1" ? "pl-2" : ""}`}
                >

                  {!isWA && showName && (
                    <span
                      className="text-[11px] mb-0.5 capitalize block"
                      style={{
                        color: nameColor || "#8e8e93",
                        marginLeft: showAvatarPlaceholder ? "36px" : "12px",
                      }}
                    >
                      {senderName}
                    </span>
                  )}
                  {showAvatarPlaceholder ? (
                    <div className="flex flex-row items-end gap-1 w-full">
                      <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center select-none relative z-10">

                        {showAvatar && (
                          avatarUrl ? (
                            <img
                              src={avatarUrl}
                              alt={senderName}
                              className="w-7 h-7 rounded-full object-cover border border-zinc-700/50"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center text-white text-[10px] font-semibold uppercase border border-zinc-700/50">
                              {charInitial}
                            </div>
                          )
                        )}
                      </div>
                      {renderBubble()}
                    </div>
                  ) : (
                    renderBubble()
                  )}

                </motion.div>
              );})}
            </AnimatePresence>
          </div>
        </div>
        </div>
        {!recording && (
          <div
            data-preview-only="true"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1 select-none cursor-ns-resize px-4 py-2 rounded-full bg-black/40 backdrop-blur-sm text-white/90 text-xs"
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              dragStateRef.current = { startY: e.clientY, startOffset: previewDragOffset };
            }}
            onPointerMove={(e) => {
              if (!dragStateRef.current) return;
              const dy = e.clientY - dragStateRef.current.startY;
              let next = dragStateRef.current.startOffset - dy;
              const outer = chatOuterRef.current?.clientHeight ?? 0;
              const inner = chatInnerRef.current?.scrollHeight ?? 0;
              const max = Math.max(0, inner - outer);
              if (next < 0) next = 0;
              if (next > max) next = max;
              setPreviewDragOffset(next);
            }}
            onPointerUp={(e) => {
              (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              dragStateRef.current = null;
            }}
          >
            <div className="w-10 h-1 rounded-full bg-white/70" />
            <span>Arraste para rolar</span>
          </div>
        )}
        {!recording && (() => {
          const outer = chatOuterRef.current?.clientHeight ?? 0;
          const inner = chatInnerRef.current?.scrollHeight ?? 1;
          const max = Math.max(1, inner - outer);
          const ratio = Math.min(1, outer / inner);
          const thumbPct = Math.max(0.08, ratio);
          const offsetPct = max > 0 ? (previewDragOffset / max) * (1 - thumbPct) : 0;
          return (
            <div
              data-preview-only="true"
              className="absolute right-2 top-4 bottom-4 w-2 z-40 rounded-full bg-black/20 backdrop-blur-sm cursor-ns-resize select-none"
              onPointerDown={(e) => {
                const rail = e.currentTarget as HTMLElement;
                rail.setPointerCapture(e.pointerId);
                const rect = rail.getBoundingClientRect();
                const update = (clientY: number) => {
                  const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
                  const pct = y / rect.height;
                  setPreviewDragOffset(pct * max);
                };
                update(e.clientY);
                (rail as any)._update = update;
              }}
              onPointerMove={(e) => {
                const u = (e.currentTarget as any)._update;
                if (u) u(e.clientY);
              }}
              onPointerUp={(e) => {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                (e.currentTarget as any)._update = null;
              }}
            >
              <div
                className="absolute left-0 right-0 rounded-full bg-white/80"
                style={{
                  top: `${offsetPct * 100}%`,
                  height: `${thumbPct * 100}%`,
                }}
              />
            </div>
          );
        })()}
        </div>
          {recording && (
            <div className="absolute inset-0 z-50 bg-black/70 flex flex-col items-center justify-center gap-3 px-6">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
              <div className="text-white text-sm font-medium">
                Rendering... {Math.round(exportProgress)}%
              </div>
              <Progress
                value={exportProgress}
                className="w-full h-2 bg-white/20 [&>div]:bg-emerald-500"
              />
            </div>
          )}
          </div>
          {/* YouTube-style Control Bar */}
          {playing && !recording && (
            <div
              style={{ width: 400 }}
              className="rounded-xl bg-black/80 backdrop-blur-md border border-white/10 px-4 py-3 flex flex-col gap-2"
            >
              {/* Progress Bar */}
              <div
                className="group relative w-full h-2 bg-white/15 rounded-full cursor-pointer hover:h-3 transition-all"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const target = Math.round(pct * totalMsgCount);
                  seekTo(target);
                }}
              >
                <div
                  className="absolute inset-y-0 left-0 bg-red-500 rounded-full transition-all"
                  style={{ width: `${totalMsgCount > 0 ? (currentMsgIndex / totalMsgCount) * 100 : 0}%` }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-red-500 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ left: `calc(${totalMsgCount > 0 ? (currentMsgIndex / totalMsgCount) * 100 : 0}% - 7px)` }}
                />
              </div>

              {/* Controls Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {/* Skip Back */}
                  <button
                    onClick={skipBackward}
                    className="p-1.5 rounded-full hover:bg-white/15 text-white/80 hover:text-white transition-colors"
                    title="Voltar 5 mensagens"
                  >
                    <SkipBack className="h-4 w-4" />
                  </button>

                  {/* Play/Pause */}
                  <button
                    onClick={togglePause}
                    className="p-2 rounded-full hover:bg-white/15 text-white hover:text-white transition-colors"
                    title={paused ? "Continuar" : "Pausar"}
                  >
                    {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
                  </button>

                  {/* Skip Forward */}
                  <button
                    onClick={skipForward}
                    className="p-1.5 rounded-full hover:bg-white/15 text-white/80 hover:text-white transition-colors"
                    title="Avançar 5 mensagens"
                  >
                    <SkipForward className="h-4 w-4" />
                  </button>

                  {/* Stop */}
                  <button
                    onClick={stopPlayback}
                    className="p-1.5 rounded-full hover:bg-white/15 text-white/80 hover:text-white transition-colors"
                    title="Parar"
                  >
                    <Square className="h-4 w-4" />
                  </button>
                </div>

                {/* Time & Progress Info */}
                <div className="flex items-center gap-3 text-xs text-white/70 font-mono">
                  <span>{formatTime(playbackElapsed)}</span>
                  <span className="text-white/40">•</span>
                  <span>{currentMsgIndex}/{totalMsgCount} msgs</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3" style={{ width: 400 }}>
            <Button
              onClick={() => exportVideoFast(false)}
              disabled={!allAudiosReady || playing || recording}
              size="lg"
              className="w-full"
              variant="secondary"
            >
              {recording ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rendering... {Math.round(exportProgress)}%
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4 rotate-180" />
                  Exportar Vídeo (Chat Ativo)
                </>
              )}
            </Button>

            <Button
              onClick={() => exportVideoFast(true)}
              disabled={!allAudiosReady || playing || recording}
              size="lg"
              className="w-full"
              variant="outline"
            >
              {recording ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rendering... {Math.round(exportProgress)}%
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4 rotate-180" />
                  Exportar Vídeo (Todos os Chats)
                </>
              )}
            </Button>
          </div>
        </div>
        </div>
      </TabsContent>

      <TabsContent value="projects" className="mt-0 p-8 bg-background min-h-[calc(100vh-60px)]">
        <div className="max-w-4xl mx-auto space-y-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Meus Projetos</h2>
            <p className="text-sm text-muted-foreground">
              Projetos salvos localmente com áudios e imagens incluídos.
            </p>
          </div>
          {projects.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Nenhum projeto salvo ainda. Salve um projeto na aba Editor.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((p) => {
                const totalMsgs = p.chats.reduce((acc, c) => acc + c.messages.length, 0);
                return (
                  <div
                    key={p.id}
                    className="rounded-lg border p-4 space-y-3 bg-card hover:shadow-md transition"
                  >
                    <div>
                      <div className="font-semibold truncate">{p.projectName}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(p.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.chats.length} chat(s) • {totalMsgs} mensagens • tema {p.theme}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleLoadProject(p)} className="flex-1">
                        <FolderOpen className="h-3 w-3 mr-1" /> Carregar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteProject(p.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
