import { execFile } from 'child_process';
import { existsSync, writeFileSync, chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_PATH = join(__dirname, '..', 'yt-dlp');
const _cookiesPath = join(__dirname, '..', 'cookies.txt');
const _hasCookies = existsSync(_cookiesPath);

let ready = false;
let _dlPromise = null;

// ─── Download latest yt-dlp from GitHub ─────────────────────────

async function download() {
  if (_dlPromise) return _dlPromise;
  _dlPromise = (async () => {
    try {
      const ext = process.platform === 'win32' ? '.exe' : '';
      const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp' + ext;
      console.log('[Audio] Downloading yt-dlp ...');
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(BIN_PATH + ext, buf);
      if (process.platform !== 'win32') chmodSync(BIN_PATH + ext, 0o755);
      console.log('[Audio] yt-dlp downloaded (' + (buf.length / 1024 / 1024).toFixed(1) + ' MB)');
      ready = true;
    } catch (err) {
      console.warn('[Audio] Failed to download yt-dlp:', err.message);
      ready = false;
    }
  })();
  return _dlPromise;
}

// ─── Resolve YouTube audio stream ─────────────────────────────────

async function getStream(videoId) {
  await download();
  if (!ready) throw new Error('yt-dlp not available');

  const ext = process.platform === 'win32' ? '.exe' : '';
  const bin = BIN_PATH + ext;

  if (!existsSync(bin)) throw new Error('yt-dlp binary not found at ' + bin);

  const strategies = [
    // Primary: Android client, no cookies
    {
      label: 'android',
      args: [
        'https://www.youtube.com/watch?v=' + videoId,
        '-f', 'bestaudio[ext=webm]/bestaudio/best',
        '--no-playlist', '--no-warnings', '-g',
        '--extractor-args', 'youtube:player_client=android',
        '--js-runtimes', 'node',
      ],
    },
    // Fallback: Android client with cookies
    ...(_hasCookies ? [{
      label: 'android+cookies',
      args: [
        'https://www.youtube.com/watch?v=' + videoId,
        '-f', 'bestaudio[ext=webm]/bestaudio/best',
        '--no-playlist', '--no-warnings', '-g',
        '--extractor-args', 'youtube:player_client=android',
        '--js-runtimes', 'node',
        '--cookies', _cookiesPath,
      ],
    }] : []),
    // Last resort: default client with cookies
    ...(_hasCookies ? [{
      label: 'default+cookies',
      args: [
        'https://www.youtube.com/watch?v=' + videoId,
        '-f', 'bestaudio[ext=webm]/bestaudio/best',
        '--no-playlist', '--no-warnings', '-g',
        '--cookies', _cookiesPath,
      ],
    }] : []),
  ];

  let lastError;
  for (const s of strategies) {
    try {
      const { stdout, stderr } = await execFileAsync(bin, s.args, { timeout: 30000 });
      const audioUrl = (stdout || '').trim();
      if (!audioUrl) { lastError = new Error(s.label + ': empty stdout'); continue; }

      const res = await fetch(audioUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { lastError = new Error(s.label + ': HTTP ' + res.status); continue; }
      if (!res.body) { lastError = new Error(s.label + ': empty body'); continue; }

      return Readable.fromWeb(res.body);
    } catch (err) {
      lastError = err;
    }
  }

  const detail = lastError?.stderr || lastError?.message || String(lastError);
  throw new Error('yt-dlp(' + videoId + '): ' + detail.split('\n')[0].slice(0, 120));
}

export { download, getStream, ready };
