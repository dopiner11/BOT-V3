import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import SystemLog from '../models/SystemLog.js';
import { success, error, warning, info } from './embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
  } catch { return {}; }
}

async function getLogChannel(guild, system) {
  const config = loadConfig();
  const channelId = config.logChannels?.[system]?.id;
  if (!channelId) return null;
  try {
    return await guild.channels.fetch(channelId).catch(() => null);
  } catch { return null; }
}

function shouldSendToChannel(severity) {
  const config = loadConfig();
  const minSeverity = config.general?.embeds?.logFilters?.minSeverityToChannel ?? 3;
  return severity >= minSeverity;
}

async function saveLog(entry) {
  try {
    return await SystemLog.create(entry);
  } catch (err) {
    console.error('[LogSystem] فشل حفظ اللوغ:', err.message);
    return null;
  }
}

async function sendLogEmbed(guild, embed, system) {
  if (!guild) return;
  const channel = await getLogChannel(guild, system);
  if (!channel) return;
  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`[LogSystem] فشل إرسال لوغ ${system}:`, err.message);
  }
}

/* ===================================================================
   Helpers for formatting and enrichment
   =================================================================== */
function getUserId(user) {
  if (!user) return null;
  if (typeof user === 'string') {
    const match = user.match(/\d{17,20}/);
    return match ? match[0] : null;
  }
  return user.id || null;
}

function formatUserMention(user) {
  if (!user) return 'غير محدد';
  if (typeof user === 'string') {
    if (user.startsWith('<@') && user.endsWith('>')) return user;
    if (/^\d{17,20}$/.test(user)) return `<@${user}>`;
    return user;
  }
  if (user.id) return `<@${user.id}>`;
  return `${user}`;
}

async function enrichLogEmbed(guild, embed, target) {
  if (!guild) return embed;
  try {
    embed.setAuthor({ name: guild.name, iconURL: guild.iconURL() });
  } catch (e) {}

  const userId = getUserId(target);
  if (userId) {
    try {
      const user = await guild.client.users.fetch(userId).catch(() => null);
      if (user) {
        embed.setThumbnail(user.displayAvatarURL({ dynamic: true }));
      }
    } catch (e) {}
  }
  return embed;
}

/* ===================================================================
   إنذار (Warning)
   =================================================================== */
export async function logWarning(guild, { target, mod, reason, warningCount, totalWarnings = 3 }) {
  const embed = warning(
    `⚠️ إنذار رسمي (#${warningCount})`,
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod), inline: true },
      { name: 'السبب', value: reason || 'غير محدد', inline: false },
      { name: 'مجموع الإنذارات', value: `${warningCount}/${totalWarnings}`, inline: true },
      { name: 'تاريخ الانتهاء', value: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('ar-IQ'), inline: true },
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(4)) await sendLogEmbed(guild, embed, 'warning');
  return saveLog({
    type: 'warning', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: `⚠️ إنذار رسمي (#${warningCount})`,
    data: { reason, warningCount, totalWarnings }, severity: 4,
  });
}

/* ===================================================================
   فصل (Fire)
   =================================================================== */
export async function logFire(guild, { target, mod, reason, totalWarnings, totalPoints, vacationsBroken = 0, excusesCancelled = 0 }) {
  const embed = error(
    '🔥 فصل عضو',
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod), inline: true },
      { name: 'السبب', value: reason || 'غير محدد', inline: false },
      { name: 'إجمالي النقاط', value: `${totalPoints ?? 0}`, inline: true },
      { name: 'التحذيرات الملغاة', value: `${totalWarnings ?? 0}`, inline: true },
      { name: 'الإجازات الملغاة', value: `${vacationsBroken}`, inline: true },
      { name: 'الأعذار الملغاة', value: `${excusesCancelled}`, inline: true },
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(5)) await sendLogEmbed(guild, embed, 'fire');
  return saveLog({
    type: 'fire', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: '🔥 فصل عضو',
    data: { reason, totalWarnings, totalPoints, vacationsBroken, excusesCancelled }, severity: 5,
  });
}

/* ===================================================================
   تسامح (Forgive)
   =================================================================== */
export async function logForgive(guild, { target, mod, reason, warningCount, totalWarnings = 3 }) {
  const embed = success(
    '🤝 تسامح / إلغاء عقوبة',
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod), inline: true },
      { name: 'السبب', value: reason || 'غير محدد', inline: false },
      { name: 'مجموع الإنذارات', value: `${warningCount}/${totalWarnings}`, inline: true },
      { name: 'تاريخ التسامح', value: new Date().toLocaleDateString('ar-IQ'), inline: true },
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(3)) await sendLogEmbed(guild, embed, 'warning');
  return saveLog({
    type: 'forgive', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: '🤝 تسامح / إلغاء عقوبة',
    data: { reason, warningCount, totalWarnings }, severity: 3,
  });
}

/* ===================================================================
   نقاط (Points)
   =================================================================== */
