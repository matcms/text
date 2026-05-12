import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
};

type ChatTheme = "imessage" | "whatsapp";

const DEFAULT_SCRIPT = `- Header: Nate
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

  const [messagePauseSec, setMessagePauseSec] = useState(0.3);

  // ElevenLabs voices cache (name -> voice_id)
  const elevenVoicesRef = useRef<Record<string, string> | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

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
    const parsed: Msg[] = [];
    let id = 0;
    let header = activeChat.contactName;
    for (const line of lines) {
      const headerMatch = line.match(/^-\s*(?:Header|iMessage)\s*:\s*(.+)$/i);
      if (headerMatch) {
        header = headerMatch[1].trim();
        continue;
      }
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
    updateActiveChat({ contactName: header, messages: parsed });
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

  const ttsElevenLabs = async (text: string, voiceName: string): Promise<string> => {
    const voices = await fetchElevenVoices();
    const voiceId = voices[voiceName.toLowerCase()] || voiceName;
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

    elevenVoicesRef.current = null; // force refresh

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
      try {
        const audioUrl = await ttsElevenLabs(msg.text, msg.voiceName);

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
    const pauseMs = Math.max(0, Math.round(messagePauseSec * 1000));

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
          const audio = new Audio(msg.audioUrl);
          audio.play();
          await new Promise((r) => (audio.onended = () => r(null)));
        }
        if (i < chat.messages.length - 1 && pauseMs > 0) {
          await new Promise((r) => setTimeout(r, pauseMs));
        }
      }
    }
    setPlayingChatId(null);
    setPlaying(false);
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
            <Label>ElevenLabs API Key</Label>
            <Input
              type="password"
              value={elevenKey}
              onChange={(e) => setElevenKey(e.target.value)}
              placeholder="sk_..."
            />
            <p className="text-xs text-muted-foreground">
              No script use o <strong>nome</strong> da voz da sua biblioteca (ex.: <code>Adam</code>).
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
            Formato: <code>- Header: nome</code> e linhas <code>1: NomeDaVoz&gt; texto</code>.
          </p>
        </div>

        <Button onClick={parseScript} className="w-full">
          Parse Script
        </Button>

        {/* Pause control */}
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <Label>Pausa entre mensagens (segundos)</Label>
            <span className="text-xs text-muted-foreground">{messagePauseSec.toFixed(2)}s</span>
          </div>
          <Input
            type="number"
            step={0.05}
            min={0}
            value={messagePauseSec}
            onChange={(e) => setMessagePauseSec(Math.max(0, Number(e.target.value) || 0))}
            placeholder="0.3"
          />
          <div className="flex gap-2 pt-1 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(0)}>0s</Button>
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(0.1)}>0.1s</Button>
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(0.3)}>0.3s</Button>
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(0.6)}>0.6s</Button>
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(1)}>1s</Button>
          </div>
        </div>


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
      <div
        className={`w-full lg:w-1/2 flex items-center justify-center p-6 min-h-screen ${
          isWA ? "bg-emerald-900" : "bg-purple-600"
        }`}
      >
        <div
          className="relative bg-black rounded-[3rem] overflow-hidden shadow-2xl border-[10px] border-black flex flex-col"
          style={{ width: 400, height: 711 }}
        >
          {/* Header */}
          {isWA ? (
            <div className="bg-[#1f2c34] text-[#e9edef] flex items-center p-3 gap-3 shadow-sm z-10">
              <ChevronLeft className="h-5 w-5 text-[#e9edef]" />
              {displayChat.contactPhoto ? (
                <img
                  src={displayChat.contactPhoto}
                  alt={displayChat.contactName}
                  className="w-9 h-9 rounded-full object-cover"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center text-white text-sm font-medium">
                  {displayChat.contactName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[15px] font-semibold truncate">
                  {displayChat.contactName}
                </span>
                <span className="text-xs text-[#8696a0]">Online</span>
              </div>
              <Video className="h-5 w-5 text-[#00a884]" />
              <Phone className="h-5 w-5 text-[#00a884]" />
            </div>
          ) : (
            <div className="bg-[#1c1c1e]/95 backdrop-blur px-4 pt-3 pb-3 flex items-center justify-between border-b border-white/5">
              <div className="flex items-center gap-1 text-[#0A84FF]">
                <ChevronLeft className="h-6 w-6" />
                <span className="text-sm">23</span>
              </div>
              <div className="flex flex-col items-center">
                {displayChat.contactPhoto ? (
                  <img
                    src={displayChat.contactPhoto}
                    alt={displayChat.contactName}
                    className="w-9 h-9 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center text-white text-sm font-medium">
                    {displayChat.contactName.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-white text-[10px] mt-0.5">{displayChat.contactName}</span>
              </div>
              <Video className="h-5 w-5 text-[#0A84FF]" />
            </div>
          )}

          {/* Chat */}
          <div
            ref={chatScrollRef}
            className={`flex-1 p-4 overflow-y-auto scroll-smooth ${
              isWA ? "bg-[#0b141a]" : "bg-black"
            }`}
            style={{ scrollbarWidth: "none" }}
          >
            <AnimatePresence>
              {(playing ? visibleMessages : displayChat.messages).map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${isWA ? "mb-1.5" : "mb-1"} ${
                    m.side === "2" ? "justify-end" : "justify-start"
                  }`}
                >
                  {m.type === "text" ? (
                    isWA ? (
                      <div
                        className={`max-w-[80%] py-1.5 px-3 text-[#e9edef] text-[15px] leading-snug ${
                          m.side === "2"
                            ? "bg-[#005c4b] rounded-lg rounded-tr-none ml-auto"
                            : "bg-[#202c33] rounded-lg rounded-tl-none"
                        }`}
                      >
                        {m.text}
                      </div>
                    ) : (
                      <div
                        className={`max-w-[80%] px-3 py-2 text-white text-[15px] leading-snug ${
                          m.side === "2"
                            ? "bg-[#0A84FF] rounded-2xl rounded-br-sm"
                            : "bg-[#262628] rounded-2xl rounded-bl-sm"
                        }`}
                      >
                        {m.text}
                      </div>
                    )
                  ) : m.imageUrl ? (
                    isWA ? (
                      <div
                        className={`p-1 rounded-lg ${
                          m.side === "2" ? "bg-[#005c4b] ml-auto" : "bg-[#202c33]"
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
                      isWA ? "bg-[#202c33] text-[#8696a0]" : "bg-zinc-800 text-zinc-300"
                    }`}>
                      <ImageIcon className="h-8 w-8" />
                      <span className="text-center">{m.text}</span>
                    </div>
                  )}
                </motion.div>
              ))}
              {typingActive && (
                <motion.div
                  key="typing-indicator"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex mb-1 justify-end"
                >
                  <div
                    className={`px-3 py-2 flex items-center gap-1 ${
                      isWA
                        ? "bg-[#005c4b] rounded-lg rounded-tr-none"
                        : "bg-[#0A84FF] rounded-2xl rounded-br-sm"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 bg-white/80 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 bg-white/80 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 bg-white/80 rounded-full animate-bounce" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
