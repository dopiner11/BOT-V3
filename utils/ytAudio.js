import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const origCwd = process.cwd();

let YouTube;
try {
  process.chdir(resolve(__dirname, '../MusicBot-main'));
  process.env.COOKIES_FROM_BROWSER = '';
  process.env.COOKIES_FILE = resolve(__dirname, '../MusicBot-main/cookies.txt');
  YouTube = require(resolve(__dirname, '../MusicBot-main/src/YouTube.js'));
} finally {
  process.chdir(origCwd);
}

const CACHE_DIR = resolve(__dirname, '../.cache');
const SEARCH_FILE = resolve(CACHE_DIR, 'ytSearch.json');
const STREAM_FILE = resolve(CACHE_DIR, 'ytStream.json');
const STREAM_TTL = 4 * 60 * 60 * 1000;
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
  const streamInfo = await timeout(YouTube.getStream(url), 65000);
  const response = await timeout(fetch(streamInfo.url, { headers: streamInfo.httpHeaders }), 30000);
  if (!response.ok || !response.body) {
    throw new Error(`Stream fetch failed: ${response.status}`);
  }
  const nodeStream = Readable.fromWeb(response.body);
  streamMem.set(videoId, nodeStream);
  return nodeStream;
}

export function extractVideoId(url) {
  return YouTube.extractVideoId(url);
}