export async function logPoints(guild, { target, mod, points, before, after, reason }) {
  const isAdd = points > 0;
  const arrow = isAdd ? '➕' : '➖';
  const embed = isAdd ? success(
    '💰 تغيير النقاط',
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod) || 'تلقائي', inline: true },
      { name: 'التغيير', value: `${arrow} ${Math.abs(points)}`, inline: true },
      { name: 'الرصيد السابق', value: `${before}`, inline: true },
      { name: 'الرصيد الجديد', value: `${after}`, inline: true },
      { name: 'السبب', value: reason || 'غير محدد', inline: false },
    ]
  ) : warning(
    '💰 تغيير النقاط',
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod) || 'تلقائي', inline: true },
      { name: 'التغيير', value: `${arrow} ${Math.abs(points)}`, inline: true },
      { name: 'الرصيد السابق', value: `${before}`, inline: true },
      { name: 'الرصيد الجديد', value: `${after}`, inline: true },
      { name: 'السبب', value: reason || 'غير محدد', inline: false },
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(3)) await sendLogEmbed(guild, embed, 'points');
  return saveLog({
    type: 'points', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: `${arrow} ${Math.abs(points)} نقطة`,
    data: { points, before, after, reason }, severity: 3,
  });
}

/* ===================================================================
   بلاك ليست (Blacklist)
   =================================================================== */
export async function logBlacklist(guild, { target, mod, reason, duration }) {
  const embed = error(
    '🚫 إضافة إلى البلاك ليست',
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod), inline: true },
      { name: 'السبب', value: reason || 'غير محدد', inline: false },
      { name: 'المدة', value: duration || 'دائم', inline: true },
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(4)) await sendLogEmbed(guild, embed, 'blacklist');
  return saveLog({
    type: 'blacklist', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: '🚫 إضافة إلى البلاك ليست',
    data: { reason, duration }, severity: 4,
  });
}

export async function logBlacklistRemove(guild, { target, mod, reason }) {
  const embed = success(
    '✅ إزالة من البلاك ليست',
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod) || 'تلقائي', inline: true },
      { name: 'السبب', value: reason || 'انتهت المدة', inline: false },
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(3)) await sendLogEmbed(guild, embed, 'blacklist');
  return saveLog({
    type: 'blacklist', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: '✅ إزالة من البلاك ليست',
    data: { reason }, severity: 3,
  });
}

/* ===================================================================
   إجازة (Vacation)
   =================================================================== */
export async function logVacation(guild, { target, mod, start, end, type, status }) {
  const embed = info(
    `🏖️ ${status === 'cancelled' ? 'إلغاء' : 'تسجيل'} إجازة`,
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod), inline: true },
      { name: 'النوع', value: type || 'عادية', inline: true },
      { name: 'تاريخ البداية', value: start || 'غير محدد', inline: true },
      { name: 'تاريخ النهاية', value: end || 'غير محدد', inline: true },
      { name: 'الحالة', value: status || 'نشطة', inline: true },
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(3)) await sendLogEmbed(guild, embed, 'vacation');
  return saveLog({
    type: 'vacation', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: `🏖️ ${status === 'cancelled' ? 'إلغاء' : 'تسجيل'} إجازة`,
    data: { start, end, type, status }, severity: 3,
  });
}

/* ===================================================================
   سيناريو (Scenario)
   =================================================================== */
function resolveCompetitionLogChannelId(cfg) {
  return cfg?.competitions?.logChannelId
    || cfg?.logChannels?.competitions?.id
    || null;
}

export async function logScenario(guild, { target, mod, scenarioName, event, details }) {
  const embed = info(
    `🎬 سيناريو: ${event}`,
    null,
    [
      { name: 'السيناريو', value: scenarioName || 'غير محدد', inline: true },
      { name: 'الحدث', value: event || 'غير محدد', inline: true },
      ...(target ? [{ name: 'العضو', value: formatUserMention(target), inline: true }] : []),
      ...(mod ? [{ name: 'بواسطة', value: formatUserMention(mod), inline: true }] : []),
      { name: 'التفاصيل', value: (details || '—').slice(0, 1000), inline: false },
    ]
  ).setTimestamp();

  await enrichLogEmbed(guild, embed, target || mod);
  await sendLogEmbed(guild, embed, 'scenarios');
  return saveLog({
    type: 'scenario', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: `🎬 ${event}`,
    data: { scenarioName, event, details }, severity: 3,
  });
}

