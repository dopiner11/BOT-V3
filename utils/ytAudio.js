import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const origCwd = process.cwd();

let YouTube;
let ytdl;
try {
  process.chdir(resolve(__dirname, '../MusicBot-main'));
  process.env.COOKIES_FROM_BROWSER = '';
  process.env.COOKIES_FILE = resolve(__dirname, '../MusicBot-main/cookies.txt');
  YouTube = require(resolve(__dirname, '../MusicBot-main/src/YouTube.js'));
  ytdl = require('youtube-dl-exec');
} finally {
  process.chdir(origCwd);
}

const streamCache = new Map();
const searchCache = new Map();

function timeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

export async function search(query) {
  const cached = searchCache.get(query);
  if (cached) return cached;

  const results = await timeout(YouTube.search(query, 1), 30000);
  if (!results?.length) throw new Error(`No YouTube results for: ${query}`);

  const track = results[0];
  const info = { videoId: track.id, title: track.title, duration: track.duration || 0 };
  searchCache.set(query, info);
  return info;
}

export async function getStream(videoId) {
  const cached = streamCache.get(videoId);
  if (cached) return cached;

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const formats = ['bestaudio*', 'bestaudio/best', 'best'];

  let lastError;
  for (const format of formats) {
    try {
      const opts = YouTube.getYtDlpOptions({
        dumpSingleJson: true,
        format,
        preferFreeFormats: true,
      });
      opts.retries = 1;
      opts.fragmentRetries = 1;
      const result = await timeout(ytdl(url, opts, { timeout: 30000 }), 35000);
      if (result?.url) {
        const info = {
          url: result.url,
          type: result.acodec && result.acodec.includes('opus') ? 'opus' : 'arbitrary',
          duration: result.duration || 0,
          bitrate: result.abr || result.tbr || 0,
          httpHeaders: result.http_headers || {},
        };
        streamCache.set(videoId, info);
        return info;
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function extractVideoId(url) {
  return YouTube.extractVideoId(url);
}
