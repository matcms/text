import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const ffmpegPath = ffmpegInstaller.path;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Read temp_project.json path from command line arguments
const tempJsonPath = process.argv[2];
if (!tempJsonPath) {
  console.error("Erro: Caminho do arquivo JSON temporario nao especificado.");
  process.exit(1);
}

// 2. Read and parse the JSON file
let project;
try {
  const fileContent = fs.readFileSync(tempJsonPath, 'utf8');
  project = JSON.parse(fileContent);
} catch (e) {
  console.error("Erro ao ler temp_project.json:", e);
  process.exit(1);
}

const { origin, fps, duration, audioBase64, outputName, trimStart = 0, trimEnd } = project;
const finalTrimStart = Number(trimStart) || 0;
const finalTrimEnd = Number(trimEnd) || duration;
const finalDuration = Math.max(0.1, finalTrimEnd - finalTrimStart);

console.log("=========================================");
console.log("   TEXTSTORY - RENDERIZADOR LOCAL PC    ");
console.log("=========================================");
console.log(`Duração do Vídeo: ${finalDuration.toFixed(2)}s (Trim: ${finalTrimStart.toFixed(1)}s - ${finalTrimEnd.toFixed(1)}s)`);
console.log(`Taxa de Quadros (FPS): ${fps}`);
console.log(`Nome do Arquivo: ${outputName}.mp4`);
console.log(`Origin do App: ${origin}`);
console.log("=========================================");

// 3. Check audio WAV file if present
const tempAudioPath = project.audioPath;
let hasAudio = false;
if (tempAudioPath && fs.existsSync(tempAudioPath)) {
  hasAudio = true;
  console.log("Audio do projeto localizado com sucesso.");
}

// 4. Resolve output path (Downloads folder)
const userHome = process.env.USERPROFILE || process.env.HOME || __dirname;
const downloadsDir = path.join(userHome, 'Downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}
const finalOutputPath = path.join(downloadsDir, `${outputName || 'chat-story'}.mp4`);
console.log(`Destino do Vídeo: ${finalOutputPath}`);

async function run() {
  console.log("\nIniciando Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
  });

  try {
    const page = await browser.newPage();

    // Pipe browser page logs and errors to console
    page.on('console', msg => {
      const text = msg.text();
      console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${text}`);
    });
    page.on('pageerror', err => {
      console.error(`[Browser PageError] ${err.toString()}`);
    });
    page.on('requestfailed', request => {
      console.warn(`[Browser RequestFailed] ${request.url()} - ${request.failure()?.errorText || 'Unknown error'}`);
    });

    // Set viewport matching exactly 1080x1920 phone size
    await page.setViewport({ width: 1080, height: 1920 });

    console.log("Carregando pagina de renderizacao local...");
    await page.goto(`${origin}/render-local`, { waitUntil: 'networkidle2' });

    console.log("Injetando dados do projeto...");
    // Inject the project data and call window.initRenderLocal(project)
    await page.evaluate((data) => {
      window.projectData = data;
      if (typeof window.initRenderLocal === 'function') {
        window.initRenderLocal(data);
      }
    }, project);

    // Give a short delay to render first state
    await new Promise(r => setTimeout(r, 1500));

    console.log("Configurando FFmpeg...");
    const ffmpegArgs = [
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-r', String(fps),
      '-i', '-',
    ];

    if (hasAudio) {
      ffmpegArgs.push('-i', tempAudioPath);
    }

    ffmpegArgs.push(
      '-vcodec', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-b:v', '6M',
      '-y',
      finalOutputPath
    );

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('frame=') || output.includes('fps=')) {
        process.stdout.write(`\rFFmpeg: ${output.trim().slice(0, 75)}`);
      }
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`\nProcessamento do FFmpeg finalizado (Codigo: ${code}).`);
    });

    console.log("\nIniciando captura de quadros...");
    const totalFrames = Math.max(1, Math.round(finalDuration * fps));
    
    for (let f = 0; f < totalFrames; f++) {
      const timeSec = (f / fps) + finalTrimStart;
      
      // Update frame layout and seek videos in Puppeteer page
      await page.evaluate(async (t) => {
        if (typeof window.renderFrameLocal === 'function') {
          await window.renderFrameLocal(t);
        }
      }, timeSec);

      // Take screenshot of the phone container
      const screenshot = await page.screenshot({
        type: 'jpeg',
        quality: 95,
        clip: { x: 0, y: 0, width: 1080, height: 1920 }
      });

      // Write frame to FFmpeg stdin
      ffmpegProcess.stdin.write(screenshot);

      const percent = ((f / totalFrames) * 100).toFixed(1);
      process.stdout.write(`\rGravando: ${f}/${totalFrames} quadros (${percent}%)`);
    }

    console.log("\nFinalizando arquivo de video...");
    ffmpegProcess.stdin.end();

    // Wait for FFmpeg to finish encoding
    await new Promise((resolve) => {
      ffmpegProcess.on('close', resolve);
    });

    console.log("\n=========================================");
    console.log("   EXPORTAÇÃO CONCLUÍDA COM SUCESSO!     ");
    console.log("=========================================");
    console.log(`Video salvo em: ${finalOutputPath}`);
    console.log("=========================================");

  } catch (err) {
    console.error("\nOcorreu um erro durante a exportação:", err);
  } finally {
    await browser.close();

    // Clean up temporary files
    try {
      if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath);
      if (tempAudioPath) {
        const tempFolder = path.dirname(tempAudioPath);
        if (fs.existsSync(tempFolder)) {
          fs.rmSync(tempFolder, { recursive: true, force: true });
          console.log("Arquivos temporarios de midia limpos com sucesso.");
        }
      }
    } catch (e) {
      console.warn("Nao foi possivel apagar arquivos temporarios:", e);
    }

    // Auto shutdown: exit command prompt after 3 seconds
    console.log("\nFechando janela em 3 segundos...");
    setTimeout(() => {
      process.exit(0);
    }, 3000);
  }
}

run();
