import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let isLoaded = false;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && isLoaded) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
      wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
    });
    ffmpegInstance = ffmpeg;
    isLoaded = true;
    return ffmpeg;
  })();

  return loadPromise;
}

export interface MessageEdit {
  delay?: number; // ms offset (-500 a 2000)
  speed?: number; // 0.5 a 2.0
  volume?: number; // 0 a 1.5
  trimStart?: number; // seconds
  trimEnd?: number; // seconds
  sfx?: {
    sfxId: string;
    volume: number;
    delay: number; // relative delay in ms
    loop: boolean;
  } | null;
}

/**
 * Decodes a Blob/URL to get its duration in seconds.
 */
export async function getAudioDuration(urlOrBlob: string | Blob): Promise<number> {
  const url = typeof urlOrBlob === "string" ? urlOrBlob : URL.createObjectURL(urlOrBlob);
  try {
    const audio = new Audio(url);
    return new Promise<number>((resolve) => {
      audio.addEventListener("loadedmetadata", () => {
        resolve(audio.duration);
        if (typeof urlOrBlob !== "string") URL.revokeObjectURL(url);
      });
      audio.addEventListener("error", () => {
        resolve(0);
        if (typeof urlOrBlob !== "string") URL.revokeObjectURL(url);
      });
      // Fallback
      setTimeout(() => {
        resolve(0);
        if (typeof urlOrBlob !== "string") URL.revokeObjectURL(url);
      }, 2000);
    });
  } catch {
    return 0;
  }
}

/**
 * Synthesizes a quiet beep as a fallback for missing native sounds
 */
function createFallbackBeepBlob(): Blob {
  const sampleRate = 44100;
  const duration = 0.5;
  const numSamples = sampleRate * duration;
  const buffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    buffer[i] = Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 0.1;
  }
  
  // Convert to WAV
  const wavBuffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(wavBuffer);
  
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  
  let offset = 44;
  for (let i = 0; i < numSamples; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Main audio processing function using FFmpeg WASM.
 */
export async function processAudio(
  originalAudioUrl: string,
  edit: MessageEdit,
  getSfxBlob: (sfxId: string) => Promise<Blob | null>
): Promise<{ audioUrl: string; duration: number }> {
  const ffmpeg = await getFFmpeg();

  // 1. Fetch original file and write to memory
  const mainData = await fetch(originalAudioUrl).then((r) => r.blob());
  await ffmpeg.writeFile("input.mp3", await fetchFile(mainData));

  let filterParts: string[] = [];
  let inputs = ["-i", "input.mp3"];
  let inputCount = 1;

  // Build audio filters for the main input [0:a]
  // Order of filters: trim -> speed -> volume
  let mainChain = "[0:a]";

  // 2. Trim (Corte)
  // We can do trim using the filter graph: atrim=start=X:end=Y, asetpts=PTS-STARTPTS
  const hasTrim = edit.trimStart !== undefined || edit.trimEnd !== undefined;
  if (hasTrim) {
    const start = edit.trimStart || 0;
    const atrimFilter = edit.trimEnd !== undefined 
      ? `atrim=start=${start}:end=${edit.trimEnd}` 
      : `atrim=start=${start}`;
    mainChain += `,${atrimFilter},asetpts=PTS-STARTPTS`;
  }

  // 3. Speed (Velocidade)
  if (edit.speed && edit.speed !== 1.0) {
    // atempo works from 0.5 to 2.0
    mainChain += `,atempo=${edit.speed}`;
  }

  // 4. Volume
  if (edit.volume !== undefined && edit.volume !== 1.0) {
    mainChain += `,volume=${edit.volume}`;
  }

  mainChain += "[main_processed]";
  filterParts.push(mainChain);

  // 5. SFX mixing
  let mixInputs = ["[main_processed]"];
  if (edit.sfx) {
    let sfxBlob = await getSfxBlob(edit.sfx.sfxId);
    
    // Fallback if sfx not found
    if (!sfxBlob) {
      // Check if it's a native sound
      const nativePaths: Record<string, string> = {
        notification: "/sfx/notification.mp3",
        typing: "/sfx/typing.mp3",
        swoosh: "/sfx/swoosh.mp3",
        laugh: "/sfx/laugh.mp3"
      };
      const path = nativePaths[edit.sfx.sfxId];
      if (path) {
        try {
          const res = await fetch(path);
          if (res.ok) sfxBlob = await res.blob();
        } catch {
          // fetch failed
        }
      }
    }
    
    // If still no sfx, use a short beep so process doesn't fail
    if (!sfxBlob) {
      sfxBlob = createFallbackBeepBlob();
    }

    await ffmpeg.writeFile("sfx.mp3", await fetchFile(sfxBlob));
    inputs.push("-i", "sfx.mp3");
    inputCount++;

    let sfxChain = "[1:a]";
    
    // SFX loop filter
    if (edit.sfx.loop) {
      sfxChain += ",aloop=loop=-1:size=2e9";
    }

    // SFX Volume filter
    if (edit.sfx.volume !== 1.0) {
      sfxChain += `,volume=${edit.sfx.volume}`;
    }

    // Delay handling (negative vs positive)
    const sfxDelay = edit.sfx.delay || 0;
    if (sfxDelay > 0) {
      // Delay SFX
      sfxChain += `,adelay=${sfxDelay}|${sfxDelay}`;
      sfxChain += "[sfx_processed]";
      filterParts.push(sfxChain);
      mixInputs.push("[sfx_processed]");
    } else if (sfxDelay < 0) {
      // Delay Main audio instead!
      // To do this, we modify the main_processed output and delay it
      const delayVal = Math.abs(sfxDelay);
      filterParts[0] = filterParts[0].replace("[main_processed]", "[main_temp]");
      filterParts.push(`[main_temp]adelay=${delayVal}|${delayVal}[main_processed]`);

      sfxChain += "[sfx_processed]";
      filterParts.push(sfxChain);
      mixInputs.push("[sfx_processed]");
    } else {
      sfxChain += "[sfx_processed]";
      filterParts.push(sfxChain);
      mixInputs.push("[sfx_processed]");
    }
  }

  // Combine mix inputs using amix
  if (mixInputs.length > 1) {
    filterParts.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:normalize=0[aout]`);
  } else {
    filterParts.push(`[main_processed]anull[aout]`);
  }

  const filterComplex = filterParts.join(";");

  // Run FFmpeg
  await ffmpeg.exec([
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[aout]",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    "output.mp3"
  ]);

  // Read output
  const data = await ffmpeg.readFile("output.mp3") as Uint8Array;
  const processedBlob = new Blob([data.buffer], { type: "audio/mp3" });
  
  // Cleanup virtual files
  try {
    await ffmpeg.deleteFile("input.mp3");
    if (edit.sfx) await ffmpeg.deleteFile("sfx.mp3");
    await ffmpeg.deleteFile("output.mp3");
  } catch { /* ignored */ }

  const processedUrl = URL.createObjectURL(processedBlob);
  const duration = await getAudioDuration(processedBlob);

  return {
    audioUrl: processedUrl,
    duration
  };
}
