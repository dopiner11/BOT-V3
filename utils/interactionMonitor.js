import { schedule } from 'node-cron';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Member from '../models/Member.js';
import Warning from '../models/Warning.js';
import DailyLog from '../models/DailyLog.js';
import Grace24h from '../models/Grace24h.js';
import {
  processAllMembers,
  calculateRankProgress,
  startDailyClassification,
  quickClassify,
  ensureDailyLog,
  getTodayLog,
  buildStatusReport,
  getIraqMidnight,
  STATUS_EMOJI,
  STATUS as IM_STATUS,
  ensurePunishmentNotification,
  formatDate,
  getInteractionConfig,
} from './interactionManager.js';
import { startWeeklyCalibration } from './weeklyCalibration.js';
import { warning as embedWarning, success as embedSuccess, info as embedInfo, error as embedError } from './embedStyles.js';
import { dmUser, sendToChannel } from './notificationSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GRACE24H_MS = 24 * 60 * 60 * 1000;

function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
  } catch { return {}; }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getReviewWindowAgo() {
  return new Date(Date.now() - getInteractionConfig().reviewWindowHours * 3600000);
}

/* ===================================================================
   تقييم حالة العضو + تحديث الروم + إرسال DM إذا تغيرت الحالة
   يستخدم النظام الجديد (interactionManager)
   =================================================================== */
export async function assessMemberStatus(client, guild, discordId, { silentInit = false } = {}) {
  const result = await quickClassify(discordId);
  if (!result.member) return false;

  const currentStatus = result.status;
  const statusEmoji = result.emoji;
  const dailyPoints = result.points;

  const prevStatus = result.member._lastInteractionStatus;

  // أول تشغيل: فقط نخزن الحالة بدون إرسال DM ولا تحديث ايموجي
  if (prevStatus === undefined && silentInit) {
    result.member._lastInteractionStatus = currentStatus;
    await result.member.save().catch(e => console.error('[InteractionMonitor]', e?.message));
    return true;
  }

  if (prevStatus === currentStatus) return false;

  await updateRoomEmoji(guild, discordId, statusEmoji);

  const user = await client.users.fetch(discordId).catch(() => null);
  if (user && currentStatus !== IM_STATUS.PROTECTED && currentStatus !== IM_STATUS.GRACE) {
    const ic = getInteractionConfig();
    const violatorThreshold = ic.violatorThreshold;
    const activeThreshold = ic.activeThreshold;

    let type;
    if (currentStatus === IM_STATUS.VIOLATOR || currentStatus === IM_STATUS.WARNED) type = 'violator';
    else if (currentStatus === IM_STATUS.INACTIVE) type = 'inactive';
    else type = 'active';

    await sendDM(user, type, dailyPoints, violatorThreshold, activeThreshold, guild);
  }

  result.member._lastInteractionStatus = currentStatus;
  await result.member.save().catch(e => console.error('[InteractionMonitor]', e?.message));

  return true;
}

/* ===================================================================
   إنشاء فترة سماح 24 ساعة + DM + Log
   =================================================================== */
export async function createGracePeriod(userId, reason, guild, client, relatedInfo) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + GRACE24H_MS);

  // حذف فترات السماح السابقة لضمان الحصول على فترة سماح كاملة تبدأ من الآن
  await Grace24h.deleteMany({ userId }).catch(e => console.error('Failed to clear old grace periods:', e));

  const grace = await Grace24h.create({ userId, expiresAt, reason, createdAt: now });
  await notifyGracePeriod(userId, reason, guild, client, relatedInfo);

  return grace;
}

