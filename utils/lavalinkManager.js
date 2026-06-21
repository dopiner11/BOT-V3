import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LAVALINK_DIR = join(ROOT, 'lavalink');
const PLUGINS_DIR = join(LAVALINK_DIR, 'plugins');
const JAR_PATH = join(LAVALINK_DIR, 'Lavalink.jar');

const LAVALINK_PORT = 2333;
const LAVALINK_PASSWORD = 'youshallnotpass';
const BASE = `http://127.0.0.1:${LAVALINK_PORT}`;
const HEADERS = { Authorization: LAVALINK_PASSWORD, 'Content-Type': 'application/json' };

let lavalinkProcess = null;
let ready = false;
let readyResolve = null;
const readyPromise = new Promise((resolve) => { readyResolve = resolve; });

let startAttempts = 0;
const MAX_START_ATTEMPTS = 3;

// ─── Process Management ──────────────────────────────────────────

async function downloadJar() {
  console.log('[Lavalink] Downloading Lavalink.jar ...');
  const url = 'https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to download Lavalink.jar: HTTP ' + res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(JAR_PATH, buffer);
  console.log('[Lavalink] Lavalink.jar downloaded (' + (buffer.length / 1024 / 1024).toFixed(1) + ' MB)');
}

async function ensureJar() {
  if (existsSync(JAR_PATH)) return;
  await downloadJar();
}

async function checkJava() {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    await promisify(execFile)('java', ['-version'], { timeout: 10000 });
  } catch {
    console.warn('[Lavalink] Java not found - Lavalink unavailable. YouTube audio will use fallback methods.');
    cleanup();
    throw new Error('Java not found');
  }
}

async function start() {
  if (lavalinkProcess) return;
  startAttempts++;

  try {
    await checkJava();
    if (!existsSync(PLUGINS_DIR)) mkdirSync(PLUGINS_DIR, { recursive: true });
    await ensureJar();

    console.log('[Lavalink] Starting Lavalink server ...');
    lavalinkProcess = spawn('java', [
      '-jar', JAR_PATH,
      '--spring.config.location=' + join(LAVALINK_DIR, 'application.yml'),
    ], {
      cwd: LAVALINK_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    lavalinkProcess.stdout.on('data', (data) => {
      const line = data.toString();
      if (line.includes('Started Launcher') || line.includes('Lavalink is ready')) {
        ready = true;
        if (readyResolve) { readyResolve(); readyResolve = null; }
        console.log('[Lavalink] Ready!');
      }
    });

    lavalinkProcess.stderr.on('data', (data) => {
      const line = data.toString();
      if (line.includes('Started Launcher') || line.includes('Lavalink is ready')) {
        ready = true;
        if (readyResolve) { readyResolve(); readyResolve = null; }
        console.log('[Lavalink] Ready!');
      }
    });

    lavalinkProcess.on('error', (err) => {
      console.error('[Lavalink] Process error:', err.message);
      cleanup();
    });

    lavalinkProcess.on('exit', (code, signal) => {
      console.warn('[Lavalink] Exited with code=' + code + ' signal=' + signal);
      cleanup();
      if (startAttempts < MAX_START_ATTEMPTS) {
        console.log('[Lavalink] Restarting (attempt ' + (startAttempts + 1) + '/' + MAX_START_ATTEMPTS + ') ...');
        setTimeout(() => start(), 2000);
      }
    });

    // Wait for ready (timeout 30s)
    await Promise.race([
      readyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Lavalink startup timeout')), 30000)),
    ]);

    startAttempts = 0;
  } catch (err) {
    console.error('[Lavalink] Failed to start:', err.message);
    cleanup();
    throw err;
  }
}

function cleanup() {
  ready = false;
  readyPromise = new Promise((resolve) => { readyResolve = resolve; });
}

function stop() {
  if (lavalinkProcess) {
    lavalinkProcess.kill('SIGTERM');
    lavalinkProcess = null;
  }
  ready = false;
}

function isReady() { return ready; }
function waitForReady() { return readyPromise; }

// ─── REST API ─────────────────────────────────────────────────────

async function loadTrack(videoUrl) {
  if (!ready) await waitForReady();
  const res = await fetch(BASE + '/v4/loadtracks?identifier=' + encodeURIComponent(videoUrl), {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('Lavalink loadtracks HTTP ' + res.status);
  const data = await res.json();
  if (!data.data || data.data.length === 0) throw new Error('No tracks loaded from Lavalink');
  return data.data[0];
}

async function downloadTrack(videoId) {
  if (!ready) await waitForReady();
  // Try the youtube plugin download endpoint
  const res = await fetch(BASE + '/youtube/download/' + videoId, {
    headers: HEADERS,
    signal: AbortSignal.timeout(30000),
  });
  if (res.ok && res.body) {
    return Readable.fromWeb(res.body);
  }
  throw new Error('Lavalink download HTTP ' + res.status);
}

async function getAudioStream(videoId) {
  try {
    const track = await loadTrack('https://www.youtube.com/watch?v=' + videoId);
    console.log('[Lavalink] Track loaded:', track.info?.title);
    const stream = await downloadTrack(videoId);
    console.log('[Lavalink] Download stream for', videoId);
    return stream;
  } catch (err) {
    console.warn('[Lavalink] Failed for', videoId + ':', err.message);
    throw err;
  }
}

export { start, stop, isReady, waitForReady, loadTrack, downloadTrack, getAudioStream };
