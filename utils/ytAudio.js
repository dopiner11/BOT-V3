import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const youtubedl = require('youtube-dl-exec');

function baseOpts(extra) {
  return {
    noCheckCertificates: true,
    noWarnings: true,
    retries: 3,
    fragmentRetries: 3,
    jsRuntimes: `node:${process.execPath}`,
    addHeader: [
      'referer:youtube.com',
      'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
    ...extra,
  };
}

async function tryFetch(url, opts) {
  try {
    return await youtubedl(url, opts);
  } catch {
    return null;
  }
}

export async function getStream(videoId, cookiesPath) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const candidates = [];

  // 1. cookies + web client (best, works on server)
  if (cookiesPath) {
    candidates.push(baseOpts({ dumpSingleJson: true, format: 'bestaudio/best', cookies: cookiesPath }));
  }

  // 2. iOS client (bypasses "Sign in" when no auth)
  candidates.push(baseOpts({ dumpSingleJson: true, format: 'bestaudio/best', extractorArgs: 'youtube:player_client=ios' }));

  // 3. web client (no auth, works locally)
  candidates.push(baseOpts({ dumpSingleJson: true, format: 'bestaudio/best' }));

  // 4. android client (last resort)
  candidates.push(baseOpts({ dumpSingleJson: true, format: 'bestaudio/best', extractorArgs: 'youtube:player_client=android', cookies: cookiesPath || undefined }));

  for (const opts of candidates) {
    const info = await tryFetch(url, opts);
    if (info?.url) {
      return {
        url: info.url,
        type: info.acodec && info.acodec.includes('opus') ? 'opus' : 'arbitrary',
        duration: info.duration || 0,
        bitrate: info.abr || info.tbr || 0,
        httpHeaders: info.http_headers || {},
      };
    }
  }

  throw new Error(`Could not resolve YouTube video: ${videoId}`);
}

export async function getPlaylistVideoIds(playlistUrl, cookiesPath) {
  const candidates = [];

  if (cookiesPath) {
    candidates.push(baseOpts({ dumpSingleJson: true, flatPlaylist: true, cookies: cookiesPath }));
  }
  candidates.push(baseOpts({ dumpSingleJson: true, flatPlaylist: true }));
  candidates.push(baseOpts({ dumpSingleJson: true, flatPlaylist: true, extractorArgs: 'youtube:player_client=ios' }));

  for (const opts of candidates) {
    const info = await tryFetch(playlistUrl, opts);
    if (info?.entries?.length) {
      return info.entries.filter(e => e?.id).map(e => e.id);
    }
  }

  throw new Error('No entries in playlist');
}

export function extractVideoId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}
