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

let downloadAttempted = false;
let ready = false;

// ─── Download latest yt-dlp from GitHub ─────────────────────────

async function download() {
  if (downloadAttempted) return;
  downloadAttempted = true;
  try {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp' + ext;
    console.log('[Audio] Downloading yt-dlp ...');
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
}

// ─── Resolve YouTube audio stream ─────────────────────────────────

async function getStream(videoId) {
  if (!downloadAttempted) await download();
  if (!ready) throw new Error('yt-dlp not available');

  const ext = process.platform === 'win32' ? '.exe' : '';
  const bin = BIN_PATH + ext;

  if (!existsSync(bin)) throw new Error('yt-dlp binary not found');

  const args = [
    'https://www.youtube.com/watch?v=' + videoId,
    '--format', 'bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '-g',
  ];
  if (_hasCookies) args.push('--cookies', _cookiesPath);
  args.push('--extractor-args', 'youtubetab:skip=none');

  const { stdout } = await execFileAsync(bin, args, { timeout: 30000 });
  const audioUrl = (stdout || '').trim();
  if (!audioUrl) throw new Error('Empty response from yt-dlp');

  const res = await fetch(audioUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('Fetch HTTP ' + res.status);
  if (!res.body) throw new Error('Empty body');

  return Readable.fromWeb(res.body);
}

export { download, getStream, ready };
