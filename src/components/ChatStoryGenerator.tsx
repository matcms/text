import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import html2canvas from "html2canvas";

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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type TextMsg = {
  id: number;
  side: string;
  type: "text";
  voiceName: string;
  text: string;
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
};

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
  const previewRef = useRef<HTMLDivElement | null>(null);
  const recordingCtxRef = useRef<{
    audioCtx: AudioContext;
    dest: MediaStreamAudioDestinationNode;
  } | null>(null);
  const [recording, setRecording] = useState(false);

  // Persist keys
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

    type Seg = { theme: ChatTheme; contactName: string; lines: string[] };
    const segs: Seg[] = [];
    let cur: Seg | null = null;

    for (const line of lines) {
      const headerMatch = line.match(/^-\s*(Header|iMessage|Whatsapp|WhatsApp)\s*:\s*(.+)$/i);
      if (headerMatch) {
        const kind = headerMatch[1].toLowerCase();
        const name = headerMatch[2].trim();
        const theme: ChatTheme =
          kind === "whatsapp" ? "whatsapp" : kind === "imessage" ? "imessage" : chatTheme;
        cur = { theme, contactName: name, lines: [] };
        segs.push(cur);
        continue;
      }
      if (!cur) {
        cur = { theme: chatTheme, contactName: activeChat.contactName, lines: [] };
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
          parsed.push({
            id: id++,
            side: textMatch[1],
            type: "text",
            voiceName: textMatch[2].trim(),
            text: textMatch[3],
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

      if (i === 0) {
        return { ...activeChat, contactName: s.contactName, messages, voiceMap };
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
      };
    });

    setChats(newChats);
    setActiveChatId(newChats[0].id);
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
        const audioUrl = await ttsElevenLabs(stripCensors(msg.text), voiceId);

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

  const playAnimation = async () => {
    setPlaying(true);
    const pauseMs = Math.max(0, Number(messageDelay) || 0);

    const scrollDown = () => {
      const el = chatScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    };

    for (let c = 0; c < chats.length; c++) {
      const chat = chats[c];
      setPlayingChatId(chat.id);
      setActiveChatId(chat.id);
      setVisibleMessages([]);
      if (c > 0 && pauseMs > 0) {
        await new Promise((r) => setTimeout(r, pauseMs));
      }

      const queue: Msg[] = [];
      for (let i = 0; i < chat.messages.length; i++) {
        const msg = chat.messages[i];

        queue.push(msg);
        setVisibleMessages([...queue]);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        scrollDown();
        if (msg.type === "text" && msg.audioUrl) {
          const rec = recordingCtxRef.current;
          if (rec) {
            // route audio through MediaStreamDestination so MediaRecorder captures it
            const buf = await fetch(msg.audioUrl).then((r) => r.arrayBuffer());
            const audioBuf = await rec.audioCtx.decodeAudioData(buf.slice(0));
            const src = rec.audioCtx.createBufferSource();
            src.buffer = audioBuf;
            src.connect(rec.dest);
            src.connect(rec.audioCtx.destination);
            src.start();
            await new Promise((r) => (src.onended = () => r(null)));
          } else {
            const audio = new Audio(msg.audioUrl);
            audio.play();
            await new Promise((r) => (audio.onended = () => r(null)));
          }
          if (Number(messageDelay) > 0) {
            await new Promise((r) => setTimeout(r, Number(messageDelay)));
          }
        }
        if (msg.type === "image") {
          await new Promise((r) => setTimeout(r, 2000));
        }
        if (i < chat.messages.length - 1 && pauseMs > 0) {
          await new Promise((r) => setTimeout(r, pauseMs));
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
    const W = target.offsetWidth;
    const H = target.offsetHeight;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    const audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    recordingCtxRef.current = { audioCtx, dest };

    const videoStream = canvas.captureStream(30);
    const combined = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const mimeCandidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
    const recorder = new MediaRecorder(combined, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(100);

    let drawing = true;
    const drawLoop = async () => {
      while (drawing) {
        try {
          const snap = await html2canvas(target, {
            backgroundColor: null,
            scale: 1,
            logging: false,
            useCORS: true,
          });
          ctx.drawImage(snap, 0, 0, W, H);
        } catch (err) {
          console.error(err);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    };
    drawLoop();

    try {
      await playAnimation();
    } finally {
      drawing = false;
      await new Promise((r) => setTimeout(r, 400));
      recorder.stop();
      await new Promise((r) => (recorder.onstop = () => r(null)));
      try { audioCtx.close(); } catch {}
      recordingCtxRef.current = null;

      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-story-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setRecording(false);
    }
  };

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

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* LEFT */}
      <div className="w-full lg:w-1/2 overflow-y-auto bg-background p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chat Story Generator</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cole um script com <code>1: NomeDaVoz&gt; texto</code>, gere os áudios e reproduza um vídeo sincronizado.
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
                variant={!isGroupChat ? "default" : "outline"}
                onClick={() => setIsGroupChat(false)}
              >
                Direct Message
              </Button>
              <Button
                size="sm"
                variant={isGroupChat ? "default" : "outline"}
                onClick={() => setIsGroupChat(true)}
              >
                Group Chat
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Message Delay (ms)</Label>
            <Input
              type="number"
              min={0}
              step={50}
              value={messageDelay}
              onChange={(e) => setMessageDelay(Math.max(0, Number(e.target.value) || 0))}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              Pausa adicional após cada áudio terminar (0 = sem pausa).
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
            Formato: <code>- iMessage: nome</code> ou <code>- Whatsapp: nome</code> (define o template automaticamente) e linhas <code>1: NomeDaVoz&gt; texto</code>.
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
          disabled={!allAudiosReady || playing}
          className="w-full"
          size="lg"
        >
          <Play className="mr-2 h-4 w-4" />
          Play vídeo (todos os chats)
        </Button>
      </div>

      {/* RIGHT */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 min-h-screen bg-background">
        <div
          className="relative rounded-[2rem] overflow-hidden shadow-2xl flex flex-col"
          style={{ width: 400, height: 711 }}
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
                  {isGroupChat ? "tap here for group info" : "Online"}
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
                {isGroupChat ? (
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
            ref={chatScrollRef}
            className={`flex-1 p-3 overflow-y-auto scroll-smooth ${
              isWA ? "bg-[#0b141a]" : "bg-black"
            }`}
            style={
              isWA
                ? {
                    scrollbarWidth: "none",
                    backgroundImage:
                      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180' viewBox='0 0 180 180'><g fill='none' stroke='%23ffffff' stroke-opacity='0.04' stroke-width='1.2'><circle cx='30' cy='30' r='10'/><path d='M60 20 q5 10 10 0 t10 0'/><circle cx='110' cy='40' r='6'/><path d='M140 20 l8 8 l-8 8 l-8 -8 z'/><circle cx='160' cy='70' r='4'/><path d='M20 80 q10 -10 20 0 t20 0'/><circle cx='80' cy='100' r='8'/><path d='M120 90 l10 0 l-5 -10 z'/><circle cx='40' cy='140' r='5'/><path d='M70 150 q10 10 20 0 t20 0'/><circle cx='140' cy='130' r='10'/><path d='M170 160 l-10 0 l5 -10 z'/></g></svg>\")",
                    backgroundRepeat: "repeat",
                  }
                : { scrollbarWidth: "none" }
            }
          >
            <AnimatePresence>
              {(playing ? visibleMessages : displayChat.messages).map((m, idx, arr) => {
                const isLastSent =
                  m.side === "2" &&
                  !arr.slice(idx + 1).some((n) => n.side === "2");
                const prev = arr[idx - 1];
                const senderName = m.type === "text" ? m.voiceName : "";
                const showName =
                  isGroupChat &&
                  m.side === "1" &&
                  m.type === "text" &&
                  (idx === 0 ||
                    prev?.side === "2" ||
                    (prev?.type === "text" && prev.voiceName !== m.voiceName));
                return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex flex-col ${isWA ? "mb-1.5" : "mb-1"} ${
                    m.side === "2" ? "items-end" : "items-start"
                  }`}
                >
                  {!isWA && showName && (
                    <span className="text-[11px] text-[#8e8e93] mb-0.5 ml-3 capitalize block">
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
                          <span className="text-[13px] font-bold text-[#53bdeb] mb-0.5 capitalize block">
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
                  {!isWA && isLastSent && (
                    <span className="text-[#8e8e93] text-[11px] mt-0.5 mr-1">Entregue</span>
                  )}
                </motion.div>
              );})}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
