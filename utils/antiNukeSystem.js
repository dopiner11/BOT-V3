import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EmbedBuilder, AuditLogEvent, PermissionFlagsBits } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ADMIN_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
];

let cachedConfig = null;
let lastConfigLoad = 0;

function loadConfig() {
  const now = Date.now();
  if (cachedConfig && now - lastConfigLoad < 30000) return cachedConfig;
  cachedConfig = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
  lastConfigLoad = now;
  return cachedConfig;
}

function getAntiNukeConfig() {
  return loadConfig().antiNuke || {};
}

const actionCache = new Map();
const CACHE_CLEAN_INTERVAL = 60000;
const punishingUsers = new Set();
const escalatedExceptions = new Map();

const userSuspicion = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [userId, actions] of actionCache) {
    for (const [actionType, data] of actions) {
      data.timestamps = data.timestamps.filter(t => now - t < data.windowMs);
    }
    const empty = [...actions.entries()].every(([_, d]) => d.timestamps.length === 0);
    if (empty) actionCache.delete(userId);
  }

  for (const [userId, record] of userSuspicion) {
    record.actions = record.actions.filter(a => now - a.time < 60000);
    if (record.actions.length === 0 && now - record.lastActionTime > 120000) {
      userSuspicion.delete(userId);
    }
  }

  for (const [userId, data] of escalatedExceptions) {
    if (now - data.timestamp > (getAntiNukeConfig().escalationCooldownMs || 300000)) {
      escalatedExceptions.delete(userId);
    }
  }
}, CACHE_CLEAN_INTERVAL);

function recordAction(userId, actionType, windowMs) {
  if (!actionCache.has(userId)) actionCache.set(userId, new Map());
  const userActions = actionCache.get(userId);
  if (!userActions.has(actionType)) {
    userActions.set(actionType, { timestamps: [], windowMs });
  }
  const action = userActions.get(actionType);
  const now = Date.now();
  action.timestamps = action.timestamps.filter(t => now - t < windowMs);
  action.timestamps.push(now);
  return action.timestamps.length;
}

function getExemptionLevel(member, config) {
  const userId = member.id;
  const antiNuke = getAntiNukeConfig();

  if ((config.committees?.founders || []).includes(userId)) return 'founder';
  if ((config.committees?.authorizedUsers || []).includes(userId)) return 'authorized';

  const bypassRoles = antiNuke.bypassRoleIds || [];
  for (const roleId of bypassRoles) {
    if (member.roles?.cache?.has(roleId)) return 'bypass';
  }
  return null;
}

async function getAuditLogExecutor(guild, actionType, filterFn) {
  try {
    const antiNuke = getAntiNukeConfig();
    const limit = antiNuke.auditLogFetchLimit || 10;
    const auditLogs = await guild.fetchAuditLogs({ type: actionType, limit });
    const entry = auditLogs.entries.find(filterFn || (() => true));
    return entry?.executor || null;
  } catch {
    return null;
  }
}

async function getRoleEditExecutor(guild, oldRole, newRole) {
  const changedName = oldRole.name !== newRole.name;
  const changedColor = oldRole.color !== newRole.color;
  const changedPerms = oldRole.permissions.bitfield !== newRole.permissions.bitfield;
  if (!changedName && !changedColor && !changedPerms) return null;
  return await getAuditLogExecutor(guild, AuditLogEvent.RoleUpdate, entry => {
    const changes = entry.changes || [];
    return changes.some(c => ['name', 'color', 'permissions'].includes(c.key));
  });
}

async function getRoleDeleteExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.RoleDelete, () => true);
}

async function getRoleCreateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.RoleCreate, () => true);
}

async function getChannelDeleteExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.ChannelDelete, () => true);
}

async function getChannelCreateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.ChannelCreate, () => true);
}

async function getChannelUpdateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.ChannelUpdate, () => true);
}

async function getBanExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.MemberBanAdd, () => true);
}

async function getUnbanExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.MemberBanRemove, () => true);
}

async function getKickExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.MemberKick, () => true);
}

async function getTimeoutExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.MemberUpdate, entry => {
    const changes = entry.changes || [];
    return changes.some(c => c.key === 'communication_disabled_until');
  });
}

async function getWebhookCreateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.WebhookCreate, () => true);
}

async function getBotAddExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.BotAdd, () => true);
}

