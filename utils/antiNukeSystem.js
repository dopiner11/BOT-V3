import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { EmbedBuilder, AuditLogEvent } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
}

function getAntiNukeConfig() {
  const config = loadConfig();
  return config.antiNuke || {};
}

const actionCache = new Map();
const CACHE_CLEAN_INTERVAL = 60000;

setInterval(() => {
  const now = Date.now();
  for (const [userId, actions] of actionCache) {
    for (const [actionType, data] of actions) {
      data.timestamps = data.timestamps.filter(t => now - t < data.windowMs);
    }
    const empty = [...actions.entries()].every(([_, d]) => d.timestamps.length === 0);
    if (empty) actionCache.delete(userId);
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

function isExempt(member, config) {
  const userId = member.id;
  const antiNuke = getAntiNukeConfig();
  if ((config.committees?.founders || []).includes(userId)) return true;
  if ((config.committees?.authorizedUsers || []).includes(userId)) return true;
  const bypassRoles = antiNuke.bypassRoleIds || [];
  for (const roleId of bypassRoles) {
    if (member.roles?.cache?.has(roleId)) return true;
  }
  return false;
}

async function getAuditLogExecutor(guild, actionType, filterFn) {
  try {
    const auditLogs = await guild.fetchAuditLogs({ type: actionType, limit: 5 });
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

  const executor = await getAuditLogExecutor(guild, AuditLogEvent.RoleUpdate, entry => {
    const changes = entry.changes || [];
    const hasRelevantChange = changes.some(c =>
      ['name', 'color', 'permissions'].includes(c.key)
    );
    if (!hasRelevantChange) return false;
    if (changedName && !changes.some(c => c.key === 'name')) return false;
    if (changedColor && !changes.some(c => c.key === 'color')) return false;
    return true;
  });
  return executor;
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

async function getKickExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.MemberKick, () => true);
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

async function getEmojiUpdateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.EmojiUpdate, () => true);
}

async function getEmojiCreateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.EmojiCreate, () => true);
}

async function getStickerCreateExecutor(guild) {
  return await getAuditLogExecutor(guild, AuditLogEvent.StickerCreate, () => true);
}

async function punishMember(member, guild, reason) {
  const config = loadConfig();
  if (!member || !guild) return false;
  try {
    const botMember = guild.members.cache.get(guild.client.user.id);
    if (!botMember) return false;
    const botHighestRole = botMember.roles.highest;
    const canManage = member.roles.highest.comparePositionTo(botHighestRole) < 0;
    if (!canManage) return false;
    const memberRoles = member.roles.cache.filter(r => r.id !== guild.id && r.comparePositionTo(botHighestRole) < 0);
    const roleIds = memberRoles.map(r => r.id);
    const targetRoles = roleIds.filter(id => {
      const bypassRoles = getAntiNukeConfig().bypassRoleIds || [];
      return !bypassRoles.includes(id);
    });
    for (const roleId of targetRoles) {
      await member.roles.remove(roleId, reason).catch(() => {});
    }
    await member.timeout(3600000, reason).catch(() => {});
    await logPunishment(guild, member, reason, targetRoles.length);
    return true;
  } catch {
    return false;
  }
}

async function instantBan(member, guild, reason) {
  if (!member || !guild) return false;
  try {
    await guild.bans.create(member, { reason, deleteMessageSeconds: 3600 }).catch(() => {});
    await logPunishment(guild, member, `[باند فوري] ${reason}`, 0);
    return true;
  } catch {
    return false;
  }
}

