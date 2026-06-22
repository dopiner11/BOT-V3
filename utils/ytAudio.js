import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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

const CACHE_DIR = resolve(__dirname, '../.cache');
const SEARCH_CACHE_FILE = resolve(CACHE_DIR, 'ytSearch.json');
const streamCache = new Map();

function loadCache() {
  try {
    if (existsSync(SEARCH_CACHE_FILE)) return JSON.parse(readFileSync(SEARCH_CACHE_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveCache(cache) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(SEARCH_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
}

function timeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

export async function search(query) {
  const cache = loadCache();
  if (cache[query]) return cache[query];

  const results = await timeout(YouTube.search(query, 1), 60000);
  if (!results?.length) throw new Error(`No YouTube results for: ${query}`);

  const track = results[0];
  const info = { videoId: track.id, title: track.title, duration: track.duration || 0 };
  cache[query] = info;
  saveCache(cache);
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
      const result = await timeout(ytdl(url, opts, { timeout: 60000 }), 65000);
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