async function getGuildUpdateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.GuildUpdate, () => true);
}

async function getEmojiCreateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.EmojiCreate, () => true);
}

async function getEmojiUpdateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.EmojiUpdate, () => true);
}

async function getEmojiDeleteExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.EmojiDelete, () => true);
}

async function getStickerCreateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.StickerCreate, () => true);
}

async function getStickerUpdateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.StickerUpdate, () => true);
}

async function getStickerDeleteExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.StickerDelete, () => true);
}

async function getThreadDeleteExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.ThreadDelete, () => true);
}

async function hasAdminRoles(member) {
  if (!member) return false;
  for (const role of member.roles.cache.values()) {
    if (role.permissions.any(ADMIN_PERMISSIONS)) return true;
  }
  return false;
}

async function removeAdminRoles(member, reason) {
  if (!member) return [];
  const botMember = member.guild.members.cache.get(member.guild.client.user.id);
  if (!botMember) return [];
  const removed = [];
  const rolesToKeep = [];

  for (const role of member.roles.cache.values()) {
    if (role.id === member.guild.id) continue;
    if (role.permissions.any(ADMIN_PERMISSIONS) && role.comparePositionTo(botMember.roles.highest) < 0) {
      removed.push(role.id);
    } else {
      rolesToKeep.push(role.id);
    }
  }

  if (removed.length > 0) {
    await member.roles.set(rolesToKeep, reason).catch(() => {});
  }
  return removed;
}

async function timeoutOnly(member, reason, durationMs = 600000) {
  if (!member || !member.guild) return false;
  try {
    await member.timeout(durationMs, reason).catch(() => {});
    await logPunishment(member.guild, member, reason, 0, false);
    return true;
  } catch {
    return false;
  }
}

async function punishRemoveAdminRoles(member, guild, reason, suspicionScore = 0) {
  if (!member || !guild) return false;
  try {
    const removed = await removeAdminRoles(member, reason);
    await new Promise(r => setTimeout(r, 500));
    await member.timeout(3600000, reason).catch(() => {});
    await logPunishment(guild, member, reason, removed.length, false, suspicionScore);
    return true;
  } catch {
    return false;
  }
}

async function punishMember(member, guild, reason) {
  if (!member || !guild) return false;
  try {
    const botMember = guild.members.cache.get(guild.client.user.id);
    if (!botMember) return false;
    const canManage = member.roles.highest.comparePositionTo(botMember.roles.highest) < 0;
    if (!canManage) return false;

    const bypassRoles = getAntiNukeConfig().bypassRoleIds || [];
    const rolesToKeep = [];
    const targetRoles = [];

    for (const role of member.roles.cache.values()) {
      if (role.id === guild.id) continue;
      if (role.comparePositionTo(botMember.roles.highest) < 0 && !bypassRoles.includes(role.id)) {
        targetRoles.push(role.id);
      } else {
        rolesToKeep.push(role.id);
      }
    }

    if (targetRoles.length > 0) {
      await member.roles.set(rolesToKeep, reason).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 500));
    await member.timeout(3600000, reason).catch(() => {});
    await logPunishment(guild, member, reason, targetRoles.length, false);
    return true;
  } catch {
    return false;
  }
}

async function instantBan(member, guild, reason, suspicionScore = 0) {
  if (!member || !guild) return false;
  try {
    await guild.bans.create(member, { reason, deleteMessageSeconds: 3600 }).catch(() => {});
    await logPunishment(guild, member, reason, 0, true, suspicionScore);
    return true;
  } catch {
    return false;
  }
}