async function notifyGracePeriod(userId, reason, guild, client, relatedInfo) {
  const user = await client?.users.fetch(userId).catch(() => null);
  const logChannelId = getInteractionConfig().channels.log;

  let dmText, logText, logColor;

  switch (reason) {
    case 'vacation_broken':
      dmText = `✅ تم كسر إجازتك. لديك 24 ساعة فترة سماح للتفاعل قبل احتساب نقاطك.\nالسبب: ${relatedInfo?.reason || ''}`;
      logText = `🕐 **فترة سماح 24 ساعة** — تم كسر إجازة <@${userId}>`;
      logColor = 0xFF9900;
      break;
    case 'vacation_ended':
      dmText = `✅ انتهت إجازتك. لديك 24 ساعة فترة سماح للتفاعل قبل احتساب نقاطك.`;
      logText = `🕐 **فترة سماح 24 ساعة** — انتهت إجازة <@${userId}> تلقائياً`;
      logColor = 0xFF9900;
      break;
    case 'excuse_broken':
      dmText = `✅ تم كسر عذرك. لديك 24 ساعة فترة سماح للتفاعل قبل احتساب نقاطك.\nالسبب: ${relatedInfo?.reason || ''}`;
      logText = `🕐 **فترة سماح 24 ساعة** — تم كسر عذر <@${userId}>${relatedInfo?.type ? ` (${relatedInfo.type})` : ''}`;
      logColor = 0xFF9900;
      break;
    case 'excuse_ended':
      dmText = `✅ انتهى عذرك. لديك 24 ساعة فترة سماح للتفاعل قبل احتساب نقاطك.`;
      logText = `🕐 **فترة سماح 24 ساعة** — انتهى عذر <@${userId}> تلقائياً`;
      logColor = 0xFF9900;
      break;
    case 'new_member':
      dmText = `🎉 مرحباً بك في العائلة! لديك 24 ساعة فترة سماح للتفاعل وجمع النقاط.`;
      logText = `🆕 **فترة سماح 24 ساعة** — عضو جديد: <@${userId}>`;
      logColor = 0x00FF00;
      break;
    default:
      dmText = `✅ لديك 24 ساعة فترة سماح للتفاعل.`;
      logText = `🕐 **فترة سماح 24 ساعة** — <@${userId}>`;
      logColor = 0xFF9900;
  }

  const graceFields = [
    { name: 'العضو', value: `<@${userId}> (${userId})`, inline: true },
    { name: 'تنتهي في', value: `<t:${Math.floor((Date.now() + GRACE24H_MS) / 1000)}:R>`, inline: true },
  ];
  if (relatedInfo?.reason) graceFields.push({ name: 'السبب', value: relatedInfo.reason, inline: false });
  if (relatedInfo?.by) graceFields.push({ name: 'بواسطة', value: relatedInfo.by, inline: true });
  const embed = embedWarning('🕐 فترة سماح 24 ساعة', logText, graceFields);

  if (user) {
    await dmUser(user, embed);
  }

  if (guild && logChannelId) {
    const logChan = guild.channels.cache.get(logChannelId) || await guild.channels.fetch(logChannelId).catch(() => null);
    if (logChan) await sendToChannel(logChan, embed);
  }
}

/* ===================================================================
   إرسال إشعار DM + تسجيل في اللوغ
   =================================================================== */
