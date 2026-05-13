/**
 * Web Worker responsável por montar o vídeo final usando FFmpeg.wasm.
 * Roda em thread separada — não trava a UI em momento algum.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;

async function loadFFmpeg() {
  ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => {
    self.postMessage({ type: "progress", percent: Math.round(progress * 100) });
  });
  await ffmpeg.load({
    coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
    wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
  });
  self.postMessage({ type: "ready" });
}

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "init") {
    try { await loadFFmpeg(); }
    catch (err) { self.postMessage({ type: "error", message: String(err) }); }
    return;
  }

  if (!ffmpeg) {
    self.postMessage({ type: "error", message: "FFmpeg não foi inicializado." });
    return;
  }

  if (type === "frame") {
    const { png, index }: { png: Uint8Array; index: number } = e.data;
    await ffmpeg.writeFile(`frame_${String(index).padStart(6, "0")}.png`, png);
    return;
  }

  if (type === "audio") {
    const { mp3, index }: { mp3: Uint8Array; index: number } = e.data;
    await ffmpeg.writeFile(`audio_${index}.mp3`, mp3);
    return;
  }

  if (type === "render") {
    const { fps, totalFrames, audioSegments, projectName }: {
      fps: number;
      totalFrames: number;
      audioSegments: { index: number; startMs: number; durationMs: number }[];
      projectName: string;
    } = e.data;

    try {
      await ffmpeg.exec([
        "-framerate", String(fps),
        "-i", "frame_%06d.png",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-crf", "18",
        "video_silent.mp4",
      ]);

      if (audioSegments.length === 0) {
        const data = await ffmpeg.readFile("video_silent.mp4") as Uint8Array;
        self.postMessage({ type: "done", mp4: data }, [data.buffer]);
        return;
      }

      const inputArgs: string[] = ["-i", "video_silent.mp4"];
      const filterParts: string[] = [];
      const mixInputs: string[] = [];

      for (let i = 0; i < audioSegments.length; i++) {
        const seg = audioSegments[i];
        inputArgs.push("-i", `audio_${seg.index}.mp3`);
        filterParts.push(`[${i + 1}:a]adelay=${seg.startMs}|${seg.startMs}[a${i}]`);
        mixInputs.push(`[a${i}]`);
      }

      const filterComplex =
        filterParts.join(";") + ";" +
        mixInputs.join("") +
        `amix=inputs=${audioSegments.length}:normalize=0[aout]`;

      await ffmpeg.exec([
        ...inputArgs,
        "-filter_complex", filterComplex,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        "output.mp4",
      ]);

      const data = await ffmpeg.readFile("output.mp4") as Uint8Array;
      self.postMessage({ type: "done", mp4: data }, [data.buffer]);

      try {
        for (let i = 0; i < totalFrames; i++)
          await ffmpeg.deleteFile(`frame_${String(i).padStart(6, "0")}.png`);
        for (const seg of audioSegments)
          await ffmpeg.deleteFile(`audio_${seg.index}.mp3`);
        await ffmpeg.deleteFile("video_silent.mp4");
        await ffmpeg.deleteFile("output.mp4");
      } catch { /* cleanup não-fatal */ }

    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
};
