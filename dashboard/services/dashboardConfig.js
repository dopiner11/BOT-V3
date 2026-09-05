import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configPath = join(__dirname, '../config.json');
let cache = null;
let cacheTime = 0;
const TTL = 5000;

export function loadDashboardConfig() {
  const now = Date.now();
  if (cache && now - cacheTime < TTL) return cache;
  cache = JSON.parse(readFileSync(configPath, 'utf8'));
  cacheTime = now;
  return cache;
}

export function saveDashboardConfig(newConfig) {
  writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf8');
  cache = newConfig;
  cacheTime = Date.now();
  return newConfig;
}

export function clearDashboardConfigCache() {
  cache = null;
  cacheTime = 0;
}

export function getDashboardConfigPath() {
  return configPath;
}