async function sendNotificationLog(guild, title, description, fields, embedType = 'info') {
  const channelId = getInteractionConfig().channels.log;
  if (!guild || !channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  const fn = { warning: embedWarning, success: embedSuccess, info: embedInfo, error: embedError }[embedType] || embedInfo;
  await sendToChannel(channel, fn(title, description, fields));
}

async function sendDM(user, type, points, violatorThreshold, activeThreshold, guild) {
  let embed, statusLabel, embedType;
  if (type === 'violator') {
    statusLabel = 'مخالف';
    embedType = 'error';
    embed = embedError('🔴 إنذار عدم تفاعل',
      `عزيزي ${user}،\n\nلم يتم تسجيل أي نقاط كافية لك خلال اليوم.\n\n**نقاطك اليوم:** ${points}\n**الحد الأدنى المطلوب:** ${violatorThreshold} نقطة\n\nأنت الآن في قائمة المخالفين. يرجى التفاعل فوراً لتجنب العقوبات.`,
      [
        { name: 'نقاط اليوم', value: `${points}`, inline: true },
        { name: 'الحد الأدنى', value: `${violatorThreshold}`, inline: true },
      ]);
  } else if (type === 'inactive') {
    statusLabel = 'خامل';
    embedType = 'warning';
    embed = embedWarning('🟡 تنبيه خمول',
      `عزيزي ${user}،\n\nنشاطك ضعيف اليوم.\n\n**نقاطك اليوم:** ${points}\n**الحد الأدنى للتفاعل الكامل:** ${activeThreshold} نقطة\n\nنرجو منك العودة للتفاعل مع العائلة.`,
      [
        { name: 'نقاط اليوم', value: `${points}`, inline: true },
        { name: 'الحد الأدنى', value: `${activeThreshold}`, inline: true },
      ]);
  } else if (type === 'active') {
    statusLabel = 'متفاعل';
    embedType = 'success';
    embed = embedSuccess('✅ أحسنت!',
      `عزيزي ${user}،\n\nنشكرك على تفاعلك المستمر! ❤️\n\n**نقاطك اليوم:** ${points}\n\nأنت الآن في قائمة المتفاعلين 🟢\n\nاستمر على هذا المستوى 👏`);
  }

  const ok = await dmUser(user, embed);
  const logFields = [
    { name: 'العضو', value: `${user.tag} (${user.id})`, inline: true },
    { name: 'الحالة', value: statusLabel, inline: true },
    { name: 'نقاط اليوم', value: `${points}`, inline: true },
  ];

  if (ok) {
    sendNotificationLog(guild, '📋 إشعار تفاعل', `تم إرسال إشعار **${statusLabel}** إلى ${user}`, logFields, embedType);
  } else {
    sendNotificationLog(guild, '⚠️ فشل إرسال إشعار تفاعل', `فشل إرسال إشعار **${statusLabel}** إلى ${user}`, logFields, 'error');
  }
  return ok;
}

/* ===================================================================
   تحديث ايموجي الروم
   =================================================================== */
export async function updateRoomEmoji(guild, discordId, emoji) {
  const member = await Member.findOne({ discordId });
  if (!member || !member.roomChannelId) return;
  const channel = guild.channels.cache.get(member.roomChannelId);
  if (!channel) return;

  if (!emoji) {
    const result = await quickClassify(discordId);
    emoji = result.emoji || '❌';
  }

  const oldPrefix = channel.name.match(/^(.+?)〢/)?.[1] || '';
  if (oldPrefix === emoji) return;

  const newName = channel.name.replace(/^.+?〢/, `${emoji}〢`);
  await channel.setName(newName).catch(e => console.error('[InteractionMonitor]', e?.message));
}

export async function updateAllRoomEmojis(guild) {
  if (!guild) return;
  const members = await Member.find({ isActive: true });

  for (const member of members) {
    await updateRoomEmoji(guild, member.discordId);
    await sleep(150);
  }
}

/* ===================================================================
   دوال للتحميل الجماعي (للتقرير و Webhook)
   =================================================================== */
export async function loadBatchData() {
  const ic = getInteractionConfig();
  const now = new Date();
  const graceDate = new Date(now.getTime() - ic.graceDays * 24 * 60 * 60 * 1000);

  const [members, activeVacations, activeExcuses, activeGracePeriods, recentPoints,
    newMembers, todayInactivityWarnings] = await Promise.all([
    Member.find({ isActive: true }),
    Vacation.find({ status: 'active', endDate: { $gte: now } }),
    Excuse.find({ isActive: { $ne: false }, type: { $ne: 'تغير اسم' }, endDate: { $gte: now } }),
    Grace24h.find({ expiresAt: { $gt: now } }),
    PointLog.aggregate([
      { $match: { createdAt: { $gte: getReviewWindowAgo() } } },
      { $group: { _id: '$discordId', total: { $sum: '$points' } } }
    ]),
    Member.find({ createdAt: { $gte: graceDate } }),
    Warning.find({ warningType: 'inactivity', status: 'active', removed: false }),
  ]);

  const pointsMap = new Map(recentPoints.map(p => [p._id, Math.max(0, p.total)]));
  const protectedIds = new Set([...activeVacations.map(v => v.memberId), ...activeExcuses.map(e => e.memberId)]);
  const graceIds = new Set(newMembers.map(m => m.discordId));
  const activeGraceIds = new Set(activeGracePeriods.map(g => g.userId));
  const warnedIds = new Set(todayInactivityWarnings.map(w => w.memberId));
  const violatorThreshold = ic.violatorThreshold;
  const activeThreshold = ic.activeThreshold;

  return { members, pointsMap, protectedIds, graceIds, activeGraceIds, warnedIds, violatorThreshold, activeThreshold, inactiveThreshold: activeThreshold };
}

export async function getInteractionData() {
  const data = await loadBatchData();

  let active = 0, inactive = 0, violator = 0, violatorWarned = 0, protected_ = 0, grace = 0;

  for (const m of data.members) {
    if (data.protectedIds.has(m.discordId)) { protected_++; continue; }
    if (data.graceIds.has(m.discordId) || data.activeGraceIds.has(m.discordId)) { grace++; continue; }
    const pts = data.pointsMap.get(m.discordId) ?? 0;
    if (pts < data.violatorThreshold) {
      if (data.warnedIds.has(m.discordId)) violatorWarned++;
      else violator++;
    } else if (pts < (data.inactiveThreshold || data.activeThreshold)) inactive++;
    else active++;
  }

  const total = data.members.length;
  return { total, active, inactive, violator, violatorWarned, protected: protected_, grace };
}

/* ===================================================================
   المهام المجدولة
   =================================================================== */
export function startInteractionChecker(client) {
  // تشغيل النظام الجديد (تصنيف ليلي + فحص ساعي)
  startDailyClassification(client);

  // تشغيل المجدول الأسبوعي لحساب إحصائيات المعايرة
  startWeeklyCalibration(client);

  // تهيئة _lastInteractionStatus للأعضاء ما عندهه
  import('./interactionManager.js').then(({ initializeInteractionStatus }) =>
    initializeInteractionStatus(client).catch(e => console.error('[Init]', e?.message))
  );

  console.log(`⏰ تم تفعيل مراجعة التفاعل (محاسبة كل ${getInteractionConfig().reviewWindowHours} ساعة)`);
}

async function checkAllMembers(client) {
  await processAllMembers(client);
}

export const STATUS = {
  ACTIVE: STATUS_EMOJI.ACTIVE_HIGH,
  INACTIVE: STATUS_EMOJI.INACTIVE,
  VIOLATOR: STATUS_EMOJI.VIOLATOR,
  WARNED: STATUS_EMOJI.WARNED,
  PROTECTED: STATUS_EMOJI.PROTECTED,
};
export { getIraqMidnight } from './interactionManager.js';
export { getInteractionConfig } from './interactionManager.js';
export { quickClassify, buildStatusReport, calculateRankProgress, buildCalibrationReport, buildCalibrationReportV2, buildFamilyAuditReport, auditInteractionThresholds, handlePunishmentButton, ensureDailyLog, getTodayLog } from './interactionManager.js';
export { getWeeklyTrends, computeWeeklyStats, startWeeklyCalibration } from './weeklyCalibration.js';
export { analyzeChurn, analyzeBreakpoints } from './churnAnalyzer.js';
