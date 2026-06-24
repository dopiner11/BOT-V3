import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PermissionFlagsBits } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BACKUP_DIR = join(__dirname, '..', 'src', '.data', 'backups');
if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

function loadConfig() {
  return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
}

function getBackupConfig() {
  return loadConfig().antiNuke?.backup || {};
}

function backupFilePath(guildId) {
  return join(BACKUP_DIR, `${guildId}.json`);
}

export async function takeSnapshot(guild) {
  try {
    const backup = getBackupConfig();
    if (!backup.enabled) return null;

    const roles = [];
    for (const role of guild.roles.cache.values()) {
      if (role.id === guild.id) continue;
      roles.push({
        id: role.id,
        name: role.name,
        color: role.color,
        hoist: role.hoist,
        position: role.rawPosition,
        permissions: role.permissions.bitfield.toString(),
        mentionable: role.mentionable,
        icon: role.iconURL(),
        unicodeEmoji: role.unicodeEmoji,
      });
    }

    const channels = [];
    for (const channel of guild.channels.cache.values()) {
      channels.push({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        position: channel.rawPosition,
        parentId: channel.parentId,
        topic: channel.topic || null,
        nsfw: channel.nsfw || false,
        bitrate: channel.bitrate || null,
        userLimit: channel.userLimit || 0,
        rateLimitPerUser: channel.rateLimitPerUser || 0,
      });
    }

    const snapshot = {
      guildId: guild.id,
      timestamp: Date.now(),
      roles,
      channels,
    };

    const filePath = backupFilePath(guild.id);
    const existing = existsSync(filePath)
      ? JSON.parse(readFileSync(filePath, 'utf8'))
      : [];

    existing.push(snapshot);

    const maxBackups = backup.maxBackups || 5;
    while (existing.length > maxBackups) {
      existing.shift();
    }

    writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
    return snapshot;
  } catch (e) {
    console.error('[Backup] Snapshot error:', e.message);
    return null;
  }
}

export function getLatestSnapshot(guildId) {
  try {
    const filePath = backupFilePath(guildId);
    if (!existsSync(filePath)) return null;
    const snapshots = JSON.parse(readFileSync(filePath, 'utf8'));
    return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  } catch {
    return null;
  }
}

export function getAllSnapshots(guildId) {
  try {
    const filePath = backupFilePath(guildId);
    if (!existsSync(filePath)) return [];
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

export async function autoRestoreRole(guild, deletedRole) {
  try {
    const backup = getBackupConfig();
    if (!backup.enabled || !backup.autoRestore) return false;

    const snapshot = getLatestSnapshot(guild.id);
    if (!snapshot) return false;

    const roleData = snapshot.roles.find(r => r.id === deletedRole.id);
    if (!roleData) return false;

    const botMember = guild.members.cache.get(guild.client.user.id);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) return false;

    await guild.roles.create({
      name: roleData.name,
      color: roleData.color,
      hoist: roleData.hoist,
      permissions: BigInt(roleData.permissions),
      mentionable: roleData.mentionable,
      icon: roleData.icon || undefined,
      unicodeEmoji: roleData.unicodeEmoji || undefined,
      reason: `استعادة تلقائية - Anti Nuke Backup`,
    }).catch(() => {});

    return true;
  } catch {
    return false;
  }
}

export async function autoRestoreChannel(guild, deletedChannel) {
  try {
    const backup = getBackupConfig();
    if (!backup.enabled || !backup.autoRestore) return false;

    const snapshot = getLatestSnapshot(guild.id);
    if (!snapshot) return false;

    const channelData = snapshot.channels.find(c => c.id === deletedChannel.id);
    if (!channelData) return false;

    const botMember = guild.members.cache.get(guild.client.user.id);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) return false;

    const channelOptions = {
      name: channelData.name,
      type: channelData.type,
      topic: channelData.topic || undefined,
      nsfw: channelData.nsfw,
      parent: channelData.parentId || undefined,
      position: channelData.position,
      reason: `استعادة تلقائية - Anti Nuke Backup`,
    };

    if (channelData.type === 2) {
      channelOptions.bitrate = channelData.bitrate || 64000;
      channelOptions.userLimit = channelData.userLimit || 0;
    }

    await guild.channels.create(channelOptions).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function startBackupScheduler(client) {
  const backup = getBackupConfig();
  if (!backup.enabled) return;

  const intervalMs = (backup.intervalMinutes || 60) * 60 * 1000;

  const run = async () => {
    try {
      for (const guild of client.guilds.cache.values()) {
        await takeSnapshot(guild);
      }
    } catch (e) {
      console.error('[Backup] Scheduler error:', e.message);
    }
  };

  run();
  setInterval(run, intervalMs);
}
