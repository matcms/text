import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toCanvas } from "html-to-image";
import { Progress } from "@/components/ui/progress";

// Render text with (parens) replaced by a censored block (audio keeps the word)
const renderCensored = (text: string) => {
  const parts = text.split(/(\([^)]*\))/g);
  return parts.map((p, i) => {
    const m = p.match(/^\(([^)]*)\)$/);
    if (m) {
      return (
        <span
          key={i}
          className="inline-block align-middle rounded px-1 mx-0.5 select-none"
          style={{
            backgroundColor: "#111",
            color: "transparent",
            textShadow: "none",
            filter: "blur(0.5px)",
          }}
        >
          {m[1]}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
};
const stripCensors = (text: string) => text.replace(/[()]/g, "");
import {
  ChevronLeft,
  Video,
  Phone,
  Image as ImageIcon,
  Loader2,
  Play,
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
};
type Msg = TextMsg | ImgMsg;

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
});

// Convert base64 (mp3) to blob URL
const base64ToBlobUrl = (b64: string, mime = "audio/mpeg") => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
};

export default function ChatStoryGenerator() {
  const [elevenKey, setElevenKey] = useState("");
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
  const exportProgressRef = useRef<{ done: number; total: number } | null>(null);

  // Projects (IndexedDB)
  const [projectName, setProjectName] = useState("");
  const [activeTab, setActiveTab] = useState<"editor" | "projects">("editor");
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [savingProject, setSavingProject] = useState(false);

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
      messages: c.messages.map((m) =>
        m.type === "text"
          ? {
              id: m.id,
              side: m.side,
              type: "text",
              voiceName: m.voiceName,
              text: m.text,
              audioUrl: m.audioBlob ? URL.createObjectURL(m.audioBlob) : null,
            }
          : {
              id: m.id,
              side: m.side,
              type: "image",
              text: m.text,
              imageUrl: m.imageBlob ? URL.createObjectURL(m.imageBlob) : null,
            }
      ),
    }));
    setChats(loadedChats);
    setActiveChatId(loadedChats[0]?.id || "");
    setChatTheme(p.theme);
    setIsGroupChat(p.isGroupChat);
    setMessageDelay(p.messageDelay);
    setProjectName(p.projectName);
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
  }, []);
  useEffect(() => {
    localStorage.setItem("elevenlabs_api_key", elevenKey);
  }, [elevenKey]);
  useEffect(() => {
    localStorage.setItem("chat_theme", chatTheme);
  }, [chatTheme]);

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

  const allAudiosReady = useMemo(() => {
    const all = chats.flatMap((c) => c.messages);
    const texts = all.filter((m) => m.type === "text") as TextMsg[];
    return texts.length > 0 && texts.every((m) => !!m.audioUrl);
  }, [chats]);

  const parseScript = () => {
    const lines = activeChat.script.split("\n").map((l) => l.trim()).filter(Boolean);

    type Seg = { theme: ChatTheme; contactName: string; lines: string[]; groupMode: boolean | null };
    const segs: Seg[] = [];
    let cur: Seg | null = null;

    for (const line of lines) {
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
        cur = { theme, contactName: name, lines: [], groupMode };
        segs.push(cur);
        continue;
      }
      if (!cur) {
        cur = {
          theme: chatTheme,
          contactName: activeChat.contactName,
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

    const buildMessages = (segLines: string[]): Msg[] => {
      const parsed: Msg[] = [];
      let id = 0;
      for (const line of segLines) {
        const imgMatch = line.match(/^(\d):\s*img:\s*(.*)$/);
        if (imgMatch) {
          parsed.push({
            id: id++,
            side: imgMatch[1],
            type: "image",
            text: imgMatch[2],
            imageUrl: null,
          });
          continue;
        }
        const textMatch = line.match(/^(\d):\s*(.+?)>\s*(.*)$/);
        if (textMatch) {
          const raw = textMatch[3];
          const sepIdx = raw.indexOf("==");
          const displayText = sepIdx >= 0 ? raw.slice(0, sepIdx).trim() : raw;
          const spokenText = sepIdx >= 0 ? raw.slice(sepIdx + 2).trim() : undefined;
          const speaker = textMatch[2].trim();
          const dashIdx = speaker.indexOf("-");
          const voiceName = dashIdx >= 0 ? speaker.slice(0, dashIdx).trim() : speaker;
          const displayName = dashIdx >= 0 ? speaker.slice(dashIdx + 1).trim() : undefined;
          parsed.push({
            id: id++,
            side: textMatch[1],
            type: "text",
            voiceName,
            displayName,
            text: displayText,
            spokenText,
            audioUrl: null,
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

      if (i === 0) {
        return {
          ...activeChat,
          contactName: s.contactName,
          messages,
          voiceMap,
          isGroupChat: resolvedGroup,
        };
      }
      return {
        id: `chat_${Date.now()}_${i}`,
        name: `Chat ${i + 1}`,
        contactName: s.contactName,
        contactPhoto: null,
        headerTime: "23",
        script: "",
        messages,
        voiceMap,
        isGroupChat: resolvedGroup,
      };
    });

    setChats(newChats);
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

  // Reusable single-message audio generator (resolves voice from chat voiceMap, savedVoices, or raw id)
  const generateSingleAudio = async (
    text: string,
    voiceIdentifier: string,
    chatId: string
  ): Promise<string> => {
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
    } catch (e) {
      console.error(e);
      alert(`Falha ao regenerar áudio: ${(e as Error).message}`);
    } finally {
      setRegeneratingMsgId(null);
    }
  };

  const generateAudios = async () => {
    if (!elevenKey) {
      alert("Por favor, insira sua API key do ElevenLabs");
      return;
    }

    

    const allTexts = chats.flatMap((c) =>
      c.messages.filter((m) => m.type === "text").map((m) => ({ chatId: c.id, msg: m as TextMsg }))
    );
    if (allTexts.length === 0) {
      alert("Faça o parse do script primeiro.");
      return;
    }

    setGenerating(true);
    setGenProgress({ done: 0, total: allTexts.length });

    let done = 0;
    const chatMessagesMap: Record<string, Msg[]> = {};
    chats.forEach((c) => (chatMessagesMap[c.id] = [...c.messages]));

    for (const { chatId, msg } of allTexts) {
      const chat = chats.find((c) => c.id === chatId)!;
      const voiceId = (chat.voiceMap[msg.voiceName] || "").trim();
      if (!voiceId) {
        alert(`Defina o Voice ID para "${msg.voiceName}" no chat "${chat.name}".`);
        setGenerating(false);
        return;
      }
      try {
        const audioUrl = await ttsElevenLabs(stripCensors(msg.spokenText ?? msg.text), voiceId);

        const arr = chatMessagesMap[chatId];
        const idx = arr.findIndex((m) => m.id === msg.id && m.type === "text");
        if (idx >= 0) arr[idx] = { ...(arr[idx] as TextMsg), audioUrl };
        updateChatById(chatId, { messages: [...arr] });
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

  const playAnimation = async (onFrameReady?: () => Promise<void>) => {
    setPlaying(true);
    const delayMs = Number(messageDelay) || 0;
    const scrollDown = () => {
      const el = chatScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    };
    for (let c = 0; c < chats.length; c++) {
      const chat = chats[c];
      setPlayingChatId(chat.id);
      setActiveChatId(chat.id);
      setVisibleMessages([]);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (onFrameReady) await onFrameReady();
      const queue: Msg[] = [];
      for (let i = 0; i < chat.messages.length; i++) {
        const msg = chat.messages[i];
        queue.push(msg);
        setVisibleMessages([...queue]);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        scrollDown();
        // Captura o frame ANTES de tocar o áudio
        if (onFrameReady) await onFrameReady();
        if (msg.type === "text" && msg.audioUrl) {
          const rec = recordingCtxRef.current;
          const audio = new Audio(msg.audioUrl);
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
          await new Promise((r) => setTimeout(r, waitTime));
        }
        if (msg.type === "image") {
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (exportProgressRef.current) {
          exportProgressRef.current.done += 1;
          const { done, total } = exportProgressRef.current;
          setExportProgress(total ? (done / total) * 100 : 0);
        }
      }
    }
    setPlayingChatId(null);
    setPlaying(false);
  };

  const recordVideo = async () => {
    const target = previewRef.current;
    if (!target) return;
    if (!allAudiosReady) {
      alert("Gere os áudios primeiro.");
      return;
    }
    setRecording(true);
    setExportProgress(0);
    const totalMessages = chats.reduce((acc, c) => acc + c.messages.length, 0);
    exportProgressRef.current = { done: 0, total: totalMessages };

    const SCALE = 2;
    const W = (target.offsetWidth || 400) * SCALE;
    const H = (target.offsetHeight || 711) * SCALE;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AC();
    const audioDest = audioCtx.createMediaStreamDestination();
    recordingCtxRef.current = { audioCtx, dest: audioDest };

    const FORMATS = [
      { mime: "video/mp4; codecs=avc1.42E01E,mp4a.40.2", ext: "mp4" },
      { mime: "video/mp4; codecs=avc1",                  ext: "mp4" },
      { mime: "video/mp4",                               ext: "mp4" },
      { mime: "video/webm; codecs=vp9,opus",             ext: "webm" },
      { mime: "video/webm; codecs=vp8,opus",             ext: "webm" },
      { mime: "video/webm; codecs=vp8",                  ext: "webm" },
      { mime: "video/webm",                              ext: "webm" },
    ];
    const chosen = FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime));
    if (!chosen) {
      alert("Seu navegador não suporta gravação de vídeo. Use o Chrome.");
      setRecording(false);
      return;
    }

    const canvasStream = canvas.captureStream(30);
    const combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDest.stream.getAudioTracks(),
    ]);

    const recorder = new MediaRecorder(combinedStream, {
      mimeType: chosen.mime,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 192_000,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.start(100);

    // Callback sincronizado: captura o frame atual e aguarda antes de continuar
    const captureFrame = async () => {
      if (!previewRef.current) return;
      try {
        const snap = await toCanvas(previewRef.current, {
          pixelRatio: SCALE,
          cacheBust: false,
          skipFonts: true,
          style: { transform: "scale(1)", transformOrigin: "top left" },
        });
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(snap, 0, 0, W, H);
      } catch (e) {
        console.warn("Frame drop", e);
      }
    };

    try {
      await playAnimation(captureFrame);
    } finally {
      // Captura frame final e aguarda gravar
      await captureFrame();
      await new Promise<void>((r) => setTimeout(r, 500));

      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });

      try { audioCtx.close(); } catch {}
      recordingCtxRef.current = null;

      const blob = new Blob(chunks, { type: chosen.mime });
      if (blob.size === 0) {
        alert("O vídeo gerado está vazio. Tente novamente.");
        setRecording(false);
        setExportProgress(0);
        return;
      }

      const url = URL.createObjectURL(blob);
      const safeName = (projectName.trim() || "chat-story").replace(/[^a-z0-9-_]+/gi, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}.${chosen.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      exportProgressRef.current = null;
      setRecording(false);
      setExportProgress(0);
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

        {Object.keys(activeChat.voiceMap).length > 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold text-sm">Voice IDs por personagem</h2>
            <p className="text-xs text-muted-foreground">
              Adicione manualmente um <code>voice_id</code> ou selecione uma voz já salva na biblioteca.
            </p>
            {Object.keys(activeChat.voiceMap).map((name) => {
              const currentId = activeChat.voiceMap[name];
              const matched = savedVoices.find((v) => v.voiceId === currentId);
              return (
                <div key={name} className="space-y-1.5 border-b last:border-b-0 pb-3 last:pb-0">
                  <Label className="text-xs">{name}</Label>
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
                .map((m) => m.displayName)
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

        <Button
          onClick={generateAudios}
          disabled={generating}
          className="w-full"
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

        <Button
          onClick={playAnimation}
          disabled={!allAudiosReady || playing || recording}
          className="w-full"
          size="lg"
        >
          <Play className="mr-2 h-4 w-4" />
          Play vídeo (todos os chats)
        </Button>

      </div>

      {/* RIGHT */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 min-h-screen bg-background gap-4">
        <div className="relative aspect-[9/16] w-full max-w-[400px]">
        <div
          ref={previewRef}
          className="aspect-[9/16] w-full max-w-[400px] h-full overflow-hidden flex flex-col relative rounded-[2rem] shadow-2xl bg-black"
        >
          {/* Header */}
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

          {/* Chat */}
          <div
            ref={(el) => {
              chatOuterRef.current = el;
              chatScrollRef.current = el;
            }}
            className="flex-1 w-full overflow-hidden relative"
            style={{
              backgroundColor: isWA ? "#0b141a" : "#000000",
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
              className="absolute top-0 left-0 w-full flex flex-col justify-end min-h-full pb-6"
              style={{
                transform: `translateY(-${exportScroll}px)`,
                transition: playing || recording ? "transform 0.15s ease-out" : "none",
              }}
            >
            <AnimatePresence>
              {(playing ? visibleMessages : displayChat.messages).map((m, idx, arr) => {
                const isLastSent =
                  m.side === "2" &&
                  !arr.slice(idx + 1).some((n) => n.side === "2");
                const prev = arr[idx - 1];
                const senderName = m.type === "text" ? (m.displayName || m.voiceName) : "";
                const prevSenderName =
                  prev?.type === "text" ? (prev.displayName || prev.voiceName) : "";
                const showName =
                  effectiveGroupChat &&
                  m.side === "1" &&
                  m.type === "text" &&
                  !!m.displayName;
                const nameColor =
                  m.type === "text" && m.displayName
                    ? displayChat.nameColors?.[m.displayName] || ""
                    : "";
                return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: recording ? 1 : 0, y: recording ? 0 : 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: recording ? 0 : 0.3 }}
                  className={`flex flex-col ${isWA ? "mb-1.5" : "mb-1"} ${
                    m.side === "2" ? "items-end" : "items-start"
                  }`}
                >
                  {!isWA && showName && (
                    <span
                      className="text-[11px] mb-0.5 ml-3 capitalize block"
                      style={{ color: nameColor || "#8e8e93" }}
                    >
                      {senderName}
                    </span>
                  )}
                  {m.type === "text" ? (
                    isWA ? (
                      <div
                        className={`relative max-w-[80%] py-1.5 px-2.5 text-white text-[15px] leading-snug shadow-sm ${
                          m.side === "2"
                            ? "bg-[#005c4b] rounded-lg rounded-tr-none ml-auto wa-tail-right"
                            : "bg-[#262d31] rounded-lg rounded-tl-none wa-tail-left"
                        }`}
                      >
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
                    ) : (
                      <div
                        className={`relative max-w-[80%] px-3 py-2 text-white text-[15px] leading-snug ${
                          m.side === "2"
                            ? "bg-[#0A84FF] rounded-2xl im-tail-right"
                            : "bg-[#262628] rounded-2xl"
                        }`}
                      >
                        {renderCensored(m.text)}
                      </div>
                    )
                  ) : m.imageUrl ? (
                    isWA ? (
                      <div
                        className={`p-1 rounded-lg ${
                          m.side === "2" ? "bg-[#005c4b] ml-auto" : "bg-[#262d31]"
                        }`}
                      >
                        <img
                          src={m.imageUrl}
                          alt={m.text}
                          className="max-w-[240px] max-h-56 object-cover rounded-md"
                        />
                      </div>
                    ) : (
                      <img
                        src={m.imageUrl}
                        alt={m.text}
                        className="max-w-[70%] max-h-56 object-cover rounded-2xl"
                      />
                    )
                  ) : (
                    <div className={`h-32 w-48 rounded-2xl flex flex-col items-center justify-center text-xs gap-2 p-2 ${
                      isWA ? "bg-[#262d31] text-[#8696a0]" : "bg-zinc-800 text-zinc-300"
                    }`}>
                      <ImageIcon className="h-8 w-8" />
                      <span className="text-center">{m.text}</span>
                    </div>
                  )}
                </motion.div>
              );})}
            </AnimatePresence>
          </div>
        </div>
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
          <Button
            onClick={recordVideo}
            disabled={!allAudiosReady || playing || recording}
            size="lg"
            style={{ width: 400 }}
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
                Export Video
              </>
            )}
          </Button>
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
