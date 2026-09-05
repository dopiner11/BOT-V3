import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '../../.data');

export function listCollections() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

export function readCollection(name) {
  const path = join(DATA_DIR, `${name}.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(data) ? data : (data.records || Object.values(data).filter(v => typeof v === 'object' && v !== null) || []);
  } catch {
    return [];
  }
}

export function countCollection(name) {
  return Array.isArray(readCollection(name)) ? readCollection(name).length : Object.keys(readCollection(name)).length;
}

export function getCollectionPath(name) {
  return join(DATA_DIR, `${name}.json`);
}

export function collectionModifiedTime(name) {
  const path = join(DATA_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  try { return statSync(path).mtime; } catch { return null; }
}

export function readFile(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function readMainConfig() {
  const path = join(__dirname, '../../config.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}
