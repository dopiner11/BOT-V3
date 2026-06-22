import youtubedl from 'youtube-dl-exec';
import { Readable } from 'stream';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '../.cache');
const SEARCH_CACHE_FILE = resolve(CACHE_DIR, 'ytSearchCache.json');
const SEARCH_CACHE_TTL = 24 * 60 * 60 * 1000;
const STREAM_CACHE_TTL = 10 * 60 * 1000;

const searchMemCache = new Map();
const streamCache = new Map();
const pendingSearches = new Map();
const COOKIES_FILE = resolve(__dirname, '../youtube_cookies.txt');
const hasCookies = existsSync(COOKIES_FILE);

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function baseOpts(extra = {}) {
  const opts = {
    dumpSingleJson: true,
    noCheckCertificates: true,
    noWarnings: true,
    retries: 2,
    ...extra,
  };
  return opts;
}

function searchOpts(extra = {}) {
  const opts = baseOpts(extra);
  if (hasCookies) opts.cookies = COOKIES_FILE;
  return opts;
}

function loadSearchCache() {
  try {
    if (existsSync(SEARCH_CACHE_FILE)) {
      return JSON.parse(readFileSync(SEARCH_CACHE_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveSearchCache(cache) {
  try {
    ensureDir();
    writeFileSync(SEARCH_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {}
}

export async function search(query) {
  const memKey = query.toLowerCase().trim();

  if (searchMemCache.has(memKey)) return searchMemCache.get(memKey);

  const diskCache = loadSearchCache();
  const diskEntry = diskCache[memKey];
  if (diskEntry && Date.now() - diskEntry.ts < SEARCH_CACHE_TTL) {
    searchMemCache.set(memKey, diskEntry.data);
    return diskEntry.data;
  }

  if (pendingSearches.has(memKey)) return pendingSearches.get(memKey);

  const promise = (async () => {
    const searchQuery = `ytsearch1:${query}`;
    const result = await youtubedl(searchQuery, searchOpts({ flatPlaylist: true }));

    if (!result || !result.entries || !result.entries.length) {
      throw new Error(`No results for: ${query}`);
    }

    const entry = result.entries[0];
    const info = {
      videoId: entry.id || entry.display_id,
      title: entry.title || entry.fulltitle || 'Unknown',
      duration: entry.duration || 0,
    };

    searchMemCache.set(memKey, info);
    diskCache[memKey] = { data: info, ts: Date.now() };
    saveSearchCache(diskCache);

    return info;
  })();

  pendingSearches.set(memKey, promise);
  try {
    return await promise;
  } finally {
    pendingSearches.delete(memKey);
  }
}

export async function getStream(videoId) {
  if (streamCache.has(videoId)) return streamCache.get(videoId);

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const info = await youtubedl(url, baseOpts({ format: 'bestaudio' }));

  if (!info || !info.url) throw new Error('No stream URL found');

  const response = await fetch(info.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
    },
  });

  if (!response.ok || !response.body) throw new Error(`Stream fetch failed: ${response.status}`);

  const nodeStream = Readable.fromWeb(response.body);
  streamCache.set(videoId, nodeStream);
  setTimeout(() => {
    streamCache.delete(videoId);
    try { nodeStream.destroy(); } catch {}
  }, STREAM_CACHE_TTL);

  return nodeStream;
}

export async function getStreamInfo(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const info = await youtubedl(url, baseOpts({ format: 'bestaudio' }));

  if (!info || !info.url) throw new Error('No stream URL found');

  return {
    url: info.url,
    headers: info.http_headers || {},
  };
}

export function extractVideoId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function clearStreamCache() {
  for (const key of streamCache.keys()) {
    try { streamCache.get(key)?.destroy(); } catch {}
  }
  streamCache.clear();
}

export function clearSearchCache() {
  searchMemCache.clear();
  try {
    if (existsSync(SEARCH_CACHE_FILE)) writeFileSync(SEARCH_CACHE_FILE, '{}');
  } catch {}
}
