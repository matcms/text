import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Video, Image as ImageIcon, Loader2, Play } from "lucide-react";
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
        parsed.push({ id: id++, side: imgMatch[1], type: "image", text: imgMatch[2] });
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
    for (const msg of messages) {
      queue.push(msg);
      setVisibleMessages([...queue]);
      if (msg.type === "text" && msg.audioUrl) {
        const audio = new Audio(msg.audioUrl);
        audio.play();
        await new Promise((r) => (audio.onended = () => r(null)));
        await new Promise((r) => setTimeout(r, 300));
      } else {
        await new Promise((r) => setTimeout(r, 1200));
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
            className="flex-1 bg-black p-4 overflow-y-auto"
            style={{ scrollbarWidth: "none" }}
          >
            <style>{`.chat-scroll::-webkit-scrollbar{display:none}`}</style>
            <AnimatePresence>
              {visibleMessages.map((m) => (
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
