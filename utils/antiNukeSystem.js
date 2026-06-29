import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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
const botAdders = new Map();

/* --- Strike system (persistent, JSON-backed, debounced) --- */
const strikeRecords = new Map();
const STRIKES_FILE = join(__dirname, '../.data/strikes.json');
const STRIKES_DIR = dirname(STRIKES_FILE);
let strikesLoaded = false;
let strikeSaveTimer = null;

function loadStrikes() {
  try {
    if (existsSync(STRIKES_FILE)) {
      const raw = readFileSync(STRIKES_FILE, 'utf8').trim();
      if (raw) {
        const now = Date.now();
        let changed = false;
        for (const item of JSON.parse(raw)) {
          if (item.expiryAt > now) {
            strikeRecords.set(`${item.memberId}_${item.actionType}`, item);
          } else { changed = true; }
        }
        if (changed) saveStrikes();
      }
    }
  } catch (e) { console.error('[Strikes] Load error:', e.message); }
  strikesLoaded = true;
}

function saveStrikes() {
  try {
    if (!existsSync(STRIKES_DIR)) mkdirSync(STRIKES_DIR, { recursive: true });
    writeFileSync(STRIKES_FILE, JSON.stringify([...strikeRecords.values()], null, 2), 'utf8');
  } catch (e) { console.error('[Strikes] Save error:', e.message); }
}

function scheduleSaveStrikes() {
  if (strikeSaveTimer) clearTimeout(strikeSaveTimer);
  strikeSaveTimer = setTimeout(() => {
    strikeSaveTimer = null;
    saveStrikes();
  }, 200);
}

function getStrikes() {
  if (!strikesLoaded) loadStrikes();
  return strikeRecords;
}

function incrementStrike(memberId, actionType, expiryMs = 86400000) {
  getStrikes();
  const key = `${memberId}_${actionType}`;
  const now = Date.now();
  let rec = strikeRecords.get(key);
  if (rec && rec.expiryAt < now) { strikeRecords.delete(key); rec = null; }
  if (!rec) rec = { memberId, actionType, strikeCount: 0, firstStrikeAt: now, lastStrikeAt: now, expiryAt: now + expiryMs };
  rec.strikeCount++;
  rec.lastStrikeAt = now;
  rec.expiryAt = now + expiryMs;
  strikeRecords.set(key, rec);
  scheduleSaveStrikes();
  return rec.strikeCount;
}

function cleanupExpiredStrikes() {
  const now = Date.now();
  let changed = false;
  for (const [k, r] of strikeRecords) { if (r.expiryAt < now) { strikeRecords.delete(k); changed = true; } }
  if (changed) scheduleSaveStrikes();
}
/* --- End Strike system --- */

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

  for (const [botId, record] of botAdders) {
    if (now - record.timestamp > 3600000) {
      botAdders.delete(botId);
    }
  }

  cleanupExpiredStrikes();
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

function getBotAdderIfTracked(executor, guild) {
  if (!executor || !executor.bot) return null;
  const record = botAdders.get(executor.id);
  if (!record) return null;
  if (record.guildId !== guild.id) return null;
  if (Date.now() - record.timestamp > 3600000) {
    botAdders.delete(executor.id);
    return null;
  }
  return guild.members.cache.get(record.adderId) || null;
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

async function canModerate(member) {
  if (!member?.guild) return false;
  const botMember = member.guild.members.cache.get(member.guild.client.user.id);
  if (!botMember) return false;
  if (member.id === member.guild.ownerId) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return false;
  return member.roles.highest.comparePositionTo(botMember.roles.highest) < 0;
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
    await member.roles.set(rolesToKeep, reason).catch(e => {
      console.error(`[AntiNuke] فشل إزالة رتب من ${member.id}: ${e.message}`);
    });
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
    if (await canModerate(member)) {
      await new Promise(r => setTimeout(r, 500));
      await member.timeout(3600000, reason).catch(e => {
        console.error(`[AntiNuke] فشل تايم آوت ${member.id}: ${e.message}`);
      });
    } else {
      console.error(`[AntiNuke] لا يمكن تطبيق تايم آوت على ${member.id}: الرتبة أعلى من البوت`);
    }
    await logPunishment(guild, member, reason, removed.length, false, suspicionScore);
    return true;
  } catch {
    return false;
  }
}

