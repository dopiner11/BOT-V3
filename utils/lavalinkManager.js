import { spawn, execFile } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
let failed = false;
let readyResolve = null;
let readyReject = null;
const MAX_START_ATTEMPTS = 2;
let startAttempts = 0;

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
  if (!existsSync(JAR_PATH)) await downloadJar();
}

async function start() {
  if (lavalinkProcess || failed) return;

  // Create fresh promise for this attempt
  let _resolve, _reject;
  const promise = new Promise((resolve, reject) => { _resolve = resolve; _reject = reject; });
  readyResolve = _resolve;
  readyReject = _reject;

  startAttempts++;
  try {
    // Check Java
    try {
      await execFileAsync('java', ['-version'], { timeout: 10000 });
    } catch {
      console.warn('[Lavalink] Java not found - Lavalink unavailable');
      failed = true;
      if (_reject) _reject(new Error('Java not found'));
      return;
    }

    if (!existsSync(PLUGINS_DIR)) mkdirSync(PLUGINS_DIR, { recursive: true });
    await ensureJar();

    console.log('[Lavalink] Starting Lavalink server ...');
    lavalinkProcess = spawn('java', [
      '-jar', JAR_PATH,
      '--spring.config.location=' + join(LAVALINK_DIR, 'application.yml'),
    ], { cwd: LAVALINK_DIR, stdio: ['ignore', 'pipe', 'pipe'] });

    lavalinkProcess.stdout.on('data', (data) => {
      if (data.toString().includes('Started Launcher') || data.toString().includes('Lavalink is ready')) {
        ready = true;
        if (readyResolve) { readyResolve(); readyResolve = null; readyReject = null; }
        console.log('[Lavalink] Ready!');
      }
    });

    lavalinkProcess.stderr.on('data', (data) => {
      if (data.toString().includes('Started Launcher') || data.toString().includes('Lavalink is ready')) {
        ready = true;
        if (readyResolve) { readyResolve(); readyResolve = null; readyReject = null; }
        console.log('[Lavalink] Ready!');
      }
    });

    lavalinkProcess.on('error', (err) => {
      console.error('[Lavalink] Process error:', err.message);
      if (readyReject) { readyReject(err); readyResolve = null; readyReject = null; }
    });

    lavalinkProcess.on('exit', (code) => {
      console.warn('[Lavalink] Exited with code', code);
      ready = false;
      lavalinkProcess = null;
      if (startAttempts < MAX_START_ATTEMPTS) {
        setTimeout(() => start(), 2000);
      } else {
        failed = true;
        if (readyReject) { readyReject(new Error('Lavalink exited')); readyResolve = null; readyReject = null; }
      }
    });

    // Wait for ready (timeout 30s)
    await Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Lavalink startup timeout')), 30000)),
    ]);

    startAttempts = 0;
  } catch (err) {
    console.error('[Lavalink] Failed:', err.message);
    lavalinkProcess = null;
    ready = false;
    if (readyReject) { readyReject(err); readyResolve = null; readyReject = null; }
    if (startAttempts >= MAX_START_ATTEMPTS) failed = true;
  }
}

function stop() {
  if (lavalinkProcess) { lavalinkProcess.kill('SIGTERM'); lavalinkProcess = null; }
  ready = false;
  if (readyReject) { readyReject(new Error('Lavalink stopped')); readyResolve = null; readyReject = null; }
}

async function waitForReady() {
  if (failed) throw new Error('Lavalink unavailable');
  if (ready) return;
  let _resolve, _reject;
  const p = new Promise((resolve, reject) => { _resolve = resolve; _reject = reject; });
  readyResolve = _resolve;
  readyReject = _reject;
  if (!lavalinkProcess && !failed) start().catch(() => {});
  await p.catch(() => { throw new Error('Lavalink unavailable'); });
}

// ─── REST API ─────────────────────────────────────────────────────

async function tryGetStream(videoId) {
  if (failed) throw new Error('Lavalink unavailable');
  if (!ready) {
    try {
      await Promise.race([
        waitForReady(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Lavalink wait timeout')), 15000)),
      ]);
    } catch {
      throw new Error('Lavalink not ready');
    }
  }

  const errs = [];

  // Try download endpoint first
  try {
    const res = await fetch(BASE + '/youtube/download/' + videoId, {
      headers: HEADERS, signal: AbortSignal.timeout(20000),
    });
    if (res.ok && res.body) {
      console.log('[Lavalink] Downloaded', videoId);
      return Readable.fromWeb(res.body);
    }
    errs.push('download HTTP ' + res.status);
  } catch (e) { errs.push(e.message); }

  // Fallback: load track and try identifier-based stream
  try {
    const res = await fetch(BASE + '/v4/loadtracks?identifier=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId), {
      headers: HEADERS, signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.data?.[0]) {
        console.log('[Lavalink] Track loaded:', data.data[0].info?.title || videoId);
      }
    }
    errs.push('loadtracks ' + res.status);
  } catch (e) { errs.push(e.message); }

  throw new Error(errs.join(' | '));
}

export { start, stop, waitForReady, tryGetStream };
