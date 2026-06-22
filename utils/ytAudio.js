import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

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
  ytdl = require('@distube/ytdl-core');
} finally {
  process.chdir(origCwd);
}

const CACHE_DIR = resolve(__dirname, '../.cache');
const SEARCH_FILE = resolve(CACHE_DIR, 'ytSearch.json');
const streamMem = new Map();

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function readJson(path) {
  try { if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')); } catch {}
  return {};
}

function writeJson(path, data) {
  try { ensureDir(); writeFileSync(path, JSON.stringify(data, null, 2)); } catch {}
}

function timeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}

export async function search(query) {
  const cache = readJson(SEARCH_FILE);
  if (cache[query]) return cache[query];

  const results = await timeout(YouTube.search(query, 1), 60000);
  if (!results?.length) throw new Error(`No YouTube results for: ${query}`);

  const track = results[0];
  const info = { videoId: track.id, title: track.title, duration: track.duration || 0 };
  cache[query] = info;
  writeJson(SEARCH_FILE, cache);
  return info;
}

export async function getStream(videoId) {
  if (streamMem.has(videoId)) return streamMem.get(videoId);

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const info = await timeout(ytdl.getInfo(url), 30000);
  const audio = ytdl.filterFormats(info.formats, 'audioonly');
  if (!audio.length) throw new Error('No audio formats found');
  const format = ytdl.chooseFormat(audio, { quality: 'highest' });
  const stream = ytdl.downloadFromInfo(info, { format });
  streamMem.set(videoId, stream);
  return stream;
}

export function extractVideoId(url) {
  return YouTube.extractVideoId(url);
}