export async function logCompetition(guild, { mod, competitionName, event, details, compType, compMode }) {
  const cfg = loadConfig();
  const channelId = resolveCompetitionLogChannelId(cfg);
  const isCancel = /إلغاء|ألغيت/i.test(event || '');
  const isEnd = /انته|إنهاء|فائز/i.test(event || '');
  const embedFn = isCancel ? warning : isEnd ? success : info;
  const embed = embedFn(
    `🏆 مسابقة: ${event}`,
    null,
    [
      { name: 'المسابقة', value: competitionName || 'غير محدد', inline: true },
      { name: 'الحدث', value: event || 'غير محدد', inline: true },
      ...(compType ? [{ name: 'النوع', value: compType, inline: true }] : []),
      ...(compMode ? [{ name: 'النمط', value: compMode, inline: true }] : []),
      ...(mod ? [{ name: 'بواسطة', value: formatUserMention(mod), inline: true }] : []),
      { name: 'التفاصيل', value: (details || '—').slice(0, 1000), inline: false },
    ]
  ).setTimestamp();

  if (mod) await enrichLogEmbed(guild, embed, mod);
  else try { embed.setAuthor({ name: guild?.name, iconURL: guild?.iconURL() }); } catch {}

  if (channelId && guild) {
    try {
      const ch = await guild.channels.fetch(channelId).catch(() => null);
      if (ch) await ch.send({ embeds: [embed] });
    } catch (err) {
      console.error('[LogSystem] فشل إرسال لوغ المسابقة:', err.message);
    }
  }

  return saveLog({
    type: 'competition', guildId: guild?.id, modId: getUserId(mod),
    action: `🏆 ${event}`,
    data: { competitionName, event, details, compType, compMode }, severity: 3,
  });
}

/* ===================================================================
   تسجيل حضور (Attendance)
   =================================================================== */
export async function logAttendance(guild, { target, mod, date, status, details }) {
  const embed = info(
    '📋 تسجيل حضور',
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod) || 'تلقائي', inline: true },
      { name: 'الحالة', value: status || 'غير محدد', inline: true },
      { name: 'التاريخ', value: date || new Date().toLocaleDateString('ar-IQ'), inline: true },
      ...(details ? [{ name: 'تفاصيل', value: details, inline: false }] : []),
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(2)) await sendLogEmbed(guild, embed, 'attendance');
  return saveLog({
    type: 'attendance', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: `📋 ${status}`,
    data: { date, status, details }, severity: 2,
  });
}

/* ===================================================================
   توظيف (Hiring)
   =================================================================== */
export async function logHiring(guild, { target, mod, role, details }) {
  const embed = success(
    '📥 توظيف عضو جديد',
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'المشرف', value: formatUserMention(mod), inline: true },
      { name: 'الرتبة', value: role || 'غير محدد', inline: true },
      ...(details ? [{ name: 'تفاصيل', value: details, inline: false }] : []),
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(3)) await sendLogEmbed(guild, embed, 'hiring');
  return saveLog({
    type: 'hiring', guildId: guild?.id, userId: getUserId(target), modId: getUserId(mod),
    action: `📥 توظيف ${getUserId(target)}`,
    data: { role, details }, severity: 3,
  });
}

/* ===================================================================
   تصعيد تفاعل (Escalation)
   =================================================================== */
export async function logEscalation(guild, { target, status, daysAsViolator, details }) {
  const embed = warning(
    '📊 تصعيد تفاعل',
    null,
    [
      { name: 'العضو', value: formatUserMention(target), inline: true },
      { name: 'الحالة', value: status || 'غير محدد', inline: true },
      { name: 'أيام المخالفة', value: `${daysAsViolator || 0}`, inline: true },
      ...(details ? [{ name: 'تفاصيل', value: details, inline: false }] : []),
    ]
  );

  await enrichLogEmbed(guild, embed, target);

  if (shouldSendToChannel(3)) await sendLogEmbed(guild, embed, 'warning');
  return saveLog({
    type: 'escalation', guildId: guild?.id, userId: getUserId(target),
    action: `📊 تصعيد: ${status}`,
    data: { status, daysAsViolator, details }, severity: 3,
  });
}

/* ===================================================================
   مزاد (Auction)
   =================================================================== */
export async function logAuction(guild, { event, productName, price, winner, details }) {
  const embed = winner
    ? success('🏆 مزاد', null, [
        { name: 'الحدث', value: event, inline: true },
        { name: 'المنتج', value: productName, inline: true },
        { name: 'السعر النهائي', value: `${price}`, inline: true },
        { name: 'الفائز', value: formatUserMention(winner), inline: true },
        ...(details ? [{ name: 'تفاصيل', value: details, inline: false }] : []),
      ])
    : info('📢 مزاد', null, [
        { name: 'الحدث', value: event, inline: true },
        { name: 'المنتج', value: productName, inline: true },
        ...(details ? [{ name: 'تفاصيل', value: details, inline: false }] : []),
      ]);

  if (winner) {
    await enrichLogEmbed(guild, embed, winner);
  } else {
    try {
      embed.setAuthor({ name: guild.name, iconURL: guild.iconURL() });
    } catch (e) {}
  }

  if (shouldSendToChannel(2)) await sendLogEmbed(guild, embed, 'general');
  return saveLog({
    type: 'auction', guildId: guild?.id,
    action: `🏆 مزاد: ${event} — ${productName}`,
    data: { event, productName, price, winner: getUserId(winner), details }, severity: winner ? 4 : 2,
  });
}
