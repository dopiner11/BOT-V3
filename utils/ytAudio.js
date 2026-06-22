import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const origCwd = process.cwd();

let YouTube;
try {
  process.chdir(resolve(__dirname, '../MusicBot-main'));

  // Use cookies.txt instead of cookiesFromBrowser (Chrome not available on server)
  process.env.COOKIES_FROM_BROWSER = '';
  process.env.COOKIES_FILE = resolve(__dirname, '../MusicBot-main/cookies.txt');

  YouTube = require(resolve(__dirname, '../MusicBot-main/src/YouTube.js'));
} finally {
  process.chdir(origCwd);
}

const streamCache = new Map();
const searchCache = new Map();

export async function search(query) {
  const cached = searchCache.get(query);
  if (cached) return cached;

  const results = await YouTube.search(query, 1);
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
  const result = await YouTube.getStream(url);

  const info = {
    url: result.url,
    type: result.type,
    duration: result.duration || 0,
    bitrate: result.bitrate || 0,
    httpHeaders: result.httpHeaders || {},
  };
  streamCache.set(videoId, info);
  return info;
}

export function extractVideoId(url) {
  return YouTube.extractVideoId(url);
}
