import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  Video,
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
  character: string;
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
  script: string;
  messages: Msg[];
};

type Provider = "elevenlabs" | "minimax" | "google";

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
  script: DEFAULT_SCRIPT,
  messages: [],
});

// Convert minimax hex string to a Blob URL
const hexToBlobUrl = (hex: string, mime = "audio/mpeg") => {
  const clean = hex.replace(/\s+/g, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
};

// Wrap raw PCM (signed 16-bit LE) into a WAV blob URL
const pcmToWavUrl = (b64: string, sampleRate = 24000, channels = 1) => {
  const bin = atob(b64);
  const pcm = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  const byteRate = sampleRate * channels * 2;
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
};

export default function ChatStoryGenerator() {
  const [elevenKey, setElevenKey] = useState("");
  const [minimaxKey, setMinimaxKey] = useState("");
  const [minimaxGroupId, setMinimaxGroupId] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [provider, setProvider] = useState<Provider>("elevenlabs");
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  // typing indicator duration before each side-2 message (seconds)
  const [typingSec, setTypingSec] = useState(0.9);
  const [typingActive, setTypingActive] = useState(false);

  const [chats, setChats] = useState<Chat[]>([newChat(1)]);
  const [activeChatId, setActiveChatId] = useState<string>(chats[0].id);
  const activeChat = chats.find((c) => c.id === activeChatId)!;

  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [visibleMessages, setVisibleMessages] = useState<Msg[]>([]);
  const [playing, setPlaying] = useState(false);
  const [playingChatId, setPlayingChatId] = useState<string | null>(null);

  // pause between messages, in SECONDS (e.g. 0.1, 0.3, 1)
  const [messagePauseSec, setMessagePauseSec] = useState(0.3);

  // manual mapping: character name (lowercased) -> voice ID
  const [voiceMap, setVoiceMap] = useState<Record<string, string>>({});

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Persist keys
  useEffect(() => {
    setElevenKey(localStorage.getItem("elevenlabs_api_key") || "");
    setMinimaxKey(localStorage.getItem("minimax_api_key") || "");
    setMinimaxGroupId(localStorage.getItem("minimax_group_id") || "");
  }, []);
  useEffect(() => {
    localStorage.setItem("elevenlabs_api_key", elevenKey);
  }, [elevenKey]);
  useEffect(() => {
    localStorage.setItem("minimax_api_key", minimaxKey);
  }, [minimaxKey]);
  useEffect(() => {
    localStorage.setItem("minimax_group_id", minimaxGroupId);
  }, [minimaxGroupId]);

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
      if (line.startsWith("- iMessage:")) {
        header = line.replace("- iMessage:", "").trim();
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
          character: textMatch[2].trim(),
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

  // Unique character names across all chats
  const uniqueCharacters = useMemo(() => {
    const set = new Set<string>();
    for (const c of chats) {
      for (const m of c.messages) {
        if (m.type === "text" && m.character) set.add(m.character.trim());
      }
    }
    return Array.from(set);
  }, [chats]);

  const setVoiceFor = (name: string, id: string) => {
    setVoiceMap((p) => ({ ...p, [name.toLowerCase().trim()]: id.trim() }));
  };

  // ---- TTS providers ----
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

  const ttsMinimax = async (text: string, voiceId: string): Promise<string> => {
    const url = minimaxGroupId
      ? `https://api.minimax.io/v1/t2a_v2?GroupId=${encodeURIComponent(minimaxGroupId)}`
      : `https://api.minimax.io/v1/t2a_v2`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${minimaxKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "speech-02-hd",
        text,
        stream: false,
        voice_setting: {
          voice_id: voiceId,
          speed: Math.min(2, Math.max(0.5, voiceSpeed)),
          vol: 1,
          pitch: 0,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    const hex = json?.data?.audio;
    if (!hex) throw new Error("Minimax: missing audio in response");
    return hexToBlobUrl(hex);
  };

  const generateAudios = async () => {
    if (provider === "elevenlabs" && !elevenKey) {
      alert("Por favor, insira sua API key do ElevenLabs");
      return;
    }
    if (provider === "minimax" && !minimaxKey) {
      alert("Por favor, insira sua API key do Minimax");
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
    // build a working snapshot per chat
    const chatMessagesMap: Record<string, Msg[]> = {};
    chats.forEach((c) => (chatMessagesMap[c.id] = [...c.messages]));

    for (const { chatId, msg } of allTexts) {
      try {
        const voiceId = voiceMap[msg.character.toLowerCase().trim()] || "";
        if (!voiceId) {
          throw new Error(
            `Sem voice ID para o personagem "${msg.character}". Preencha o ID na seção "Voice Mapping".`
          );
        }

        const audioUrl =
          provider === "elevenlabs"
            ? await ttsElevenLabs(msg.text, voiceId)
            : await ttsMinimax(msg.text, voiceId);

        const arr = chatMessagesMap[chatId];
        const idx = arr.findIndex((m) => m.id === msg.id && m.type === "text");
        if (idx >= 0) arr[idx] = { ...(arr[idx] as TextMsg), audioUrl };
        updateChatById(chatId, { messages: [...arr] });
      } catch (e) {
        console.error(e);
        alert(`Falha ao gerar áudio para: ${msg.text}\n${(e as Error).message}`);
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
      // switch the displayed chat (header switches too)
      setPlayingChatId(chat.id);
      setActiveChatId(chat.id);
      setVisibleMessages([]);
      // pause between chat transitions respects user setting
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
        // single, literal pause between messages — no hidden minimums
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

  // The chat to display in the right column
  const displayChat = playingChatId
    ? chats.find((c) => c.id === playingChatId) || activeChat
    : activeChat;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* LEFT */}
      <div className="w-full lg:w-1/2 overflow-y-auto bg-background p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chat Story Generator</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cole um script, gere as vozes via API e reproduza um vídeo iMessage sincronizado.
          </p>
        </div>

        {/* API keys + provider */}
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-2">
            <Label>ElevenLabs API Key</Label>
            <Input
              type="password"
              value={elevenKey}
              onChange={(e) => setElevenKey(e.target.value)}
              placeholder="sk_..."
            />
            <p className="text-xs text-muted-foreground">
              Informe um Voice ID por personagem na seção "Voice Mapping".
            </p>
          </div>
          <div className="space-y-2">
            <Label>Minimax API Key</Label>
            <Input
              type="password"
              value={minimaxKey}
              onChange={(e) => setMinimaxKey(e.target.value)}
              placeholder="eyJh..."
            />
          </div>
          <div className="space-y-2">
            <Label>Minimax Group ID (opcional)</Label>
            <Input
              value={minimaxGroupId}
              onChange={(e) => setMinimaxGroupId(e.target.value)}
              placeholder="1234567890"
            />
          </div>
          <div className="space-y-2">
            <Label>TTS Provider</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={provider === "elevenlabs" ? "default" : "outline"}
                onClick={() => setProvider("elevenlabs")}
              >
                ElevenLabs
              </Button>
              <Button
                size="sm"
                variant={provider === "minimax" ? "default" : "outline"}
                onClick={() => setProvider("minimax")}
              >
                Minimax
              </Button>
            </div>
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
            <p className="text-xs text-muted-foreground">
              ElevenLabs aceita 0.7–1.2; Minimax 0.5–2.0.
            </p>
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
            Cole uma imagem (Ctrl/Cmd+V), uma URL, ou envie um arquivo. Sem foto, mostramos a inicial.
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
        </div>

        <Button onClick={parseScript} className="w-full">
          Parse Script
        </Button>

        {/* Pause control (in seconds) */}
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <Label>Pausa entre mensagens (segundos)</Label>
            <span className="text-xs text-muted-foreground">
              {messagePauseSec.toFixed(2)}s
            </span>
          </div>
          <Input
            type="number"
            step={0.05}
            min={0}
            value={messagePauseSec}
            onChange={(e) => setMessagePauseSec(Math.max(0, Number(e.target.value) || 0))}
            placeholder="0.3"
          />
          <p className="text-xs text-muted-foreground">
            Tempo de espera entre uma mensagem e a próxima. Ex.: <code>0.1</code> deixa o vídeo
            mais rápido.
          </p>
          <div className="flex gap-2 pt-1 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(0)}>
              0s
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(0.1)}>
              0.1s
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(0.3)}>
              0.3s
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(0.6)}>
              0.6s
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMessagePauseSec(1)}>
              1s
            </Button>
          </div>
        </div>

        {/* Voice mapping — manual voice IDs per character */}
        {uniqueCharacters.length > 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">Voice Mapping</h2>
            <p className="text-xs text-muted-foreground">
              Cole o Voice ID ({provider === "elevenlabs" ? "ElevenLabs" : "Minimax"}) para cada
              personagem encontrado nos scripts.
            </p>
            {uniqueCharacters.map((name) => (
              <div key={name} className="grid grid-cols-3 gap-2 items-center">
                <Label className="col-span-1 truncate">{name}</Label>
                <Input
                  className="col-span-2"
                  placeholder="Voice ID"
                  value={voiceMap[name.toLowerCase().trim()] || ""}
                  onChange={(e) => setVoiceFor(name, e.target.value)}
                />
              </div>
            ))}
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
            <p className="text-xs text-muted-foreground">
              Cole uma imagem (Ctrl/Cmd+V) dentro do campo, ou cole uma URL, ou envie um arquivo.
            </p>
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
                    onClick={() =>
                      fileInputRefs.current[`${activeChatId}_${m.id}`]?.click()
                    }
                  >
                    <Upload className="mr-2 h-3 w-3" /> Upload
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const items = await navigator.clipboard.read();
                        for (const it of items) {
                          const imgType = it.types.find((t) => t.startsWith("image/"));
                          if (imgType) {
                            const blob = await it.getType(imgType);
                            const file = new File([blob], "pasted.png", { type: imgType });
                            onUploadImage(m.id, file);
                            return;
                          }
                        }
                        const text = await navigator.clipboard.readText();
                        if (text && /^https?:\/\//i.test(text.trim())) {
                          setImageUrlFor(m.id, text.trim());
                        }
                      } catch {
                        alert("Não foi possível ler o clipboard. Use Ctrl/Cmd+V dentro do campo.");
                      }
                    }}
                  >
                    <ClipboardPaste className="mr-2 h-3 w-3" /> Colar
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
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-purple-600 p-6 min-h-screen">
        <div
          className="relative bg-black rounded-[3rem] overflow-hidden shadow-2xl border-[10px] border-black flex flex-col"
          style={{ width: 400, height: 711 }}
        >
          {/* Header */}
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

          {/* Chat */}
          <div
            ref={chatScrollRef}
            className="flex-1 bg-black p-4 overflow-y-auto scroll-smooth"
            style={{ scrollbarWidth: "none" }}
          >
            <AnimatePresence>
              {(playing ? visibleMessages : displayChat.messages).map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex mb-1 ${m.side === "2" ? "justify-end" : "justify-start"}`}
                >
                  {m.type === "text" ? (
                    <div
                      className={`max-w-[80%] px-3 py-2 text-white text-[15px] leading-snug ${
                        m.side === "2"
                          ? "bg-[#0A84FF] rounded-2xl rounded-br-sm"
                          : "bg-[#262628] rounded-2xl rounded-bl-sm"
                      }`}
                    >
                      {m.text}
                    </div>
                  ) : m.imageUrl ? (
                    <img
                      src={m.imageUrl}
                      alt={m.text}
                      className="max-w-[70%] max-h-56 object-cover rounded-2xl"
                    />
                  ) : (
                    <div className="h-32 w-48 bg-zinc-800 rounded-2xl flex flex-col items-center justify-center text-zinc-300 text-xs gap-2 p-2">
                      <ImageIcon className="h-8 w-8" />
                      <span className="text-center">{m.text}</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