async function punishMember(member, guild, reason) {
  if (!member || !guild) return false;
  try {
    if (!(await canModerate(member))) {
      console.error(`[AntiNuke] لا يمكن عقاب ${member.id}: الرتبة أعلى من البوت`);
      return false;
    }
    const removed = await removeAdminRoles(member, reason);
    await new Promise(r => setTimeout(r, 500));
    await member.timeout(3600000, reason).catch(e => {
      console.error(`[AntiNuke] فشل تايم آوت ${member.id}: ${e.message}`);
    });
    await logPunishment(guild, member, reason, removed.length, false);
    return true;
  } catch {
    return false;
  }
}

async function instantBan(member, guild, reason, suspicionScore = 0) {
  if (!member || !guild) return false;
  try {
    if (!(await canModerate(member))) {
      console.error(`[AntiNuke] لا يمكن باند ${member.id}: الرتبة أعلى من البوت`);
      return false;
    }
    await guild.bans.create(member, { reason, deleteMessageSeconds: 3600 });
    await logPunishment(guild, member, reason, 0, true, suspicionScore);
    return true;
  } catch (e) {
    console.error(`[AntiNuke] فشل باند ${member.id}: ${e.message}`);
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

function getStrikeActionConfig(actionType) {
  const antiNuke = getAntiNukeConfig();
  const strikes = antiNuke.strikes;
  if (!strikes || strikes.enabled === false) return null;
  const mapping = strikes.mapping || {};
  const categoryName = mapping[actionType] || 'default';
  const categories = strikes.categories || {};
  const cfg = categories[categoryName] || categories.default || null;
  return cfg;
}

function validateStrikeConfig() {
  try {
    const antiNuke = getAntiNukeConfig();
    const strikes = antiNuke.strikes;
    if (!strikes || strikes.enabled === false) return;
    const categories = strikes.categories;
    if (!categories) return;
    const validActions = ['dm', 'timeout', 'strip_admin', 'ban', 'none'];
    for (const [catName, cfg] of Object.entries(categories)) {
      for (let i = 1; i <= 3; i++) {
        const level = cfg[`strike${i}`];
        if (level && !validActions.includes(level.action)) {
          console.warn(`[AntiNuke] ⚠️ إعدادات خاطئة في فئة "${catName}": strike${i} action="${level.action}"`);
        }
      }
    }
  } catch (e) { console.error('[AntiNuke] Config validation error:', e.message); }
}
validateStrikeConfig();

const STRIKE_ACTION_NAMES = {
  mass_mention: 'المنشن الجماعي',
  spam: 'السبام',
  role_edit: 'تعديل الرتب',
  role_delete: 'حذف الرتب',
  role_create: 'إنشاء الرتب',
  channel_delete: 'حذف الرومات',
  channel_create: 'إنشاء الرومات',
  channel_update: 'تعديل الرومات',
  webhook_create: 'إنشاء ويب هوك',
  ban: 'حظر (باند) أعضاء',
  unban: 'فك الحظر',
  kick: 'طرد أعضاء',
  timeout: 'كتم (تايم آوت)',
  message_delete: 'حذف رسائل',
  bulk_delete: 'حذف جماعي للرسائل',
  emoji_create: 'إنشاء إيموجي',
  emoji_update: 'تعديل إيموجي',
  emoji_delete: 'حذف إيموجي',
  sticker_create: 'إنشاء ستيكر',
  sticker_delete: 'حذف ستيكر',
  thread_delete: 'حذف ثريد',
  guild_update: 'تعديل إعدادات السيرفر',
  bot_add: 'إضافة بوت',
};

const STRIKE_WARNINGS = { 1: 'الأول', 2: 'الثاني', 3: 'الثالث' };
const STRIKE_CONSEQUENCES = {
  1: 'إنذار فقط — لا توجد عقوبة هذه المرة.',
  2: 'سيتم عمل تايم آوت لمدة 30 دقيقة.',
  3: 'سيتم سحب الرتب مع تايم آوت.',
};

async function sendStrikeDm(member, reasonBase, strikeCount, actionType) {
  if (!member) return;
  try {
    const name = STRIKE_ACTION_NAMES[actionType] || actionType;
    const strikeLabel = STRIKE_WARNINGS[Math.min(strikeCount, 3)] || `${strikeCount}`;
    const consequence = STRIKE_CONSEQUENCES[Math.min(strikeCount, 3)] || 'سيتم اتخاذ إجراءات أشد.';
    await member.send({
      embeds: [new EmbedBuilder()
        .setTitle(`⚠️ إنذار ${strikeLabel} - ${name}`)
        .setDescription(
          `عزيزي ${member.user.tag}،\n\n` +
          `تم رصد مخالفة **${name}** من قبلك.\n` +
          `هذا الإنذار **${strikeLabel}** من أصل 3.\n\n` +
          `**العقوبة المطبقة:** ${consequence}\n\n` +
          `_تنتهي صلاحية الإنذارات بعد 24 ساعة من آخر مخالفة._`
        )
        .setColor(0xF39C12)
        .setFooter({ text: 'X.IRAQ FAMILY - نظام الحماية' })
        .setTimestamp()
      ]
    }).catch(() => {
      console.warn(`[AntiNuke] فشل إرسال DM إنذار للعضو ${member.id} (${actionType}, strike ${strikeCount})`);
    });
  } catch {}
}

async function logStrikePunishment(guild, member, reasonBase, strikeCount, actionType) {
  try {
    const antiNuke = getAntiNukeConfig();
    const channelId = antiNuke.logChannelId;
    if (!channelId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const name = STRIKE_ACTION_NAMES[actionType] || actionType;
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ إنذار #${strikeCount} - ${name}`)
      .setColor(0xF39C12)
      .addFields(
        { name: 'العضو', value: `${member.user.tag} (<@${member.id}>)`, inline: true },
        { name: 'الإجراء', value: reasonBase, inline: true },
        { name: 'عدد الإنذارات', value: `${strikeCount}`, inline: true },
        { name: 'التوقيت', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      )
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch {}
}

async function checkAndPunish(member, guild, actionType, threshold, reasonBase, windowMs = 60000, originalExecutor = null) {
  if (!member || punishingUsers.has(member.id)) return false;

  /* ── بوت مخرب تابع لمستخدم مستثنى → احظر البوت ونبه المستثنى ── */
  if (originalExecutor?.bot) {
    const botRecord = botAdders.get(originalExecutor.id);
    if (botRecord && botRecord.guildId === guild.id) {
      const adderMember = guild.members.cache.get(botRecord.adderId);
      if (adderMember) {
        const cfg = loadConfig();
        if (getExemptionLevel(adderMember, cfg)) {
          try {
            await guild.bans.create(originalExecutor, {
              reason: `بوت مخرب لمستخدم مستثنى - ${reasonBase} - Anti Nuke`,
              deleteMessageSeconds: 3600
            });
            console.warn(`[AntiNuke] ✅ بوت ${originalExecutor.tag} محظور (مضاف من مستثنى ${adderMember.id})`);
          } catch (e) {
            console.error(`[AntiNuke] ❌ فشل حظر بوت ${originalExecutor.id}: ${e.message}`);
          }
          try {
            await sendStrikeDm(adderMember,
              `البوت ${originalExecutor.tag} تم حظره بسبب سلوك تخريبي (${reasonBase})`, 0, actionType);
          } catch {}
          return false;
        }
      }
    }
  }

  const config = loadConfig();
  const exemption = getExemptionLevel(member, config);

  /* ── مسار المستثنين: لا عقاب أبداً ── */
  if (exemption) {
    const suspicionScore = calculateSuspicion(member.id, actionType);
    if (suspicionScore >= 90) {
      console.warn(`[AntiNuke] ⚠️ تنبيه: حساب مستثنى ${exemption} <@${member.id}> نشاط مشبوه عالي (${suspicionScore}/100) - ${actionType}`);
    }
    return false;
  }

  const count = recordAction(member.id, actionType, windowMs);
  if (count < threshold) return false;

  punishingUsers.add(member.id);
  resetUserCache(member.id);

  const suspicionScore = calculateSuspicion(member.id, actionType);
  const suspicionLevel = getSuspicionLevel(suspicionScore);

  let punished = false;

  try {
    if (suspicionLevel === 'ban') {
      /* ── شبهة اختراق عالية جداً ← عقاب فوري بدون إنذارات ── */
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
      punished = true;
    } else {
      /* ── المسار الطبيعي: نظام الإنذارات التدريجي ── */
      const strikeConfig = getStrikeActionConfig(actionType);
      if (strikeConfig) {
        const sc = incrementStrike(member.id, actionType, 86400000);
        const levelKey = `strike${Math.min(sc, 3)}`;
        const actionCfg = strikeConfig[levelKey] || strikeConfig.strike3;

        if (actionCfg) {
          const reason = `${reasonBase} (إنذار ${sc})`;
          if (actionCfg.action === 'dm') {
            await sendStrikeDm(member, reasonBase, sc, actionType);
          } else if (actionCfg.action === 'timeout') {
            if (await canModerate(member)) {
              await member.timeout((actionCfg.timeoutMinutes || 10) * 60000, reason).catch(e => {
                console.error(`[AntiNuke] فشل تايم آوت ${member.id}: ${e.message}`);
              });
              punished = true;
            } else {
              console.error(`[AntiNuke] لا يمكن تطبيق تايم آوت على ${member.id}: الرتبة أعلى من البوت`);
              punished = true;
            }
          } else if (actionCfg.action === 'strip_admin') {
            if (await canModerate(member)) {
              await removeAdminRoles(member, reason);
              await new Promise(r => setTimeout(r, 500));
              await member.timeout(3600000, reason).catch(e => {
                console.error(`[AntiNuke] فشل تايم آوت ${member.id}: ${e.message}`);
              });
              punished = true;
            } else {
              console.error(`[AntiNuke] لا يمكن سحب صلاحيات ${member.id}: الرتبة أعلى من البوت`);
              punished = true;
            }
          } else if (actionCfg.action === 'ban') {
            if (await canModerate(member)) {
              await guild.bans.create(member, { reason, deleteMessageSeconds: 3600 }).catch(e => {
                console.error(`[AntiNuke] فشل باند ${member.id}: ${e.message}`);
              });
              punished = true;
            } else {
              console.error(`[AntiNuke] لا يمكن باند ${member.id}: الرتبة أعلى من البوت`);
              punished = true;
            }
          }

          if (actionCfg.log !== false && actionCfg.action !== 'dm') {
            let loggedSuccess = true;
            if (actionCfg.action === 'timeout' || actionCfg.action === 'strip_admin') {
              loggedSuccess = await canModerate(member);
            }
            if (loggedSuccess) {
              await logStrikePunishment(guild, member, reasonBase, sc, actionType);
            }
          }
        }
      } else {
        /* ── حالياً ما يصير توصل هنا لأن كل الأنواع مغطاة بالـ config ── */
        if (await hasAdminRoles(member)) {
          await punishRemoveAdminRoles(member, guild,
            `${reasonBase} (${count}) - سحب صلاحيات إدارية - Fallback`,
            suspicionScore
          );
        } else {
          await punishMember(member, guild,
            `${reasonBase} (${count}) - Fallback`
          );
        }
        punished = true;
      }
    }
  } catch (e) {
    console.error('[AntiNuke] Error in checkAndPunish:', e);
  }

  const lockMs = getAntiNukeConfig().punishLockMs || 30000;
  setTimeout(() => {
    punishingUsers.delete(member.id);
  }, lockMs);

  return punished;
}

export async function handleGuildRoleUpdate(oldRole, newRole) {
  const guild = newRole.guild;
  const changedName = oldRole.name !== newRole.name;
  const changedColor = oldRole.color !== newRole.color;
  if (!changedName && !changedColor) return;
  const executor = await getRoleEditExecutor(guild, oldRole, newRole);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.roleEditThreshold || 3;
  await checkAndPunish(member, guild, 'role_edit', threshold, 'تعديل رتب متكرر', 60000, executor);
}

export async function handleGuildRoleDelete(role) {
  const guild = role.guild;
  const executor = await getRoleDeleteExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.roleDeleteThreshold || 2;
  await checkAndPunish(member, guild, 'role_delete', threshold, 'حذف رتب متكرر', 60000, executor);

  if (getAntiNukeConfig().backup?.autoRestore) {
    const { autoRestoreRole } = await import('./backupSystem.js');
    await autoRestoreRole(guild, role).catch(() => {});
  }
}

export async function handleGuildRoleCreate(role) {
  const guild = role.guild;
  const executor = await getRoleCreateExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.roleCreateThreshold || 3;
  await checkAndPunish(member, guild, 'role_create', threshold, 'إنشاء رتب متكرر', 60000, executor);
}

export async function handleChannelDelete(channel) {
  const guild = channel.guild;
  if (!guild) return;
  const executor = await getChannelDeleteExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.channelDeleteThreshold || 2;
  await checkAndPunish(member, guild, 'channel_delete', threshold, 'حذف رومات متكرر', 60000, executor);

  if (getAntiNukeConfig().backup?.autoRestore) {
    const { autoRestoreChannel } = await import('./backupSystem.js');
    await autoRestoreChannel(guild, channel).catch(() => {});
  }
}

export async function handleChannelCreate(channel) {
  const guild = channel.guild;
  if (!guild) return;
  const executor = await getChannelCreateExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.channelCreateThreshold || 3;
  await checkAndPunish(member, guild, 'channel_create', threshold, 'إنشاء رومات متكرر', 60000, executor);
}

export async function handleChannelUpdate(oldChannel, newChannel) {
  const guild = newChannel.guild;
  if (!guild) return;
  const oldPerms = oldChannel.permissionOverwrites?.cache;
  const newPerms = newChannel.permissionOverwrites?.cache;
  const permsChanged = oldPerms && newPerms && oldPerms.size !== newPerms.size;
  if (!permsChanged) return;
  const executor = await getChannelUpdateExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.channelUpdateThreshold || 5;
  await checkAndPunish(member, guild, 'channel_update', threshold, 'تعديل صلاحيات رومات متكرر', 60000, executor);
}

export async function handleGuildBanAdd(ban) {
  const guild = ban.guild;
  if (!guild) return;
  const executor = await getBanExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.banThreshold || 3;
  await checkAndPunish(member, guild, 'ban', threshold, 'باند متكرر', 60000, executor);
}

export async function handleGuildBanRemove(ban) {
  const guild = ban.guild;
  if (!guild) return;
  const executor = await getUnbanExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.unbanThreshold || 2;
  await checkAndPunish(member, guild, 'unban', threshold, 'فك باند متكرر', 60000, executor);
}

export async function handleGuildMemberKick(member) {
  if (!member?.guild) return;
  const guild = member.guild;
  const executor = await getKickExecutor(guild);
  if (!executor) return;
  const modMember = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!modMember) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.kickThreshold || 3;
  await checkAndPunish(modMember, guild, 'kick', threshold, 'كيك متكرر', 60000, executor);
}

export async function handleGuildMemberTimeout(member) {
  if (!member?.guild) return;
  const guild = member.guild;
  const executor = await getTimeoutExecutor(guild);
  if (!executor) return;
  const modMember = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!modMember) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.timeoutThreshold || 5;
  await checkAndPunish(modMember, guild, 'timeout', threshold, 'تايم آوت متكرر', 60000, executor);
}

export async function handleWebhookCreate(webhook) {
  const guild = webhook.guild;
  if (!guild) return;
  const executor = await getWebhookCreateExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.webhookThreshold || 2;
  await checkAndPunish(member, guild, 'webhook_create', threshold, 'إنشاء ويب هوك متكرر', 60000, executor);
}

export async function handleGuildMemberAdd(member) {
  const guild = member.guild;
  if (!guild || !member.user.bot) return;
  const config = loadConfig();
  const executor = await getBotAddExecutor(guild);
  if (!executor) return;
  const modMember = guild.members.cache.get(executor.id);
  if (!modMember) return;

  const exemption = getExemptionLevel(modMember, config);
  if (exemption) {
    botAdders.set(member.id, { adderId: modMember.id, guildId: guild.id, timestamp: Date.now() });
    return;
  }

  // Ban the bot itself
  try {
    if (await canModerate(member)) {
      await guild.bans.create(member, { reason: 'دخول بوت غير مصرح به - Anti Nuke', deleteMessageSeconds: 3600 });
    } else {
      console.error(`[AntiNuke] لا يمكن حظر بوت ${member.id}: الرتبة أعلى من البوت`);
    }
  } catch (e) {
    console.error(`[AntiNuke] فشل حظر بوت ${member.id}: ${e.message}`);
  }

  // Punish the adder via strike system
  await checkAndPunish(modMember, guild, 'bot_add', 1, 'إضافة بوت', 300000, executor);
}

export async function handleGuildUpdate(oldGuild, newGuild) {
  const guild = newGuild;
  if (!guild) return;
  const changedName = oldGuild.name !== newGuild.name;
  const changedIcon = oldGuild.icon !== newGuild.icon;
  if (!changedName && !changedIcon) return;
  const executor = await getGuildUpdateExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.guildUpdateThreshold || 2;
  await checkAndPunish(member, guild, 'guild_update', threshold, 'تغيير إعدادات السيرفر متكرر', 60000, executor);
}

export async function handleGuildEmojiCreate(emoji) {
  const guild = emoji.guild;
  if (!guild) return;
  const executor = await getEmojiCreateExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.emojiCreateThreshold || 3;
  await checkAndPunish(member, guild, 'emoji_create', threshold, 'إنشاء إيموجي متكرر', 60000, executor);
}

export async function handleGuildEmojiUpdate(oldEmoji, newEmoji) {
  const guild = newEmoji.guild;
  if (!guild) return;
  const changedName = oldEmoji.name !== newEmoji.name;
  if (!changedName) return;
  const executor = await getEmojiUpdateExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.emojiUpdateThreshold || 3;
  await checkAndPunish(member, guild, 'emoji_update', threshold, 'تغيير إيموجي متكرر', 60000, executor);
}

export async function handleGuildEmojiDelete(emoji) {
  const guild = emoji.guild;
  if (!guild) return;
  const executor = await getEmojiDeleteExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.emojiDeleteThreshold || 2;
  await checkAndPunish(member, guild, 'emoji_delete', threshold, 'حذف إيموجي متكرر', 60000, executor);
}

export async function handleGuildStickerCreate(sticker) {
  const guild = sticker.guild;
  if (!guild) return;
  const executor = await getStickerCreateExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.stickerCreateThreshold || 3;
  await checkAndPunish(member, guild, 'sticker_create', threshold, 'إنشاء ستيكر متكرر', 60000, executor);
}

export async function handleGuildStickerDelete(sticker) {
  const guild = sticker.guild;
  if (!guild) return;
  const executor = await getStickerDeleteExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.stickerDeleteThreshold || 2;
  await checkAndPunish(member, guild, 'sticker_delete', threshold, 'حذف ستيكر متكرر', 60000, executor);
}

export async function handleThreadDelete(thread) {
  const guild = thread.guild;
  if (!guild) return;
  const executor = await getThreadDeleteExecutor(guild);
  if (!executor) return;
  const member = guild.members.cache.get(executor.id) || getBotAdderIfTracked(executor, guild);
  if (!member) return;
  const config = loadConfig();
  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.threadDeleteThreshold || 3;
  await checkAndPunish(member, guild, 'thread_delete', threshold, 'حذف ثريد متكرر', 60000, executor);
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
  await checkAndPunish(member, guild, 'message_delete', threshold, 'حذف رسائل متكرر', 10000, message.author);
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
      await checkAndPunish(member, guild, 'bulk_delete', threshold, 'حذف جماعي للرسائل متكرر', 60000, deletedBy);
    }
  }
}

export async function handleMassMention(message) {
  if (!message.guild) return;
  let member;
  if (message.author.bot) {
    member = getBotAdderIfTracked(message.author, message.guild);
    if (!member) return;
  } else {
    member = message.guild.members.cache.get(message.author.id);
  }
  if (!member) return;

  const config = loadConfig();
  if (getExemptionLevel(member, config)) return;

  const hasEveryone = message.mentions.everyone;
  const roleCount = message.mentions.roles.size;
  const userMentionCount = message.mentions.users.size;

  let weight = 0;
  if (hasEveryone) weight += 50;
  weight += roleCount * 15;
  weight += userMentionCount * 1;

  const antiNuke = getAntiNukeConfig();
  const mentionThreshold = antiNuke.mentionThreshold || 5;
  if (weight < mentionThreshold) return;

  const repeatThreshold = antiNuke.mentionRepeatThreshold || 2;
  const punished = await checkAndPunish(member, message.guild, 'mass_mention', repeatThreshold, 'منشن جماعي متكرر', 60000, message.author);
  if (punished) {
    await message.delete().catch(() => {});
  }
}

export async function handleSpam(message) {
  if (!message.guild) return;
  let member;
  if (message.author.bot) {
    member = getBotAdderIfTracked(message.author, message.guild);
    if (!member) return;
  } else {
    member = message.guild.members.cache.get(message.author.id);
  }
  if (!member) return;

  const config = loadConfig();
  if (getExemptionLevel(member, config)) return;

  if (punishingUsers.has(member.id)) {
    await message.delete().catch(() => {});
    return;
  }

  const antiNuke = getAntiNukeConfig();
  const threshold = antiNuke.spamThreshold || 5;
  const punished = await checkAndPunish(member, message.guild, 'spam', threshold, 'سبام متكرر', 3000, message.author);
  if (punished) {
    await message.delete().catch(() => {});
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

export function isNukeEnabled() {
  return getAntiNukeConfig().enabled === true;
}

export function resetUserCache(userId) {
  actionCache.delete(userId);
}

export function resetAllCache() {
  actionCache.clear();
  userSuspicion.clear();
  escalatedExceptions.clear();
}

export function resetStrikes(memberId, actionType) {
  const key = `${memberId}_${actionType}`;
  if (strikeRecords.has(key)) {
    strikeRecords.delete(key);
    saveStrikes();
  }
}

export function getStrikeCount(memberId, actionType) {
  const rec = getStrikes().get(`${memberId}_${actionType}`);
  if (!rec || rec.expiryAt < Date.now()) return 0;
  return rec.strikeCount;
}

export function getSuspicionData(userId) {
  return userSuspicion.get(userId) || null;
}

export function getEscalationData(userId) {
  return escalatedExceptions.get(userId) || null;
}