async function logPunishment(guild, member, reason, rolesRemoved) {
  try {
    const config = loadConfig();
    const antiNuke = getAntiNukeConfig();
    const channelId = antiNuke.logChannelId || config.logChannels?.warning?.id;
    if (!channelId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const isBan = reason.includes('[باند فوري]');
    const embed = new EmbedBuilder()
      .setTitle(isBan ? '⛔ باند فوري - Anti Nuke' : '🛡️ إجراء حماية - Anti Nuke')
      .setColor(isBan ? 0xE74C3C : 0xF39C12)
      .addFields(
        { name: 'العضو', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
        { name: 'السبب', value: reason, inline: false },
        { name: 'عدد الرتب المسحوبة', value: `${rolesRemoved}`, inline: true },
        { name: 'التوقيت', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch {}
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
  if (!member || isExempt(member, config)) return;
  const count = recordAction(executor.id, 'role_edit', 60000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.roleEditThreshold || 3;
  if (count >= threshold) {
    await punishMember(member, guild, `تعديل رتب متكرر (${count} مرة خلال دقيقة) - Anti Nuke`);
  }
}

export async function handleGuildRoleDelete(role) {
  const guild = role.guild;
  const executor = await getRoleDeleteExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  await instantBan(member, guild, 'حذف رتبة - Anti Nuke');
}

export async function handleGuildRoleCreate(role) {
  const guild = role.guild;
  const executor = await getRoleCreateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  const count = recordAction(executor.id, 'role_create', 60000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.roleCreateThreshold || 3;
  if (count >= threshold) {
    await punishMember(member, guild, `إنشاء رتب متكرر (${count} مرة خلال دقيقة) - Anti Nuke`);
  }
}

export async function handleChannelDelete(channel) {
  const guild = channel.guild;
  const executor = await getChannelDeleteExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  await instantBan(member, guild, 'حذف روم - Anti Nuke');
}

export async function handleChannelCreate(channel) {
  const guild = channel.guild;
  const executor = await getChannelCreateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  const count = recordAction(executor.id, 'channel_create', 60000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.channelCreateThreshold || 3;
  if (count >= threshold) {
    await punishMember(member, guild, `إنشاء رومات متكرر (${count} مرة خلال دقيقة) - Anti Nuke`);
  }
}

export async function handleChannelUpdate(oldChannel, newChannel) {
  const guild = newChannel.guild;
  const executor = await getChannelUpdateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  const count = recordAction(executor.id, 'channel_update', 60000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.channelUpdateThreshold || 5;
  if (count >= threshold) {
    await punishMember(member, guild, `تعديل صلاحيات رومات متكرر (${count} مرة خلال دقيقة) - Anti Nuke`);
  }
}

export async function handleGuildBanAdd(ban) {
  const guild = ban.guild;
  const executor = await getBanExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  const count = recordAction(executor.id, 'ban', 60000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.banThreshold || 3;
  if (count >= threshold) {
    await punishMember(member, guild, `باند متكرر (${count} مرة خلال دقيقة) - Anti Nuke`);
  }
}

export async function handleGuildMemberKick(member) {
  const guild = member.guild;
  const executor = await getKickExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const modMember = guild.members.cache.get(executor.id);
  if (!modMember || isExempt(modMember, config)) return;
  const count = recordAction(executor.id, 'kick', 60000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.kickThreshold || 3;
  if (count >= threshold) {
    await punishMember(modMember, guild, `كيك متكرر (${count} مرة خلال دقيقة) - Anti Nuke`);
  }
}

export async function handleGuildMemberTimeout(member, executorId) {
  if (!executorId) return;
  const guild = member.guild;
  const config = loadConfig();
  const modMember = guild.members.cache.get(executorId);
  if (!modMember || isExempt(modMember, config)) return;
  const count = recordAction(executorId, 'timeout', 60000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.timeoutThreshold || 5;
  if (count >= threshold) {
    await punishMember(modMember, guild, `تايم آوت متكرر (${count} مرة خلال دقيقة) - Anti Nuke`);
  }
}

export async function handleWebhookCreate(webhook) {
  const guild = webhook.guild;
  const executor = await getWebhookCreateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  await punishMember(member, guild, 'إنشاء ويب هوك - Anti Nuke');
}

export async function handleGuildMemberAdd(member) {
  const guild = member.guild;
  if (!member.user.bot) return;
  const config = loadConfig();
  const executor = await getBotAddExecutor(guild);
  if (!executor) return;
  const modMember = guild.members.cache.get(executor.id);
  if (!modMember) return;
  if (isExempt(modMember, config)) return;
  await instantBan(modMember, guild, 'إضافة بوت - Anti Nuke');
  await instantBan(member, guild, 'دخول بوت غير مصرح به - Anti Nuke');
}

export async function handleGuildUpdate(oldGuild, newGuild) {
  const guild = newGuild;
  const changedName = oldGuild.name !== newGuild.name;
  const changedIcon = oldGuild.icon !== newGuild.icon;
  if (!changedName && !changedIcon) return;
  const executor = await getGuildUpdateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  await punishMember(member, guild, 'تغيير إعدادات السيرفر (اسم/صورة) - Anti Nuke');
}

export async function handleGuildEmojiCreate(emoji) {
  const guild = emoji.guild;
  if (!emoji.id) return;
  const executor = await getEmojiCreateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  const count = recordAction(executor.id, 'emoji_create', 60000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.emojiCreateThreshold || 3;
  if (count >= threshold) {
    await punishMember(member, guild, `إنشاء إيموجي متكرر (${count} مرة خلال دقيقة) - Anti Nuke`);
  }
}

export async function handleGuildEmojiUpdate(oldEmoji, newEmoji) {
  const guild = newEmoji.guild;
  const changedName = oldEmoji.name !== newEmoji.name;
  if (!changedName) return;
  const executor = await getEmojiUpdateExecutor(guild);
  if (!executor || executor.bot) return;
  const config = loadConfig();
  const member = guild.members.cache.get(executor.id);
  if (!member || isExempt(member, config)) return;
  const count = recordAction(executor.id, 'emoji_update', 60000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.emojiUpdateThreshold || 3;
  if (count >= threshold) {
    await punishMember(member, guild, `تغيير إيموجي متكرر (${count} مرة خلال دقيقة) - Anti Nuke`);
  }
}

export async function handleMessageDelete(message) {
  if (!message.author || message.author.bot) return;
  const guild = message.guild;
  if (!guild) return;
  const config = loadConfig();
  const member = guild.members.cache.get(message.author.id);
  if (!member || isExempt(member, config)) return;
  const count = recordAction(message.author.id, 'message_delete', 10000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.messageDeleteThreshold || 10;
  if (count >= threshold) {
    await punishMember(member, guild, `حذف رسائل متكرر (${count} رسالة خلال 10 ثواني) - Anti Nuke`);
  }
}

export async function handleMessageDeleteBulk(messages) {
  if (messages.size === 0) return;
  const guild = messages.first()?.guild;
  if (!guild) return;
  const deletedBy = messages.first()?.deletedBy;
  if (deletedBy && !deletedBy.bot) {
    const config = loadConfig();
    const member = guild.members.cache.get(deletedBy.id);
    if (member && !isExempt(member, config)) {
      await punishMember(member, guild, `حذف جماعي للرسائل (${messages.size} رسالة) - Anti Nuke`);
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
  const threshold = antiNuke.mentionThreshold || 5;
  if (totalMentions < threshold) return;
  const config = loadConfig();
  const member = message.guild.members.cache.get(message.author.id);
  if (!member || isExempt(member, config)) return;
  await message.delete().catch(() => {});
  await punishMember(member, message.guild, `منشن جماعي (${totalMentions} منشن) - Anti Nuke`);
}

export async function handleSpam(message) {
  if (!message.guild || message.author.bot) return;
  const config = loadConfig();
  const member = message.guild.members.cache.get(message.author.id);
  if (!member || isExempt(member, config)) return;
  const count = recordAction(message.author.id, 'spam', 3000);
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.spamThreshold || 5;
  if (count >= threshold) {
    await message.delete().catch(() => {});
    await punishMember(member, message.guild, `سبام (${count} رسالة خلال 3 ثواني) - Anti Nuke`);
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
}