async function logPunishment(guild, member, reason, rolesRemoved, isBan, suspicionScore = 0) {
  try {
    const config = loadConfig();
    const antiNuke = getAntiNukeConfig();
    const channelId = antiNuke.logChannelId || config.logChannels?.warning?.id;
    if (!channelId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    let title = '🛡️ إجراء حماية - Anti Nuke';
    let color = 0xF39C12;
    if (isBan) { title = '⛔ باند فوري - Anti Nuke'; color = 0xE74C3C; }
    else if (rolesRemoved === 0 && reason.includes('سبام')) { title = '⏰ تايم آوت - Anti Nuke'; color = 0x3498DB; }
    else if (rolesRemoved >= 0 && reason.includes('إدارية')) { title = '🔰 سحب صلاحيات إدارية - Anti Nuke'; color = 0x9B59B6; }
    else if (reason.includes('اختراق')) { title = '🚨 اختراق حساب - Anti Nuke'; color = 0xFF0000; }
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .addFields(
        { name: 'العضو', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
        { name: 'السبب', value: reason, inline: false },
        { name: 'عدد الرتب المسحوبة', value: `${rolesRemoved}`, inline: true },
        { name: 'التوقيت', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();
    if (suspicionScore > 0) {
      embed.addFields({ name: '⚠️ مؤشر الاختراق', value: `${suspicionScore}/100`, inline: true });
    }
    await channel.send({ embeds: [embed] });
  } catch {}
}

function calculateSuspicion(userId, actionType) {
  if (!userSuspicion.has(userId)) {
    userSuspicion.set(userId, {
      score: 0,
      actions: [],
      lastActionTime: Date.now(),
      actionTypes: new Set()
    });
  }

  const record = userSuspicion.get(userId);
  const now = Date.now();
  const timeSinceLast = now - record.lastActionTime;

  record.actions.push({ type: actionType, time: now });
  record.actionTypes.add(actionType);

  record.actions = record.actions.filter(a => now - a.time < 60000);

  const antiNuke = getAntiNukeConfig();
  const suspicion = antiNuke.suspicion || {};
  if (!suspicion.enabled) return 0;

  const speedWeight = suspicion.speedWeight || 30;
  const crossWeight = suspicion.crossCategoryWeight || 40;
  const volumeWeight = suspicion.volumeWeight || 25;

  let score = 0;

  if (record.actions.length > 1 && timeSinceLast < 5000) score += speedWeight;
  else if (record.actions.length > 1 && timeSinceLast < 15000) score += Math.floor(speedWeight / 2);

  if (record.actionTypes.size >= 3) score += crossWeight;
  else if (record.actionTypes.size >= 2) score += Math.floor(crossWeight / 2);

  if (record.actions.length >= 10) score += volumeWeight;
  else if (record.actions.length >= 5) score += Math.floor(volumeWeight / 2);

  record.score = Math.min(100, score);
  record.lastActionTime = now;

  return record.score;
}

function getSuspicionLevel(score) {
  const antiNuke = getAntiNukeConfig();
  const suspicion = antiNuke.suspicion || {};
  const watch = suspicion.watchScore || 20;
  const warn = suspicion.warnScore || 40;
  const strip = suspicion.stripScore || 60;
  const ban = suspicion.banScore || 80;

  if (score >= ban) return 'ban';
  if (score >= strip) return 'strip';
  if (score >= warn) return 'warn';
  if (score >= watch) return 'watch';
  return null;
}

async function checkAndPunish(member, guild, actionType, threshold, reasonBase, windowMs = 60000) {
  if (!member || punishingUsers.has(member.id)) return;

  const config = loadConfig();
  const exemption = getExemptionLevel(member, config);

  let effectiveThreshold = threshold;
  if (exemption) {
    const antiNuke = getAntiNukeConfig();
    const multiplier = antiNuke.exceptionMultiplier || 4;
    effectiveThreshold = threshold * multiplier;
  }

  const count = recordAction(member.id, actionType, windowMs);
  if (count < effectiveThreshold) return;

  punishingUsers.add(member.id);
  resetUserCache(member.id);

  const suspicionScore = calculateSuspicion(member.id, actionType);
  const suspicionLevel = getSuspicionLevel(suspicionScore);

  try {
    if (exemption) {
      const antiNuke = getAntiNukeConfig();
      const escalateToBan = antiNuke.exceptionEscalateToBan !== false;

      if (escalateToBan && escalatedExceptions.has(member.id)) {
        await instantBan(member, guild,
          `اختراق حساب مستثنى (${exemption}) - ${reasonBase} (${count}) - ${suspicionScore >= 60 ? 'مؤشر اختراق عالي' : 'تكرار بعد العقاب'} - Anti Nuke`,
          suspicionScore
        );
      } else {
        if (await hasAdminRoles(member)) {
          await punishRemoveAdminRoles(member, guild,
            `استثناء (${exemption}) - ${reasonBase} (${count}) - سحب صلاحيات إدارية - Anti Nuke`,
            suspicionScore
          );
        } else {
          await punishMember(member, guild,
            `استثناء (${exemption}) - ${reasonBase} (${count}) - Anti Nuke`
          );
        }

        if (escalateToBan) {
          escalatedExceptions.set(member.id, { timestamp: Date.now() });
        }
      }

      if (suspicionScore >= (getAntiNukeConfig().suspicion?.banScore || 80)) {
        try {
          const alertChannelId = getAntiNukeConfig().logChannelId;
          if (alertChannelId) {
            const ch = await guild.channels.fetch(alertChannelId).catch(() => null);
            if (ch) {
              await ch.send({
                content: `🚨 **إنذار اختراق حساب!**\n<@${member.id}> (\`${member.user.tag}\`) — حساب مستثنى (\`${exemption}\`)\nمؤشر الاختراق: **${suspicionScore}/100**\nتم اتخاذ إجراء: ${suspicionScore >= 80 ? '⛔ باند فوري' : '🔰 سحب صلاحيات'}`
              }).catch(() => {});
            }
          }
        } catch {}
      }
    } else if (suspicionLevel === 'ban') {
      const hasAdmin = await hasAdminRoles(member);
      if (hasAdmin) {
        await punishRemoveAdminRoles(member, guild,
          `${reasonBase} (${count}) - مؤشر اختراق ${suspicionScore}/100 - سحب صلاحيات إدارية - Anti Nuke`,
          suspicionScore
        );
      } else {
        await instantBan(member, guild,
          `${reasonBase} (${count}) - مؤشر اختراق ${suspicionScore}/100 - باند فوري - Anti Nuke`,
          suspicionScore
        );
      }
    } else {
      if (await hasAdminRoles(member)) {
        await punishRemoveAdminRoles(member, guild,
          `${reasonBase} (${count}) - سحب صلاحيات إدارية - Anti Nuke`,
          suspicionScore
        );
      } else {
        const durationStr = windowMs === 10000 ? '10 ثواني' : (windowMs === 3000 ? '3 ثواني' : 'دقيقة');
        await punishMember(member, guild,
          `${reasonBase} (${count} مرة خلال ${durationStr}) - Anti Nuke`
        );
      }
    }
  } catch (e) {
    console.error('Error in checkAndPunish:', e);
  }

  const lockMs = getAntiNukeConfig().punishLockMs || 30000;
  setTimeout(() => {
    punishingUsers.delete(member.id);
  }, lockMs);
}

export async function handleGuildRoleUpdate(oldRole, newRole) {
  const guild = newRole.guild;
  const changedName = oldRole.name !== newRole.name;
  const changedColor = oldRole.color !== newRole.color;
  if (!changedName && !changedColor) return;
  const executor = await getRoleEditExecutor(guild, oldRole, newRole);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.roleEditThreshold || 3;
  await checkAndPunish(member, guild, 'role_edit', threshold, 'تعديل رتب متكرر');
}

export async function handleGuildRoleDelete(role) {
  const guild = role.guild;
  const executor = await getRoleDeleteExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.roleDeleteThreshold || 2;
  await checkAndPunish(member, guild, 'role_delete', threshold, 'حذف رتب متكرر');

  if (getAntiNukeConfig().backup?.autoRestore) {
    const { autoRestoreRole } = await import('./backupSystem.js');
    await autoRestoreRole(guild, role).catch(() => {});
  }
}

export async function handleGuildRoleCreate(role) {
  const guild = role.guild;
  const executor = await getRoleCreateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.roleCreateThreshold || 3;
  await checkAndPunish(member, guild, 'role_create', threshold, 'إنشاء رتب متكرر');
}

export async function handleChannelDelete(channel) {
  const guild = channel.guild;
  if (!guild) return;
  const executor = await getChannelDeleteExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.channelDeleteThreshold || 2;
  await checkAndPunish(member, guild, 'channel_delete', threshold, 'حذف رومات متكرر');

  if (getAntiNukeConfig().backup?.autoRestore) {
    const { autoRestoreChannel } = await import('./backupSystem.js');
    await autoRestoreChannel(guild, channel).catch(() => {});
  }
}

export async function handleChannelCreate(channel) {
  const guild = channel.guild;
  if (!guild) return;
  const executor = await getChannelCreateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.channelCreateThreshold || 3;
  await checkAndPunish(member, guild, 'channel_create', threshold, 'إنشاء رومات متكرر');
}

export async function handleChannelUpdate(oldChannel, newChannel) {
  const guild = newChannel.guild;
  if (!guild) return;
  const oldPerms = oldChannel.permissionOverwrites?.cache;
  const newPerms = newChannel.permissionOverwrites?.cache;
  const permsChanged = oldPerms && newPerms && oldPerms.size !== newPerms.size;
  if (!permsChanged) return;
  const executor = await getChannelUpdateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.channelUpdateThreshold || 5;
  await checkAndPunish(member, guild, 'channel_update', threshold, 'تعديل صلاحيات رومات متكرر');
}

export async function handleGuildBanAdd(ban) {
  const guild = ban.guild;
  if (!guild) return;
  const executor = await getBanExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.banThreshold || 3;
  await checkAndPunish(member, guild, 'ban', threshold, 'باند متكرر');
}

export async function handleGuildBanRemove(ban) {
  const guild = ban.guild;
  if (!guild) return;
  const executor = await getUnbanExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.unbanThreshold || 2;
  await checkAndPunish(member, guild, 'unban', threshold, 'فك باند متكرر');
}

export async function handleGuildMemberKick(member) {
  if (!member?.guild) return;
  const guild = member.guild;
  const executor = await getKickExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const modMember = guild.members.cache.get(executor.id);
  if (!modMember) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.kickThreshold || 3;
  await checkAndPunish(modMember, guild, 'kick', threshold, 'كيك متكرر');
}

export async function handleGuildMemberTimeout(member) {
  if (!member?.guild) return;
  const guild = member.guild;
  const executor = await getTimeoutExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const modMember = guild.members.cache.get(executor.id);
  if (!modMember) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.timeoutThreshold || 5;
  await checkAndPunish(modMember, guild, 'timeout', threshold, 'تايم آوت متكرر');
}

export async function handleWebhookCreate(webhook) {
  const guild = webhook.guild;
  if (!guild) return;
  const executor = await getWebhookCreateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.webhookThreshold || 2;
  await checkAndPunish(member, guild, 'webhook_create', threshold, 'إنشاء ويب هوك متكرر');
}

export async function handleGuildMemberAdd(member) {
  const guild = member.guild;
  if (!guild || !member.user.bot) return;
  const config = loadConfig();
  const executor = await getBotAddExecutor(guild);
  if (!executor) return;
  const modMember = guild.members.cache.get(executor.id);
  if (!modMember) return;
  if (punishingUsers.has(modMember.id)) return;

  punishingUsers.add(modMember.id);
  await instantBan(modMember, guild, 'إضافة بوت - Anti Nuke');
  await instantBan(member, guild, 'دخول بوت غير مصرح به - Anti Nuke');

  const lockMs = getAntiNukeConfig().punishLockMs || 30000;
  setTimeout(() => {
    punishingUsers.delete(modMember.id);
  }, lockMs);
}

export async function handleGuildUpdate(oldGuild, newGuild) {
  const guild = newGuild;
  if (!guild) return;
  const changedName = oldGuild.name !== newGuild.name;
  const changedIcon = oldGuild.icon !== newGuild.icon;
  if (!changedName && !changedIcon) return;
  const executor = await getGuildUpdateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.guildUpdateThreshold || 2;
  await checkAndPunish(member, guild, 'guild_update', threshold, 'تغيير إعدادات السيرفر متكرر');
}

export async function handleGuildEmojiCreate(emoji) {
  const guild = emoji.guild;
  if (!guild) return;
  const executor = await getEmojiCreateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.emojiCreateThreshold || 3;
  await checkAndPunish(member, guild, 'emoji_create', threshold, 'إنشاء إيموجي متكرر');
}

export async function handleGuildEmojiUpdate(oldEmoji, newEmoji) {
  const guild = newEmoji.guild;
  if (!guild) return;
  const changedName = oldEmoji.name !== newEmoji.name;
  if (!changedName) return;
  const executor = await getEmojiUpdateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.emojiUpdateThreshold || 3;
  await checkAndPunish(member, guild, 'emoji_update', threshold, 'تغيير إيموجي متكرر');
}

export async function handleGuildEmojiDelete(emoji) {
  const guild = emoji.guild;
  if (!guild) return;
  const executor = await getEmojiDeleteExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.emojiDeleteThreshold || 2;
  await checkAndPunish(member, guild, 'emoji_delete', threshold, 'حذف إيموجي متكرر');
}

export async function handleGuildStickerCreate(sticker) {
  const guild = sticker.guild;
  if (!guild) return;
  const executor = await getStickerCreateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.stickerCreateThreshold || 3;
  await checkAndPunish(member, guild, 'sticker_create', threshold, 'إنشاء ستيكر متكرر');
}

export async function handleGuildStickerDelete(sticker) {
  const guild = sticker.guild;
  if (!guild) return;
  const executor = await getStickerDeleteExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.stickerDeleteThreshold || 2;
  await checkAndPunish(member, guild, 'sticker_delete', threshold, 'حذف ستيكر متكرر');
}

export async function handleThreadDelete(thread) {
  const guild = thread.guild;
  if (!guild) return;
  const executor = await getThreadDeleteExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.threadDeleteThreshold || 3;
  await checkAndPunish(member, guild, 'thread_delete', threshold, 'حذف ثريد متكرر');
}

export async function handleMessageDelete(message) {
  if (!message.author || message.author.bot) return;
  const guild = message.guild;
  if (!guild) return;
  const config = loadConfig();
  const member = guild.members.cache.get(message.author.id);
  if (!member) return;
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.messageDeleteThreshold || 10;
  await checkAndPunish(member, guild, 'message_delete', threshold, 'حذف رسائل متكرر', 10000);
}

export async function handleMessageDeleteBulk(messages) {
  if (messages.size === 0) return;
  const guild = messages.first()?.guild;
  if (!guild) return;
  const deletedBy = messages.first()?.deletedBy;
  if (deletedBy && !deletedBy.bot) {
    const config = loadConfig();
    const member = guild.members.cache.get(deletedBy.id);
    if (member) {
      const antiNuke = getAntiNukeConfig();
      const threshold = antiNuke.bulkDeleteThreshold || 2;
      await checkAndPunish(member, guild, 'bulk_delete', threshold, 'حذف جماعي للرسائل متكرر');
    }
  }
}

export async function handleMassMention(message) {
  if (!message.guild || message.author.bot) return;
  const mentionsEveryone = message.mentions.everyone;
  const userMentions = message.mentions.users.size;
  const roleMentions = message.mentions.roles.size;
  const totalMentions = userMentions + roleMentions + (mentionsEveryone ? 10 : 0);
  const antiNuke = getAntiNukeConfig();
  const mentionThreshold = antiNuke.mentionThreshold || 5;
  if (totalMentions < mentionThreshold) return;
  const config = loadConfig();
  const member = message.guild.members.cache.get(message.author.id);
  if (!member) return;
  await message.delete().catch(() => {});
  const antiNukeConfig = getAntiNukeConfig();
  const repeatThreshold = antiNukeConfig.mentionRepeatThreshold || 2;
  await checkAndPunish(member, message.guild, 'mass_mention', repeatThreshold, 'منشن جماعي متكرر');
}

export async function handleSpam(message) {
  if (!message.guild || message.author.bot) return;
  const config = loadConfig();
  const member = message.guild.members.cache.get(message.author.id);
  if (!member || punishingUsers.has(member.id)) return;

  const count = recordAction(message.author.id, 'spam', 3000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.spamThreshold || 5;
  if (count >= threshold) {
    punishingUsers.add(member.id);
    resetUserCache(member.id);
    await message.delete().catch(() => {});
    await timeoutOnly(member, `سبام (${count} رسالة خلال 3 ثواني) - Anti Nuke`, 600000);
    const lockMs = getAntiNukeConfig().punishLockMs || 30000;
    setTimeout(() => {
      punishingUsers.delete(member.id);
    }, lockMs);
  }
}

export async function unbanAll(guild, modUser) {
  if (!guild) return { unbanned: 0, failed: 0 };
  let unbanned = 0;
  let failed = 0;
  try {
    const bans = await guild.bans.fetch();
    for (const ban of bans.values()) {
      try {
        await guild.bans.remove(ban.user.id, `فك باند جماعي بواسطة ${modUser?.tag || 'النظام'}`);
        unbanned++;
      } catch {
        failed++;
      }
    }
  } catch {
    failed = -1;
  }
  return { unbanned, failed };
}

export function resetUserCache(userId) {
  actionCache.delete(userId);
}

export function resetAllCache() {
  actionCache.clear();
  userSuspicion.clear();
  escalatedExceptions.clear();
}

export function getSuspicionData(userId) {
  return userSuspicion.get(userId) || null;
}

export function getEscalationData(userId) {
  return escalatedExceptions.get(userId) || null;
}
