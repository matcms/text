import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { toCanvas } from "html-to-image";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { Progress } from "@/components/ui/progress";

function dataURLtoBlob(dataurl: string): Blob {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || "video/mp4";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

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
  Settings,
  Cpu,
  FileText,
  Download,
  Menu,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, RefreshCw, Sparkles, Wand2 } from "lucide-react";
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
  instruct?: string;
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
  characterPhotos?: Record<string, string>;
  characterAudios?: Record<string, string>;
  aiPrompt?: string;
  aiChapterInstruction?: string;
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
  characterAudios: {},
  aiPrompt: "",
  aiChapterInstruction: "",
});

// Convert base64 (mp3) to blob URL
const base64ToBlobUrl = (b64: string, mime = "audio/mpeg") => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
};

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // chunk length
  setUint16(1); // sample format (raw)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // byte rate
  setUint16(numOfChan * 2); // block align
  setUint16(16); // bits per sample
  setUint32(0x61746164); // "data" chunk
  setUint32(length - pos - 4); // chunk length

  for (i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return bufferArr;
}

const startLocalRenderServerFn = createServerFn({ method: "POST" })
  .validator((data: any) => data)
  .handler(async ({ data }) => {
    const { exec } = await import("child_process");
    const fs = await import("fs");
    const path = await import("path");
    const http = await import("http");
    
    // data is a FormData instance on the server side
    const projectRaw = data.get("project") as string;
    const audioFile = data.get("audio") as any; // Blob/File
    const bgVideoFile = data.get("bgVideo") as any; // Blob/File
    
    const cwd = process.cwd();
    const timestamp = Date.now();
    const tempDirName = `temp_render_${timestamp}`;
    const tempDirPath = path.join(cwd, "public", tempDirName);
    
    // Create the temporary folder in static public directory
    fs.mkdirSync(tempDirPath, { recursive: true });
    
    // 1) Save audio file
    if (audioFile) {
      const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
      fs.writeFileSync(path.join(tempDirPath, "audio.wav"), audioBuffer);
    }
    
    // 2) Save background video file
    if (bgVideoFile) {
      const bgVideoBuffer = Buffer.from(await bgVideoFile.arrayBuffer());
      fs.writeFileSync(path.join(tempDirPath, "bg_video.mp4"), bgVideoBuffer);
    }
    
    // 3) Save all message video and image files
    for (const key of data.keys()) {
      if (key.startsWith("msgVideo_")) {
        const file = data.get(key) as any;
        if (file) {
          const fileBuffer = Buffer.from(await file.arrayBuffer());
          const idxStr = key.replace("msgVideo_", "");
          fs.writeFileSync(path.join(tempDirPath, `msg_video_${idxStr}.mp4`), fileBuffer);
        }
      } else if (key.startsWith("msgImage_")) {
        const file = data.get(key) as any;
        if (file) {
          const fileBuffer = Buffer.from(await file.arrayBuffer());
          const idxStr = key.replace("msgImage_", "");
          const ext = file.name ? path.extname(file.name) : ".png";
          fs.writeFileSync(path.join(tempDirPath, `msg_image_${idxStr}${ext}`), fileBuffer);
        }
      }
    }
    
    // 4) Spin up a dynamic local HTTP server on port 8085 to bypass Vinxi static asset caching
    const mime: Record<string, string> = {
      ".mp4": "video/mp4",
      ".wav": "audio/wav",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif"
    };

    const fileServer = http.createServer((req: any, res: any) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const urlPath = req.url.split("?")[0];
      const relativePath = urlPath.replace(/^\//, "");
      const filePath = path.join(cwd, "public", relativePath);

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    });

    fileServer.listen(8085);
    
    // 5) Parse project JSON and update all paths to live server asset URLs
    const project = JSON.parse(projectRaw);
    const host = "http://localhost:8085"; // Use the dynamically started file server
    
    // Update audio track path (used by render.js directly)
    project.audioPath = path.join(tempDirPath, "audio.wav");
    
    // Update background path in project (if active background is a video)
    if (bgVideoFile) {
      project.activeBackground = `${host}/${tempDirName}/bg_video.mp4`;
    }
    
    // Update message video and image URLs in project
    if (project.messages && Array.isArray(project.messages)) {
      project.messages = project.messages.map((m: any) => {
        if (m.type === "video" && m.videoUrl && m.videoUrl.endsWith(".mp4")) {
          return {
            ...m,
            videoUrl: `${host}/${tempDirName}/${m.videoUrl}`
          };
        }
        if (m.type === "image" && m.imageUrl && (m.imageUrl.includes("msg_image_") || m.imageUrl.endsWith(".png") || m.imageUrl.endsWith(".jpg") || m.imageUrl.endsWith(".jpeg") || m.imageUrl.endsWith(".gif"))) {
          return {
            ...m,
            imageUrl: `${host}/${tempDirName}/${m.imageUrl}`
          };
        }
        return m;
      });
    }
    
    // Update chats message video and image URLs too
    if (project.chats && Array.isArray(project.chats)) {
      project.chats = project.chats.map((c: any) => {
        if (c.messages && Array.isArray(c.messages)) {
          c.messages = c.messages.map((m: any) => {
            const cleanMsg = project.messages.find((orig: any) => orig.id === m.id);
            if (cleanMsg) return cleanMsg;
            return m;
          });
        }
        return c;
      });
    }
    
    // Write the finalized project file to disk
    const tempJsonPath = path.join(cwd, `temp_project_${timestamp}.json`);
    fs.writeFileSync(tempJsonPath, JSON.stringify(project, null, 2), "utf8");
    
    const command = `start cmd.exe /c "cd /d ${cwd} && node render.js ${tempJsonPath}"`;
    
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      exec(command, (error) => {
        fileServer.close(); // Clean up dynamic file server on completion
        if (error) {
          console.error("Erro ao iniciar o renderizador local:", error);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  });

const startOmniVoiceServerFn = createServerFn({ method: "POST" })
  .handler(async () => {
    const { exec } = await import("child_process");
    const cwd = process.cwd();
    const command = `start cmd.exe /k "cd /d ${cwd} && venv\\Scripts\\activate && python tts_server.py"`;
    
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
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
  const [elevenModel, setElevenModel] = useState("eleven_multilingual_v2");
  const [elevenModels, setElevenModels] = useState<{ model_id: string; name: string }[]>([
    { model_id: "eleven_multilingual_v2", name: "Eleven Multilingual v2" },
    { model_id: "eleven_turbo_v2_5", name: "Eleven Turbo v2.5" },
    { model_id: "eleven_flash_v2_5", name: "Eleven Flash v2.5" },
    { model_id: "eleven_turbo_v2", name: "Eleven Turbo v2" },
    { model_id: "eleven_monolingual_v1", name: "Eleven Monolingual v1" },
    { model_id: "eleven_flash_v2", name: "Eleven Flash v2" },
  ]);
  const [ttsProvider, setTtsProvider] = useState<"elevenlabs" | "omnivoice" | "qwen3">("elevenlabs");
  const [omniVoiceUrl, setOmniVoiceUrl] = useState("http://localhost:8000");
  const [chatTheme, setChatTheme] = useState<ChatTheme>("imessage");
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  
  // AI Speech Emotion Director States
  const [useDirector, setUseDirector] = useState(false);
  const [directorLlmProvider, setDirectorLlmProvider] = useState<"gemini" | "openai" | "local">("gemini");
  const [localLlmUrl, setLocalLlmUrl] = useState("http://localhost:11434/v1");
  const [localLlmModel, setLocalLlmModel] = useState("gemma2");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [isDirecting, setIsDirecting] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeInstructions, setYoutubeInstructions] = useState("");
  const [visualAnalysis, setVisualAnalysis] = useState(false);

  // Formatting States
  const [rawScriptInput, setRawScriptInput] = useState("");
  const [formatterInstructions, setFormatterInstructions] = useState("");
  const [formattedScriptOutput, setFormattedScriptOutput] = useState("");
  const [isFormatting, setIsFormatting] = useState(false);

  // OmniVoice advanced tuning parameters
  const [omniNumStep, setOmniNumStep] = useState(32);
  const [omniGuidanceScale, setOmniGuidanceScale] = useState(2.0);

  const [chats, setChats] = useState<Chat[]>([newChat(1)]);
  const [activeChatId, setActiveChatId] = useState<string>(chats[0].id);
  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0] || {
    id: "",
    name: "",
    contactName: "",
    contactPhoto: null,
    messages: [],
    voiceMap: {},
    nameColors: {},
    characterPhotos: {},
    characterAudios: {}
  };

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
  type SavedVoice = { name: string; voiceId: string; referenceAudioB64?: string };
  const [savedVoices, setSavedVoices] = useState<SavedVoice[]>([]);
  const [newVoiceName, setNewVoiceName] = useState("");
  const [newVoiceId, setNewVoiceId] = useState("");
  const [newVoiceRefAudioB64, setNewVoiceRefAudioB64] = useState<string | null>(null);
  const [designGender, setDesignGender] = useState("female");
  const [designAge, setDesignAge] = useState("young adult");
  const [designPitch, setDesignPitch] = useState("moderate pitch");
  const [designAccent, setDesignAccent] = useState("portuguese accent");

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
    if (!n) return;
    
    let v = "";
    if (ttsProvider === "omnivoice" || ttsProvider === "qwen3") {
      v = [designGender, designAge, designPitch, designAccent].filter(Boolean).join(", ");
    } else {
      v = newVoiceId.trim();
    }
    
    if (!v) return;
    setSavedVoices((p) => [
      ...p.filter((x) => x.name !== n),
      { name: n, voiceId: v, referenceAudioB64: newVoiceRefAudioB64 || undefined }
    ]);
    setNewVoiceName("");
    setNewVoiceId("");
    setNewVoiceRefAudioB64(null);
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
  const [activeSection, setActiveSection] = useState<"project" | "script" | "formatter" | "characters" | "media" | "generation" | "export" | "settings">("project");
  const [generatingCharacter, setGeneratingCharacter] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const bgVideoInputRef = useRef<HTMLInputElement | null>(null);
  const [bgVideoOffset, setBgVideoOffset] = useState<number>(0); // Video background start offset in seconds
  const [bgVideoDuration, setBgVideoDuration] = useState<number>(0);
  const activeBgVideoRef = useRef<HTMLVideoElement | null>(null);
  const [exportFps, setExportFps] = useState<number>(30);
  const [bgVideoResolution, setBgVideoResolution] = useState<string>("");
  const [activeBgBlobUrl, setActiveBgBlobUrl] = useState<string>("");
  const isBgVideo = activeBackground.startsWith("data:video/") || activeBackground.endsWith(".mp4") || activeBackground.includes("/bg_video.mp4");

  useEffect(() => {
    if (activeBackground.startsWith("data:video/")) {
      try {
        const blob = dataURLtoBlob(activeBackground);
        const url = URL.createObjectURL(blob);
        setActiveBgBlobUrl(url);
        return () => {
          URL.revokeObjectURL(url);
        };
      } catch (e) {
        console.error("Failed to create blob url for background", e);
        setActiveBgBlobUrl(activeBackground);
      }
    } else {
      setActiveBgBlobUrl("");
    }
  }, [activeBackground]);

  const [isRenderLocalActive, setIsRenderLocalActive] = useState(false);
  const [localExportProgress, setLocalExportProgress] = useState(0);
  const [isLocalExporting, setIsLocalExporting] = useState(false);

  useEffect(() => {
    const isRender = typeof window !== "undefined" && window.location.pathname === "/render-local";
    if (isRender) {
      setIsRenderLocalActive(true);
      document.body.classList.add("is-render-local-mode");
      
      console.log("Render mode active. Exposing global methods...");
      
      (window as any).initRenderLocal = (data: any) => {
        console.log("initRenderLocal called", data);
        setProjectName(data.projectName || "chat-story");
        setChatTheme(data.chatTheme || "imessage");
        const newChats = data.chats || [];
        setChats(newChats);
        if (newChats.length > 0) {
          setActiveChatId(newChats[0].id);
        }
        setActiveBackground(data.activeBackground || "#9333ea");
        setBgVideoOffset(data.bgVideoOffset || 0);
      };

      (window as any).renderFrameLocal = async (timeSec: number) => {
        if (!(window as any).projectData) return;
        const data = (window as any).projectData;
        const msgList = data.messages || [];
        const startTimes = data.startTimesSec || [];
        const currentChatTheme = data.chatTheme || "imessage";

        let visibleIdx = -1;
        for (let idx = 0; idx < msgList.length; idx++) {
          if (startTimes[idx] <= timeSec) {
            visibleIdx = idx;
          } else {
            break;
          }
        }

        const visibleSlice = msgList.slice(0, visibleIdx + 1);
        setVisibleMessages(visibleSlice);

        if (visibleSlice.length > 0) {
          const lastMsg = visibleSlice[visibleSlice.length - 1];
          const lastMsgChatId = lastMsg.chatId || (data.chats?.[0]?.id);
          if (lastMsgChatId) {
            setPlayingChatId(lastMsgChatId);
            setActiveChatId(lastMsgChatId);
          }
        }

        await new Promise((r) => requestAnimationFrame(r));
        const scrollEl = chatScrollRef.current;
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }

        const bgVideo = document.querySelector("video.bg-video-el") as HTMLVideoElement;
        if (bgVideo) {
          const dur = bgVideo.duration || 1;
          const target = (timeSec + (data.bgVideoOffset || 0)) % dur;
          
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              bgVideo.removeEventListener("seeked", onSeeked);
              resolve();
            };
            bgVideo.addEventListener("seeked", onSeeked);
            bgVideo.currentTime = target;
            setTimeout(() => {
              bgVideo.removeEventListener("seeked", onSeeked);
              resolve();
            }, 100);
          });
        }

        const bubbleVideos = document.querySelectorAll("video:not(.bg-video-el)");
        const seekPromises = Array.from(bubbleVideos).map((video) => {
          const url = video.getAttribute("src") || "";
          const placeholder = document.querySelector(`[data-video-src="${url}"]`);
          if (!placeholder) return Promise.resolve();

          const msgIdAttr = placeholder.getAttribute("data-msg-id");
          const msgId = msgIdAttr ? parseInt(msgIdAttr, 10) : -1;
          const msgIndex = msgList.findIndex((m: any) => m.id === msgId);
          const videoStartSec = msgIndex >= 0 ? startTimes[msgIndex] : 0;
          const elapsed = timeSec - videoStartSec;

          return new Promise<void>((resolve) => {
            const el = video as HTMLVideoElement;
            const onSeeked = () => {
              el.removeEventListener("seeked", onSeeked);
              resolve();
            };
            el.addEventListener("seeked", onSeeked);
            el.currentTime = Math.max(0, elapsed);
            setTimeout(() => {
              el.removeEventListener("seeked", onSeeked);
              resolve();
            }, 100);
          });
        });

        await Promise.all(seekPromises);
      };

      return () => {
        document.body.classList.remove("is-render-local-mode");
      };
    }
  }, [activeBackground]);

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

  const addVideoBackground = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      const bg: StoredBackground = {
        id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "video",
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
          aiPrompt: c.aiPrompt || "",
          aiChapterInstruction: c.aiChapterInstruction || "",
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
      aiPrompt: c.aiPrompt || "",
      aiChapterInstruction: c.aiChapterInstruction || "",
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
    setActiveSection("project");
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm("Excluir este projeto?")) return;
    await deleteProject(id);
    await refreshProjects();
  };

  useEffect(() => {
    setElevenKey(localStorage.getItem("elevenlabs_api_key") || "");
    setChatTheme((localStorage.getItem("chat_theme") as ChatTheme) || "imessage");
    setTtsProvider((localStorage.getItem("tts_provider") as "elevenlabs" | "omnivoice" | "qwen3") || "elevenlabs");
    setOmniVoiceUrl(localStorage.getItem("omnivoice_url") || "http://localhost:8000");
    setUseDirector(localStorage.getItem("use_director") === "true");
    setDirectorLlmProvider((localStorage.getItem("director_llm_provider") as "gemini" | "openai" | "local") || "gemini");
    setLocalLlmUrl(localStorage.getItem("local_llm_url") || "http://localhost:11434/v1");
    setLocalLlmModel(localStorage.getItem("local_llm_model") || "gemma2");
    setGeminiApiKey(localStorage.getItem("gemini_api_key") || "");
    setOpenaiApiKey(localStorage.getItem("openai_api_key") || "");
    setOpenaiModel(localStorage.getItem("openai_model") || "gpt-4o-mini");
    setOmniNumStep(Number(localStorage.getItem("omni_num_step")) || 32);
    setOmniGuidanceScale(Number(localStorage.getItem("omni_guidance_scale")) || 2.0);
    setBgVideoOffset(Number(localStorage.getItem("bg_video_offset")) || 0);
    setExportFps(Number(localStorage.getItem("export_fps")) || 30);
  }, []);
  useEffect(() => {
    localStorage.setItem("elevenlabs_api_key", elevenKey);
  }, [elevenKey]);
  useEffect(() => {
    localStorage.setItem("elevenlabs_model", elevenModel);
  }, [elevenModel]);
  useEffect(() => {
    if (elevenKey) {
      fetchElevenModels();
    }
  }, [elevenKey]);
  useEffect(() => {
    localStorage.setItem("bg_video_offset", String(bgVideoOffset));
  }, [bgVideoOffset]);
  useEffect(() => {
    localStorage.setItem("export_fps", String(exportFps));
  }, [exportFps]);
  useEffect(() => {
    localStorage.setItem("chat_theme", chatTheme);
  }, [chatTheme]);
  useEffect(() => {
    localStorage.setItem("tts_provider", ttsProvider);
  }, [ttsProvider]);
  useEffect(() => {
    localStorage.setItem("omnivoice_url", omniVoiceUrl);
  }, [omniVoiceUrl]);
  useEffect(() => {
    localStorage.setItem("use_director", String(useDirector));
  }, [useDirector]);
  useEffect(() => {
    localStorage.setItem("director_llm_provider", directorLlmProvider);
  }, [directorLlmProvider]);
  useEffect(() => {
    localStorage.setItem("local_llm_url", localLlmUrl);
  }, [localLlmUrl]);
  useEffect(() => {
    localStorage.setItem("local_llm_model", localLlmModel);
  }, [localLlmModel]);
  useEffect(() => {
    localStorage.setItem("gemini_api_key", geminiApiKey);
  }, [geminiApiKey]);
  useEffect(() => {
    localStorage.setItem("openai_api_key", openaiApiKey);
  }, [openaiApiKey]);
  useEffect(() => {
    localStorage.setItem("openai_model", openaiModel);
  }, [openaiModel]);
  useEffect(() => {
    localStorage.setItem("omni_num_step", String(omniNumStep));
  }, [omniNumStep]);
  useEffect(() => {
    localStorage.setItem("omni_guidance_scale", String(omniGuidanceScale));
  }, [omniGuidanceScale]);

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

  const parseScript = (scriptOverride?: string | React.MouseEvent) => {
    const scriptToParse = typeof scriptOverride === "string" ? scriptOverride : activeChat.script;
    const lines = scriptToParse.split("\n").map((l) => l.trim()).filter(Boolean);

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
    const reader = new FileReader();
    reader.onloadend = () => {
      const b64 = reader.result as string;
      updateActiveChat({ contactPhoto: b64 });
    };
    reader.readAsDataURL(file);
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
  const fetchElevenModels = async () => {
    if (!elevenKey) return;
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/models", {
        headers: { "xi-api-key": elevenKey },
      });
      if (!res.ok) throw new Error(`ElevenLabs models error: ${await res.text()}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.models || []);
      if (list && list.length > 0) {
        const formatted = list.map((m: any) => ({
          model_id: m.model_id,
          name: m.name || m.model_id,
        }));
        setElevenModels(formatted);
      }
    } catch (err) {
      console.error("Erro ao carregar modelos do ElevenLabs:", err);
    }
  };

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
          model_id: elevenModel || "eleven_multilingual_v2",
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
    // 0. Check if there is a custom reference audio uploaded for this character
    const targetChat = chats.find((c) => c.id === chatId);
    const customAudioB64 = targetChat?.characterAudios?.[voiceName];
    if (customAudioB64) {
      try {
        let mime = "audio/mpeg";
        let pureB64 = customAudioB64;
        if (customAudioB64.startsWith("data:")) {
          const match = customAudioB64.match(/^data:(.*?);base64,/);
          if (match) {
            mime = match[1];
            pureB64 = customAudioB64.slice(match[0].length);
          }
        }
        const bin = atob(pureB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        console.log(`[findReferenceAudio] Retornando áudio customizado carregado para o personagem ${voiceName}`);
        return new Blob([bytes], { type: mime });
      } catch (err) {
        console.error("Erro ao converter áudio de referência customizado:", err);
      }
    }

    // 1. Search in the active/current chat messages
    const currentChatMessages = localMessagesMap
      ? localMessagesMap[chatId]
      : targetChat?.messages;

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

  const directSpeechWithAI = async () => {
    const textMsgs = activeChat.messages.filter(
      (m): m is TextMsg => m.type === "text"
    );
    if (textMsgs.length === 0) {
      alert("Não há mensagens de texto para analisar no chat ativo.");
      return;
    }

    let apiKey = "";
    if (directorLlmProvider !== "local") {
      apiKey = directorLlmProvider === "gemini" ? geminiApiKey : openaiApiKey;
      if (!apiKey.trim()) {
        alert(`Por favor, insira sua API Key do ${directorLlmProvider === "gemini" ? "Gemini" : "OpenAI"} nas configurações.`);
        return;
      }
    }

    setIsDirecting(true);
    try {
      const dialogueLines = textMsgs.map((m) => `ID: ${m.id} | ${m.voiceName}: ${m.text}`).join("\n");
      
      const promptText = `Aqui está o diálogo completo do chat. Analise as falas no contexto geral da conversa para determinar o tom de voz correto ("instruct") e os ajustes expressivos ("spokenText") para cada uma.
Mantenha a consistência emocional entre as respostas.

Diálogo do Chat:
${dialogueLines}

Retorne um array JSON contendo as decisões de direção de fala para cada ID de mensagem fornecido.
O formato final de cada objeto do array DEVE ser exatamente:
{
  "id": número (correspondente ao ID da mensagem),
  "spokenText": "texto original com pontuações expressivas ou tags [laughter]/[sigh] se necessário. Ex: 'Hum... [sigh] Não acredito...'",
  "instruct": "tom de voz OmniVoice ('whisper', 'low pitch', 'very low pitch', 'moderate pitch', 'high pitch', 'very high pitch' ou '')"
}`;

      const systemPrompt = `Você é o Diretor de Expressão de Voz (Speech Emotion Director).
Sua tarefa é analisar o diálogo de um chat e decidir como cada fala deve ser interpretada pelo motor de Text-to-Speech (TTS) OmniVoice.

Para cada mensagem de texto, você deve:
1. Definir o tom de voz (campo "instruct") usando APENAS um dos seguintes valores oficiais do OmniVoice:
   - "whisper" (para sussurros, segredos, medo intenso)
   - "low pitch" (para falas sérias, tristes, calmas, deprimidas)
   - "very low pitch" (para vozes muito graves, ameaçadoras ou sombrias)
   - "moderate pitch" (para diálogo normal, neutro)
   - "high pitch" (para alegria, empolgação, surpresa, perguntas ou fala mais rápida)
   - "very high pitch" (para gritos, raiva extrema, desespero ou grande agitação)
   - "" (vazio, para deixar o padrão do clone de voz)

2. Ajustar o texto falado (campo "spokenText") para expressar melhor a emoção através de pontuação e tags não-verbais. O OmniVoice suporta as tags "[laughter]" (risada) e "[sigh]" (suspiro) inseridas no texto.
   Dicas para "spokenText":
   - Use reticências "..." para indicar hesitação, pausas dramáticas ou tristeza.
   - Use exclamações triplas "!!!" e letras maiúsculas para palavras gritadas ou com muita ênfase (ex: "NÃO faça isso!!!").
   - Adicione "[laughter]" para risadas curtas ou falas achando graça (ex: "[laughter] Sério mesmo?").
   - Adicione "[sigh]" para demonstrar desânimo, cansaço ou alívio (ex: "[sigh] Que bom que acabou.").
   - NÃO altere o significado ou as palavras da mensagem principal; faça apenas ajustes expressivos de formatação, pontuação e inclusão de tags.

Analise o fluxo do chat para garantir consistência no diálogo (se um personagem está irritado em uma fala, a resposta do outro ou a fala seguinte deve refletir esse contexto).`;

      let parsedResults: Array<{ id: number; spokenText: string; instruct: string }> = [];

      if (directorLlmProvider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: promptText }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    id: { type: "INTEGER" },
                    spokenText: { type: "STRING" },
                    instruct: { type: "STRING" }
                  },
                  required: ["id", "spokenText", "instruct"]
                }
              }
            }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Erro API Gemini: ${errText}`);
        }

        const data = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) throw new Error("A API do Gemini retornou uma resposta sem texto.");
        parsedResults = JSON.parse(jsonText);
      } else if (directorLlmProvider === "openai") {
        const url = "https://api.openai.com/v1/chat/completions";
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: openaiModel || "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: promptText }
            ],
            response_format: { type: "json_object" }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Erro API OpenAI: ${errText}`);
        }

        const data = await response.json();
        const jsonText = data.choices?.[0]?.message?.content;
        if (!jsonText) throw new Error("A API da OpenAI retornou uma resposta sem conteúdo.");
        const rawJson = JSON.parse(jsonText);
        parsedResults = Array.isArray(rawJson) 
          ? rawJson 
          : (rawJson.emotions || rawJson.results || rawJson.dialogue || Object.values(rawJson)[0] as any);
      } else {
        // Local LLM
        const baseUrl = localLlmUrl.replace(/\/$/, "");
        const url = `${baseUrl}/chat/completions`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer local-key-not-needed"
          },
          body: JSON.stringify({
            model: localLlmModel || "local-model",
            messages: [
              { role: "user", content: `${systemPrompt}\n\n${promptText}` }
            ],
            response_format: { type: "json_object" }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Erro API Local: ${errText}`);
        }

        const data = await response.json();
        const jsonText = data.choices?.[0]?.message?.content;
        if (!jsonText) throw new Error("O modelo local retornou uma resposta sem conteúdo.");
        const rawJson = JSON.parse(jsonText);
        parsedResults = Array.isArray(rawJson) 
          ? rawJson 
          : (rawJson.emotions || rawJson.results || rawJson.dialogue || Object.values(rawJson)[0] as any);
      }

      if (!Array.isArray(parsedResults)) {
        throw new Error("A resposta da IA não pôde ser interpretada como uma lista de emoções.");
      }

      const updatedMessages = activeChat.messages.map((msg) => {
        if (msg.type !== "text") return msg;
        const aiMatch = parsedResults.find((r) => r.id === msg.id);
        if (aiMatch) {
          return {
            ...msg,
            spokenText: aiMatch.spokenText || undefined,
            instruct: aiMatch.instruct || undefined,
          };
        }
        return msg;
      });

      updateActiveChat({ messages: updatedMessages });
      toast.success("Direção de voz concluída com sucesso! Emoções aplicadas ao chat.");
    } catch (e) {
      console.error(e);
      alert(`Falha ao dirigir falas: ${(e as Error).message}`);
    } finally {
      setIsDirecting(false);
    }
  };

  const generateScriptWithAI = async (isContinuation: boolean) => {
    let apiKey = "";
    if (directorLlmProvider !== "local") {
      apiKey = directorLlmProvider === "gemini" ? geminiApiKey : openaiApiKey;
      if (!apiKey.trim()) {
        alert(`Por favor, insira sua API Key do ${directorLlmProvider === "gemini" ? "Gemini" : "OpenAI"} nas configurações avançadas.`);
        return;
      }
    }

    setIsGeneratingScript(true);
    try {
      // Gather context from all chats in the project
      const otherChatsContext = chats
        .filter((c) => c.id !== activeChatId)
        .map((c) => {
          const lines = c.script.split("\n").filter(Boolean);
          const previewLines = lines.slice(-20).join("\n"); // last 20 lines
          return `Chat "${c.contactName}":\n${previewLines}`;
        })
        .join("\n\n");

      const currentChatHistory = activeChat.script || "";

      let userPrompt = "";
      if (!isContinuation) {
        if (!activeChat.aiPrompt?.trim()) {
          alert("Por favor, digite a premissa geral do roteiro.");
          setIsGeneratingScript(false);
          return;
        }
        userPrompt = `Crie um novo roteiro de chat story baseado na seguinte premissa geral:
Premissa Geral: "${activeChat.aiPrompt}"

Gere as primeiras 20 a 30 mensagens da história. Certifique-se de começar com o cabeçalho do tema.`;
      } else {
        userPrompt = `Continue o roteiro de chat story atual.
Histórico das conversas em outras abas/chats do projeto (para contexto):
${otherChatsContext || "Nenhum chat anterior."}

Histórico atual deste chat (últimas mensagens):
${currentChatHistory}

Instrução/Direção para este novo capítulo/bloco de mensagens:
"${activeChat.aiChapterInstruction || "Continue a história de forma natural e surpreendente"}"

Gere as próximas 20 a 30 mensagens da história no mesmo formato textual, dando continuidade exata à última fala. NÃO repita nenhuma mensagem anterior do histórico. NÃO inclua nenhum cabeçalho de tema. Comece diretamente com a próxima fala.`;
      }

      const systemPrompt = `Você é um roteirista profissional e assistente de escrita para um gerador de Chat Stories em formato de vídeo (estilo conversa de WhatsApp/iMessage).
Sua tarefa é escrever diálogos naturais, engajadores, com suspense ou humor, dependendo da premissa fornecida.

O roteiro gerado DEVE seguir EXATAMENTE o seguinte formato textual:
- Se for o início da conversa (primeiro capítulo), comece com o cabeçalho do tema na primeira linha:
- iMessage: [Nome do Contato ou do Grupo]
(Ou "- WhatsApp: [Nome]")

- As falas seguintes devem ter a estrutura:
[Lado]: [NomePersonagem]> [Mensagem]

Onde [Lado] é:
1 - Lado esquerdo (personagem remoto/outro participante)
2 - Lado direito (personagem autor/dono do celular)

Exemplo de formato válido:
- iMessage: Lucas
1: Lucas> Oi Amor, tudo bem?
2: Ana> Oi! Tudo sim, e com você?
1: Lucas> Estou ótimo. Onde você está?

Dicas de formatação que você PODE usar:
• Mídias:
1: img: [descrição da imagem para aparecer na tela]
2: gif: [descrição do gif animado]

Exemplo com mídia:
2: Ana> Olha o que eu achei na rua:
2: img: um gatinho preto pequeno de olhos verdes
1: Lucas> Meu Deus! Que fofo!

Regras CRÍTICAS:
1. Retorne APENAS o texto do roteiro no formato especificado. Não escreva nenhuma introdução, explicação ou consideração antes ou depois do roteiro.
2. Certifique-se de que cada linha de diálogo comece exatamente com "1: " ou "2: " seguido pelo nome do personagem, caractere ">" e a mensagem.
3. Se for uma continuação (capítulo seguinte), NÃO gere cabeçalhos (como "- iMessage: ..."), apenas as falas que continuam a história.
4. Mantenha os nomes dos personagens exatamente iguais aos que já foram criados no histórico do chat.
5. NUNCA inicie ou inclua títulos ou cabeçalhos em Markdown (por exemplo, NÃO use '#', '##' ou '###' para títulos ou seções como '## Roteiro'). Comece a resposta diretamente com o conteúdo do roteiro (seja o cabeçalho do tema ou a primeira fala).`;

      let generatedText = "";

      if (directorLlmProvider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Erro API Gemini: ${errText}`);
        }

        const data = await response.json();
        generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!generatedText) throw new Error("A API do Gemini retornou uma resposta sem texto.");
      } else if (directorLlmProvider === "openai") {
        const url = "https://api.openai.com/v1/chat/completions";
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: openaiModel || "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Erro API OpenAI: ${errText}`);
        }

        const data = await response.json();
        generatedText = data.choices?.[0]?.message?.content;
        if (!generatedText) throw new Error("A API da OpenAI retornou uma resposta sem conteúdo.");
      } else {
        // Local LLM
        const baseUrl = localLlmUrl.replace(/\/$/, "");
        const url = `${baseUrl}/chat/completions`;

        let fewShotPrompt = "";
        if (!isContinuation) {
          fewShotPrompt = `Exemplo de Geração (inicie diretamente sem títulos ou cabeçalhos Markdown):\n` +
            `Entrada: Premissa Geral: "Um casal decidindo o que jantar"\n\n` +
            `Saída:\n` +
            `- iMessage: Amor\n` +
            `2: Ana> Oi! O que vamos jantar hoje?\n` +
            `1: Lucas> Não sei, que tal pizza?\n` +
            `2: Ana> Pizza de novo? Comemos ontem!\n\n` +
            `Agora, gere a história para a seguinte entrada:\n` +
            `${userPrompt}`;
        } else {
          fewShotPrompt = `Exemplo de Geração de Continuação (inicie diretamente com as falas, sem cabeçalhos ou títulos Markdown):\n` +
            `Entrada: Histórico atual: \n` +
            `- iMessage: Amor\n` +
            `2: Ana> O que vamos jantar hoje?\n` +
            `1: Lucas> Que tal pizza?\n\n` +
            `Instrução: Ana sugere hambúrguer.\n\n` +
            `Saída:\n` +
            `2: Ana> Que tal pedirmos hambúrguer?\n` +
            `1: Lucas> Boa! Aquele artesanal?\n\n` +
            `Agora, gere a continuação para a seguinte entrada:\n` +
            `${userPrompt}`;
        }

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer local-key-not-needed"
          },
          body: JSON.stringify({
            model: localLlmModel || "local-model",
            messages: [
              { role: "user", content: `${systemPrompt}\n\n${fewShotPrompt}` }
            ]
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Erro API Local: ${errText}`);
        }

        const data = await response.json();
        generatedText = data.choices?.[0]?.message?.content;
        if (!generatedText) throw new Error("O modelo local retornou uma resposta sem conteúdo.");
      }

      generatedText = generatedText.trim();

      // Limpar blocos de markdown se a IA colocar
      generatedText = generatedText.replace(/^```[a-zA-Z]*\n/g, "").replace(/\n```$/g, "").trim();

      let newScript = "";
      if (isContinuation) {
        const currentScript = activeChat.script || "";
        const endsWithNewline = currentScript.endsWith("\n");
        newScript = currentScript + (endsWithNewline ? "" : "\n") + "\n" + generatedText;
        updateActiveChat({
          script: newScript,
          aiChapterInstruction: ""
        });
        toast.success("Próximo capítulo gerado e adicionado ao roteiro!");
      } else {
        newScript = generatedText;
        updateActiveChat({
          script: newScript
        });
        toast.success("Roteiro inicial gerado com sucesso!");
      }

      parseScript(newScript);

    } catch (e) {
      console.error(e);
      alert(`Falha ao gerar roteiro por IA: ${(e as Error).message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const generateScriptFromYouTube = async () => {
    if (!youtubeUrl.trim()) {
      alert("Por favor, digite o link do vídeo do YouTube.");
      return;
    }

    if (directorLlmProvider !== "local") {
      const apiKey = directorLlmProvider === "gemini" ? geminiApiKey : openaiApiKey;
      if (!apiKey.trim()) {
        alert(`Por favor, insira sua API Key do ${directorLlmProvider === "gemini" ? "Gemini" : "OpenAI"} nas configurações avançadas.`);
        return;
      }
    }

    if (visualAnalysis && directorLlmProvider !== "gemini") {
      alert("A Análise Visual (IA assistindo ao vídeo) requer o provedor Gemini. Por favor, mude o provedor nas configurações avançadas ou desmarque a Análise Visual.");
      return;
    }

    setIsGeneratingScript(true);
    try {
      const baseUrl = omniVoiceUrl || "http://localhost:8000";
      
      const response = await fetch(`${baseUrl}/analyze-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          video_url: youtubeUrl,
          gemini_api_key: geminiApiKey,
          openai_api_key: openaiApiKey,
          provider: directorLlmProvider,
          visual_analysis: visualAnalysis,
          prompt: youtubeInstructions || activeChat.aiPrompt || "",
          local_llm_url: localLlmUrl,
          local_llm_model: localLlmModel,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro do servidor local: ${response.status}`);
      }

      const data = await response.json();
      if (!data.script) {
        throw new Error("O servidor não retornou nenhuma fala de chat.");
      }

      const newScript = data.script.trim();
      updateActiveChat({
        script: newScript,
      });

      toast.success("Roteiro do YouTube gerado com sucesso!");
      parseScript(newScript);
      
    } catch (e) {
      console.error(e);
      alert(`Falha ao importar do YouTube: ${(e as Error).message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const formatScriptWithAI = async () => {
    if (!rawScriptInput.trim()) {
      alert("Por favor, cole o roteiro original que deseja formatar.");
      return;
    }

    let apiKey = "";
    if (directorLlmProvider !== "local") {
      apiKey = directorLlmProvider === "gemini" ? geminiApiKey : openaiApiKey;
      if (!apiKey.trim()) {
        alert(`Por favor, insira sua API Key do ${directorLlmProvider === "gemini" ? "Gemini" : "OpenAI"} nas configurações avançadas.`);
        return;
      }
    }

    setIsFormatting(true);
    try {
      const systemPrompt = `Você é um especialista em formatação de diálogos de chat e roteiros.
Sua tarefa é ler um roteiro fornecido pelo usuário (que pode estar em qualquer formato: texto corrido, roteiro teatral tradicional, diálogo de livro, transcrição de áudio, etc.) e convertê-lo/formatá-lo EXATAMENTE no formato exigido pelo nosso gerador de Chat Stories.

O roteiro formatado resultante DEVE seguir EXATAMENTE o seguinte formato textual:
- Comece com o cabeçalho do tema na primeira linha:
- iMessage: [Nome do Contato ou do Grupo]
(Ou "- WhatsApp: [Nome]")

- As falas seguintes devem ter a estrutura:
[Lado]: [NomePersonagem]> [Mensagem]

Onde [Lado] é:
1 - Lado esquerdo (personagem remoto/outro participante)
2 - Lado direito (personagem autor/dono do celular)

Exemplo de formato válido:
- iMessage: Lucas
1: Lucas> Oi Amor, tudo bem?
2: Ana> Oi! Tudo sim, e com você?
1: Lucas> Estou ótimo. Onde você está?

Dicas de formatação que você PODE usar:
• Mídias:
1: img: [descrição da imagem para aparecer na tela]
2: gif: [descrição do gif animado]

Regras CRÍTICAS:
1. Retorne APENAS o texto do roteiro formatado. Não escreva nenhuma introdução, explicação, notas ou consideração antes ou depois do roteiro.
2. Certifique-se de que cada linha de diálogo comece exatamente com "1: " ou "2: " seguido pelo nome do personagem, caractere ">" e a mensagem.
3. Classifique os lados coerentemente: mantenha o personagem principal (normalmente o autor do chat/dono do celular) sempre do lado direito ("2: ") e os interlocutores do lado esquerdo ("1: ").
4. Se o usuário forneceu orientações adicionais de tradução ou modificações, siga-as à risca durante a formatação.
5. Se o texto original contiver múltiplos chats ou cenas separados (como diferentes blocos de diálogo), certifique-se de colocar um cabeçalho "- iMessage: [NomeDoChat]" ou "- WhatsApp: [NomeDoChat]" para cada um deles no início de seu respectivo bloco, e separe cada bloco de chat com uma linha contendo "---".
6. NUNCA inicie ou estruture a resposta com títulos ou cabeçalhos em Markdown (por exemplo, NÃO use '#', '##' ou '###' como '## Roteiro'). Comece a resposta diretamente com o cabeçalho do tema (ex: - iMessage: Lucas).`;

      let userPrompt = `Roteiro original a ser formatado:\n${rawScriptInput}\n\n`;
      if (formatterInstructions.trim()) {
        userPrompt += `Orientações adicionais do usuário:\n${formatterInstructions}\n\n`;
      }
      userPrompt += `Formate o roteiro seguindo estritamente as regras especificadas.`;

      let generatedText = "";

      if (directorLlmProvider === "gemini") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Erro API Gemini: ${errText}`);
        }

        const data = await response.json();
        generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!generatedText) throw new Error("A API do Gemini retornou uma resposta sem texto.");
      } else if (directorLlmProvider === "openai") {
        const url = "https://api.openai.com/v1/chat/completions";
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: openaiModel || "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Erro API OpenAI: ${errText}`);
        }

        const data = await response.json();
        generatedText = data.choices?.[0]?.message?.content;
        if (!generatedText) throw new Error("A API da OpenAI retornou uma resposta sem conteúdo.");
      } else {
        // Local LLM
        const baseUrl = localLlmUrl.replace(/\/$/, "");
        const url = `${baseUrl}/chat/completions`;

        const fewShotPrompt = `Exemplo de Conversão (inicie diretamente sem títulos ou cabeçalhos Markdown):\n` +
          `Entrada:\n` +
          `Dr. Woods: Mantenha-me atualizado\n` +
          `Dr. Woods: Vamos garantir que isso nunca mais aconteça\n` +
          `EU: Concordo\n\n` +
          `Saída:\n` +
          `- iMessage: Dr. Woods\n` +
          `1: Dr. Woods> Mantenha-me atualizado\n` +
          `1: Dr. Woods> Vamos garantir que isso nunca mais aconteça\n` +
          `2: EU> Concordo\n\n` +
          `Agora, converta o seguinte:\n` +
          `${userPrompt}`;

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer local-key-not-needed"
          },
          body: JSON.stringify({
            model: localLlmModel || "local-model",
            messages: [
              { role: "user", content: `${systemPrompt}\n\n${fewShotPrompt}` }
            ]
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Erro API Local: ${errText}`);
        }

        const data = await response.json();
        generatedText = data.choices?.[0]?.message?.content;
        if (!generatedText) throw new Error("O modelo local retornou uma resposta sem conteúdo.");
      }

      generatedText = generatedText.trim();
      // Limpar blocos de markdown se a IA colocar
      generatedText = generatedText.replace(/^```[a-zA-Z]*\n/g, "").replace(/\n```$/g, "").trim();

      setFormattedScriptOutput(generatedText);
      toast.success("Roteiro formatado com sucesso!");

    } catch (e) {
      console.error(e);
      alert(`Falha ao formatar roteiro: ${(e as Error).message}`);
    } finally {
      setIsFormatting(false);
    }
  };

  const ttsOmniVoice = async (
    text: string,
    voiceName: string,
    chatId: string,
    localMessagesMap?: Record<string, Msg[]>,
    instruct?: string,
    speed?: number
  ): Promise<string> => {
    let refBlob = await findReferenceAudio(voiceName, chatId, localMessagesMap);
    
    // If no reference audio is found, check if we can run in Voice Design mode
    if (!refBlob) {
      // Find the mapped voice setting for this character
      const chat = chats.find((c) => c.id === chatId);
      let characterVoiceSetting = (chat?.voiceMap[voiceName] || "").trim();
      if (!characterVoiceSetting) {
        const sv = savedVoices.find(
          (v) => v.name.toLowerCase() === voiceName.toLowerCase()
        );
        if (sv) characterVoiceSetting = sv.voiceId;
      }

      // Check if we have an explicit instruct or a character voice setting to use for Voice Design
      const voiceDesignInstruct = (instruct && instruct.trim()) ? instruct : characterVoiceSetting;

      if (voiceDesignInstruct && voiceDesignInstruct.trim()) {
        console.log(`[OmniVoice] Nenhum áudio de referência encontrado. Usando modo Voice Design com instrução: ${voiceDesignInstruct}`);
        instruct = voiceDesignInstruct;
      } else if (ttsProvider === "qwen3") {
        console.log(`[Qwen3] Nenhum áudio de referência encontrado. Usando modo Voice Design padrão.`);
        instruct = "";
      } else {
        if (!elevenKey) {
          throw new Error(
            `Nenhum áudio de referência encontrado no histórico para "${voiceName}". Insira sua API Key do ElevenLabs nas configurações ou digite uma instrução (Voice Design) para gerar o áudio.`
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

        const telegramUrl = await ttsElevenLabs(stripCensors(text), voiceId);
        return telegramUrl;
      }
    }

    if (refBlob) {
      console.log("Enviando áudio de referência para OmniVoice:", {
        voiceName,
        size: refBlob.size,
        type: refBlob.type
      });
    }

    const formData = new FormData();
    formData.append("text", text);
    if (refBlob) {
      formData.append("reference_audio", refBlob, "reference.mp3");
    }
    if (instruct) {
      formData.append("instruct", instruct);
    }
    formData.append("speed", String(speed !== undefined ? speed : voiceSpeed));
    formData.append("num_step", String(omniNumStep));
    formData.append("guidance_scale", String(omniGuidanceScale));
    formData.append("provider", ttsProvider);

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
    chatId: string,
    instruct?: string
  ): Promise<string> => {
    if (ttsProvider === "omnivoice" || ttsProvider === "qwen3") {
      return ttsOmniVoice(text, voiceIdentifier, chatId, undefined, instruct);
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
        activeChat.id,
        msg.instruct
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

  const linkAllAudios = () => {
    let currentMessages = [...activeChat.messages];
    let boundCount = 0;

    for (const g of generatedAudios) {
      const isAlreadyLinked = currentMessages.some(
        (m) => m.type === "text" && m.audioUrl === g.audioUrl
      );
      if (isAlreadyLinked) continue;

      let bound = false;
      currentMessages = currentMessages.map((m) => {
        if (
          !bound &&
          m.type === "text" &&
          !m.audioUrl &&
          m.voiceName.toLowerCase() === g.voiceName.toLowerCase() &&
          m.text.toLowerCase() === g.text.toLowerCase()
        ) {
          bound = true;
          boundCount++;
          return { ...m, audioUrl: g.audioUrl };
        }
        return m;
      });

      if (!bound) {
        const textMsgsWithoutAudio = currentMessages.filter(
          (m): m is TextMsg => m.type === "text" && !m.audioUrl
        );
        if (textMsgsWithoutAudio.length > 0) {
          const candidate = textMsgsWithoutAudio.find(
            (m) => m.voiceName.toLowerCase() === g.voiceName.toLowerCase()
          ) || textMsgsWithoutAudio[0];
          
          currentMessages = currentMessages.map((m) => {
            if (m.id === candidate.id && m.type === "text") {
              boundCount++;
              return { ...m, audioUrl: g.audioUrl };
            }
            return m;
          });
        }
      }
    }

    if (boundCount > 0) {
      updateActiveChat({ messages: currentMessages });
      toast.success(`${boundCount} áudio(s) vinculado(s) com sucesso!`);
    } else {
      toast.info("Nenhum áudio novo elegível para vinculação.");
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
      setGeneratingCharacter(msg.voiceName);
      const chat = chats.find((c) => c.id === chatId)!;
      const voiceId = (chat.voiceMap[msg.voiceName] || "").trim();
      if (ttsProvider === "elevenlabs" && !voiceId) {
        alert(`Defina o Voice ID para "${msg.voiceName}" no chat "${chat.name}".`);
        setGenerating(false);
        setGeneratingCharacter(null);
        return;
      }
      try {
        let audioUrl: string;
        const textToGenerate = msg.spokenText ?? msg.text;
        if (ttsProvider === "omnivoice" || ttsProvider === "qwen3") {
          audioUrl = await ttsOmniVoice(
            stripCensors(textToGenerate),
            msg.voiceName,
            chatId,
            chatMessagesMap,
            msg.instruct
          );
        } else {
          audioUrl = await ttsElevenLabs(stripCensors(textToGenerate), voiceId);
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
        setGeneratingCharacter(null);
        return;
      }
      done++;
      setGenProgress({ done, total: allTexts.length });
    }
    setGenerating(false);
    setGeneratingCharacter(null);
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
        const elapsed = now - playbackStartTimeRef.current - pauseAccumulatorRef.current;
        setPlaybackElapsed(elapsed);

        // Keep DOM video background synced in preview
        if (isBgVideo && activeBgVideoRef.current) {
          const bgVideo = activeBgVideoRef.current;
          const currentSec = (elapsed / 1000) + bgVideoOffset;
          const dur = bgVideo.duration || 1;
          const target = currentSec % dur;
          if (Math.abs(bgVideo.currentTime - target) > 0.3) {
            bgVideo.currentTime = target;
          }
        }
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
        if (video.classList.contains("bg-video-el")) {
          if (next) video.pause();
          else video.play().catch(() => {});
          return;
        }
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
    const blobUrlsCache: Record<string, string> = {};
    const isWA = chatTheme === "whatsapp";

    const getVideoElement = async (url: string): Promise<HTMLVideoElement> => {
      let finalUrl = url;
      if (url.startsWith("data:video/")) {
        if (blobUrlsCache[url]) {
          finalUrl = blobUrlsCache[url];
        } else {
          try {
            const blob = dataURLtoBlob(url);
            const blobUrl = URL.createObjectURL(blob);
            blobUrlsCache[url] = blobUrl;
            finalUrl = blobUrl;
          } catch (e) {
            console.error("Failed to convert dataURL to BlobURL", e);
          }
        }
      }

      if (videoCache.has(finalUrl)) {
        return videoCache.get(finalUrl)!;
      }
      const video = document.createElement("video");
      video.src = finalUrl;
      video.muted = true;
      video.crossOrigin = "anonymous";
      video.playsInline = true;
      videoCache.set(finalUrl, video);
      
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

    const seekVideoLoop = async (video: HTMLVideoElement, time: number) => {
      const duration = video.duration || 1;
      const targetTime = (time + bgVideoOffset) % duration;
      
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
        video: { codec: "avc", width: 1080, height: 1920 },
        audio: { codec: "opus", numberOfChannels: 1, sampleRate: 48000 },
        fastStart: "in-memory"
      });

      let selectedCodec = "avc1.4d002a";
      let selectedHardwareAcceleration: "prefer-hardware" | "no-preference" = "prefer-hardware";

      const configsToTest = [
        { codec: "avc1.64002a", acceleration: "prefer-hardware" as const },
        { codec: "avc1.4d002a", acceleration: "prefer-hardware" as const },
        { codec: "avc1.64002a", acceleration: "no-preference" as const },
        { codec: "avc1.4d002a", acceleration: "no-preference" as const },
        { codec: "avc1.42e02a", acceleration: "no-preference" as const },
      ];

      for (const t of configsToTest) {
        try {
          const support = await (window as any).VideoEncoder.isConfigSupported({
            codec: t.codec,
            width: 1080,
            height: 1920,
            bitrate: 6_000_000,
            hardwareAcceleration: t.acceleration,
            avc: { format: "avc" }
          });
          if (support.supported) {
            selectedCodec = t.codec;
            selectedHardwareAcceleration = t.acceleration;
            break;
          }
        } catch (err) {
          console.warn("isConfigSupported failed for config", t, err);
        }
      }

      const videoEncoder = new (window as any).VideoEncoder({
        output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
        error: (e: any) => {
          console.error("Video error:", e);
          alert(`Erro no Codificador de Vídeo: ${e.message || e}`);
        },
      });
      videoEncoder.configure({
        codec: selectedCodec,
        width: 1080,
        height: 1920,
        bitrate: 6_000_000,
        hardwareAcceleration: selectedHardwareAcceleration,
        avc: { format: "avc" }
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

      const fps = exportFps;
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
              if (node?.tagName?.toLowerCase() === "video" && node.classList?.contains("bg-video-el")) {
                return false;
              }
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
          
          if (activeBackground.startsWith("data:video/")) {
            try {
              const bgVideo = await getVideoElement(activeBackground);
              const currentFrameTimeSec = timestampUs / 1_000_000;
              // Throttle seeks to every 2 frames to cut GPU decoding load in half
              if (framesEncoded % 2 === 0) {
                await seekVideoLoop(bgVideo, currentFrameTimeSec);
              }
              
              // Draw video background with cover-fit crop
              const imgW = bgVideo.videoWidth || 1080;
              const imgH = bgVideo.videoHeight || 1920;
              const imgRatio = imgW / imgH;
              const targetRatio = 1080 / 1920;
              let sx = 0, sy = 0, sw = imgW, sh = imgH;
              if (imgRatio > targetRatio) {
                sw = imgH * targetRatio;
                sx = (imgW - sw) / 2;
              } else {
                sh = imgW / targetRatio;
                sy = (imgH - sh) / 2;
              }
              ctx1080.drawImage(bgVideo, sx, sy, sw, sh, 0, 0, 1080, 1920);
            } catch (err) {
              console.warn("Failed to draw background video frame", err);
            }
          }
          
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

          // Let the browser and GPU breathe every 10 frames to avoid thread blocking
          if (framesEncoded % 10 === 0) {
            await new Promise((r) => setTimeout(r, 10));
          }
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

      const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
      if (blob.size === 0) {
        alert("O vídeo gerado está vazio. Tente novamente.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const safeName = (projectName.trim() || "chat-story").replace(/[^a-z0-9-_]+/gi, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}.mp4`;
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
      if (typeof blobUrlsCache !== "undefined" && blobUrlsCache) {
        for (const url of Object.values(blobUrlsCache)) {
          try {
            URL.revokeObjectURL(url);
          } catch {}
        }
      }

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

  const exportVideoLocal = async (exportAll?: boolean) => {
    if (!previewRef.current) return;
    if (!allAudiosReady) {
      alert("Gere os áudios primeiro.");
      return;
    }

    const messages = exportAll
      ? chats.flatMap((c) => c.messages.map((m) => ({ ...m, chatId: c.id })))
      : displayChat.messages;
    if (messages.length === 0) return;

    setIsLocalExporting(true);
    setLocalExportProgress(5);

    try {
      // 1) Mix audio offline
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AC();
      const tracksInfo: { duration: number; buffer: AudioBuffer | null }[] = [];
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
          tracksInfo.push({ buffer: null, duration: 2.0 });
          totalDurationSec += 2.0;
        }
      }
      totalDurationSec = Math.max(1, totalDurationSec + 1);

      setLocalExportProgress(20);

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

      setLocalExportProgress(40);

      // Convert mixed AudioBuffer to WAV ArrayBuffer
      const wavArrBuffer = audioBufferToWav(renderedAudio);
      const audioBlob = new Blob([wavArrBuffer], { type: "audio/wav" });

      setLocalExportProgress(50);

      const startTimesSec: number[] = [];
      let currentAcc = 0;
      for (let j = 0; j < messages.length; j++) {
        startTimesSec.push(currentAcc);
        currentAcc += tracksInfo[j].duration;
      }

      // Build FormData to send media as binary blobs natively (uses virtually 0 extra RAM)
      const formData = new FormData();
      formData.append("audio", audioBlob, "audio.wav");

      let bgVideoFilename = "";
      if (activeBackground.startsWith("data:video/") || activeBackground.startsWith("blob:")) {
        try {
          const response = await fetch(activeBackground);
          const blob = await response.blob();
          formData.append("bgVideo", blob, "bg_video.mp4");
          bgVideoFilename = "bg_video.mp4";
        } catch (e) {
          console.error("Failed to fetch bgVideo blob", e);
        }
      }

      setLocalExportProgress(65);

      const cleanMessages = await Promise.all(messages.map(async (msg, idx) => {
        if (msg.type === "video" && msg.videoUrl) {
          try {
            const response = await fetch(msg.videoUrl);
            const blob = await response.blob();
            const filename = `msg_video_${idx}.mp4`;
            formData.append(`msgVideo_${idx}`, blob, filename);
            return {
              ...msg,
              videoUrl: filename
            };
          } catch (e) {
            console.error("Failed to fetch msgVideo blob", e);
          }
        }
        if (msg.type === "image" && msg.imageUrl) {
          try {
            const response = await fetch(msg.imageUrl);
            const blob = await response.blob();
            const ext = blob.type.split("/")[1] || "png";
            const filename = `msg_image_${idx}.${ext}`;
            formData.append(`msgImage_${idx}`, blob, filename);
            return {
              ...msg,
              imageUrl: filename
            };
          } catch (e) {
            console.error("Failed to fetch msgImage blob", e);
          }
        }
        return msg;
      }));

      setLocalExportProgress(80);

      const payload = {
        origin: window.location.origin,
        fps: exportFps,
        duration: totalDurationSec,
        projectName: projectName,
        chatTheme: chatTheme,
        activeBackground: bgVideoFilename ? bgVideoFilename : activeBackground,
        bgVideoOffset: bgVideoOffset,
        chats: chats.map(c => ({
          ...c,
          messages: c.messages.map(m => {
            const msgIdx = messages.findIndex(orig => orig.id === m.id);
            if (msgIdx >= 0) {
              const cleanMsg = cleanMessages[msgIdx] as any;
              if (m.type === "video" && cleanMsg.videoUrl) {
                return {
                  ...m,
                  videoUrl: cleanMsg.videoUrl
                };
              }
              if (m.type === "image" && cleanMsg.imageUrl) {
                return {
                  ...m,
                  imageUrl: cleanMsg.imageUrl
                };
              }
            }
            return m;
          })
        })),
        messages: cleanMessages,
        startTimesSec: startTimesSec,
        outputName: (projectName.trim() || "chat-story").replace(/[^a-z0-9-_]+/gi, "_")
      };

      formData.append("project", JSON.stringify(payload));

      setLocalExportProgress(90);

      // Trigger the local renderer with the FormData!
      const res = await startLocalRenderServerFn({ data: formData });
      
      if (res.success) {
        setLocalExportProgress(100);
        toast.success("Vídeo exportado pelo PC e salvo na pasta Downloads!");
      } else {
        throw new Error(res.error || "Erro ao rodar renderizador no Prompt");
      }
    } catch (err) {
      console.error("Local Export Failed:", err);
      toast.error(`Falha na exportação pelo PC: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLocalExporting(false);
      setLocalExportProgress(0);
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
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans select-none">
      {/* 1. SIDEBAR LATERAL FIXA */}
      <aside className={`bg-zinc-900 border-r border-zinc-800 flex flex-col shrink-0 transition-all duration-200 ${sidebarCollapsed ? "w-16" : "w-64"}`}>
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          {!sidebarCollapsed && (
            <span className="font-bold tracking-wider text-xs bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent uppercase">
              Story Generator
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-white"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
          {[
            { id: "project", label: "Projeto", icon: FolderOpen },
            { id: "script", label: "Script / Roteiro", icon: FileText },
            { id: "formatter", label: "Formatador de Script", icon: Wand2 },
            { id: "characters", label: "Personagens", icon: Users },
            { id: "media", label: "Mídias (Imagens/Vídeo)", icon: ImageIcon },
            { id: "generation", label: "Sintetizar Áudio", icon: Cpu },
            { id: "export", label: "Exportar Vídeo", icon: Download },
            { id: "settings", label: "Avançado", icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id as any)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                  active
                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/20"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* MAIN CONTAINER */}
      <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950 relative">
        <div className="flex-1 flex overflow-hidden">
          
          {/* 2. WORKSPACE CENTRAL */}
          <main className="flex-1 overflow-y-auto p-8 space-y-6 bg-zinc-950 pb-24">
            
            {/* SEÇÃO: PROJETO */}
            {activeSection === "project" && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">📁 Gerenciar Projeto</h2>
                  <p className="text-xs text-zinc-400">Configure o nome, tema e gerencie chats e salvamentos locais.</p>
                </div>

                {/* Nome do Projeto + Salvar */}
                <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                  <Label className="text-xs text-zinc-300">Nome do Projeto</Label>
                  <div className="flex gap-2">
                    <Input
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="Ex: Story do Nate"
                      className="bg-zinc-950 border-zinc-800 text-zinc-200 h-9"
                    />
                    <Button
                      onClick={handleSaveProject}
                      disabled={savingProject}
                      variant="secondary"
                      className="h-9"
                    >
                      {savingProject ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Save className="h-4 w-4 mr-1.5" /> Salvar
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    Salva o script, áudios e imagens localmente (IndexedDB) para evitar regerar falas.
                  </p>
                </div>

                {/* Temas e Aparência rápida */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                    <Label className="text-xs text-zinc-300">Tema do Chat</Label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={chatTheme === "imessage" ? "default" : "outline"}
                        onClick={() => setChatTheme("imessage")}
                        className="flex-1"
                      >
                        iMessage
                      </Button>
                      <Button
                        size="sm"
                        variant={chatTheme === "whatsapp" ? "default" : "outline"}
                        onClick={() => setChatTheme("whatsapp")}
                        className="flex-1"
                      >
                        WhatsApp (Dark)
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                    <Label className="text-xs text-zinc-300">Modo de Conversa</Label>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={!effectiveGroupChat ? "default" : "outline"}
                        onClick={() => {
                          setIsGroupChat(false);
                          updateActiveChat({ isGroupChat: false });
                        }}
                        className="flex-1"
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
                        className="flex-1"
                      >
                        Group Chat
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Video Background */}
                <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                  <Label className="text-xs text-zinc-300">Background do Vídeo</Label>
                  <div className="flex flex-wrap gap-2">
                    {backgrounds.map((bg) => {
                      const isActive = activeBackground === bg.value;
                      return (
                        <div key={bg.id} className="relative">
                          <button
                            type="button"
                            onClick={() => setActiveBackground(bg.value)}
                            className={`w-10 h-10 rounded-md cursor-pointer border-2 transition-all overflow-hidden relative flex items-center justify-center ${
                              isActive
                                ? "border-purple-500 ring-2 ring-purple-500 scale-105"
                                : "border-zinc-800 hover:border-zinc-700"
                            }`}
                            title={bg.type === "color" ? bg.value : bg.type === "video" ? "Custom video" : "Custom image"}
                          >
                            {bg.type === "color" && (
                              <div className="w-full h-full" style={{ backgroundColor: bg.value }} />
                            )}
                            {bg.type === "image" && (
                              <div className="w-full h-full bg-cover bg-center" style={{ backgroundImage: `url(${bg.value})` }} />
                            )}
                            {bg.type === "video" && (
                              <video
                                src={bg.value}
                                muted
                                loop
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover"
                              />
                            )}
                          </button>
                          {!bg.id.startsWith("default-") && (
                            <button
                              type="button"
                              onClick={() => removeBackground(bg)}
                              className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] leading-none"
                              title="Remove"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-4 flex-wrap pt-2 border-t border-zinc-800/40">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={newColor}
                        onChange={(e) => setNewColor(e.target.value)}
                        className="w-10 h-8 rounded cursor-pointer border border-zinc-800 bg-transparent"
                      />
                      <Button size="sm" variant="outline" onClick={addColorBackground} className="h-8">
                        Adicionar Cor
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
                        className="h-8"
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" /> Enviar Imagem
                      </Button>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        ref={bgVideoInputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) addVideoBackground(f);
                          if (bgVideoInputRef.current) bgVideoInputRef.current.value = "";
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => bgVideoInputRef.current?.click()}
                        className="h-8"
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" /> Enviar Vídeo
                      </Button>
                    </div>
                  </div>

                  {activeBackground.startsWith("data:video/") && (
                    <div className="space-y-2 pt-3 border-t border-zinc-800/40">
                      <div className="flex items-center justify-between text-xs">
                        <Label className="text-zinc-300">Início do vídeo de fundo (offset)</Label>
                        <span className="text-zinc-400 font-mono">
                          {bgVideoOffset}s {bgVideoDuration > 0 && `(Total: ${Math.round(bgVideoDuration)}s${bgVideoResolution ? ` | ${bgVideoResolution}` : ""})`}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={bgVideoDuration > 0 ? Math.round(bgVideoDuration) : 1200}
                          step={1}
                          value={bgVideoOffset}
                          onChange={(e) => setBgVideoOffset(Number(e.target.value))}
                          className="flex-1 h-1.5 bg-zinc-850 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                        <Input
                          type="number"
                          min={0}
                          max={bgVideoDuration > 0 ? Math.round(bgVideoDuration) : 1200}
                          value={bgVideoOffset}
                          onChange={(e) => setBgVideoOffset(Math.max(0, Number(e.target.value)))}
                          className="w-16 h-8 bg-zinc-950 border-zinc-800 text-zinc-300 text-xs px-1 text-center"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Gerenciamento de Chats */}
                <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                  <Label className="text-xs text-zinc-300">Mensagens e Chats do Projeto</Label>
                  <div className="flex flex-wrap gap-2 items-center">
                    {chats.map((c) => (
                      <div
                        key={c.id}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                          c.id === activeChatId
                            ? "bg-purple-600 text-white border-purple-500"
                            : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:text-white"
                        }`}
                      >
                        <button
                          onClick={() => {
                            setActiveChatId(c.id);
                            setVisibleMessages([]);
                          }}
                          className="font-medium"
                        >
                          {c.name}
                        </button>
                        {chats.length > 1 && (
                          <button
                            className="opacity-70 hover:opacity-100 transition-opacity"
                            onClick={() => removeChat(c.id)}
                            aria-label="Remove chat"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={addChat} className="h-8">
                      <Plus className="h-3.5 w-3.5 mr-1" /> Novo Chat
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-zinc-800/40">
                    <div className="space-y-2">
                      <Label className="text-[11px] text-zinc-400">Rótulo do Chat</Label>
                      <Input
                        value={activeChat.name}
                        onChange={(e) => updateActiveChat({ name: e.target.value })}
                        className="bg-zinc-950 border-zinc-800 text-zinc-200 h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[11px] text-zinc-400">Nome do Contato</Label>
                      <Input
                        value={activeChat.contactName}
                        onChange={(e) => updateActiveChat({ contactName: e.target.value })}
                        className="bg-zinc-950 border-zinc-800 text-zinc-200 h-8 text-xs"
                      />
                    </div>
                  </div>

                  {/* Foto de Contato */}
                  <div
                    className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
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
                    <Label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                      <User className="h-3.5 w-3.5" /> Foto do Contato
                    </Label>
                    <div className="flex items-center gap-3 flex-wrap">
                      {activeChat.contactPhoto ? (
                        <img
                          src={activeChat.contactPhoto}
                          alt="contact"
                          className="h-10 w-10 rounded-full object-cover border border-zinc-800"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-white text-xs font-medium border border-zinc-800">
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
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => photoInputRef.current?.click()}>
                        <Upload className="mr-1 h-3 w-3" /> Upload
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={pasteContactPhoto}>
                        <ClipboardPaste className="mr-1 h-3 w-3" /> Colar
                      </Button>
                      {activeChat.contactPhoto && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[10px] text-red-400 hover:text-red-300"
                          onClick={() => updateActiveChat({ contactPhoto: null })}
                        >
                          Remover
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Lista de Projetos do IndexedDB */}
                <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                  <h3 className="font-semibold text-sm text-zinc-200">Meus Projetos Salvos</h3>
                  {projects.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-zinc-500 text-xs">
                      Nenhum projeto salvo na base local ainda.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {projects.map((p) => {
                        const totalMsgs = p.chats.reduce((acc, c) => acc + c.messages.length, 0);
                        return (
                          <div
                            key={p.id}
                            className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3 hover:border-zinc-700 transition"
                          >
                            <div>
                              <div className="font-semibold text-zinc-200 truncate text-xs">{p.projectName}</div>
                              <div className="text-[10px] text-zinc-400">
                                {new Date(p.createdAt).toLocaleString()}
                              </div>
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              {p.chats.length} chat(s) • {totalMsgs} mensagens • tema {p.theme}
                            </div>
                            <div className="flex gap-2 pt-1">
                              <Button size="sm" onClick={() => handleLoadProject(p)} className="flex-1 h-7 text-[10px]">
                                <FolderOpen className="h-3 w-3 mr-1" /> Carregar
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] text-red-400 hover:text-red-300 hover:bg-zinc-900"
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
              </div>
            )}

            {/* SEÇÃO: SCRIPT */}
            {activeSection === "script" && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">📝 Escrever Script</h2>
                  <p className="text-xs text-zinc-400">Escreva o roteiro da história com personagens identificados ou use inteligência artificial.</p>
                </div>

                {/* ASSISTENTE DE ROTEIRO IA */}
                <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-5 space-y-4 hover:border-zinc-700/60 transition duration-150 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition pointer-events-none">
                    <Sparkles className="h-32 w-32 text-purple-500" />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-purple-500/10 text-purple-400 rounded-lg border border-purple-500/20">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-xs text-zinc-200">Assistente de Roteiro IA</h3>
                        <p className="text-[10px] text-zinc-400">Gere roteiros completos ou continue capítulo por capítulo.</p>
                      </div>
                    </div>
                    
                    {/* Status da Chave de API */}
                    <div>
                      {directorLlmProvider === "local" ? (
                        <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          💻 LLM Local ({localLlmModel})
                        </span>
                      ) : !(geminiApiKey || openaiApiKey) ? (
                        <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse">
                          ⚠️ Sem API Key
                        </span>
                      ) : (
                        <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          API Key Pronta ({directorLlmProvider === "gemini" ? "Gemini" : "OpenAI"})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3.5 pt-2 border-t border-zinc-800/40 text-xs">
                    {/* Se não houver chave de API */}
                    {directorLlmProvider !== "local" && !(geminiApiKey || openaiApiKey) && (
                      <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 text-[10px] text-red-400/90 leading-relaxed">
                        Configure sua chave de API nas <button className="underline font-semibold hover:text-red-300" onClick={() => setActiveSection("settings")}>Configurações Avançadas</button> para habilitar a geração por IA.
                      </div>
                    )}

                    {/* Premissa Geral */}
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] text-zinc-400 font-medium">Premissa Geral da História (Ideia Principal)</Label>
                      <Textarea
                        className="min-h-[60px] bg-zinc-950 border-zinc-800 text-zinc-200 text-xs focus:ring-purple-600 focus:border-purple-600 rounded-lg"
                        placeholder="Ex: Lucas e Ana são casados. Lucas descobre uma mensagem suspeita no celular dela e a confronta. No final, era uma surpresa..."
                        value={activeChat.aiPrompt || ""}
                        onChange={(e) => updateActiveChat({ aiPrompt: e.target.value })}
                      />
                    </div>

                    {/* Direção do Próximo Capítulo (Só se o script já tiver algo) */}
                    {(activeChat.script || "").trim().length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <Label className="text-[10px] text-zinc-400 font-medium">Direção para o Próximo Capítulo (Opcional)</Label>
                        <Input
                          className="bg-zinc-950 border-zinc-800 text-zinc-200 text-xs focus:ring-purple-600 focus:border-purple-600 rounded-lg"
                          placeholder="Ex: Ana chora e diz que é mentira. Lucas pede pra ver o celular dela..."
                          value={activeChat.aiChapterInstruction || ""}
                          onChange={(e) => updateActiveChat({ aiChapterInstruction: e.target.value })}
                        />
                      </div>
                    )}

                    {/* Link do YouTube */}
                    <div className="flex flex-col gap-1.5 pt-2 border-t border-zinc-800/40">
                      <Label className="text-[10px] text-zinc-400 font-medium">Extrair Roteiro do YouTube (Link do Vídeo)</Label>
                      <div className="flex gap-2">
                        <Input
                          className="bg-zinc-950 border-zinc-800 text-zinc-200 text-xs focus:ring-purple-600 focus:border-purple-600 rounded-lg flex-1 h-9"
                          placeholder="Ex: https://www.youtube.com/watch?v=..."
                          value={youtubeUrl}
                          onChange={(e) => setYoutubeUrl(e.target.value)}
                        />
                        <Button
                          onClick={generateScriptFromYouTube}
                          disabled={isGeneratingScript || !(geminiApiKey || openaiApiKey)}
                          className="bg-purple-600 hover:bg-purple-500 text-white h-9 px-3 text-xs font-semibold rounded-lg shrink-0 flex items-center gap-1"
                        >
                          {isGeneratingScript ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Processando...
                            </>
                          ) : (
                            <>
                              <span>Importar</span>
                              <span>🎥</span>
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Instruções para Adaptação do Vídeo */}
                      <Label className="text-[10px] text-zinc-400 font-medium pt-1">Instruções de Adaptação / Tradução (Opcional)</Label>
                      <Textarea
                        className="min-h-[50px] bg-zinc-950 border-zinc-800 text-zinc-200 text-xs focus:ring-purple-600 focus:border-purple-600 rounded-lg"
                        placeholder="Ex: Traduzir para português, deixar o tom mais dramático, manter nomes originais..."
                        value={youtubeInstructions}
                        onChange={(e) => setYoutubeInstructions(e.target.value)}
                      />
                      
                      {/* Checkbox de visão (Apenas se Gemini estiver selecionado) */}
                      {directorLlmProvider === "gemini" && (
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="checkbox"
                            id="visual-analysis-chk"
                            className="rounded bg-zinc-950 border-zinc-800 text-purple-600 focus:ring-purple-600 cursor-pointer h-3.5 w-3.5"
                            checked={visualAnalysis}
                            onChange={(e) => setVisualAnalysis(e.target.checked)}
                          />
                          <label
                            htmlFor="visual-analysis-chk"
                            className="text-[10px] text-zinc-400 font-medium cursor-pointer selection:bg-transparent"
                          >
                            Ativar Análise Visual (Fazer IA assistir ao vídeo - consome mais tokens)
                          </label>
                        </div>
                      )}
                    </div>

                    {/* Botões de Ação */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        onClick={() => generateScriptWithAI(false)}
                        disabled={isGeneratingScript || !(geminiApiKey || openaiApiKey)}
                        className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 h-9 text-xs font-semibold rounded-lg"
                      >
                        {isGeneratingScript && !activeChat.script ? (
                          <>
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-purple-400" />
                            Gerando Início...
                          </>
                        ) : (
                          "Gerar Novo Roteiro 🪄"
                        )}
                      </Button>
                      
                      {(activeChat.script || "").trim().length > 0 && (
                        <Button
                          onClick={() => generateScriptWithAI(true)}
                          disabled={isGeneratingScript || !(geminiApiKey || openaiApiKey)}
                          className="flex-1 bg-purple-600 hover:bg-purple-500 text-white h-9 text-xs font-semibold rounded-lg"
                        >
                          {isGeneratingScript && activeChat.script ? (
                            <>
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-white" />
                              Escrevendo Capítulo...
                            </>
                          ) : (
                            "Continuar Capítulo ✨"
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-zinc-300">Script do Chat</Label>
                    <span className="text-[10px] text-zinc-400 font-mono">Formato: 1: Personagem&gt; Fala</span>
                  </div>
                  <Textarea
                    className="min-h-[350px] font-mono text-xs bg-zinc-950 border-zinc-800 text-zinc-200 focus:ring-1 focus:ring-purple-600 leading-relaxed"
                    value={activeChat.script}
                    onChange={(e) => updateActiveChat({ script: e.target.value })}
                  />
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg text-[10px] text-zinc-400 space-y-1">
                    <p className="font-semibold text-zinc-300">Dicas rápidas de formato:</p>
                    <p>• Definir tema: <code>- iMessage: Nate</code> ou <code>- Whatsapp: Nate</code></p>
                    <p>• Mensagens: <code>1: NomePersonagem&gt; Texto da fala</code> (para lado esquerdo/remoto) ou <code>2: NomePersonagem&gt; Texto</code> (lado direito/autor)</p>
                    <p>• Mídias: <code>1: img: descrição da imagem</code> ou <code>2: gif: descrição do gif</code></p>
                  </div>
                </div>

                <Button onClick={() => parseScript()} className="w-full bg-purple-600 hover:bg-purple-500 text-white h-10 font-medium text-xs">
                  Processar Roteiro (Parse Script)
                </Button>
              </div>
            )}

            {/* SEÇÃO: FORMATADOR DE SCRIPT */}
            {activeSection === "formatter" && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">🪄 Formatador de Script por IA</h2>
                  <p className="text-xs text-zinc-400">Converta qualquer formato de diálogo ou roteiro bruto para a formatação correta do Chat Story.</p>
                </div>

                <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-5 space-y-4 hover:border-zinc-700/60 transition duration-150 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition pointer-events-none">
                    <Wand2 className="h-32 w-32 text-purple-500" />
                  </div>

                  <div className="space-y-4">
                    {/* Se não houver chave de API */}
                    {directorLlmProvider !== "local" && !(geminiApiKey || openaiApiKey) && (
                      <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 text-[10px] text-red-400/90 leading-relaxed">
                        Configure sua chave de API nas <button className="underline font-semibold hover:text-red-300" onClick={() => setActiveSection("settings")}>Configurações Avançadas</button> para habilitar a formatação por IA.
                      </div>
                    )}

                    {/* Roteiro Original */}
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">Roteiro Original (Qualquer Formato)</Label>
                      <Textarea
                        className="min-h-[140px] bg-zinc-950 border-zinc-800 text-zinc-200 text-xs focus:ring-purple-600 focus:border-purple-600 rounded-lg placeholder-zinc-700"
                        placeholder="Ex:&#10;Lucas: oi amor, tudo bem?&#10;Ana diz que sim, mas está preocupada com o Lucas.&#10;Lucas responde que não é nada..."
                        value={rawScriptInput}
                        onChange={(e) => setRawScriptInput(e.target.value)}
                      />
                    </div>

                    {/* Instruções de Formatação */}
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">Instruções de Adaptação / Tradução (Opcional)</Label>
                      <Input
                        className="bg-zinc-950 border-zinc-800 text-zinc-200 text-xs focus:ring-purple-600 focus:border-purple-600 rounded-lg placeholder-zinc-700"
                        placeholder="Ex: Traduzir para português, deixar as falas mais curtas e dramáticas..."
                        value={formatterInstructions}
                        onChange={(e) => setFormatterInstructions(e.target.value)}
                      />
                    </div>

                    {/* Botão de Formatação */}
                    <div className="flex justify-end">
                      <Button
                        onClick={formatScriptWithAI}
                        disabled={isFormatting || (directorLlmProvider !== "local" && !(geminiApiKey || openaiApiKey))}
                        className="bg-purple-600 hover:bg-purple-500 text-white h-9 px-4 text-xs font-semibold rounded-lg shrink-0 flex items-center gap-1.5"
                      >
                        {isFormatting ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Formatando Roteiro...
                          </>
                        ) : (
                          <>
                            <span>Formatar com IA</span>
                            <span>🪄</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Resultado da Formatação */}
                {formattedScriptOutput && (
                  <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">Resultado da Formatação</Label>
                      <div className="text-[10px] text-zinc-500 font-medium">Formato Pronto para Parse</div>
                    </div>
                    
                    <Textarea
                      readOnly
                      className="min-h-[140px] bg-zinc-950 border-zinc-800 text-zinc-300 text-xs rounded-lg font-mono placeholder-zinc-700 cursor-default"
                      value={formattedScriptOutput}
                    />

                    <div className="flex gap-3 justify-end pt-2">
                      <Button
                        variant="outline"
                        onClick={() => setFormattedScriptOutput("")}
                        className="border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 h-9 text-xs font-semibold rounded-lg"
                      >
                        Limpar Resultado
                      </Button>
                      <Button
                        onClick={() => {
                          updateActiveChat({
                            script: formattedScriptOutput,
                          });
                          parseScript(formattedScriptOutput);
                          toast.success("Roteiro aplicado com sucesso!");
                          setActiveSection("script");
                        }}
                        className="bg-purple-600 hover:bg-purple-500 text-white h-9 px-4 text-xs font-semibold rounded-lg shrink-0"
                      >
                        Aplicar ao Roteiro do Chat Ativo 📝
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SEÇÃO: PERSONAGENS & VOZES */}
            {activeSection === "characters" && (
              <div className="space-y-6 max-w-4xl">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">👥 Personagens & Vozes</h2>
                  <p className="text-xs text-zinc-400">Configure o avatar, voz e tom de fala de cada personagem detectado no script.</p>
                </div>

                {uniqueCharacters.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 p-12 text-center text-zinc-500 bg-zinc-900/10 text-xs">
                    Nenhum personagem carregado. Cole o script e clique em <strong>Parse Script</strong> na seção de <strong>Script</strong> primeiro.
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {uniqueCharacters.map((name) => {
                        const isVoice = name in activeChat.voiceMap;
                        const currentId = isVoice ? activeChat.voiceMap[name] : "";
                        const matched = savedVoices.find((v) => v.voiceId === currentId);
                        const photoInputId = `photo-input-${name}`;
                        const photoUrl = activeChat.characterPhotos?.[name];
                        const configured = isVoice && currentId.trim().length > 0;

                        return (
                          <div
                            key={name}
                            className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4 flex flex-col justify-between hover:border-zinc-700/60 transition duration-150"
                          >
                            <div className="space-y-3">
                              {/* Card Header */}
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  {photoUrl ? (
                                    <img
                                      src={photoUrl}
                                      alt={name}
                                      className="h-10 w-10 rounded-full object-cover border border-zinc-800"
                                    />
                                  ) : (
                                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold uppercase border border-zinc-850">
                                      {name.charAt(0)}
                                    </div>
                                  )}
                                  <div>
                                    <h3 className="font-semibold text-xs text-zinc-200 capitalize">{name}</h3>
                                    <p className="text-[9px] text-zinc-400">
                                      {isVoice ? "Personagem com fala" : "Nome de exibição"}
                                    </p>
                                  </div>
                                </div>

                                {isVoice && (
                                  configured ? (
                                    <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                      ✅ Voz configurada
                                    </span>
                                  ) : (
                                    <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                      ⚠️ Sem voz
                                    </span>
                                  )
                                )}
                              </div>

                              {isVoice && (
                                <div className="space-y-2.5 pt-2 border-t border-zinc-800/40">
                                  {/* Voz da biblioteca */}
                                  <div className="flex flex-col gap-1">
                                    <Label className="text-[9px] text-zinc-400">Voz da Biblioteca</Label>
                                    <select
                                      className="h-8 w-full rounded border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-200 focus:outline-none"
                                      value={matched?.name || ""}
                                      onChange={(e) => {
                                        const sel = savedVoices.find((v) => v.name === e.target.value);
                                        if (sel) {
                                          const patches: any = {
                                            voiceMap: { ...activeChat.voiceMap, [name]: sel.voiceId },
                                          };
                                          if (sel.referenceAudioB64) {
                                            patches.characterAudios = {
                                              ...(activeChat.characterAudios || {}),
                                              [name]: sel.referenceAudioB64,
                                            };
                                          }
                                          updateActiveChat(patches);
                                        }
                                      }}
                                    >
                                      <option value="">Selecionar...</option>
                                      {savedVoices.map((v) => (
                                        <option key={v.name} value={v.name}>
                                          {v.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Input Voice ID manual */}
                                  <div className="flex flex-col gap-1">
                                    <Label className="text-[9px] text-zinc-400">Voice ID Manual</Label>
                                    <Input
                                      className="h-8 font-mono text-[10px] bg-zinc-950 border-zinc-800 text-zinc-200"
                                      placeholder="Ex: 21m00Tcm4Tlv..."
                                      value={currentId}
                                      onChange={(e) =>
                                        updateActiveChat({
                                          voiceMap: { ...activeChat.voiceMap, [name]: e.target.value },
                                        })
                                      }
                                    />
                                  </div>

                                  {/* Áudio clone */}
                                  {(ttsProvider === "omnivoice" || ttsProvider === "qwen3") && (
                                    <div className="pt-2 border-t border-zinc-850 flex items-center justify-between gap-2">
                                      <span className="text-[9px] text-zinc-400 font-medium">Áudio de Ref:</span>
                                      <input
                                        id={`audio-input-${name}`}
                                        type="file"
                                        accept="audio/*"
                                        className="hidden"
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          if (f) {
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                              const b64 = String(reader.result || "");
                                              updateActiveChat({
                                                characterAudios: {
                                                  ...(activeChat.characterAudios || {}),
                                                  [name]: b64,
                                                },
                                              });
                                            };
                                            reader.readAsDataURL(f);
                                          }
                                        }}
                                      />
                                      {activeChat.characterAudios?.[name] ? (
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[8px] font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">🎵 Salvo</span>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 px-1 text-[8px] text-red-400 hover:text-red-300 hover:bg-transparent"
                                            onClick={() => {
                                              if (confirm(`Remover áudio de referência de ${name}?`)) {
                                                const updated = { ...(activeChat.characterAudios || {}) };
                                                delete updated[name];
                                                updateActiveChat({ characterAudios: updated });
                                              }
                                            }}
                                          >
                                            Limpar
                                          </Button>
                                        </div>
                                      ) : (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-6 px-2 text-[8px] border-zinc-800 bg-zinc-950 text-zinc-350"
                                          onClick={() => document.getElementById(`audio-input-${name}`)?.click()}
                                        >
                                          <Upload className="h-2.5 w-2.5 mr-1" /> Enviar WAV/MP3
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Foto Actions */}
                            <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-zinc-800/40">
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
                                  };
                                }}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[8px] border-zinc-800 bg-zinc-950 text-zinc-350"
                                onClick={() => document.getElementById(photoInputId)?.click()}
                              >
                                Upload Foto
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[8px] border-zinc-800 bg-zinc-950 text-zinc-355"
                                onClick={() => pasteCharacterPhoto(name)}
                              >
                                Colar Foto
                              </Button>
                              {photoUrl && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[8px] text-red-400 hover:text-red-300 ml-auto"
                                  onClick={() => {
                                    if (confirm(`Remover a foto de ${name}?`)) {
                                      const updated = { ...(activeChat.characterPhotos || {}) };
                                      delete updated[name];
                                      updateActiveChat({ characterPhotos: updated });
                                    }
                                  }}
                                >
                                  Limpar Foto
                                </Button>
                              )}
                            </div>

                            {/* WA/Group chat name color */}
                            {(() => {
                              const isGroup = activeChat.isGroupChat ?? isGroupChat;
                              if (!isGroup) return null;
                              const colors = activeChat.nameColors || {};
                              const current = colors[name] || "";
                              return (
                                <div className="pt-2 mt-2 border-t border-zinc-800/40 flex items-center justify-between gap-2">
                                  <span className="text-[9px] text-zinc-400">Cor do Nome:</span>
                                  <select
                                    className="h-6 rounded border border-zinc-850 bg-zinc-950 px-1 text-[9px] text-zinc-350 focus:outline-none"
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
                            })()}
                          </div>
                        );
                      })}
                    </div>

                    {/* Biblioteca de vozes */}
                    <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/10 p-5">
                      <h3 className="font-semibold text-xs text-zinc-200">Biblioteca de Vozes</h3>
                      <p className="text-[10px] text-zinc-400">
                        Salve vozes frequentes aqui. Mapeie personagens selecionando-os pelo nome.
                      </p>
                      
                      {ttsProvider === "omnivoice" || ttsProvider === "qwen3" ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-[2fr_1fr] gap-2">
                            <div className="space-y-1">
                              <Label className="text-[9px] text-zinc-400">Nome da Voz</Label>
                              <Input
                                placeholder="Nome (ex: Voz do Adam)"
                                value={newVoiceName}
                                onChange={(e) => setNewVoiceName(e.target.value)}
                                className="h-8 text-xs bg-zinc-955 border-zinc-800"
                              />
                            </div>
                            <div className="space-y-1 self-end">
                              <Button size="sm" onClick={addSavedVoice} className="w-full h-8 text-xs">
                                Salvar
                              </Button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[9px] text-zinc-400">Gênero</Label>
                              <select
                                className="w-full h-8 text-[11px] border border-zinc-800 rounded bg-zinc-950 px-2"
                                value={designGender}
                                onChange={(e) => setDesignGender(e.target.value)}
                              >
                                <option value="male">Masculino</option>
                                <option value="female">Feminino</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] text-zinc-400">Idade</Label>
                              <select
                                className="w-full h-8 text-[11px] border border-zinc-800 rounded bg-zinc-950 px-2"
                                value={designAge}
                                onChange={(e) => setDesignAge(e.target.value)}
                              >
                                <option value="">Não especificado</option>
                                <option value="child">Criança</option>
                                <option value="teenager">Adolescente</option>
                                <option value="young adult">Jovem Adulto</option>
                                <option value="middle-aged">Adulto</option>
                                <option value="elderly">Idoso</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-[9px] text-zinc-400">Tom de Voz</Label>
                              <select
                                className="w-full h-8 text-[11px] border border-zinc-800 rounded bg-zinc-950 px-2"
                                value={designPitch}
                                onChange={(e) => setDesignPitch(e.target.value)}
                              >
                                <option value="">Não especificado</option>
                                <option value="very low pitch">Muito Grave</option>
                                <option value="low pitch">Grave</option>
                                <option value="moderate pitch">Médio</option>
                                <option value="high pitch">Agudo</option>
                                <option value="very high pitch">Muito Agudo</option>
                                <option value="whisper">Sussurro</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[9px] text-zinc-400">Sotaque</Label>
                              <select
                                className="w-full h-8 text-[11px] border border-zinc-800 rounded bg-zinc-950 px-2"
                                value={designAccent}
                                onChange={(e) => setDesignAccent(e.target.value)}
                              >
                                <option value="">Nenhum sotaque</option>
                                <option value="portuguese accent">Sotaque Português</option>
                                <option value="american accent">Sotaque Americano</option>
                                <option value="british accent">Sotaque Britânico</option>
                              </select>
                            </div>
                          </div>

                          <div className="space-y-1 pt-1">
                            <Label className="text-[9px] text-zinc-400">Áudio Clone de Referência (Opcional)</Label>
                            <div className="flex items-center gap-2">
                              <input
                                id="voice-lib-audio-input"
                                type="file"
                                accept="audio/*"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) {
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                      setNewVoiceRefAudioB64(String(reader.result || ""));
                                      toast.success("Áudio de referência carregado!");
                                    };
                                    reader.readAsDataURL(f);
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                onClick={() => document.getElementById("voice-lib-audio-input")?.click()}
                                className="h-8 text-xs flex-1 border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-white"
                              >
                                {newVoiceRefAudioB64 ? "✓ Áudio de Ref Carregado" : "Carregar Áudio de Ref"}
                              </Button>
                              {newVoiceRefAudioB64 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  type="button"
                                  onClick={() => setNewVoiceRefAudioB64(null)}
                                  className="h-8 text-xs text-red-400 hover:text-red-350"
                                >
                                  Remover
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
                          <Input
                            placeholder="Nome (ex: Adam)"
                            value={newVoiceName}
                            onChange={(e) => setNewVoiceName(e.target.value)}
                            className="h-8 text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
                          />
                          <Input
                            className="font-mono text-xs h-8 bg-zinc-950 border-zinc-800 text-zinc-200"
                            placeholder="voice_id"
                            value={newVoiceId}
                            onChange={(e) => setNewVoiceId(e.target.value)}
                          />
                          <Button size="sm" onClick={addSavedVoice} className="h-8">
                            <Plus className="h-3.5 w-3.5 mr-1" /> Salvar
                          </Button>
                        </div>
                      )}

                      {savedVoices.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-zinc-800/40">
                          {savedVoices.map((v) => (
                            <div key={v.name} className="flex flex-col gap-1.5 bg-zinc-950 px-2.5 py-1.5 rounded border border-zinc-850">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-semibold text-zinc-200 w-24 truncate">{v.name}</span>
                                <code className="flex-1 truncate text-zinc-400 text-[9px] ml-2">{v.voiceId}</code>
                                <button
                                  onClick={() => removeSavedVoice(v.name)}
                                  className="opacity-60 hover:opacity-100 hover:text-red-400 transition ml-2"
                                  aria-label="Remove"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              {v.referenceAudioB64 && (
                                <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-900/60">
                                  <span className="text-[8px] font-medium text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                                    🎙️ Clone
                                  </span>
                                  <audio src={v.referenceAudioB64} controls className="h-5 flex-1 filter invert opacity-70 scale-90 origin-left" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SEÇÃO: MÍDIAS (IMAGENS & VÍDEOS) */}
            {activeSection === "media" && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">🖼️ Configurar Mídias</h2>
                  <p className="text-xs text-zinc-400">Configure uploads e links para imagens ou vídeos em mensagens multimídia.</p>
                </div>

                {imageMessages.length === 0 && videoMessages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 p-12 text-center text-zinc-500 bg-zinc-900/10 text-xs">
                    Nenhuma mensagem de mídia (imagem/vídeo) detectada no script ativo.
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Imagens */}
                    {imageMessages.map((m) => (
                      <div
                        key={m.id}
                        className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/20 p-4"
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
                        <div className="text-[11px] font-semibold text-zinc-350 flex items-center justify-between">
                          <span>Mensagem ID #{m.id} (Lado {m.side})</span>
                          <span className="italic font-normal">“{m.text}”</span>
                        </div>
                        
                        <div className="flex gap-2 items-center">
                          <Link2 className="h-4 w-4 text-zinc-500 shrink-0" />
                          <Input
                            placeholder="Cole URL ou imagem aqui (Ctrl+V)"
                            value={m.imageUrl?.startsWith("blob:") ? "" : m.imageUrl ?? ""}
                            onChange={(e) => setImageUrlFor(m.id, e.target.value || null)}
                            className="bg-zinc-950 border-zinc-800 text-xs h-8"
                          />
                        </div>

                        <div className="flex items-center gap-2 pt-1">
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
                            className="h-7 text-[10px]"
                            onClick={() => fileInputRefs.current[`${activeChatId}_${m.id}`]?.click()}
                          >
                            <Upload className="mr-1 h-3 w-3" /> Fazer Upload
                          </Button>
                          {m.imageUrl && (
                            <>
                              <img
                                src={m.imageUrl}
                                alt={m.text}
                                className="h-10 w-10 object-cover rounded border border-zinc-800 ml-auto"
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] text-red-400"
                                onClick={() => setImageUrlFor(m.id, null)}
                              >
                                Limpar
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Vídeos */}
                    {videoMessages.map((m) => (
                      <div
                        key={m.id}
                        className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/20 p-4"
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
                        <div className="text-[11px] font-semibold text-zinc-350 flex items-center justify-between">
                          <span>Mensagem ID #{m.id} (Lado {m.side})</span>
                          <span className="italic font-normal">“{m.text}”</span>
                        </div>

                        <div className="flex gap-2 items-center">
                          <Link2 className="h-4 w-4 text-zinc-500 shrink-0" />
                          <Input
                            placeholder="Cole URL de vídeo ou GIF aqui (Ctrl+V)"
                            value={m.videoUrl?.startsWith("blob:") ? "" : m.videoUrl ?? ""}
                            onChange={(e) => setVideoUrlFor(m.id, e.target.value || null)}
                            className="bg-zinc-950 border-zinc-800 text-xs h-8"
                          />
                        </div>

                        <div className="flex items-center gap-2 pt-1">
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
                            className="h-7 text-[10px]"
                            onClick={() => fileInputRefs.current[`${activeChatId}_${m.id}`]?.click()}
                          >
                            <Upload className="mr-1 h-3 w-3" /> Fazer Upload
                          </Button>
                          {m.videoUrl && (
                            <>
                              {m.videoType === "gif" ? (
                                <img
                                  src={m.videoUrl}
                                  alt={m.text}
                                  className="h-10 w-10 object-cover rounded border border-zinc-800 ml-auto"
                                />
                              ) : (
                                <video
                                  src={m.videoUrl}
                                  className="h-10 w-10 object-cover rounded border border-zinc-800 ml-auto"
                                />
                              )}
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 text-[10px] text-red-400"
                                onClick={() => setVideoUrlFor(m.id, null)}
                              >
                                Limpar
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* SEÇÃO: GERAR ÁUDIOS */}
            {activeSection === "generation" && (
              <div className="space-y-6 max-w-4xl">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">⚡ Gerar & Sintetizar Áudios</h2>
                  <p className="text-xs text-zinc-400">Gere todas as falas baseando-se nas vozes configuradas para cada personagem.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={() => generateAudios(false)}
                    disabled={generating}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs h-10 shadow-lg shadow-purple-600/10"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sintetizando... {genProgress.done}/{genProgress.total}
                      </>
                    ) : (
                      "Gerar Todos os Áudios 🎵"
                    )}
                  </Button>
                  <Button
                    onClick={() => generateAudios(true)}
                    disabled={generating}
                    className="flex-1 h-10 text-xs"
                    variant="outline"
                  >
                    Continuar de Onde Parou
                  </Button>
                </div>

                {/* PROGRESS BAR COM NOME DO PERSONAGEM */}
                {generating && (
                  <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 shadow-sm animate-pulse">
                    <div className="flex justify-between text-xs text-zinc-200 font-medium">
                      <span>Processando: <strong className="text-purple-400 capitalize">{generatingCharacter || "Carregando"}</strong></span>
                      <span>{Math.round((genProgress.done / (genProgress.total || 1)) * 100)}%</span>
                    </div>
                    <Progress
                      value={(genProgress.done / (genProgress.total || 1)) * 100}
                      className="h-2 bg-zinc-950 [&>div]:bg-purple-500"
                    />
                  </div>
                )}

                {/* Post-Generation Editor */}
                {(() => {
                  const textMsgs = activeChat.messages.filter((m): m is TextMsg => m.type === "text");
                  if (textMsgs.length === 0) return null;
                  return (
                    <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/40">
                        <div>
                          <h3 className="font-semibold text-xs text-zinc-200">Editor de Falas e Emoções</h3>
                          <p className="text-[10px] text-zinc-400">Visualize textos falados, edite emoções e escute os áudios gerados.</p>
                        </div>
                        
                        {useDirector && (
                          <Button
                            size="sm"
                            className="text-[10px] font-semibold flex items-center justify-center gap-1.5 h-8 bg-zinc-900 border border-zinc-800 text-zinc-200 hover:bg-zinc-850"
                            disabled={isDirecting}
                            onClick={directSpeechWithAI}
                          >
                            {isDirecting ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Dirigindo...
                              </>
                            ) : (
                              <>
                                <Sparkles className="h-3 w-3 text-purple-400" />
                                Direção de Emoções IA
                              </>
                            )}
                          </Button>
                        )}
                      </div>

                      <div className="space-y-3.5 max-h-[450px] overflow-y-auto pr-1">
                        {textMsgs.map((msg) => {
                          const isLoading = regeneratingMsgId === msg.id;
                          return (
                            <div key={msg.id} className="rounded-lg border border-zinc-800/60 p-3.5 space-y-2 bg-zinc-950/60">
                              <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-[10px] text-zinc-300 capitalize">{msg.voiceName}</span>
                                    <span className="text-[8px] text-zinc-500">Msg #{msg.id}</span>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <div className="space-y-0.5">
                                      <Label className="text-[8px] text-zinc-450">Texto na Tela</Label>
                                      <Input
                                        className="text-xs h-7 bg-zinc-950 border-zinc-850 text-zinc-300"
                                        value={msg.text}
                                        onChange={(e) => updateTextMessage(msg.id, { text: e.target.value })}
                                      />
                                    </div>
                                    <div className="space-y-0.5">
                                      <Label className="text-[8px] text-zinc-450">Texto Falado (TTS Override)</Label>
                                      <Input
                                        className="text-xs h-7 bg-zinc-950 border-zinc-850 text-zinc-300 font-mono"
                                        placeholder="Ex: [risadas] Olá!"
                                        value={msg.spokenText ?? ""}
                                        onChange={(e) => updateTextMessage(msg.id, { spokenText: e.target.value || undefined })}
                                      />
                                    </div>
                                  </div>

                                  {(useDirector || ttsProvider === "omnivoice" || ttsProvider === "qwen3") && (
                                    <div className="space-y-0.5">
                                      <Label className="text-[8px] text-zinc-450">Instruções de Tom de Voz</Label>
                                      <Input
                                        className="text-xs h-7 bg-zinc-950 border-zinc-850 text-zinc-350"
                                        placeholder="female, low pitch, whisper..."
                                        value={msg.instruct ?? ""}
                                        onChange={(e) => updateTextMessage(msg.id, { instruct: e.target.value || undefined })}
                                      />
                                    </div>
                                  )}
                                </div>

                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isLoading || !msg.voiceName.trim() || !msg.text.trim()}
                                  onClick={() => regenerateOneAudio(msg.id)}
                                  className="h-8 w-8 p-0 border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-white shrink-0 mt-3"
                                >
                                  {isLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-purple-450" />
                                  ) : (
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </div>
                              {msg.audioUrl && (
                                <audio controls src={msg.audioUrl} className="h-7 w-full mt-2 filter invert opacity-80" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Biblioteca de áudios gerados */}
                <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-850">
                    <h3 className="font-semibold text-xs text-zinc-200">Biblioteca de Áudios ({generatedAudios.length})</h3>
                    {generatedAudios.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={linkAllAudios}
                        className="text-[10px] h-7 px-2 border-purple-800/80 hover:bg-purple-900/20 hover:border-purple-650 hover:text-white transition duration-150"
                      >
                        Vincular Todos
                      </Button>
                    )}
                  </div>
                  {generatedAudios.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-zinc-850 p-6 text-center text-zinc-500 text-xs">
                      Nenhum áudio gerado nesta sessão ainda.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {generatedAudios.map((g, idx) => {
                        const isLinked = activeChat.messages.some(
                          (m) => m.type === "text" && m.audioUrl === g.audioUrl
                        );
                        return (
                          <div key={idx} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2 text-xs">
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="font-bold text-zinc-300 capitalize">{g.voiceName}</span>
                              <span className={`px-2 py-0.5 rounded text-[8px] font-medium ${isLinked ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" : "bg-zinc-800 text-zinc-400"}`}>
                                {isLinked ? "Vinculado" : "Não Vinculado"}
                              </span>
                            </div>
                            <p className="text-[10px] text-zinc-400 italic truncate font-sans">“{g.text}”</p>
                            <audio src={g.audioUrl} controls className="h-6 w-full filter invert opacity-75 mt-1" />
                            <div className="flex gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="text-[9px] h-6 px-2 flex-1"
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
                                  } else {
                                    const textMsgsWithoutAudio = activeChat.messages.filter(
                                      (m): m is TextMsg => m.type === "text" && !m.audioUrl
                                    );
                                    if (textMsgsWithoutAudio.length === 0) return;
                                    const candidate = textMsgsWithoutAudio.find(
                                      (m) => m.voiceName.toLowerCase() === g.voiceName.toLowerCase()
                                    ) || textMsgsWithoutAudio[0];
                                    const updated = activeChat.messages.map((m) =>
                                      m.id === candidate.id && m.type === "text"
                                        ? { ...m, audioUrl: g.audioUrl }
                                        : m
                                    );
                                    updateActiveChat({ messages: updated });
                                  }
                                }}
                              >
                                Vincular ao Script
                              </Button>
                              <button
                                onClick={() => setGeneratedAudios((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-[9px] text-red-400 hover:text-red-350 px-2 transition"
                              >
                                Excluir
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SEÇÃO: EXPORTAÇÃO */}
            {activeSection === "export" && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">📥 Exportar Vídeo</h2>
                  <p className="text-xs text-zinc-400">Configure limites de renderização e grave o vídeo do chat finalizado.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                    <Label className="text-xs text-zinc-350">Gravar a partir do índice</Label>
                    <Input
                      type="number"
                      value={exportStartIndex}
                      onChange={(e) => setExportStartIndex(Number(e.target.value) || 0)}
                      className="bg-zinc-950 border-zinc-800 text-xs h-8"
                    />
                    <p className="text-[9px] text-zinc-450 leading-tight">
                      Grave a partir de uma mensagem específica para acelerar testes. (0 = início do chat).
                    </p>
                  </div>

                  <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                    <Label className="text-xs text-zinc-350">Altura do scroll ajustada (px)</Label>
                    <Input
                      type="number"
                      value={exportScroll}
                      onChange={(e) => setExportScroll(Number(e.target.value) || 0)}
                      className="bg-zinc-950 border-zinc-800 text-xs h-8"
                    />
                  </div>

                  <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                    <Label className="text-xs text-zinc-350">Taxa de Quadros (FPS)</Label>
                    <select
                      value={exportFps}
                      onChange={(e) => setExportFps(Number(e.target.value))}
                      className="w-full h-8 rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
                    >
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                    </select>
                    <p className="text-[9px] text-zinc-450 leading-tight">
                      Taxa de quadros do vídeo final. 60 FPS oferece animações mais fluidas.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 pt-3">
                  <Button
                    onClick={() => exportVideoFast(false)}
                    disabled={!allAudiosReady || playing || recording || isLocalExporting}
                    size="lg"
                    className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs h-12 shadow-lg shadow-purple-600/10"
                  >
                    {recording ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Gravando vídeo... {Math.round(exportProgress)}%
                      </>
                    ) : (
                      <>
                        <Download className="mr-2 h-4 w-4" />
                        Exportar Vídeo (Chat Ativo) 🎬
                      </>
                    )}
                  </Button>

                  <Button
                    onClick={() => exportVideoFast(true)}
                    disabled={!allAudiosReady || playing || recording || isLocalExporting}
                    size="lg"
                    className="w-full text-xs h-11"
                    variant="outline"
                  >
                    Exportar Vídeo (Todos os Chats)
                  </Button>

                  <div className="relative flex items-center justify-center my-3">
                    <span className="absolute px-3 bg-zinc-950 text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">ou pelo seu Computador</span>
                    <hr className="w-full border-zinc-800" />
                  </div>

                  <Button
                    onClick={() => exportVideoLocal(false)}
                    disabled={!allAudiosReady || playing || recording || isLocalExporting}
                    size="lg"
                    className="w-full bg-emerald-650 hover:bg-emerald-600 text-white font-semibold text-xs h-12 shadow-lg shadow-emerald-600/10"
                  >
                    {isLocalExporting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Exportando no PC... {Math.round(localExportProgress)}%
                      </>
                    ) : (
                      <>
                        <Cpu className="mr-2 h-4 w-4" />
                        Exportar via PC (Chat Ativo) 🖥️
                      </>
                    )}
                  </Button>

                  <Button
                    onClick={() => exportVideoLocal(true)}
                    disabled={!allAudiosReady || playing || recording || isLocalExporting}
                    size="lg"
                    className="w-full text-xs h-11 text-emerald-400 hover:text-emerald-350 border-emerald-900/50 hover:bg-emerald-950/20"
                    variant="outline"
                  >
                    Exportar via PC (Todos os Chats)
                  </Button>
                </div>
              </div>
            )}

            {/* SEÇÃO: CONFIGURAÇÕES AVANÇADAS */}
            {activeSection === "settings" && (
              <div className="space-y-6 max-w-3xl">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">⚙️ Configurações Avançadas</h2>
                  <p className="text-xs text-zinc-400">Configure chaves de API, portas de rede e atrasos finos de áudio.</p>
                </div>

                {/* Atrasos e velocidades básicas */}
                <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-zinc-300">Message Delay (ms)</Label>
                      <Input
                        type="number"
                        step={50}
                        value={messageDelay}
                        onChange={(e) => setMessageDelay(Number(e.target.value) || 0)}
                        className="bg-zinc-950 border-zinc-800 text-zinc-200 h-9"
                      />
                      <p className="text-[9px] text-zinc-450">
                        Atraso entre o áudio de uma mensagem e o aparecimento da próxima.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-zinc-300">Voice Speed</Label>
                        <span className="text-xs font-mono text-purple-400">{voiceSpeed.toFixed(2)}x</span>
                      </div>
                      <Input
                        type="range"
                        min={0.5}
                        max={2}
                        step={0.05}
                        value={voiceSpeed}
                        onChange={(e) => setVoiceSpeed(Number(e.target.value))}
                        className="h-6 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                {/* Provedor TTS e APIs */}
                <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                  <div className="space-y-2">
                    <Label className="text-xs text-zinc-300">Provedor de Voz (TTS)</Label>
                    <select
                      className="w-full h-9 rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
                      value={ttsProvider}
                      onChange={(e) => setTtsProvider(e.target.value as any)}
                    >
                      <option value="elevenlabs">ElevenLabs (Nuvem / API Key)</option>
                      <option value="omnivoice">OmniVoice Local (Gratuito / GPU)</option>
                      <option value="qwen3">Qwen3-TTS Local (1.7B / GPU)</option>
                    </select>
                  </div>

                  {ttsProvider === "elevenlabs" ? (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label className="text-xs text-zinc-300">ElevenLabs API Key</Label>
                        <Input
                          type="password"
                          value={elevenKey}
                          onChange={(e) => setElevenKey(e.target.value)}
                          placeholder="sk_..."
                          className="bg-zinc-950 border-zinc-800 text-zinc-200 h-9"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-zinc-300">Modelo ElevenLabs</Label>
                          <button
                            type="button"
                            onClick={fetchElevenModels}
                            className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                            disabled={!elevenKey}
                          >
                            Recarregar Modelos
                          </button>
                        </div>
                        <select
                          className="w-full h-9 rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
                          value={elevenModel}
                          onChange={(e) => setElevenModel(e.target.value)}
                        >
                          {elevenModels.map((m) => (
                            <option key={m.model_id} value={m.model_id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 pt-2 border-t border-zinc-800/40">
                      <div className="space-y-2">
                        <Label className="text-xs text-zinc-300">URL do Servidor Local</Label>
                        <Input
                          type="text"
                          value={omniVoiceUrl}
                          onChange={(e) => setOmniVoiceUrl(e.target.value)}
                          placeholder="http://localhost:8000"
                          className="bg-zinc-950 border-zinc-800 text-zinc-200 h-9"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full text-xs h-9 border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900"
                        onClick={async () => {
                          try {
                            const res = await startOmniVoiceServerFn();
                            if ((res as any).success) {
                              alert("Comando enviado! O terminal do servidor se abrirá em breve.");
                            } else {
                              alert(`Erro ao abrir: ${(res as any).error}`);
                            }
                          } catch (err) {
                            alert(`Erro: ${(err as Error).message}`);
                          }
                        }}
                      >
                        Iniciar Servidor de Voz Local (python tts_server.py)
                      </Button>

                      {/* Parâmetros avançados OmniVoice */}
                      {ttsProvider === "omnivoice" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-zinc-850">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label className="text-[10px] text-zinc-400">Diffusion Steps (Qualidade)</Label>
                              <span className="text-[10px] text-zinc-400 font-mono">{omniNumStep}</span>
                            </div>
                            <Input
                              type="range"
                              min={16}
                              max={128}
                              step={8}
                              value={omniNumStep}
                              onChange={(e) => setOmniNumStep(Number(e.target.value))}
                              className="h-6 cursor-pointer"
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label className="text-[10px] text-zinc-400">CFG Scale (Expressividade)</Label>
                              <span className="text-[10px] text-zinc-400 font-mono">{omniGuidanceScale.toFixed(1)}</span>
                            </div>
                            <Input
                              type="range"
                              min={1.0}
                              max={4.0}
                              step={0.1}
                              value={omniGuidanceScale}
                              onChange={(e) => setOmniGuidanceScale(Number(e.target.value))}
                              className="h-6 cursor-pointer"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Diretor de Emoções IA */}
                <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="use-director" className="text-xs text-zinc-300 font-medium cursor-pointer">
                      Usar Diretor de Emoções (IA)
                    </Label>
                    <input
                      id="use-director"
                      type="checkbox"
                      className="h-4 w-4 rounded border-zinc-800 text-purple-600 focus:ring-purple-600 bg-zinc-950 cursor-pointer"
                      checked={useDirector}
                      onChange={(e) => setUseDirector(e.target.checked)}
                    />
                  </div>

                  {useDirector && (
                    <div className="space-y-3 bg-zinc-950/40 p-4 border border-zinc-850 rounded-lg">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-400">Provedor IA</Label>
                        <select
                          className="w-full h-8 rounded border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
                          value={directorLlmProvider}
                          onChange={(e) => setDirectorLlmProvider(e.target.value as any)}
                        >
                          <option value="gemini">Gemini (Google AI Studio - Chave Grátis)</option>
                          <option value="openai">OpenAI (Pago)</option>
                          <option value="local">LLM Local (Ollama / LM Studio)</option>
                        </select>
                      </div>

                      {directorLlmProvider === "gemini" && (
                        <div className="space-y-1">
                          <Label className="text-[10px] text-zinc-400">Gemini API Key</Label>
                          <Input
                            type="password"
                            className="h-8 text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
                            value={geminiApiKey}
                            onChange={(e) => setGeminiApiKey(e.target.value)}
                            placeholder="AIzaSy..."
                          />
                        </div>
                      )}

                      {directorLlmProvider === "openai" && (
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] text-zinc-400">OpenAI API Key</Label>
                            <Input
                              type="password"
                              className="h-8 text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
                              value={openaiApiKey}
                              onChange={(e) => setOpenaiApiKey(e.target.value)}
                              placeholder="sk-proj-..."
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-zinc-400">Modelo OpenAI</Label>
                            <Input
                              type="text"
                              className="h-8 text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
                              value={openaiModel}
                              onChange={(e) => setOpenaiModel(e.target.value)}
                              placeholder="gpt-4o-mini"
                            />
                          </div>
                        </div>
                      )}

                      {directorLlmProvider === "local" && (
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] text-zinc-400">URL do Servidor Local LLM (Base URL)</Label>
                            <Input
                              type="text"
                              className="h-8 text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
                              value={localLlmUrl}
                              onChange={(e) => setLocalLlmUrl(e.target.value)}
                              placeholder="Ex: http://localhost:11434/v1 ou http://localhost:1234/v1"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-zinc-400">Nome do Modelo Local (ex: gemma2)</Label>
                            <Input
                              type="text"
                              className="h-8 text-xs bg-zinc-950 border-zinc-800 text-zinc-200"
                              value={localLlmModel}
                              onChange={(e) => setLocalLlmModel(e.target.value)}
                              placeholder="Ex: gemma2, llama3, qwen2.5:7b"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>

          {/* 3. STICKY PREVIEW DO CELULAR */}
          <section id="phone-preview-section" className="hidden lg:flex w-[450px] shrink-0 border-l border-zinc-850 bg-zinc-900/10 p-6 flex-col justify-center items-center sticky top-0 h-full overflow-hidden">
            <div className="relative aspect-[9/16] w-full max-w-[370px]">
              <div
                id="phone-preview-wrapper"
                ref={previewRef}
                className="w-full h-full flex items-center justify-center relative overflow-hidden"
                style={{
                  background: activeBackground.startsWith("data:image")
                    ? `url(${activeBackground}) center/cover no-repeat`
                    : isBgVideo
                    ? "transparent"
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
                {isBgVideo && (
                  <video
                    ref={(el) => {
                      activeBgVideoRef.current = el;
                      if (el) {
                        el.onloadedmetadata = () => {
                          setBgVideoDuration(el.duration);
                          setBgVideoResolution(`${el.videoWidth}x${el.videoHeight}`);
                        };
                        if (el.currentTime !== bgVideoOffset && !playing) {
                          el.currentTime = bgVideoOffset % (el.duration || 1);
                        }
                      }
                    }}
                    src={activeBgBlobUrl || activeBackground}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="bg-video-el absolute inset-0 w-full h-full object-cover z-0 pointer-events-none"
                  />
                )}
                <div
                  id="phone-preview-phone"
                  className="w-[92%] h-fit max-h-[68%] flex flex-col rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden shrink-0 border border-zinc-800 z-10"
                  style={{ backgroundColor: isWA ? "#0b141a" : "#000000" }}
                >
                  {/* Header */}
                  <div className="shrink-0 z-10 w-full">
                    {isWA ? (
                      <div className="bg-[#1f2c34] text-white flex items-center px-3 py-2.5 gap-3 z-10">
                        <ChevronLeft className="h-5 w-5 text-[#0A84FF] shrink-0" />
                        {displayChat.contactPhoto ? (
                          <img
                            src={displayChat.contactPhoto}
                            alt={displayChat.contactName}
                            className="w-9 h-9 rounded-full object-cover border border-zinc-800"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-650 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                            {displayChat.contactName.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="text-sm font-semibold truncate leading-tight">
                            {displayChat.contactName}
                          </span>
                          <span className="text-[10px] text-[#8696a0] leading-tight">
                            {effectiveGroupChat ? (
                              <input
                                value={displayChat.groupSubtitle ?? "tap here for group info"}
                                onChange={(e) =>
                                  updateChatById(displayChat.id, { groupSubtitle: e.target.value })
                                }
                                className="bg-transparent border-none outline-none text-[10px] text-[#8696a0] w-full p-0"
                              />
                            ) : (
                              "Online"
                            )}
                          </span>
                        </div>
                        <Video className="h-5 w-5 text-[#0A84FF] shrink-0" strokeWidth={2} />
                        <Phone className="h-4.5 w-4.5 text-[#0A84FF] shrink-0 ml-1" strokeWidth={2} />
                      </div>
                    ) : (
                      <div className="relative bg-black px-4 pt-3 pb-3 border-b border-zinc-900">
                        <div className="flex items-center gap-1 text-[#0A84FF] absolute left-3 top-1/2 -translate-y-1/2 bg-[#1c1c1e] rounded-full pl-1 pr-3 py-0.5">
                          <ChevronLeft className="h-4 w-4" />
                          <input
                            value={displayChat.headerTime}
                            onChange={(e) =>
                              updateChatById(displayChat.id, { headerTime: e.target.value })
                            }
                            className="bg-transparent border-none outline-none text-xs w-9 text-white p-0 font-medium"
                          />
                        </div>
                        <div className="flex flex-col items-center mx-auto w-fit">
                          {effectiveGroupChat ? (
                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#7a7a99] to-[#3a3a5a] flex items-center justify-center border border-zinc-800">
                              <Users className="h-5 w-5 text-white" />
                            </div>
                          ) : displayChat.contactPhoto ? (
                            <img
                              src={displayChat.contactPhoto}
                              alt={displayChat.contactName}
                              className="w-11 h-11 rounded-full object-cover border border-zinc-800"
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#7a7a99] to-[#3a3a5a] flex items-center justify-center text-white text-sm font-semibold border border-zinc-800">
                              {displayChat.contactName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="mt-1 flex items-center gap-1 bg-[#1c1c1e] rounded-full px-2.5 py-0.5">
                            <span className="text-white text-[13px] font-semibold">{displayChat.contactName}</span>
                            <span className="text-[#8e8e93] text-xs">›</span>
                          </div>
                        </div>
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-[#1c1c1e] rounded-full p-1.5 border border-zinc-850">
                          <Video className="h-4 w-4 text-white" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Chat Message Scrollport */}
                  <div
                    ref={(el) => {
                      chatOuterRef.current = el;
                      chatScrollRef.current = el;
                    }}
                    className="w-full relative overflow-hidden flex-shrink"
                    style={{
                      ...(isWA
                        ? {
                            backgroundImage:
                              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'><g fill='none' stroke='%23ffffff' stroke-opacity='0.03' stroke-width='1.2'><circle cx='30' cy='30' r='10'/><path d='M60 20 q5 10 10 0 t10 0'/><circle cx='110' cy='40' r='6'/><path d='M140 20 l8 8 l-8 8 l-8 -8 z'/><circle cx='160' cy='70' r='4'/><path d='M20 80 q10 -10 20 0 t20 0'/><circle cx='80' cy='100' r='8'/><path d='M120 90 l10 0 l-5 -10 z'/><circle cx='40' cy='140' r='5'/><path d='M70 150 q10 10 20 0 t20 0'/><circle cx='140' cy='130' r='10'/><path d='M170 160 l-10 0 l5 -10 z'/></g></svg>\")",
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
                          const isLeftSide = effectiveGroupChat ? (m.side !== "2") : (m.side === "1");

                          const isFirstInSequence = (() => {
                            if (!isLeftSide) return false;
                            const pMsg = arr[idx - 1];
                            if (!pMsg) return true;
                            const pMsgLeftSide = effectiveGroupChat ? (pMsg.side !== "2") : (pMsg.side === "1");
                            if (!pMsgLeftSide) return true;
                            const currentSender = getSenderName(m, idx);
                            const prevSender = pMsg ? getSenderName(pMsg, idx - 1) : "";
                            return currentSender !== prevSender;
                          })();

                          const isLastInSequence = (() => {
                            if (!isLeftSide) return false;
                            const next = arr[idx + 1];
                            if (!next) return true;
                            const nextLeftSide = effectiveGroupChat ? (next.side !== "2") : (next.side === "1");
                            if (!nextLeftSide) return true;
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

                          const showName = effectiveGroupChat && isLeftSide && isFirstInSequence;
                          const nameColor = senderName ? displayChat.nameColors?.[senderName] || "" : "";
                          const showAvatarPlaceholder = effectiveGroupChat && isLeftSide;
                          const avatarUrl = showAvatarPlaceholder && senderName ? (displayChat.characterPhotos?.[senderName] || "") : "";
                          const charInitial = senderName ? senderName.charAt(0).toUpperCase() : "";
                          const showAvatar = isLastInSequence && effectiveGroupChat;

                          const isEndOfBlock = (() => {
                            const next = arr[idx + 1];
                            if (!next) return true;
                            if (next.side !== m.side) return true;
                            if (isLeftSide) {
                              const currentSender = getSenderName(m, idx);
                              const nextSender = next ? getSenderName(next, idx + 1) : "";
                              return currentSender !== nextSender;
                            }
                            return false;
                          })();

                          const spacingClass = isEndOfBlock ? "mb-3" : "mb-0.5";

                          const renderBubble = () => {
                            if (m.type === "text") {
                              if (isWA) {
                                const bubbleSideClass = m.side === "2"
                                  ? `bg-[#005c4b] ml-auto ${isLastInSequenceRight ? "rounded-lg rounded-tr-none wa-tail-right" : "rounded-lg"}`
                                  : `bg-[#262d31] ${isLastInSequence ? "rounded-lg rounded-tl-none wa-tail-left" : "rounded-lg"}`;
                                return (
                                  <div className={`relative max-w-[82%] py-1.5 px-2.5 text-white text-[14px] leading-snug shadow-sm ${bubbleSideClass}`}>
                                    {showName && (
                                      <span
                                        className="text-[12px] font-bold mb-0.5 capitalize block"
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
                                  <div className={`relative max-w-[82%] px-3 py-1.5 text-white text-[14px] leading-snug ${bubbleSideClass}`}>
                                    {renderCensored(m.text)}
                                  </div>
                                );
                              }
                            } else if (m.type === "image") {
                              if (m.imageUrl) {
                                if (isWA) {
                                  return (
                                    <div className={`p-1 rounded-lg ${m.side === "2" ? "bg-[#005c4b] ml-auto" : "bg-[#262d31]"}`}>
                                      {showName && (
                                        <span
                                          className="text-[12px] font-bold px-1.5 pt-0.5 pb-1 capitalize block"
                                          style={{ color: nameColor || "#53bdeb" }}
                                        >
                                          {senderName}
                                        </span>
                                      )}
                                      <img src={m.imageUrl} alt={m.text} className="max-w-[210px] max-h-48 object-cover rounded" />
                                    </div>
                                  );
                                } else {
                                  return (
                                    <img src={m.imageUrl} alt={m.text} className="max-w-[70%] max-h-48 object-cover rounded-2xl" />
                                  );
                                }
                              } else {
                                return (
                                  <div className={`h-24 w-40 rounded-2xl flex flex-col items-center justify-center text-[10px] gap-1.5 p-2 ${isWA ? "bg-[#262d31] text-[#8696a0]" : "bg-zinc-800 text-zinc-350"}`}>
                                    <ImageIcon className="h-6 w-6" />
                                    <span className="text-center line-clamp-2">{m.text}</span>
                                  </div>
                                );
                              }
                            } else if (m.type === "video") {
                              if (m.videoUrl) {
                                const isGif = m.videoType === "gif";
                                if (isWA) {
                                  return (
                                    <div className={`p-1 rounded-lg ${m.side === "2" ? "bg-[#005c4b] ml-auto" : "bg-[#262d31]"}`}>
                                      {showName && (
                                        <span
                                          className="text-[12px] font-bold px-1.5 pt-0.5 pb-1 capitalize block"
                                          style={{ color: nameColor || "#53bdeb" }}
                                        >
                                          {senderName}
                                        </span>
                                      )}
                                      {isGif ? (
                                        <img src={m.videoUrl} alt={m.text} className="max-w-[210px] max-h-[160px] object-cover rounded" />
                                      ) : (
                                        <VideoBubble
                                          src={m.videoUrl}
                                          recording={recording}
                                          className="max-w-[210px] max-h-[160px] object-cover rounded"
                                          msgId={m.id}
                                          chatId={displayChat.id}
                                        />
                                      )}
                                    </div>
                                  );
                                } else {
                                  return isGif ? (
                                    <img src={m.videoUrl} alt={m.text} className="max-w-[210px] max-h-[160px] object-cover rounded-2xl" />
                                  ) : (
                                    <VideoBubble
                                      src={m.videoUrl}
                                      recording={recording}
                                      className="max-w-[210px] max-h-[160px] object-cover rounded-2xl"
                                      msgId={m.id}
                                      chatId={displayChat.id}
                                    />
                                  );
                                }
                              } else {
                                return (
                                  <div className={`w-[210px] h-[140px] rounded-2xl flex flex-col items-center justify-center text-[10px] gap-1.5 p-2 ${isWA ? "bg-[#262d31] text-[#8696a0]" : "bg-zinc-800 text-zinc-350"}`}>
                                    <Video className="h-6 w-6" />
                                    <span className="text-center truncate max-w-full px-2">{m.text}</span>
                                  </div>
                                );
                              }
                            }
                          };

                          return (
                            <motion.div
                              key={m.id}
                              initial={{ opacity: recording ? 1 : 0, y: recording ? 0 : 15 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: recording ? 0 : 0.25 }}
                              className={`flex flex-col ${spacingClass} ${
                                m.side === "2" ? "items-end" : "items-start"
                              } ${!effectiveGroupChat && m.side === "1" ? "pl-1.5" : ""}`}
                            >
                              {!isWA && showName && (
                                <span
                                  className="text-[10px] mb-0.5 capitalize block"
                                  style={{
                                    color: nameColor || "#8e8e93",
                                    marginLeft: showAvatarPlaceholder ? "32px" : "10px",
                                  }}
                                >
                                  {senderName}
                                </span>
                              )}
                              {showAvatarPlaceholder ? (
                                <div className="flex flex-row items-end gap-1.5 w-full">
                                  <div className="w-6.5 h-6.5 flex-shrink-0 flex items-center justify-center select-none relative z-10">
                                    {showAvatar && (
                                      avatarUrl ? (
                                        <img
                                          src={avatarUrl}
                                          alt={senderName}
                                          className="w-6 h-6 rounded-full object-cover border border-zinc-800"
                                        />
                                      ) : (
                                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-zinc-600 to-zinc-850 flex items-center justify-center text-white text-[9px] font-semibold uppercase border border-zinc-800">
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
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {!recording && (
                  <div
                    data-preview-only="true"
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1 select-none cursor-ns-resize px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md text-white/90 text-[10px] border border-white/5 shadow-lg"
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
                    <div className="w-8 h-1 rounded-full bg-white/50" />
                    <span>Arraste para rolar</span>
                  </div>
                )}
              </div>

              {recording && (
                <div className="absolute inset-0 z-50 bg-black/85 flex flex-col items-center justify-center gap-3 px-6 rounded-2xl">
                  <Loader2 className="h-7 w-7 animate-spin text-purple-400" />
                  <div className="text-white text-xs font-semibold">
                    Gravando vídeo... {Math.round(exportProgress)}%
                  </div>
                  <Progress
                    value={exportProgress}
                    className="w-full h-1.5 bg-zinc-800 [&>div]:bg-purple-500"
                  />
                </div>
              )}
            </div>
          </section>

        </div>

        {/* 4. RODAPÉ FIXO DE REPRODUÇÃO & EXPORTAÇÃO RÁPIDA */}
        <footer className="fixed bottom-0 left-0 right-0 h-20 bg-zinc-900/90 backdrop-blur-md border-t border-zinc-800 px-6 flex items-center justify-between shrink-0 z-50">
          {/* LADO ESQUERDO: CONTROLES DE PLAYBACK OU STATUS */}
          <div className="flex items-center gap-4">
            {playing && !recording ? (
              <div className="flex items-center gap-2">
                {/* Voltar */}
                <button
                  onClick={skipBackward}
                  className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
                  title="Voltar 5 mensagens"
                >
                  <SkipBack className="h-4 w-4" />
                </button>

                {/* Play/Pause */}
                <button
                  onClick={togglePause}
                  className="p-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white transition shadow-md shadow-purple-600/10"
                  title={paused ? "Continuar" : "Pausar"}
                >
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </button>

                {/* Avançar */}
                <button
                  onClick={skipForward}
                  className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
                  title="Avançar 5 mensagens"
                >
                  <SkipForward className="h-4 w-4" />
                </button>

                {/* Parar */}
                <button
                  onClick={stopPlayback}
                  className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-red-400 transition"
                  title="Parar"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <Button
                onClick={() => playAnimation()}
                disabled={!allAudiosReady || playing || recording}
                variant="secondary"
                size="sm"
                className="h-9 font-medium text-xs gap-1.5"
              >
                <Play className="h-3.5 w-3.5" /> Play Vídeo
              </Button>
            )}

            {/* Contador de tempo/mensagens */}
            {playing && !recording && (
              <div className="flex items-center gap-2.5 text-xs text-zinc-400 font-mono border-l border-zinc-800 pl-4 h-6">
                <span>{formatTime(playbackElapsed)}</span>
                <span className="text-zinc-600">•</span>
                <span>{currentMsgIndex}/{totalMsgCount} msgs</span>
              </div>
            )}
          </div>

          {/* CENTRO: BARRA DE PROGRESSO DO PLAYER ESTILO YOUTUBE */}
          {playing && !recording && (
            <div className="flex-1 max-w-md mx-6">
              <div
                className="group relative w-full h-1.5 bg-zinc-800 rounded-full cursor-pointer hover:h-2 transition-all"
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
                  className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-red-550 border border-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ left: `calc(${totalMsgCount > 0 ? (currentMsgIndex / totalMsgCount) * 100 : 0}% - 7px)` }}
                />
              </div>
            </div>
          )}

          {/* LADO DIREITO: EXPORTAÇÃO RÁPIDA */}
          <div className="flex items-center gap-2">
            {!allAudiosReady && (
              <span className="text-[10px] text-zinc-500 mr-2">Gere os áudios primeiro para liberar o play/exportação</span>
            )}
            <Button
              onClick={() => exportVideoFast(false)}
              disabled={!allAudiosReady || playing || recording}
              size="sm"
              className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs h-9 px-4 shadow-lg shadow-purple-600/10"
            >
              {recording ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Salvando... {Math.round(exportProgress)}%
                </>
              ) : (
                <>
                  <Download className="mr-2 h-3.5 w-3.5" />
                  Exportar Vídeo
                </>
              )}
            </Button>
          </div>
        </footer>

      </div>
    </div>
  );
}
