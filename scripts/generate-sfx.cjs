/**
 * Generates 4 native SFX WAV files into public/sfx/
 * Uses raw WAV synthesis — no dependencies needed.
 */
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "public", "sfx");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SAMPLE_RATE = 44100;

function floatToInt16(val) {
  const clamped = Math.max(-1, Math.min(1, val));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function buildWav(samples) {
  const numSamples = samples.length;
  const buf = Buffer.alloc(44 + numSamples * 2);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + numSamples * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);       // chunk size
  buf.writeUInt16LE(1, 20);        // PCM
  buf.writeUInt16LE(1, 22);        // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);        // block align
  buf.writeUInt16LE(16, 34);       // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(floatToInt16(samples[i]), 44 + i * 2);
  }
  return buf;
}

function envelope(i, total, attack = 0.02, release = 0.1) {
  const t = i / total;
  if (t < attack) return t / attack;
  if (t > 1 - release) return (1 - t) / release;
  return 1;
}

// 1. notification.mp3 (saved as .mp3 extension but WAV content — browsers handle it)
// Two ascending pings: 880Hz then 1108Hz, ~0.8s
(function generateNotification() {
  const dur = 0.8;
  const n = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const freq = t < 0.35 ? 880 : 1108;
    const pingPhase = t < 0.35 ? t : t - 0.4;
    const env = pingPhase < 0.01 ? pingPhase / 0.01 : Math.exp(-pingPhase * 8);
    samples[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.6;
  }
  fs.writeFileSync(path.join(OUT_DIR, "notification.mp3"), buildWav(samples));
  console.log("✓ notification.mp3");
})();

// 2. typing.mp3 — rapid click bursts, ~1.5s
(function generateTyping() {
  const dur = 1.5;
  const n = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(n);
  // A click every ~80ms
  const clickInterval = 0.08;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const phase = t % clickInterval;
    if (phase < 0.012) {
      const freq = 1200 + 400 * Math.random();
      const env = phase < 0.003 ? phase / 0.003 : Math.exp(-(phase - 0.003) * 150);
      samples[i] = (Math.random() * 2 - 1) * env * 0.35 + Math.sin(2 * Math.PI * freq * t) * env * 0.15;
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, "typing.mp3"), buildWav(samples));
  console.log("✓ typing.mp3");
})();

// 3. swoosh.mp3 — noise sweep falling in pitch, ~0.5s
(function generateSwoosh() {
  const dur = 0.5;
  const n = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const env = envelope(i, n, 0.01, 0.3);
    // Frequency sweeping down
    const freq = 1600 * Math.exp(-t * 4);
    samples[i] = (Math.random() * 2 - 1) * env * 0.3 + Math.sin(2 * Math.PI * freq * t) * env * 0.2;
  }
  fs.writeFileSync(path.join(OUT_DIR, "swoosh.mp3"), buildWav(samples));
  console.log("✓ swoosh.mp3");
})();

// 4. laugh.mp3 — rhythmic "ha ha ha" pulse, ~1.2s
(function generateLaugh() {
  const dur = 1.2;
  const n = Math.floor(SAMPLE_RATE * dur);
  const samples = new Float32Array(n);
  // Three "ha" bursts at 0.0, 0.35, 0.7s
  const haTimes = [0, 0.35, 0.7];
  const haLen = 0.22;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let val = 0;
    for (const start of haTimes) {
      if (t >= start && t < start + haLen) {
        const p = t - start;
        const env = p < 0.02 ? p / 0.02 : Math.exp(-(p - 0.02) * 12);
        // Harmonics for voice-like tone
        val += (Math.sin(2 * Math.PI * 260 * t) * 0.5 + Math.sin(2 * Math.PI * 520 * t) * 0.3 + Math.sin(2 * Math.PI * 780 * t) * 0.2) * env * 0.5;
      }
    }
    samples[i] = val;
  }
  fs.writeFileSync(path.join(OUT_DIR, "laugh.mp3"), buildWav(samples));
  console.log("✓ laugh.mp3");
})();

console.log("\nAll SFX files written to public/sfx/");
