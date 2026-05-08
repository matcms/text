import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Video, Image as ImageIcon, Loader2, Play, Upload, Link2, ClipboardPaste } from "lucide-react";
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

export default function ChatStoryGenerator() {
  const [apiKey, setApiKey] = useState("");
  const [script, setScript] = useState(
    `- iMessage: Nate
1: Adam> Dude, we're seriously screwed.
1: Adam> Cancel the Christmas turkey.
1: img: police cruiser on the street
2: Chris> "Us" who, man?`
  );
  const [contactName, setContactName] = useState("Nate");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [voices, setVoices] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
  const [visibleMessages, setVisibleMessages] = useState<Msg[]>([]);
  const [playing, setPlaying] = useState(false);
  // delay offset in ms: negative = faster, positive = slower. Applied to both audio + image pauses.
  const [delayOffset, setDelayOffset] = useState(0);
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const k = localStorage.getItem("elevenlabs_api_key");
    if (k) setApiKey(k);
  }, []);

  useEffect(() => {
    if (apiKey) localStorage.setItem("elevenlabs_api_key", apiKey);
  }, [apiKey]);

  const characters = useMemo(() => {
    const set = new Set<string>();
    messages.forEach((m) => m.type === "text" && set.add(m.character));
    return Array.from(set);
  }, [messages]);

  const imageMessages = useMemo(
    () => messages.filter((m): m is ImgMsg => m.type === "image"),
    [messages]
  );

  const allAudiosReady = useMemo(() => {
    const texts = messages.filter((m) => m.type === "text") as TextMsg[];
    return texts.length > 0 && texts.every((m) => !!m.audioUrl);
  }, [messages]);

  const parseScript = () => {
    const lines = script.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed: Msg[] = [];
    let id = 0;
    let header = contactName;
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
    setContactName(header);
    setMessages(parsed);
    setVisibleMessages([]);
  };

  const setImageUrlFor = (id: number, url: string | null) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id && m.type === "image" ? { ...m, imageUrl: url } : m))
    );
  };

  const onUploadImage = (id: number, file: File) => {
    const url = URL.createObjectURL(file);
    setImageUrlFor(id, url);
  };

  const generateAudios = async () => {
    if (!apiKey) {
      alert("Please enter your ElevenLabs API key");
      return;
    }
    const texts = messages.filter((m) => m.type === "text") as TextMsg[];
    const missing = texts.find((m) => !voices[m.character]);
    if (missing) {
      alert(`Please set a voice ID for ${missing.character}`);
      return;
    }
    setGenerating(true);
    setGenProgress({ done: 0, total: texts.length });
    const updated = [...messages];
    let done = 0;
    for (let i = 0; i < updated.length; i++) {
      const m = updated[i];
      if (m.type !== "text") continue;
      try {
        const voiceId = voices[m.character];
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: m.text, model_id: "eleven_multilingual_v2" }),
          }
        );
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        updated[i] = { ...m, audioUrl: URL.createObjectURL(blob) };
      } catch (e) {
        console.error(e);
        alert(`Failed to generate audio for: ${m.text}`);
        setGenerating(false);
        return;
      }
      done++;
      setGenProgress({ done, total: texts.length });
      setMessages([...updated]);
    }
    setGenerating(false);
  };

  const playAnimation = async () => {
    setPlaying(true);
    setVisibleMessages([]);
    const queue: Msg[] = [];
    // base pauses; offset shifts ALL pauses (including between messages)
    const basePauseAfterAudio = 300;
    const baseImagePause = 1200;
    const baseBetweenMessages = 250;
    const pauseAfterAudio = Math.max(0, basePauseAfterAudio + delayOffset);
    const imagePause = Math.max(0, baseImagePause + delayOffset);
    const betweenMessages = Math.max(0, baseBetweenMessages + delayOffset);

    const scrollDown = () => {
      const el = chatScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    };

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      queue.push(msg);
      setVisibleMessages([...queue]);
      // wait a frame so DOM updates, then auto-scroll to bottom
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      scrollDown();
      if (msg.type === "text" && msg.audioUrl) {
        const audio = new Audio(msg.audioUrl);
        audio.play();
        await new Promise((r) => (audio.onended = () => r(null)));
        if (pauseAfterAudio > 0) await new Promise((r) => setTimeout(r, pauseAfterAudio));
      } else {
        await new Promise((r) => setTimeout(r, imagePause));
      }
      if (i < messages.length - 1 && betweenMessages > 0) {
        await new Promise((r) => setTimeout(r, betweenMessages));
      }
    }
    setPlaying(false);
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* LEFT */}
      <div className="w-full lg:w-1/2 overflow-y-auto bg-background p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Chat Story Generator</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Parse a script, generate ElevenLabs voices, and play a synced iMessage video.
          </p>
        </div>

        <div className="space-y-2">
          <Label>ElevenLabs API Key</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk_..."
          />
        </div>

        <div className="space-y-2">
          <Label>Script</Label>
          <Textarea
            className="min-h-[300px] font-mono text-sm"
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </div>

        <Button onClick={parseScript} className="w-full">
          Parse Script
        </Button>

        {/* Delay control */}
        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <Label>Message delay offset (ms)</Label>
            <span className="text-xs text-muted-foreground">
              {delayOffset > 0 ? `+${delayOffset}` : delayOffset} ms
            </span>
          </div>
          <Input
            type="number"
            step={50}
            value={delayOffset}
            onChange={(e) => setDelayOffset(Number(e.target.value) || 0)}
            placeholder="0"
          />
          <p className="text-xs text-muted-foreground">
            Negative values speed messages up, positive values slow them down. Applied to the
            pause after each message (clamped at 0).
          </p>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setDelayOffset((d) => d - 100)}>
              -100ms
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDelayOffset(0)}>
              Reset
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDelayOffset((d) => d + 100)}>
              +100ms
            </Button>
          </div>
        </div>

        {characters.length > 0 && (
          <div className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">Voice Mapping</h2>
            {characters.map((c) => (
              <div key={c} className="grid grid-cols-3 items-center gap-2">
                <Label className="col-span-1">{c}</Label>
                <Input
                  className="col-span-2"
                  placeholder="ElevenLabs Voice ID"
                  value={voices[c] || ""}
                  onChange={(e) => setVoices((v) => ({ ...v, [c]: e.target.value }))}
                />
              </div>
            ))}
            <Button
              onClick={generateAudios}
              disabled={generating}
              className="w-full"
              variant="secondary"
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating {genProgress.done}/{genProgress.total}
                </>
              ) : (
                "Generate Audios"
              )}
            </Button>
          </div>
        )}

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
                      fileInputRefs.current[m.id] = el;
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
                    onClick={() => fileInputRefs.current[m.id]?.click()}
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
                      } catch (err) {
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
          Play Animation
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
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center text-white text-sm font-medium">
                {contactName.charAt(0).toUpperCase()}
              </div>
              <span className="text-white text-[10px] mt-0.5">{contactName}</span>
            </div>
            <Video className="h-5 w-5 text-[#0A84FF]" />
          </div>

          {/* Chat */}
          <div
            ref={chatScrollRef}
            className="flex-1 bg-black p-4 overflow-y-auto scroll-smooth"
            style={{ scrollbarWidth: "none" }}
          >
            <style>{`.chat-scroll::-webkit-scrollbar{display:none}`}</style>
            <AnimatePresence>
              {(playing ? visibleMessages : messages).map((m) => (
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
