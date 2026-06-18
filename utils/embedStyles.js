import { EmbedBuilder } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, '../config.json');

let _configCache = null;
let _configCacheTime = 0;
const CACHE_TTL = 5000;

function getConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < CACHE_TTL) return _configCache;
  try {
    _configCache = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    _configCacheTime = now;
  } catch { _configCache = _configCache || {}; }
  return _configCache;
}

function parseColor(color) {
  if (!color) return 0x2B2D31;
  if (typeof color === 'number') return color;
  if (color.startsWith('#')) return parseInt(color.slice(1), 16);
  return 0x2B2D31;
}

function baseEmbed() {
  const config = getConfig();
  const footer = config.general?.embeds?.footer || '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘';
  return new EmbedBuilder()
    .setTimestamp()
    .setFooter({ text: footer });
}

export function success(title, description, fields = []) {
  const config = getConfig();
  return baseEmbed()
    .setTitle(title)
    .setDescription(description || null)
    .addFields(fields)
    .setColor(parseColor(config.general?.embeds?.colors?.success || '#2ECC71'));
}

export function error(title, description, fields = []) {
  const config = getConfig();
  return baseEmbed()
    .setTitle(title)
    .setDescription(description || null)
    .addFields(fields)
    .setColor(parseColor(config.general?.embeds?.colors?.error || '#E74C3C'));
}

export function warning(title, description, fields = []) {
  const config = getConfig();
  return baseEmbed()
    .setTitle(title)
    .setDescription(description || null)
    .addFields(fields)
    .setColor(parseColor(config.general?.embeds?.colors?.warning || '#F39C12'));
}

export function info(title, description, fields = []) {
  const config = getConfig();
  return baseEmbed()
    .setTitle(title)
    .setDescription(description || null)
    .addFields(fields)
    .setColor(parseColor(config.general?.embeds?.colors?.info || '#3498DB'));
}

export function neutral(title, description, fields = []) {
  const config = getConfig();
  return baseEmbed()
    .setTitle(title)
    .setDescription(description || null)
    .addFields(fields)
    .setColor(parseColor(config.general?.embeds?.colors?.neutral || '#2B2D31'));
}

export function gold(title, description, fields = []) {
  const config = getConfig();
  return baseEmbed()
    .setTitle(title)
    .setDescription(description || null)
    .addFields(fields)
    .setColor(parseColor(config.general?.embeds?.colors?.gold || '#F1C40F'));
}

export function custom(color, title, description, fields = []) {
  return baseEmbed()
    .setTitle(title)
    .setDescription(description || null)
    .addFields(fields)
    .setColor(parseColor(color));
}
