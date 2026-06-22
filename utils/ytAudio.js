import { createRequire } from 'module';
import { existsSync } from 'fs';
const require = createRequire(import.meta.url);
const youtubedl = require('youtube-dl-exec');

const TIMEOUT = 30000;
const BASE = {
  noCheckCertificates: true,
  noWarnings: true,
  retries: 1,
  fragmentRetries: 1,
  addHeader: [
    'referer:youtube.com',
    'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ],
};

function makeOpts(extra) {
  return { ...BASE, ...extra };
}

async function tryFetch(url, flags) {
  try {
    return await youtubedl(url, flags, { timeout: TIMEOUT });
  } catch {
    return null;
  }
}

const streamCache = new Map();
const searchCache = new Map();

export async function search(query, cookiesPath) {
  const cached = searchCache.get(query);
  if (cached) return cached;

  const searchUrl = `ytsearch1:${query}`;
  let result = null;

  if (cookiesPath && existsSync(cookiesPath)) {
    result = await tryFetch(searchUrl, makeOpts({ dumpSingleJson: true, flatPlaylist: true, cookies: cookiesPath }));
  }
  if (!result) {
    result = await tryFetch(searchUrl, makeOpts({ dumpSingleJson: true, flatPlaylist: true }));
  }
  if (!result) {
    result = await tryFetch(searchUrl, makeOpts({ dumpSingleJson: true, flatPlaylist: true, extractorArgs: 'youtube:player_client=android' }));
  }

  if (!result?.entries?.[0]) throw new Error(`No YouTube results for: ${query}`);

  const entry = result.entries[0];
  const info = { videoId: entry.id, title: entry.title || query, duration: entry.duration || 0 };
  searchCache.set(query, info);
  return info;
}

export async function getStream(videoId, cookiesPath) {
  const cached = streamCache.get(videoId);
  if (cached) return cached;

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  let result = null;

  if (cookiesPath && existsSync(cookiesPath)) {
    result = await tryFetch(url, makeOpts({ dumpSingleJson: true, format: 'bestaudio/best', cookies: cookiesPath }));
  }
  if (!result) {
    result = await tryFetch(url, makeOpts({ dumpSingleJson: true, format: 'bestaudio/best' }));
  }
  if (!result) {
    result = await tryFetch(url, makeOpts({ dumpSingleJson: true, format: 'bestaudio/best', extractorArgs: 'youtube:player_client=android' }));
  }
  if (!result) {
    result = await tryFetch(url, makeOpts({ dumpSingleJson: true, format: 'bestaudio/best', extractorArgs: 'youtube:player_client=ios' }));
  }

  if (!result?.url) throw new Error(`Could not resolve YouTube video: ${videoId}`);

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

export function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}
