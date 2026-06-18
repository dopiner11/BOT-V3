import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configPath = join(__dirname, '../config.json');
const committeesPath = join(__dirname, '../.data/Committees.json');

let cachedConfig = null;
let cacheTime = 0;
const CACHE_TTL = 5000;

export function loadConfig(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedConfig && (now - cacheTime) < CACHE_TTL) {
    return cachedConfig;
  }
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (existsSync(committeesPath)) {
      const committeeList = JSON.parse(readFileSync(committeesPath, 'utf8'));
      if (committeeList && Object.keys(committeeList).length > 0) {
        config.committees = config.committees || {};
        const merged = {};
        for (const key of Object.keys(config.committees.list || {})) {
          merged[key] = { ...config.committees.list[key] };
        }
        for (const [key, data] of Object.entries(committeeList)) {
          if (merged[key]) Object.assign(merged[key], data);
          else merged[key] = data;
        }
        config.committees.list = merged;
      }
    }
    cachedConfig = config;
    cacheTime = now;
    return config;
  } catch (err) {
    console.error('configLoader error:', err);
    return {};
  }
}
