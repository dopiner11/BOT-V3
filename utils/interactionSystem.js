import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { schedule } from 'node-cron';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Member from '../models/Member.js';
import DailyLog from '../models/DailyLog.js';
import WeeklyStat from '../models/WeeklyStat.js';
import PointLog from '../models/PointLog.js';
import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';
import Grace24h from '../models/Grace24h.js';
import Warning from '../models/Warning.js';
import Attendance from '../models/Attendance.js';
import AttendanceLog from '../models/AttendanceLog.js';
import Ticket from '../models/Ticket.js';
import { logWarning, logFire, logForgive } from './logSystem.js';
import { getWeeklyTrends } from './weeklyCalibration.js';
import { analyzeChurn } from './churnAnalyzer.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo } from './embedStyles.js';
import { dmUser, sendToChannel } from './notificationSystem.js';
import { getDaysInRank } from './promotionManager.js';
import { startWeeklyCalibration } from './weeklyCalibration.js';

const __filename = fileURLToPath(import.meta.url);

/* ===================================================================
   Forgive modal context storage (بديل عن awaitModalSubmit)
   =================================================================== */
export const pendingForgives = new Map();
const __dirname = dirname(__filename);

/* ===================================================================
   Config cache (يقرأ من الديسك مرة كل دقيقة)
   =================================================================== */
let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 60000;

function loadConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < CONFIG_CACHE_TTL) {
    return _configCache;
  }
  try {
    const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    // دمج بيانات اللجان من Committees.json
    const committeeDataPath = join(__dirname, '../.data/Committees.json');
    try {
      const raw = readFileSync(committeeDataPath, 'utf8');
      const committeeList = JSON.parse(raw);
      if (committeeList && Object.keys(committeeList).length > 0) {
        config.committees = config.committees || {};
        const merged = {};
        for (const key of Object.keys(config.committees.list || {})) {
          merged[key] = { ...config.committees.list[key] };
        }
        for (const [key, data] of Object.entries(committeeList)) {
          if (merged[key]) {
            Object.assign(merged[key], data);
          } else {
            merged[key] = data;
          }
        }
        config.committees.list = merged;
      }
    } catch { /* Committees.json not found or parse error, use config.json only */ }
    _configCache = config;
    _configCacheTime = now;
  } catch {
    _configCache = _configCache || {};
  }
  return _configCache;
}

/* ===================================================================
   Interaction Config — يقرأ كل إعدادات التفاعل من config.json
   ويرجع object واحد بكل القيم (مسطحة). أي تغيير بالـ config
   يظهر تلقائياً لأن `loadConfig` تعيد قراءة كل 60 ثانية.
   =================================================================== */
export function getInteractionConfig() {
  const cfg = loadConfig();
  const im = cfg.interactionMonitor || {};

  // v() تفلتر { _label, value } → value
  // وتدعم القيم القديمة (بدون الغلاف) للتوافقية
  const v = (obj, fallback) => {
    if (obj === null || obj === undefined) return fallback;
    if (typeof obj === 'object' && 'value' in obj) return obj.value;
    return obj;
  };

  return {
    violatorThreshold: v(im.violatorThreshold, 100),
    inactiveThreshold: v(im.inactiveThreshold, 200),
    activeThreshold: v(im.activeThreshold, 200),
    graceDays: v(im.graceDays, 1),
    reviewWindowHours: v(im.reviewWindowHours, 24),
    analysisDays: v(im.analysisDays, 7),
    minActiveDays: v(im.minActiveDays, 3),
    maxWarnings: v(im.maxWarnings, 3),

    emoji: {
      active: v(im.emoji?.active, '🟢'),
      inactive: v(im.emoji?.inactive, '🟡'),
      violator: v(im.emoji?.violator, '🔴'),
      warned: v(im.emoji?.warned, '🟤'),
      protected: v(im.emoji?.protected, '⚫'),
      grace: v(im.emoji?.grace, '🆕'),
    },

    channels: {
      log: v(im.channels?.log, ''),
      alert: v(im.channels?.alert, ''),
      announcements: v(im.channels?.announcements, ''),
      decisions: v(im.channels?.decisions, ''),
    },

    notifications: {
      minIntervalHours: v(im.notifications?.minIntervalHours, 6),
      worseningCooldownMinutes: v(im.notifications?.worseningCooldownMinutes, 120),
      dmOnViolation: v(im.notifications?.dmOnViolation, true),
      dmOnInactive: v(im.notifications?.dmOnInactive, false),
    },

    streakMilestones: v(im.streakMilestones, [
      { days: 7, multiplier: 1.25, label: '×١.٢٥' },
      { days: 14, multiplier: 1.5, label: '×١.٥' },
      { days: 30, multiplier: 2.0, label: '×٢' },
    ]),
  };
}

/* ===================================================================
   الثوابت
   =================================================================== */
export const STATUS = {
  ACTIVE_HIGH: 'active_high',
  INACTIVE: 'inactive',
  VIOLATOR: 'violator',
  WARNED: 'warned',
  PROTECTED: 'protected',
  GRACE: 'grace',
};

export function getStatusEmoji(status) {
  const ic = getInteractionConfig();
  const emojiMap = {
    [STATUS.ACTIVE_HIGH]: ic.emoji.active,
    [STATUS.INACTIVE]: ic.emoji.inactive,
    [STATUS.VIOLATOR]: ic.emoji.violator,
    [STATUS.WARNED]: ic.emoji.warned,
    [STATUS.PROTECTED]: ic.emoji.protected,
    [STATUS.GRACE]: ic.emoji.grace,
  };
  return emojiMap[status] || '❌';
}

// Reverse mapping for Proxy: STATUS key name → STATUS enum value
const STATUS_KEY_MAP = {
  ACTIVE_HIGH: STATUS.ACTIVE_HIGH,
  INACTIVE: STATUS.INACTIVE,
  VIOLATOR: STATUS.VIOLATOR,
  WARNED: STATUS.WARNED,
  PROTECTED: STATUS.PROTECTED,
  GRACE: STATUS.GRACE,
};

// Legacy constant for backwards compatibility
export const STATUS_EMOJI = new Proxy({}, {
  get: (_, status) => {
    const resolved = STATUS_KEY_MAP[status] || status;
    return getStatusEmoji(resolved);
  },
});

// Lazy imports (cached after first call)
let _embedStyles = null;
let _notificationSystem = null;
let _reportsCommand = null;

async function getEmbedStyles() {
  if (!_embedStyles) _embedStyles = await import('./embedStyles.js');
  return _embedStyles;
}
async function getNotificationSystem() {
  if (!_notificationSystem) _notificationSystem = await import('./notificationSystem.js');
  return _notificationSystem;
}
async function getReportsCommand() {
  if (!_reportsCommand) _reportsCommand = await import('../commands/reports.js');
  return _reportsCommand;
}

const NOTIFICATION_TYPES = {
  STATUS_CHANGE: 'status_change',
  STREAK_MILESTONE: 'streak_milestone',
  STREAK_BROKEN: 'streak_broken',
  WARNING_ISSUED: 'warning_issued',
  AUTO_FIRE: 'auto_fire',
  IMPROVEMENT: 'improvement',
  ESCALATION: 'escalation',
};

function getStreakMilestones() {
  const ic = getInteractionConfig();
  if (Array.isArray(ic.streakMilestones) && ic.streakMilestones.length > 0) {
    return ic.streakMilestones.map(m => ({
      days: m.days,
      multiplier: m.multiplier ?? (m.points ? 1 + (m.points / 100) : 1),
      label: m.label || `×${m.multiplier ?? (m.points ? (1 + (m.points / 100)).toFixed(2) : 1)}`
    }));
  }
  return [
    { days: 7, multiplier: 1.25, label: '×١.٢٥' },
    { days: 14, multiplier: 1.5, label: '×١.٥' },
    { days: 30, multiplier: 2.0, label: '×٢' },
  ];
}

const STREAK_BONUS_DURATION_MS = 24 * 60 * 60 * 1000;

/* ===================================================================
   التوقيت
   =================================================================== */

export function getIraqMidnight() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Baghdad',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const h = parseInt(parts.find(p => p.type === 'hour').value);
  const m = parseInt(parts.find(p => p.type === 'minute').value);
  const s = parseInt(parts.find(p => p.type === 'second').value);
  const elapsed = (h * 3600 + m * 60 + s) * 1000;
  return new Date(now.getTime() - elapsed);
}

export function formatDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ===================================================================
   CDM السجلات اليومية
   =================================================================== */
export async function ensureDailyLog(discordId, date) {
  const dateStr = date || formatDate(new Date());
  let log = await DailyLog.findOne({ discordId, date: dateStr });
  if (!log) {
    log = new DailyLog({ discordId, date: dateStr, points: 0, status: STATUS.ACTIVE_HIGH, streakCount: 0, warningCount: 0, daysAsViolator: 0, multiplier: 1, multiplierExpiresAt: null, committeeMsgId: null, committeeChannelId: null });
    await log.save();
  }
  return log;
}

async function getRecentLogs(discordId, days) {
  const logs = await DailyLog.find({ discordId });
  return logs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, days);
}

export async function getTodayLog(discordId) {
  return ensureDailyLog(discordId);
}

/* ===================================================================
   التصنيف
   =================================================================== */
function classifyMember(points, isProtected, isGrace, hasWarning) {
  if (isProtected) return STATUS.PROTECTED;
  if (isGrace) return STATUS.GRACE;

  const ic = getInteractionConfig();

  if (points < ic.violatorThreshold) return hasWarning ? STATUS.WARNED : STATUS.VIOLATOR;
  if (points < ic.inactiveThreshold) return STATUS.INACTIVE;
  return STATUS.ACTIVE_HIGH;
}

/* ===================================================================
   نقاط اليوم من PointLog (Iraq Midnight)
   =================================================================== */
async function getTodayPoints(discordId) {
  const midnight = getIraqMidnight();
  const result = await PointLog.aggregate([
    { $match: { createdAt: { $gte: midnight }, discordId } },
    { $group: { _id: '$discordId', total: { $sum: '$points' } } },
  ]);
  return result.length > 0 ? Math.max(0, result[0].total) : 0;
}

/* ===================================================================
   حساب Streak
   =================================================================== */
async function calculateStreak(discordId, todayStatus) {
  const logs = await getRecentLogs(discordId, 60);
  if (logs.length === 0) return 0;

  const todayDate = formatDate(new Date());
  const todayIdx = logs.findIndex(l => l.date === todayDate);

  if (todayStatus === STATUS.PROTECTED || todayStatus === STATUS.GRACE) {
    if (todayIdx < logs.length - 1) return logs[todayIdx + 1].streakCount || 0;
    return 0;
  }

  if (todayStatus === STATUS.VIOLATOR || todayStatus === STATUS.WARNED || todayStatus === STATUS.INACTIVE) return 0;

  if (todayIdx >= 0 && logs[todayIdx].streakCount > 0) return logs[todayIdx].streakCount;

  let streak = 0;
  for (let i = 0; i < logs.length; i++) {
    const s = logs[i].status;
    if (s === STATUS.ACTIVE_HIGH) {
      streak++;
    } else if (s === STATUS.PROTECTED || s === STATUS.GRACE) {
      continue;
    } else {
      break;
    }
  }

  return streak;
}

function getStreakBonus(streakCount) {
  const STREAK_MILESTONES = getStreakMilestones();
  for (const m of STREAK_MILESTONES) {
    if (streakCount >= m.days) return m;
  }
  return null;
}

/* ===================================================================
   كولداون الـ DM
   =================================================================== */
async function canSendDM(discordId, type) {
  const today = await ensureDailyLog(discordId);
  const now = Date.now();

  const ic = getInteractionConfig();
  const minInterval = ic.notifications.minIntervalHours * 3600000;
  const worseningCd = ic.notifications.worseningCooldownMinutes * 60000;

  if (today.lastNotificationAt) {
    const elapsed = now - new Date(today.lastNotificationAt).getTime();

    if (type === NOTIFICATION_TYPES.STATUS_CHANGE) {
      if (elapsed < minInterval) return false;
    }
    if (type === NOTIFICATION_TYPES.IMPROVEMENT) {
      if (elapsed < minInterval) return false;
    }
    if (elapsed < worseningCd) return false;
  }

  return true;
}

async function markDMSent(discordId, type) {
  const today = await ensureDailyLog(discordId);
  today.lastNotificationAt = new Date().toISOString();
  today.notificationType = type;
  await today.save();
}

/* ===================================================================
   إرسال DM
   =================================================================== */
async function sendDM(user, content, embed) {
  try {
    if (embed) {
      await user.send({ embeds: [embed] });
    } else {
      await user.send({ content });
    }
    return true;
  } catch { return false; }
}

/* ===================================================================
   معالجة عضو واحد (التصنيف + Streak + حفظ)
   =================================================================== */
async function processMember(client, guild, discordId, preloadedPoints) {
  const config = loadConfig();
  const now = new Date();
  const todayDate = formatDate(now);

  const member = await Member.findOne({ discordId });
  if (!member) return null;

  const graceDate = new Date(Date.now() - getInteractionConfig().graceDays * 24 * 60 * 60 * 1000);
  const [activeVacations, activeExcuses, activeGrace24h, todayWarning, isNewMember] = await Promise.all([
    Vacation.find({ status: 'active', endDate: { $gte: now }, memberId: discordId }),
    Excuse.find({ isActive: { $ne: false }, type: { $ne: 'تغير اسم' }, endDate: { $gte: now }, memberId: discordId }),
    Grace24h.findOne({ userId: discordId, expiresAt: { $gt: now } }),
    Warning.findOne({ memberId: discordId, warningType: 'inactivity', status: 'active', removed: false }),
    Member.findOne({ discordId, createdAt: { $gte: graceDate } }),
  ]);

  const isProtected = activeVacations.length > 0 || activeExcuses.length > 0;
  const isGrace = !!activeGrace24h || !!isNewMember;
  const hasWarning = !!todayWarning;

  const points = preloadedPoints !== undefined ? preloadedPoints : await getTodayPoints(discordId);
  const status = classifyMember(points, isProtected, isGrace, hasWarning);

  const activeWarnings = await Warning.find({ memberId: discordId, removed: false });
  const warningCount = activeWarnings.length;

  // Streak
  const streakCount = await calculateStreak(discordId, status);
  const bonus = getStreakBonus(streakCount);
  const multiplier = bonus ? bonus.multiplier : 1;
  const multiplierExpiresAt = bonus ? new Date(Date.now() + STREAK_BONUS_DURATION_MS).toISOString() : null;

  // Days as violator (consecutive)
  const yesterdayDate = formatDate(new Date(Date.now() - 86400000));
  const yesterdayLog = await DailyLog.findOne({ discordId, date: yesterdayDate });
  let daysAsViolator = 0;
  if (status === STATUS.VIOLATOR || status === STATUS.WARNED) {
    daysAsViolator = (yesterdayLog?.daysAsViolator || 0) + 1;
  }

  // Save/update DailyLog for today
  let dailyLog = await DailyLog.findOne({ discordId, date: todayDate });
  if (!dailyLog) {
    dailyLog = new DailyLog({
      discordId, date: todayDate,
      points, status, streakCount, warningCount,
      daysAsViolator, multiplier,
      multiplierExpiresAt,
      lastNotificationAt: null, notificationType: null,
      committeeMsgId: null,
      committeeChannelId: null,
    });
  } else {
    dailyLog.points = points;
    dailyLog.status = status;
    dailyLog.streakCount = streakCount;
    dailyLog.warningCount = warningCount;
    dailyLog.daysAsViolator = daysAsViolator;
    dailyLog.multiplier = multiplier;
    dailyLog.multiplierExpiresAt = multiplierExpiresAt;
  }
  await dailyLog.save();

  // Check Streak milestone
  if (streakCount > 0 && bonus) {
    const prevBonus = getStreakBonus(streakCount - 1);
    if (!prevBonus || prevBonus.days !== bonus.days) {
      const user = await client.users.fetch(discordId).catch(() => null);
      if (user && await canSendDM(discordId, NOTIFICATION_TYPES.STREAK_MILESTONE)) {
        await markDMSent(discordId, NOTIFICATION_TYPES.STREAK_MILESTONE);
        await sendDM(user,
          `🎉 **مبروك!** وصلت ${bonus.days} يوم Streak!\n` +
          `نقاطك مضاعفة ${bonus.label} لمدة ٢٤ ساعة.\n` +
          `استمر للوصول للمستوى التالي!`
        );
      }
    }
  }

  return {
    member, dailyLog, status, points, streakCount, multiplier, warningCount, daysAsViolator,
    isProtected, isGrace, hasWarning,
  };
}

/* ===================================================================
   تهيئة _lastInteractionStatus لجميع الأعضاء (مرة واحدة عند بدء التشغيل)
   =================================================================== */
export async function initializeInteractionStatus(client) {
  const config = loadConfig();
  const guild = client.guilds.cache.get(config.bot?.guildId);
  if (!guild) return;
  const members = await Member.find({ isActive: true, _lastInteractionStatus: { $exists: false } });
  if (members.length === 0) return;
  let count = 0;
  for (const m of members) {
    try {
      await assessMemberStatus(client, guild, m.discordId, { silentInit: true });

      count++;
    } catch (e) {
      console.error(`[Init] Error for ${m.discordId}:`, e?.message);
    }
  }
  console.log(`[InteractionManager] ✅ تم تهيئة _lastInteractionStatus لـ ${count} عضو`);
}

/* ===================================================================
   معالجة جميع الأعضاء (التصنيف الليلي)
   =================================================================== */
export async function processAllMembers(client) {
  const config = loadConfig();
  const guild = client.guilds.cache.get(config.bot?.guildId);
  if (!guild) return console.error('[InteractionManager] ❌ Guild not found');

  const members = await Member.find({ isActive: true });
  let processed = 0;
  const statusCounts = {};

  for (const m of members) {
    try {
      const result = await processMember(client, guild, m.discordId);
      if (result) {
        statusCounts[result.status] = (statusCounts[result.status] || 0) + 1;
        processed++;
        const emoji = getStatusEmoji(result.status);
        m._lastInteractionStatus = result.status;
        await m.save().catch(() => {});
        await updateRoomEmoji(guild, m.discordId, emoji).catch(() => {});
      }

    } catch (e) {
      console.error(`[InteractionManager] Error processing ${m.discordId}:`, e?.message);
    }
  }

  console.log(`[InteractionManager] ✅ ${processed} عضو مصنف`, statusCounts);

  // Auto-escalation check after classification (fire only)
  await checkAllEscalations(client, guild);

  // بناء قائمة الإنذارات للمخالفين المتبقين (غير الجاهزين للفصل)
  try {
    const { buildWarningQueue, sendQueueMessage } = await import('./punishmentQueue.js');
    const items = await buildWarningQueue(guild, client);
    if (items.length > 0) {
      await sendQueueMessage(guild, items);
    }
  } catch (e) {
    console.error('[InteractionSystem] Queue build error:', e?.message);
  }

  const reportsCmd = await getReportsCommand();
  reportsCmd.scheduleReportsDashboardUpdate(client, 3000);

  return { processed, statusCounts };
}

/* ===================================================================
   التصعيد التلقائي (Auto-Escalation)
   =================================================================== */
async function checkAllEscalations(client, guild) {
  const config = loadConfig();
  const now = new Date();
  const todayDate = formatDate(now);
  const alertChannelId = getInteractionConfig().channels.alert || config.points?.channels?.staffReview?.id || config.logChannels?.warning?.id;

  const violators = await DailyLog.find({ date: todayDate, status: { $in: [STATUS.VIOLATOR, STATUS.WARNED] } });

  for (const log of violators) {
    try {
      const memberData = await Member.findOne({ discordId: log.discordId });
      if (!memberData || !memberData.isActive) continue;

      const user = await client.users.fetch(log.discordId).catch(() => null);

      if (log.daysAsViolator === 1 && user && await canSendDM(log.discordId, NOTIFICATION_TYPES.ESCALATION)) {
        await markDMSent(log.discordId, NOTIFICATION_TYPES.ESCALATION);
        await sendDM(user, `⚠️ **أنت الآن مصنف مخالف بعدم التفاعل.**\nإذا لم تتفاعل غداً، سيتم رفعك للجنة العقوبات وقد تصل الأمور إلى الإنذار والفصل.\n\n🎫 افتح تذكرة في حال كان عندك عذر.`);
      }

      if (log.daysAsViolator >= 1) {
        await ensurePunishmentNotification(client, guild, log, memberData, alertChannelId);
      }
    } catch (e) {
      console.error(`[Escalation] Error ${log.discordId}:`, e?.message);
    }
  }

  // Check for improved members → remove old notifications
  if (alertChannelId) {
    const improvedLogs = await DailyLog.find({
      date: todayDate,
      status: { $in: [STATUS.ACTIVE_HIGH, STATUS.INACTIVE] },
      committeeMsgId: { $ne: null },
    });
    for (const log of improvedLogs) {
      await clearPunishmentNotification(guild, log);
    }
  }
}

export async function ensurePunishmentNotification(client, guild, dailyLog, member, channelId) {
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  const config = loadConfig();

  const user = await client.users.fetch(dailyLog.discordId).catch(() => null);

  const inactivityWarnings = await Warning.find({ memberId: dailyLog.discordId, warningType: 'inactivity', status: 'active', removed: false });
  const inactivityCount = inactivityWarnings.length;
  const maxWarnings = getInteractionConfig().maxWarnings;
  const isFireReady = inactivityCount >= maxWarnings;

  // إذا العضو غير جاهز للفصل — لا نرسل إشعار فردي (يدخل القائمة بدلاً منه)
  if (!isFireReady) return;

  const [{ error: embedError }, { sendToChannel }] = await Promise.all([getEmbedStyles(), getNotificationSystem()]);
  const embed = embedError(
    '⛔ عضو جاهز للفصل',
    null,
    [
      { name: 'العضو', value: `${user || dailyLog.discordId} (${dailyLog.discordId})`, inline: false },
      { name: 'التصنيف', value: `${dailyLog.status}`, inline: true },
      { name: 'نقاط اليوم', value: `${dailyLog.points || 0}`, inline: true },
      { name: 'أيام المخالفة', value: `${dailyLog.daysAsViolator}`, inline: true },
      { name: 'إنذارات عدم تفاعل', value: `${inactivityCount}/${maxWarnings}`, inline: true },
    ]
  ).setThumbnail(user?.displayAvatarURL({ dynamic: true }) || null);

  const fireBtn = new ButtonBuilder()
    .setCustomId(`punish_fire_${dailyLog.discordId}`)
    .setLabel('❌ فصل')
    .setStyle(ButtonStyle.Danger);

  const forgiveBtn = new ButtonBuilder()
    .setCustomId(`punish_forgive_${dailyLog.discordId}`)
    .setLabel('🤝 تسامح / عدم عقوبة')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(fireBtn, forgiveBtn);

  if (dailyLog.committeeMsgId) {
    try {
      const oldMsg = await channel.messages.fetch(dailyLog.committeeMsgId).catch(() => null);
      if (oldMsg) {
        await oldMsg.edit({ embeds: [embed], components: [row] });
        return;
      }
    } catch { }
  }

  const msg = await channel.send({
    content: `<@&${config.roles?.admin?.id || ''}> عضو جاهز للفصل`,
    embeds: [embed],
    components: [row],
  }).catch(() => null);

  if (msg) {
    dailyLog.committeeMsgId = msg.id;
    dailyLog.committeeChannelId = channelId;
    await dailyLog.save();
  }
}

async function clearPunishmentNotification(guild, dailyLog) {
  if (!dailyLog.committeeMsgId || !dailyLog.committeeChannelId) return;
  const channel = guild.channels.cache.get(dailyLog.committeeChannelId) || await guild.channels.fetch(dailyLog.committeeChannelId).catch(() => null);
  if (!channel) return;
  try {
    const msg = await channel.messages.fetch(dailyLog.committeeMsgId).catch(() => null);
    if (msg) {
      await msg.edit({
        content: '~~' + (msg.content || '') + '~~',
        embeds: [],
        components: [],
      }).catch(() => {});
    }
  } catch { }

  dailyLog.committeeMsgId = null;
  dailyLog.committeeChannelId = null;
  await dailyLog.save();
}

/* ===================================================================
   معالجة أزرار العقوبات
   =================================================================== */
export async function handlePunishmentButton(interaction) {
  const { customId, guild, member: executor } = interaction;
  if (!customId.startsWith('punish_warn_') && !customId.startsWith('punish_fire_') && !customId.startsWith('punish_forgive_')) return false;

  const config = loadConfig();

  // Check permission (only punishment committee / presidency / founders)
  const presidency = config.committees?.list?.family_presidency;
  const allowedRoles = [
    ...(config.committees?.list?.punishment?.roles?.manager || []),
    ...(config.committees?.list?.punishment?.roles?.deputy || []),
    ...(config.committees?.list?.punishment?.roles?.member || []),
    ...(presidency?.roles?.manager || []),
    ...(presidency?.roles?.deputy || []),
    ...(presidency?.roles?.member || []),
    ...(config.committees?.founders || []),
  ];

  const hasPerm = allowedRoles.some(rid => rid === executor.id || executor.roles?.cache?.has(rid));
  if (!hasPerm) {
    return interaction.reply({ content: '❌ فقط لجنة العقوبات والرئاسة تملك الصلاحية.', flags: 64 });
  }

  const action = customId.startsWith('punish_warn_') ? 'warn' : customId.startsWith('punish_fire_') ? 'fire' : 'forgive';
  const discordId = customId.replace(/^punish_(warn|fire|forgive)_/, '');

  // احفظ مرجع الرسالة الأصلية
  const originalMessage = interaction.message;

  try {
    if (action === 'forgive') {
      await executePunishForgive(interaction, discordId, originalMessage);
    } else {
      await interaction.deferReply({ flags: 64 });
      if (action === 'warn') {
        await executePunishWarning(interaction, discordId, originalMessage);
      } else {
        await executePunishFire(interaction, discordId, originalMessage);
      }
    }
  } catch (error) {
    console.error(`[Punishment] ${action} error:`, error);
    if (action === 'forgive') {
      interaction.followUp({ content: `❌ حدث خطأ: ${error.message}`, flags: 64 }).catch(() => {});
    } else {
      await interaction.editReply({ content: `❌ حدث خطأ: ${error.message}` });
    }
  }

  return true;
}

async function executePunishForgive(interaction, discordId, originalMessage = null) {
  const member = await Member.findOne({ discordId });
  if (!member || !member.isActive) {
    return interaction.reply({ content: '❌ العضو غير موجود أو غير نشط.', flags: 64 });
  }

  const modalCustomId = `forgive_reason_${discordId}_${Date.now()}`;
  const modal = new ModalBuilder()
    .setCustomId(modalCustomId)
    .setTitle('🤝 سبب التسامح');

  const reasonInput = new TextInputBuilder()
    .setCustomId('forgive_reason')
    .setLabel('السبب')
    .setPlaceholder('اذكر سبب إلغاء العقوبة...')
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(10)
    .setMaxLength(500)
    .setRequired(true);

  const actionRow = new ActionRowBuilder().addComponents(reasonInput);
  modal.addComponents(actionRow);

  // خزّن السياق للمعالج الرئيسي
  pendingForgives.set(modalCustomId, { discordId, originalMessage, executorId: interaction.user.id, guildId: interaction.guild.id });

  // نظّف بعد 5 دقائق
  setTimeout(() => pendingForgives.delete(modalCustomId), 300000);

  if (typeof interaction.showModal !== 'function') {
    console.error('[Forgive] interaction type missing showModal:', interaction.constructor?.name);
    return interaction.reply({ content: '❌ لا يمكن فتح النموذج، تفاعل غير متوقع.', flags: 64 });
  }

  await interaction.showModal(modal).catch(e => {
    console.error('[Forgive] showModal failed:', e?.message);
  });
}

export async function handlePunishForgiveModal(interaction) {
  const customId = interaction.customId;
  const ctx = pendingForgives.get(customId);
  if (!ctx) {
    return interaction.reply({ content: '❌ انتهت صلاحية الجلسة. يرجى إعادة المحاولة.', flags: 64 });
  }
  pendingForgives.delete(customId);

  const { discordId, originalMessage, executorId, guildId } = ctx;

  // تحقق من أن المستخدم نفسه هو من فتح المودال
  if (interaction.user.id !== executorId) {
    return interaction.reply({ content: '❌ فقط من فتح النموذج يمكنه إكمال التسامح.', flags: 64 });
  }

  const reason = interaction.fields.getTextInputValue('forgive_reason');
  await interaction.deferReply({ flags: 64 });

  try {
    const todayDate = formatDate(new Date());
    const dailyLog = await DailyLog.findOne({ discordId, date: todayDate });

    if (dailyLog) {
      dailyLog.forgiven = true;
      dailyLog.forgivenBy = executorId;
      dailyLog.forgivenReason = reason;
      dailyLog.forgivenAt = new Date();
      dailyLog.daysAsViolator = 0;
      await dailyLog.save();
    }

    const warningCount = await Warning.countDocuments({ memberId: discordId, warningType: 'inactivity', status: 'active', removed: false });
    await logForgive(interaction.guild, {
      target: `<@${discordId}>`,
      mod: `<@${executorId}>`,
      reason,
      warningCount,
      totalWarnings: 3,
    }).catch(e => console.error('[Forgive] log error:', e));

    const result = await quickClassify(discordId);
    if (result && result.emoji) {
      await updateRoomEmoji(interaction.guild, discordId, result.emoji).catch(() => {});
    }

    if (originalMessage) {
      const updatedEmbed = embedSuccess('✅ تم التسامح', null, [
        { name: '👤 العضو', value: `<@${discordId}>`, inline: false },
        { name: '🤝 سبب التسامح', value: reason, inline: false },
        { name: '👮 بواسطة', value: `<@${executorId}>`, inline: true },
        { name: '🕐 الوقت', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
      ]);

      await originalMessage.edit({ content: '', embeds: [updatedEmbed], components: [] }).catch(e => console.error('[Forgive] edit msg:', e.message));
    }

    await interaction.editReply({ content: `✅ تم التسامح مع <@${discordId}> - السبب: ${reason}` });
  } catch (error) {
    console.error('[Forgive] error:', error);
    await interaction.editReply({ content: `❌ حدث خطأ: ${error.message}` });
  }
}

async function executePunishWarning(interaction, discordId, originalMessage = null) {
  const member = await Member.findOne({ discordId });
  if (!member || !member.isActive) {
    return interaction.editReply({ content: '❌ العضو غير موجود أو غير نشط.' });
  }

  // Check: فقط إنذارات عدم تفعيل تحسب للحد الأعلى
  const activeInactivityWarnings = await Warning.find({ memberId: discordId, warningType: 'inactivity', status: 'active', removed: false });
  if (activeInactivityWarnings.length >= getInteractionConfig().maxWarnings) {
    return interaction.editReply({ content: `❌ العضو وصل ${getInteractionConfig().maxWarnings} إنذارات عدم تفعيل — استخدم زر الفصل بدلاً من ذلك.` });
  }

  const warning = new Warning({
    memberId: discordId,
    memberName: interaction.user.tag,
    warningType: 'inactivity',
    typeName: 'عدم تفاعل',
    reason: 'عدم تفاعل مستمر (إنذار من لجنة العقوبات)',
    givenBy: interaction.user.id,
    givenByName: interaction.user.tag,
    status: 'active',
    removed: false,
  });
  await warning.save();

  const warningNum = activeInactivityWarnings.length + 1;

  // إضافة رتبة التحذير في ديسكورد
  const config = loadConfig();
  const targetMember = await interaction.guild.members.fetch(discordId).catch(() => null);
  if (targetMember) {
    let warningRoleId = config.warnings?.roles?.[warningNum.toString()];
    const actualRoleId = warningRoleId?.id || warningRoleId;
    if (actualRoleId) {
      await targetMember.roles.add(actualRoleId).catch(e => console.error('Failed to add warning role:', e));
    }
  }

  // إرسال القرار إلى قناة القرارات
  const decisionChannelId = config.warnings?.channels?.warningDecision?.id || getInteractionConfig().channels.decisions;
  const decisionChannel = decisionChannelId ? (interaction.guild.channels.cache.get(decisionChannelId) || await interaction.guild.channels.fetch(decisionChannelId).catch(() => null)) : null;
  const basicRoleId = config.roles?.basic?.id || '';
  const WARN_GIF = 'https://media.discordapp.net/attachments/1391704768660901919/1453017759565746197/934_x_175_.gif?ex=6979677d&is=697815fd&hm=25cad4a05c4c0a463592f296df1c220c508c3093b37c177bc0b332df019ded5a=&width=1553&height=291';
  if (decisionChannel) {
    const numArabic = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس'][activeInactivityWarnings.length] || `${warningNum}`;
    await decisionChannel.send({ content: WARN_GIF }).catch(e => console.error('[Warn] GIF send failed:', e?.message));
    const decision = `
▬▬▬ ﷽ ▬▬▬
<:Family:1516647836744417320> **قرار إداري صادر من قيادة العائلة** 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 

**لكلاً من :**  
- <@${discordId}>

**السبب :**  || عدم تفاعل مستمر ||

> • **بإعطاء تحذير (${numArabic})**
> || نوع التحذير: نقص تفاعل ||

-# ملاحظة : عند بلوغ 3 تحذيرات سيتم اتخاذ إجراء الفصل التلقائي.
**تــوقــيــع مسؤول القرار ✍:** ${interaction.user}

||<@&${basicRoleId}>||
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`.trim();
    await decisionChannel.send({ content: decision }).catch(() => {});
  }

  await updateDailyLogWarningCount(discordId);
  await logWarning(interaction.guild, {
    target: `<@${discordId}>`,
    mod: `<@${interaction.user.id}>`,
    reason: 'عدم تفاعل مستمر',
    warningCount: warningNum,
    totalWarnings: 3,
  });

  const user = await interaction.client.users.fetch(discordId).catch(() => null);
  if (user) {
    const remaining = 3 - warningNum;
    let msg = `🟤 **تم تسجيل إنذار بعدم التفاعل.**\nمعك الآن ${warningNum} من ٣ إنذارات.\n`;
    if (remaining > 0) {
      msg += `عند وصول ٣ إنذارات يصير العضو جاهزاً للفصل.\n🎫 توجه للتذاكر إذا كان عندك عذر.`;
    } else {
      msg += `⚠️ وصلت ٣ إنذارات — اللجنة مخولة بفصلك.`;
    }
    await sendDM(user, msg);
  }

  // تحديث ايموجي الروم فوراً لـ 🟤 (تم إنذاره)
  await Member.findOneAndUpdate(
    { discordId },
    { $set: { violatorWarningSentAt: new Date() } }
  );
  try {
    await updateRoomEmoji(interaction.guild, discordId, getStatusEmoji(STATUS.WARNED));
  } catch (err) {
    console.error('Failed to update room emoji:', err);
  }

  // تحديث لوحة التقارير (مع debounce — 3 ثواني)
  try {
    const reportsCmd = await getReportsCommand();
    reportsCmd.scheduleReportsDashboardUpdate(interaction.client, 3000);
  } catch (err) {
    console.error('Failed to schedule reports dashboard update:', err);
  }

  // تحديث رسالة لجنة العقوبات الأصلية وإزالة الأزرار
  try {
    const msgToEdit = originalMessage || interaction.message;
    const oldEmbed = msgToEdit?.embeds?.[0];
    if (msgToEdit && oldEmbed) {
      const updatedEmbed = EmbedBuilder.from(oldEmbed)
        .setColor(0xE67E22)
        .setTitle('⚠️ تم تنفيذ الإنذار')
        .addFields({
          name: '📋 القرار',
          value: `تم إعطاء **إنذار (${warningNum}/3)** لـ <@${discordId}>\nبواسطة: <@${interaction.user.id}>\nالوقت: <t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: false
        });

      await msgToEdit.edit({
        content: '',
        embeds: [updatedEmbed],
        components: []
      }).catch(e => console.error('[Punishment] edit warning msg:', e.message));
    }
  } catch (err) {
    console.error('Failed to edit original message in executePunishWarning:', err);
  }

  await interaction.editReply({ content: `✅ تم إعطاء إنذار عدم تفاعل لـ <@${discordId}> (${warningNum}/3)` });

  // Update the committee notification
  const todayDate = formatDate(new Date());
  const dailyLog = await DailyLog.findOne({ discordId, date: todayDate });
  if (dailyLog) {
    dailyLog.warningCount = warningNum;
    await dailyLog.save();
  }
}

async function executePunishFire(interaction, discordId, originalMessage = null) {
  const member = await Member.findOne({ discordId });
  if (!member || !member.isActive) {
    return interaction.editReply({ content: '❌ العضو غير موجود أو غير نشط.' });
  }

  // Check: لازم عنده ٣ إنذارات عدم تفعيل نشطة
  const activeInactivityWarnings = await Warning.find({ memberId: discordId, warningType: 'inactivity', status: 'active', removed: false });
  if (activeInactivityWarnings.length < getInteractionConfig().maxWarnings) {
    return interaction.editReply({ content: `❌ العضو عنده ${activeInactivityWarnings.length} إنذارات عدم تفعيل فقط. يحتاج ${getInteractionConfig().maxWarnings} للفصل.` });
  }

  // Fire: remove roles, set inactive, etc.
  const guild = interaction.guild;
  const config = loadConfig();

  const discordMember = await guild.members.fetch(discordId).catch(() => null);
  const user = await interaction.client.users.fetch(discordId).catch(() => null);

  const memberBefore = await Member.findOne({ discordId });
  const oldPoints = memberBefore?.points || 0;
  const oldRank = memberBefore?.currentRank || 'غير معروف';

  // إحصائيات وإزالة التحذيرات
  const allActiveWarnings = await Warning.find({ memberId: discordId, removed: false, status: 'active' });
  const warningsCount = allActiveWarnings.length;
  await Warning.removeAllActiveWarnings(discordId, 'فصل - عدم تفاعل مستمر (٣ إنذارات عدم تفعيل)', interaction.user.id, interaction.user.tag);

  // كسر الإجازات الفعالة
  const activeVacations = await Vacation.find({ memberId: discordId, status: 'active' });
  const vacationsBroken = activeVacations.length;
  if (vacationsBroken > 0) {
    await Vacation.updateMany(
      { memberId: discordId, status: 'active' },
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: interaction.user.id, cancelledByName: interaction.user.tag, cancellationReason: `فصل: عدم تفاعل مستمر` } }
    );
  }

  // إلغاء الأعذار النشطة
  const activeExcuses = await Excuse.find({ memberId: discordId, isActive: true });
  const excusesCancelled = activeExcuses.length;
  if (excusesCancelled > 0) {
    await Excuse.updateMany(
      { memberId: discordId, isActive: true },
      { $set: { isActive: false, cancelledBy: interaction.user.id, cancelledAt: new Date(), cancellationReason: `فصل: عدم تفاعل مستمر` } }
    );
  }

  // نشر القرار في قناة الإعلانات أولاً (قبل الطرد عشان الـ mention يشتغل)
  const annChannelId = config.general?.channels?.announcements?.id || getInteractionConfig().channels.announcements;
  const annChannel = annChannelId ? (guild.channels.cache.get(annChannelId) || await guild.channels.fetch(annChannelId).catch(() => null)) : null;
  if (annChannel) {
    await annChannel.send({ content: 'https://media.discordapp.net/attachments/1391704768660901919/1453017755392671899/934_x_175_.gif' }).catch(() => {});

    let extraInfo = '';
    if (warningsCount > 0) extraInfo += `\n**تم إزالة ${warningsCount} تحذير(ات).**`;
    if (vacationsBroken > 0) extraInfo += `\n**تم كسر ${vacationsBroken} إجازة.**`;
    if (excusesCancelled > 0) extraInfo += `\n**تم إلغاء ${excusesCancelled} عذر.**`;

    const decision = `
****قرار صادر من قيادة 𓆩 <:Family:1516647836744417320> 𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪****

**بعد الاطلاع على ملف العضو وإيقافه عن العمل قررنا الآتي:**

**فصل للمدعو/ين:**
- <@${discordId}>

**السبب:** عدم تفاعل مستمر (٣ إنذارات عدم تفعيل)
${extraInfo}

**امضاء محرر القرار:** ${interaction.user}
**امضاء لجنة العقوبات:** <@&1398212916389478442>

**▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬**`.trim();
    await annChannel.send({ content: decision }).catch(() => {});
  }

  // بعد القرار — إزالة الرتب وحذف الروم (الـ mention اشتغل خلاص)
  try {
    if (discordMember) {
      const rolesToRemove = [];
      if (config.promotion?.ranks) {
        config.promotion.ranks.forEach(r => {
          if (discordMember.roles.cache.has(r.roleId)) rolesToRemove.push(r.roleId);
        });
      }
      if (config.roles?.jobRoles) {
        Object.values(config.roles.jobRoles).forEach(r => {
          if (discordMember.roles.cache.has(r.id)) rolesToRemove.push(r.id);
        });
      }
      if (config.roles?.basic?.id && discordMember.roles.cache.has(config.roles.basic.id)) {
        rolesToRemove.push(config.roles.basic.id);
      }
      const uniqueRoles = [...new Set(rolesToRemove)];
      if (uniqueRoles.length > 0) {
        await discordMember.roles.remove(uniqueRoles, 'فصل - وصول ٣ إنذارات عدم تفعيل').catch(() => {});
      }

      // حذف الروم
      const channelId = member?.roomChannelId;
      if (channelId) {
        const roomChannel = await guild.channels.fetch(channelId).catch(() => null);
        if (roomChannel && roomChannel.deletable) await roomChannel.delete().catch(() => {});
      }
    }
  } catch (e) {
    console.error('Failed to remove roles/room on fire:', e);
  }

  // حذف جلسات الحضور والملفات المرتبطة
  await Promise.all([
    Attendance.deleteMany({ userId: discordId }),
    AttendanceLog.deleteMany({ userId: discordId }),
    Ticket.deleteMany({ userId: discordId }),
    Ticket.deleteMany({ creatorId: discordId }),
  ]).catch(e => console.error('Failed to delete attendance/tickets on fire:', e));

  member.lastActiveRank = member.currentRank || 'غير معروف';
  member.isActive = false;
  member.points = 0;
  member.currentRank = 'مفصول';
  member.firedAt = new Date();
  member.firedBy = interaction.user.id;
  member._lastInteractionStatus = null;
  await member.save();

  await logFire(interaction.guild, {
    target: `<@${discordId}>`,
    mod: `<@${interaction.user.id}>`,
    reason: '٣ إنذارات عدم تفعيل',
    totalWarnings: warningsCount,
    totalPoints: oldPoints,
    vacationsBroken,
    excusesCancelled,
  });

  // إرسال DM للمستخدم
  if (user) {
    let dmDesc = `لقد تم اتخاذ قرار بفصلك من عائلة X.IRAQ.\n\n**السبب:** عدم تفاعل مستمر (٣ إنذارات عدم تفعيل)`;
    if (warningsCount > 0) dmDesc += `\n\n**📝 تم إزالة ${warningsCount} تحذير(ات) من سجلك بسبب الفصل.**`;
    if (vacationsBroken > 0) dmDesc += `\n**🏖️ تم كسر ${vacationsBroken} إجازة.**`;
    if (excusesCancelled > 0) dmDesc += `\n**📋 تم إلغاء ${excusesCancelled} عذر.**`;
    
    const dmEmbed = embedError('🚫 تم فصلك من العائلة', dmDesc);
    await sendDM(user, null, dmEmbed);
  }

  // تحديث ايموجي الروم
  try {
    await updateRoomEmoji(guild, discordId);
  } catch (err) {
    console.error('Failed to update room emoji:', err);
  }

  // تحديث لوحة التقارير (مع debounce — 3 ثواني)
  try {
    const reportsCmd = await getReportsCommand();
    reportsCmd.scheduleReportsDashboardUpdate(interaction.client, 3000);
  } catch (err) {
    console.error('Failed to schedule reports dashboard update:', err);
  }

  // Update committee notification
  const todayDate = formatDate(new Date());
  const dailyLog = await DailyLog.findOne({ discordId, date: todayDate });
  if (dailyLog && dailyLog.committeeMsgId) {
    try {
      const channel = guild.channels.cache.get(dailyLog.committeeChannelId);
      if (channel) {
        const msg = await channel.messages.fetch(dailyLog.committeeMsgId).catch(() => null);
        if (msg) {
          await msg.edit({
            content: `✅ تم فصل <@${discordId}> (٣ إنذارات عدم تفعيل)`,
            embeds: [],
            components: [],
          }).catch(() => {});
        }
      }
    } catch { }
  }

  if (dailyLog) {
    dailyLog.committeeMsgId = null;
    dailyLog.committeeChannelId = null;
    await dailyLog.save();
  }

  // تحديث رسالة لجنة العقوبات الأصلية وإزالة الأزرار
  try {
    const msgToEdit = originalMessage || interaction.message;
    const oldEmbed = msgToEdit?.embeds?.[0];
    if (msgToEdit && oldEmbed) {
      const updatedEmbed = EmbedBuilder.from(oldEmbed)
        .setColor(0xFF0000)
        .setTitle('🚫 تم تنفيذ الفصل')
        .addFields({
          name: '📋 القرار',
          value: `تم **فصل** <@${discordId}> من العائلة\nبواسطة: <@${interaction.user.id}>\nالوقت: <t:${Math.floor(Date.now() / 1000)}:R>`,
          inline: false
        });

      await msgToEdit.edit({
        content: '',
        embeds: [updatedEmbed],
        components: []
      }).catch(e => console.error('[Punishment] edit fire msg:', e.message));
    }
  } catch (err) {
    console.error('Failed to edit original message in executePunishFire:', err);
  }

  await interaction.editReply({ content: `✅ تم فصل العضو <@${discordId}> بنجاح ونشر القرار.` });
}

async function updateDailyLogWarningCount(discordId) {
  const todayDate = formatDate(new Date());
  const log = await DailyLog.findOne({ discordId, date: todayDate });
  if (log) {
    const warnings = await Warning.find({ memberId: discordId, removed: false });
    log.warningCount = warnings.length;
    await log.save();
  }
}

/* ===================================================================
   تقرير الحالة (للوحة)
   =================================================================== */
export async function buildStatusReport(client) {
  const config = loadConfig();
  const todayDate = formatDate(new Date());
  const logs = await DailyLog.find({ date: todayDate });

  const counts = { active_high: 0, inactive: 0, violator: 0, warned: 0, protected: 0, grace: 0 };
  const tracked = { violator: [], warned: [], inactive: [] };

  for (const log of logs) {
    const member = await Member.findOne({ discordId: log.discordId });
    if (!member || !member.isActive) continue;

    if (counts[log.status] !== undefined) counts[log.status]++;

    if (['violator', 'warned', 'inactive'].includes(log.status)) {
      tracked[log.status].push({
        discordId: log.discordId,
        points: log.points || 0,
        warningCount: log.warningCount || 0,
        daysAsViolator: log.daysAsViolator || 0,
      });
    }
  }

  return { counts, tracked };
}

/* ===================================================================
   مصدر async يعمل في buildStatusReport (للـ client)
   =================================================================== */
let _clientRef = null;
export function setClientRef(client) { _clientRef = client; }

/* ===================================================================
   رتب التقدم في لوحة - حاسبة الترقية
   =================================================================== */
export async function calculateRankProgress(discordId) {
  const config = loadConfig();
  const member = await Member.findOne({ discordId });
  if (!member) return null;

  const ranks = config.promotion?.ranks || [];
  if (ranks.length === 0) return null;

  const currentRankIndex = ranks.findIndex(r => r.name === member.currentRank);
  const currentRank = currentRankIndex >= 0 ? ranks[currentRankIndex] : ranks[0];
  const nextRank = currentRankIndex >= 0 && currentRankIndex < ranks.length - 1 ? ranks[currentRankIndex + 1] : null;

  if (!nextRank) {
    return {
      currentRank: currentRank?.name || 'غير معروف',
      nextRank: null,
      points: member.points || 0,
      requiredPoints: 0,
      memberDays: Math.floor((Date.now() - new Date(member.joinDate || member.createdAt || Date.now()).getTime()) / 86400000),
      nextRankPointsNeeded: 0,
      avgDailyPoints: null,
      estimatedDaysForPoints: null,
      estimatedDaysForDays: null,
      limitingFactor: null,
      streakBonus: null,
    };
  }

  const memberDays = Math.floor((Date.now() - new Date(member.joinDate || member.createdAt || Date.now()).getTime()) / 86400000);
  const pointsNeeded = Math.max(0, nextRank.requiredPoints - (member.points || 0));

  // Average daily points from last 30 days
  const thirtyDaysAgo = formatDate(new Date(Date.now() - 30 * 86400000));
  const logs = await DailyLog.find({ discordId, date: { $gte: thirtyDaysAgo } });
  const totalPoints = logs.reduce((s, l) => s + (l.points || 0), 0);
  const avgDailyPoints = logs.length > 0 ? Math.round(totalPoints / logs.length) : 0;

  // Today's log for streak
  const todayLog = await DailyLog.findOne({ discordId, date: formatDate(new Date()) });

  const estimatedDaysForPoints = avgDailyPoints > 0 ? Math.ceil(pointsNeeded / avgDailyPoints) : null;
  const estimatedDaysForDays = Math.max(0, nextRank.requiredDays - memberDays);
  const limitingFactor = estimatedDaysForPoints !== null
    ? (estimatedDaysForPoints > estimatedDaysForDays ? 'النقاط' : 'الأيام')
    : 'الأيام';

  return {
    currentRank: currentRank?.name || 'غير معروف',
    nextRank: nextRank?.name || null,
    requiredPoints: nextRank?.requiredPoints || 0,
    requiredDays: nextRank?.requiredDays || 0,
    points: member.points || 0,
    pointsNeeded,
    memberDays,
    avgDailyPoints,
    estimatedDaysForPoints,
    estimatedDaysForDays,
    limitingFactor,
    streakCount: todayLog?.streakCount || 0,
    multiplier: todayLog?.multiplier || 1,
  };
}

/* ===================================================================
   جدولة المهام
   =================================================================== */
let dailyCheckScheduled = false;

export function startDailyClassification(client) {
  if (dailyCheckScheduled) return;
  setClientRef(client);

  schedule('0 22 * * *', async () => { // 22:00 Iraq
    console.log('[InteractionManager] 🌙 بدء التصنيف الليلي...');
    await processAllMembers(client);
    console.log('[InteractionManager] ✅ التصنيف الليلي اكتمل');
  });

  // Hourly check: process real-time classification for active escalations
  schedule('0 * * * *', async () => {
    const config = loadConfig();
    const guild = client.guilds.cache.get(config.bot?.guildId);
    if (!guild) return;

    const todayDate = formatDate(new Date());
    const yesterdayDate = formatDate(new Date(Date.now() - 86400000));
    const activeCases = await DailyLog.find({
      status: { $in: [STATUS.VIOLATOR, STATUS.WARNED] },
      daysAsViolator: { $gte: 1 },
      date: { $in: [todayDate, yesterdayDate] },
    });

    for (const log of activeCases) {
      const member = await Member.findOne({ discordId: log.discordId });
      if (!member || !member.isActive) continue;
      const todayPoints = await getTodayPoints(log.discordId);
      const configLocal = loadConfig();
      const [activeVacations, activeExcuses, activeGrace24h, isNewMember, todayWarning] = await Promise.all([
        Vacation.find({ status: 'active', endDate: { $gte: new Date() }, memberId: log.discordId }),
        Excuse.find({ isActive: { $ne: false }, type: { $ne: 'تغير اسم' }, endDate: { $gte: new Date() }, memberId: log.discordId }),
        Grace24h.findOne({ userId: log.discordId, expiresAt: { $gt: new Date() } }),
        Member.findOne({ discordId: log.discordId, createdAt: { $gte: new Date(Date.now() - getInteractionConfig().graceDays * 24 * 60 * 60 * 1000) } }),
        Warning.findOne({ memberId: log.discordId, warningType: 'inactivity', status: 'active', removed: false }),
      ]);

      const isProtected = activeVacations.length > 0 || activeExcuses.length > 0;
      const isGrace = !!activeGrace24h || !!isNewMember;
      const hasWarning = !!todayWarning;
      const newStatus = classifyMember(todayPoints, isProtected, isGrace, hasWarning);

      if (newStatus !== STATUS.VIOLATOR && newStatus !== STATUS.WARNED) {
        const user = await client.users.fetch(log.discordId).catch(() => null);
        if (user && await canSendDM(log.discordId, NOTIFICATION_TYPES.IMPROVEMENT)) {
          await markDMSent(log.discordId, NOTIFICATION_TYPES.IMPROVEMENT);
          await sendDM(user, `✅ **تم تحسن حالتك!**\nنقاطك حالياً ${todayPoints} — أنت الآن ${STATUS_EMOJI[newStatus] || ''} ${newStatus}.\nألغيت إجراءات العقوبات.`);
        }

        if (log.committeeMsgId) {
          await clearPunishmentNotification(guild, log);
        }

        log.status = newStatus;
        if (log.date !== todayDate) log.date = todayDate;
        await log.save();

        // تحديث الإيموجي فوراً عند تحسن العضو
        const newEmoji = getStatusEmoji(newStatus);
        await updateRoomEmoji(guild, log.discordId, newEmoji).catch(() => {});
        member._lastInteractionStatus = newStatus;
        await member.save().catch(() => {});
      }
    }
  });

  dailyCheckScheduled = true;
  console.log('[InteractionManager] ⏰ تم جدولة التصنيف الليلي (22:00 بغداد) والفحص الساعي');
}

/* ===================================================================
   واجهة للاستدعاء الخارجي (تحل محل assessMemberStatus القديم)
   =================================================================== */
export async function quickClassify(discordId) {
  const config = loadConfig();
  const member = await Member.findOne({ discordId });
  if (!member) return { status: 'unknown', points: 0 };

  const points = await getTodayPoints(discordId);
  const now = new Date();

  const graceDate = new Date(Date.now() - getInteractionConfig().graceDays * 24 * 60 * 60 * 1000);
  const [activeVacations, activeExcuses, activeGrace24h, todayWarning, isNewMember] = await Promise.all([
    Vacation.find({ status: 'active', endDate: { $gte: now }, memberId: discordId }),
    Excuse.find({ isActive: { $ne: false }, type: { $ne: 'تغير اسم' }, endDate: { $gte: now }, memberId: discordId }),
    Grace24h.findOne({ userId: discordId, expiresAt: { $gt: now } }),
    Warning.findOne({ memberId: discordId, warningType: 'inactivity', status: 'active', removed: false }),
    Member.findOne({ discordId, createdAt: { $gte: graceDate } }),
  ]);

  const isProtected = activeVacations.length > 0 || activeExcuses.length > 0;
  const isGrace = !!activeGrace24h || !!isNewMember;
  const hasWarning = !!todayWarning;
  const status = classifyMember(points, isProtected, isGrace, hasWarning);

  return { status, points, emoji: STATUS_EMOJI[status] || '❌', member };
}

/* ===================================================================
   بناء تقرير المعايرة (تحليل النقاط vs أيام الرتب) — إصدار قديم
   @deprecated استخدم buildCalibrationReportV2 للتحليل المتقدم
   =================================================================== */
export async function buildCalibrationReportLegacy() {
  const config = loadConfig();
  const ranks = config.promotion?.ranks || [];

  const midnight = getIraqMidnight();
  const cutoff = new Date(midnight.getTime() - getAnalysisDays() * 86400000);

  const pointsData = await PointLog.aggregate([
    { $match: { createdAt: { $gte: cutoff } } },
    { $group: { _id: '$discordId', total: { $sum: '$points' } } },
  ]);

  const allMembers = await Member.find({});
  const activeMembers = allMembers.filter(m => m.isActive);
  const activeDiscordIds = new Set(activeMembers.map(m => m.discordId));
  const filtered = pointsData.filter(p => activeDiscordIds.has(p._id));
  const totalPointsAll = filtered.reduce((s, p) => s + p.total, 0);
  const avgDailyPerMember = filtered.length > 0 ? Math.round(totalPointsAll / getAnalysisDays() / filtered.length) : 0;

  const report = {
    avgDailyPerMember,
    totalMembers: allMembers.length,
    activeMembers: activeMembers.length,
    analyzedMembers: filtered.length,
    totalPointsLast7d: totalPointsAll,
    ranks: [],
  };

  for (const rank of ranks) {
    if (rank.requiredPoints === 0) continue;
    const estimatedDays = avgDailyPerMember > 0 ? Math.ceil(rank.requiredPoints / avgDailyPerMember) : null;
    const diff = estimatedDays !== null ? estimatedDays - rank.requiredDays : null;
    report.ranks.push({
      name: rank.name,
      requiredPoints: rank.requiredPoints,
      requiredDays: rank.requiredDays,
      estimatedDays,
      diff,
      status: diff === null ? 'no_data' : (Math.abs(diff) <= 2 ? 'good' : (diff > 2 ? 'slow_points' : 'fast_points')),
    });
  }

  return report;
}

export { buildCalibrationReportLegacy as buildCalibrationReport };

/* ===================================================================
   حساب مباشر لبيانات الرتب (آخر 7 أيام) — يحلل فقط أعضاء DB النشطاء
   =================================================================== */

function getAnalysisDays() { return getInteractionConfig().analysisDays; }
function getMinActiveDays() { return getInteractionConfig().minActiveDays; }

function computeRankHealth(stats) {
  const { p50, p75, p25, estimatedDays, requiredDays, requiredPoints, memberCount, allMembersCount, dataQuality } = stats;
  if (requiredPoints === 0) return null;
  if (dataQuality === 'low') return null;

  let speedScore = 40;
  if (requiredDays > 0 && estimatedDays !== null) {
    const ratio = estimatedDays / requiredDays;
    if (ratio <= 0.8) speedScore = 40;
    else if (ratio <= 1.0) speedScore = Math.round(35 - (ratio - 0.8) / 0.2 * 5);
    else if (ratio <= 1.2) speedScore = Math.round(30 - (ratio - 1.0) / 0.2 * 10);
    else if (ratio <= 1.5) speedScore = Math.round(20 - (ratio - 1.2) / 0.3 * 10);
    else speedScore = Math.max(0, Math.round(10 - (ratio - 1.5) / 0.5 * 10));
  }

  let distScore = 30;
  if (allMembersCount > 0) {
    const pct = memberCount / allMembersCount * 100;
    if (pct <= 10) distScore = 30;
    else if (pct <= 20) distScore = 25;
    else if (pct <= 30) distScore = 18;
    else if (pct <= 40) distScore = 10;
    else distScore = 5;
  }

  let spreadScore = 30;
  if (p50 > 0) {
    const spread = (p75 - p25) / p50;
    if (spread <= 0.5) spreadScore = 30;
    else if (spread <= 1.0) spreadScore = 24;
    else if (spread <= 1.5) spreadScore = 18;
    else if (spread <= 2.0) spreadScore = 10;
    else spreadScore = 5;
  }

  return speedScore + distScore + spreadScore;
}

function generateRankRecommendation(rank, churnByRank = {}) {
  const { status, rankName, requiredPoints, requiredDays, p50, diff, memberCount, allMembersCount, healthScore } = rank;
  if (status === 'no_requirements') return { status, recommendation: 'ℹ️ رتبة إدارية — لا توجد متطلبات ترقية' };
  if (status === 'no_data') return { status, recommendation: '❓ لا توجد بيانات كافية — ليس لدى الأعضاء نقاط مسجلة في آخر 7 أيام' };

  const pctInRank = allMembersCount > 0 ? Math.round(memberCount / allMembersCount * 100) : 0;
  const congestion = pctInRank > 30;
  const rankChurn = churnByRank[rankName];
  const churnPct = rankChurn ? rankChurn.percentage : 0;
  const churnWarning = churnPct >= 20;

  function suggestPoints(adjustment) {
    const suggested = Math.round(requiredPoints * (1 + adjustment));
    if (adjustment < 0) return `خفض النقاط المطلوبة لـ ${suggested}`;
    return `رفع النقاط المطلوبة لـ ${suggested}`;
  }

  if (status === 'very_slow') {
    const excessPct = Math.round(Math.abs(diff) / requiredDays * 100);
    const adjust = Math.min(-0.1, -Math.round(excessPct / 4) / 100);
    const clamped = Math.max(-0.3, adjust);
    let rec = `🔴 أبطأ ب${excessPct}% من المطلوب`;
    if (healthScore !== null) rec += ` | Health: ${healthScore}/100`;
    if (congestion) rec += `\n   ⚠️ ازدحام: ${pctInRank}% من الأعضاء بهالرتبة`;
    if (churnWarning) rec += `\n   🔴 الفاقد: ${churnPct}% من المغادرين من هذه الرتبة`;
    rec += `\n   💡 ${suggestPoints(clamped)} أو زد مكافآت الرتبة`;
    if (congestion) rec += `\n   💡 أنشئ رتبة وسطية أو زد مدة الرتبة`;
    return { status, recommendation: rec };
  }

  if (status === 'slow') {
    const excessPct = Math.round(Math.abs(diff) / requiredDays * 100);
    const adjust = Math.min(-0.05, -Math.round(excessPct / 5) / 100);
    const clamped = Math.max(-0.25, adjust);
    let rec = `🟡 أبطأ ب${excessPct}% — يحتاج متابعة`;
    if (congestion) rec += `\n   ⚠️ ازدحام: ${pctInRank}% من الأعضاء هنا`;
    if (churnWarning) rec += `\n   🟡 فاقد: ${churnPct}% من المغادرين`;
    rec += `\n   💡 ${suggestPoints(clamped)} أو زد المكافآت`;
    return { status, recommendation: rec };
  }

  if (status === 'good') {
    let rec = `✅ متوازن — P50: ${p50} نقطة/يوم`;
    if (pctInRank > 25) rec += `\n   👀 نسبة الأعضاء: ${pctInRank}% — راقب الازدحام`;
    if (churnPct > 0 && churnPct < 20) rec += `\n   🟡 فاقد بسيط: ${churnPct}%`;
    rec += `\n   💡 استمر على الوضع الحالي`;
    return { status, recommendation: rec };
  }

  if (status === 'fast') {
    const adjust = Math.min(0.1, 0.15);
    let rec = `🚀 أسرع من المطلوب`;
    rec += `\n   💡 ${suggestPoints(adjust)}`;
    return { status, recommendation: rec };
  }

  if (status === 'very_fast') {
    const adjust = Math.min(0.2, 0.25);
    let rec = `⚡ أسرع بكثير — أداء ممتاز`;
    rec += `\n   💡 ${suggestPoints(adjust)}`;
    return { status, recommendation: rec };
  }

  return { status, recommendation: '' };
}

async function computeLiveRankData(config) {
  const midnight = getIraqMidnight();
  const cutoff = new Date(midnight.getTime() - getAnalysisDays() * 86400000);
  const minDate = new Date(midnight.getTime() - 1 * 86400000);

  const pointsData = await PointLog.aggregate([
    { $match: { createdAt: { $gte: cutoff } } },
    { $group: { _id: '$discordId', total: { $sum: '$points' }, days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } } },
  ]);

  const memberPointsMap = new Map();
  const memberDaysMap = new Map();
  for (const p of pointsData) {
    memberPointsMap.set(p._id, p.total);
    memberDaysMap.set(p._id, p.days.length);
  }

  // فقط الأعضاء النشطاء من DB (لا نجلب كل السيرفر)
  const activeMembers = await Member.find({ isActive: true });

  // Group by actual currentRank from DB
  const rankMap = new Map();
  for (const m of activeMembers) {
    const rankAliases = { 'مبتدئ': 'عضو جديد' };
    const name = rankAliases[m.currentRank] || m.currentRank || 'غير معروف';
    if (!rankMap.has(name)) rankMap.set(name, []);
    rankMap.get(name).push(m);
  }

  const configRanks = config.promotion?.ranks || [];
  const rankConfigMap = new Map();
  for (const rc of configRanks) rankConfigMap.set(rc.name, rc);

  const result = [];
  for (const [rankName, members] of rankMap) {
    const cfg = rankConfigMap.get(rankName);
    const requiredPoints = cfg?.requiredPoints || 0;
    const requiredDays = cfg?.requiredDays || 0;
    const memberCount = members.length;

    // حول كل عضو إلى معدله اليومي — استبعد اللي معهم < getMinActiveDays()
    const rawDailyAvgs = [];
    let skippedLowData = 0;
    for (const m of members) {
      const days = memberDaysMap.get(m.discordId) || 0;
      if (days < getMinActiveDays() && days > 0) {
        skippedLowData++;
        continue;
      }
      const total = memberPointsMap.get(m.discordId) || 0;
      rawDailyAvgs.push(Math.round(total / getAnalysisDays()));
    }

    const membersWithData = rawDailyAvgs.length;
    const dataQuality = membersWithData === 0 ? 'none' : (membersWithData < 3 ? 'low' : 'high');

    rawDailyAvgs.sort((a, b) => a - b);
    const count = rawDailyAvgs.length;
    const p25Val = count > 0 ? rawDailyAvgs[Math.max(0, Math.ceil(0.25 * count) - 1)] : 0;
    const p50Val = count > 0 ? rawDailyAvgs[Math.max(0, Math.ceil(0.50 * count) - 1)] : 0;
    const p75Val = count > 0 ? rawDailyAvgs[Math.max(0, Math.ceil(0.75 * count) - 1)] : 0;
    const meanVal = count > 0 ? Math.round(rawDailyAvgs.reduce((s, v) => s + v, 0) / count) : 0;

    const estimatedDays = (requiredPoints > 0 && p50Val > 0) ? Math.ceil(requiredPoints / p50Val) : null;
    const diff = (estimatedDays !== null && requiredDays > 0) ? estimatedDays - requiredDays : null;

    const healthScore = computeRankHealth({
      p50: p50Val, p75: p75Val, p25: p25Val,
      estimatedDays, requiredDays, requiredPoints,
      memberCount,
      allMembersCount: activeMembers.length,
      dataQuality,
    });

    let status = 'no_requirements';
    if (requiredPoints > 0 && requiredDays > 0) {
      if (diff === null || dataQuality === 'none') status = 'no_data';
      else {
        const pctOff = Math.abs(diff) / requiredDays;
        if (pctOff <= 0.15) status = 'good';
        else if (diff > 0) status = pctOff <= 0.30 ? 'slow' : 'very_slow';
        else status = pctOff <= 0.30 ? 'fast' : 'very_fast';
      }
    }

    result.push({
      name: rankName,
      memberCount,
      membersWithData,
      skippedLowData,
      dataQuality,
      p25: p25Val, p50: p50Val, p75: p75Val, mean: meanVal,
      requiredPoints, requiredDays, estimatedDays, diff,
      status,
      healthScore: healthScore !== null ? healthScore : null,
    });
  }

  // Sort: config ranks first, then others alphabetically
  result.sort((a, b) => {
    const aIdx = configRanks.findIndex(r => r.name === a.name);
    const bIdx = configRanks.findIndex(r => r.name === b.name);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  return { rankData: result, totalMembers: activeMembers.length, activeMembers: activeMembers.length };
}

/* ===================================================================
   تقرير المعايرة V2 — تحليل ذكي مع Percentiles + اتجاهات + توصيات
   =================================================================== */
export async function buildCalibrationReportV2() {
  const config = loadConfig();

  const live = await computeLiveRankData(config);

  const allWeekly = await WeeklyStat.find({});
  allWeekly.sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart));
  const currentWeek = allWeekly.length > 0 ? allWeekly[0] : null;

  const trends = await getWeeklyTrends(6);

  const churn = await analyzeChurn(60);

  // بناء خريطة churn حسب الرتبة لتمريرها للتوصيات
  const churnByRank = {};
  for (const r of churn.byRank) {
    churnByRank[r.name] = r;
  }

  // إضافة التوصيات لكل رتبة
  const rankAnalysis = live.rankData.map(r => {
    const { recommendation } = generateRankRecommendation({
      status: r.status, rankName: r.name, requiredPoints: r.requiredPoints,
      requiredDays: r.requiredDays, p50: r.p50, diff: r.diff,
      memberCount: r.memberCount, allMembersCount: live.totalMembers,
      healthScore: r.healthScore,
    }, churnByRank);
    return { ...r, recommendation };
  });

  const rankDistribution = rankAnalysis.map(r => ({
    name: r.name,
    memberCount: r.memberCount,
    membersWithData: r.membersWithData,
    skippedLowData: r.skippedLowData,
    dataQuality: r.dataQuality,
    pctOfTotal: live.totalMembers > 0 ? Math.round(r.memberCount / live.totalMembers * 100) : 0,
  }));

  // اقتراح Thresholds — فقط الأعضاء مع >= getMinActiveDays()
  let suggestedThresholds = null;
  const midnight = getIraqMidnight();
  const cutoff = new Date(midnight.getTime() - getAnalysisDays() * 86400000);
  const ptsData = await PointLog.aggregate([
    { $match: { createdAt: { $gte: cutoff } } },
    { $group: { _id: '$discordId', total: { $sum: '$points' }, days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } } } },
  ]);
  const filteredAvgs = [];
  const activeMemberSet = new Set((await Member.find({ isActive: true })).map(m => m.discordId));
  for (const p of ptsData) {
    if (activeMemberSet.has(p._id) && p.days.length >= getMinActiveDays()) {
      filteredAvgs.push(Math.round(p.total / getAnalysisDays()));
    }
  }
  filteredAvgs.sort((a, b) => a - b);
  const len = filteredAvgs.length;
  if (len > 10) {
    const p15 = filteredAvgs[Math.max(0, Math.ceil(0.15 * len) - 1)];
    const p35 = filteredAvgs[Math.max(0, Math.ceil(0.35 * len) - 1)];
    const p60 = filteredAvgs[Math.max(0, Math.ceil(0.60 * len) - 1)];
    suggestedThresholds = {
      current: {
        violator: getInteractionConfig().violatorThreshold,
        inactive: getInteractionConfig().inactiveThreshold,
        active: getInteractionConfig().activeThreshold,
      },
      suggested: {
        violator: p15,
        inactive: p35,
        active: p60,
      },
      basedOnMembers: len,
    };
  }

  return {
    rankAnalysis,
    rankDistribution,
    currentWeek,
    trends,
    churn,
    suggestedThresholds,
    totalMembers: live.totalMembers,
    activeMembers: live.activeMembers,
    generatedAt: new Date().toISOString(),
  };
}

export async function runManualReview(guild, client) {
  // 1. Process all members
  const result = await processAllMembers(client);

  // 2. Update all room emojis based on new status
  const members = await Member.find({ isActive: true });
  let roomUpdates = 0;
  for (const m of members) {
    try {
      const classification = await quickClassify(m.discordId);
      if (classification && classification.emoji) {
        await updateRoomEmoji(guild, m.discordId, classification.emoji);
        roomUpdates++;
      }
    } catch (e) {
      console.error(`[ManualReview] Error updating emoji for ${m.discordId}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  return {
    ...result,
    roomUpdates
  };
}

export async function buildAndSendWarningQueue(guild, client) {
  const { buildWarningQueue, sendQueueMessage } = await import('./punishmentQueue.js');
  const items = await buildWarningQueue(guild, client);
  if (items.length > 0) {
    await sendQueueMessage(guild, items);
  }
  return items;
}

/* ===================================================================
   Family Rank Audit — بناءً على رتب الترقية من config فقط
   لكل رتبة: جدول الأعضاء + نقاطهم الحالية + المطلوب للرتبة التالية
   + اقتراح threshold واقعي
   =================================================================== */
export async function buildFamilyAuditReport() {
  const config = loadConfig();
  const ranks = config.promotion?.ranks || [];
  const activeMembers = await Member.find({ isActive: true });

  const rankAliases = { 'مبتدئ': 'عضو جديد' };

  const rankMembersMap = new Map();
  for (const m of activeMembers) {
    let r = m.currentRank || 'غير معروف';
    if (rankAliases[r]) r = rankAliases[r];
    if (!rankMembersMap.has(r)) rankMembersMap.set(r, []);
    rankMembersMap.get(r).push(m);
  }

  const rankAudit = [];
  for (let i = 0; i < ranks.length; i++) {
    const rank = ranks[i];
    const members = rankMembersMap.get(rank.name) || [];
    const nextRank = ranks[i + 1];

    const memberData = members.map(m => ({
      discordId: m.discordId,
      points: m.points || 0,
      daysInRank: getDaysInRank(m),
    }));

    const count = memberData.length;
    const maxPts = count > 0 ? Math.max(...memberData.map(m => m.points)) : 0;
    const avgPts = count > 0 ? Math.round(memberData.reduce((s, m) => s + m.points, 0) / count) : 0;
    const minPts = count > 0 ? Math.min(...memberData.map(m => m.points)) : 0;

    let suggested = null;
    let suggestionLabel = '';
    if (nextRank && count > 0) {
      if (maxPts >= nextRank.requiredPoints) {
        suggested = nextRank.requiredPoints;
        suggestionLabel = `✅ ${suggested}ن — مناسب (عضو تجاوز العتبة)`;
      } else if (maxPts > 0) {
        const base = Math.round(maxPts * 1.5);
        const rounded = Math.ceil(base / 50) * 50;
        suggested = Math.min(rounded, nextRank.requiredPoints);
        const pct = Math.round((suggested / nextRank.requiredPoints) * 100);
        suggestionLabel = pct < 70
          ? `🔻 ${suggested}ن (${pct}% من الأصلي ${nextRank.requiredPoints}ن)`
          : `✅ ${suggested}ن (قريب من الأصلي)`;
      } else {
        suggested = null;
        suggestionLabel = '⚠️ لا توجد نقاط لتقدير الاقتراح';
      }
    }

    rankAudit.push({
      name: rank.name,
      roleId: rank.roleId,
      memberCount: count,
      memberData,
      maxPoints: maxPts,
      avgPoints: avgPts,
      minPoints: minPts,
      requiredPoints: nextRank?.requiredPoints || 0,
      requiredDays: nextRank?.requiredDays || 0,
      suggested,
      suggestionLabel,
    });
  }

  const usedAliases = [];
  for (const [orig, mapped] of Object.entries(rankAliases)) {
    if (activeMembers.some(m => m.currentRank === orig)) {
      usedAliases.push({ from: orig, to: mapped });
    }
  }

  return { rankAudit, usedAliases, totalMembers: activeMembers.length };
}

/* ===================================================================
   Interaction System Audit — تدقيق نظام التفاعل
   يحلل كل الأعضاء حسب نقاط اليوم ويقترح thresholds جديدة
   =================================================================== */
export async function auditInteractionThresholds() {
  const ic = getInteractionConfig();
  const vt = ic.violatorThreshold;
  const at = ic.activeThreshold;
  const it = ic.inactiveThreshold;

  const now = new Date();
  const graceDate = new Date(now.getTime() - ic.graceDays * 86400000);
  const cutoff7d = new Date(now.getTime() - ic.analysisDays * 86400000);
  const cutoff24h = new Date(now.getTime() - ic.reviewWindowHours * 3600000);

  const [members, activeVacations, activeExcuses, activeGracePeriods,
    points24h, points7d, newMembers, todayWarnings] = await Promise.all([
    Member.find({ isActive: true }),
    (await import('../models/Vacation.js')).default.find({ status: 'active', endDate: { $gte: now } }).catch(() => []),
    (await import('../models/Excuse.js')).default.find({ isActive: { $ne: false }, type: { $ne: 'تغير اسم' }, endDate: { $gte: now } }).catch(() => []),
    (await import('../models/Grace24h.js')).default.find({ expiresAt: { $gt: now } }).catch(() => []),
    PointLog.aggregate([
      { $match: { createdAt: { $gte: cutoff24h } } },
      { $group: { _id: '$discordId', total: { $sum: '$points' } } }
    ]),
    PointLog.aggregate([
      { $match: { createdAt: { $gte: cutoff7d } } },
      { $group: { _id: '$discordId', total: { $sum: '$points' } } }
    ]),
    Member.find({ createdAt: { $gte: graceDate } }),
    (await import('../models/Warning.js')).default.find({ warningType: 'inactivity', status: 'active', removed: false }).catch(() => []),
  ]);

  const points24hMap = new Map(points24h.map(p => [p._id, Math.max(0, p.total)]));
  const points7dMap = new Map(points7d.map(p => [p._id, Math.max(0, p.total)]));
  const protectedIds = new Set([...activeVacations.map(v => v.memberId), ...activeExcuses.map(e => e.memberId)]);
  const graceIds = new Set(newMembers.map(m => m.discordId));
  const activeGraceIds = new Set(activeGracePeriods.map(g => g.userId));

  // Classification based on last 24h (real-time snapshot)
  const violatorList = [];
  const inactiveList = [];
  const activeList = [];
  let protectedCount = 0;
  let graceCount = 0;

  for (const m of members) {
    if (protectedIds.has(m.discordId)) { protectedCount++; continue; }
    if (graceIds.has(m.discordId) || activeGraceIds.has(m.discordId)) { graceCount++; continue; }
    const pts = points24hMap.get(m.discordId) ?? 0;
    if (pts < vt) {
      violatorList.push({ discordId: m.discordId, points: pts, currentRank: m.currentRank });
    } else if (pts < it) {
      inactiveList.push({ discordId: m.discordId, points: pts, currentRank: m.currentRank });
    } else {
      activeList.push({ discordId: m.discordId, points: pts, currentRank: m.currentRank });
    }
  }

  // Percentiles from 7-day daily average (smoother, reflects typical activity)
  const dailyAvgs = members
    .filter(m => !protectedIds.has(m.discordId) && !graceIds.has(m.discordId) && !activeGraceIds.has(m.discordId))
    .map(m => Math.round((points7dMap.get(m.discordId) ?? 0) / getAnalysisDays()))
    .sort((a, b) => a - b);
  const len = dailyAvgs.length;
  const calcP = (pct) => len > 0 ? dailyAvgs[Math.max(0, Math.ceil(pct * len) - 1)] : 0;
  let p15 = calcP(0.15), p35 = calcP(0.35), p60 = calcP(0.60);

  // Fallback: avoid 0/0/0 when data is sparse
  const allZero = len > 0 && dailyAvgs.every(v => v === 0);
  if (allZero || p15 === 0) p15 = Math.max(1, Math.round(vt / 2));
  if (allZero || p35 === 0) p35 = Math.max(1, Math.round(at / 2));
  if (allZero || p60 === 0) p60 = Math.max(1, Math.round(at / 2));
  // ضمان الترتيب التصاعدي: p15 ≤ p35 ≤ p60
  const sorted = [p15, p35, p60].sort((a, b) => a - b);
  p15 = sorted[0]; p35 = sorted[1]; p60 = sorted[2];

  const maxViolator = violatorList.length > 0 ? Math.max(...violatorList.map(m => m.points)) : 0;
  const minActive = activeList.length > 0 ? Math.min(...activeList.map(m => m.points)) : 0;
  const avgV = violatorList.length > 0 ? Math.round(violatorList.reduce((s, m) => s + m.points, 0) / violatorList.length) : 0;
  const avgI = inactiveList.length > 0 ? Math.round(inactiveList.reduce((s, m) => s + m.points, 0) / inactiveList.length) : 0;
  const avgA = activeList.length > 0 ? Math.round(activeList.reduce((s, m) => s + m.points, 0) / activeList.length) : 0;

  return {
    current: { violator: vt, inactive: it, active: at },
    suggested: { violator: p15, inactive: p35, active: p60 },
    basedOnMembers: len,
    counts: {
      violator: violatorList.length,
      inactive: inactiveList.length,
      active: activeList.length,
      protected: protectedCount,
      grace: graceCount,
      total: members.length,
    },
    averages: { violator: avgV, inactive: avgI, active: avgA },
    maxViolator,
    minActive,
    note: allZero ? '⚠️ كل الأعضاء بدون نقاط — تم استخدام fallback' : '',
  };
}

/* ===================================================================
   interactionMonitor.js — دوال مراقبة التفاعل
   =================================================================== */

const GRACE24H_MS = 24 * 60 * 60 * 1000;

function getReviewWindowAgo() {
  return new Date(Date.now() - getInteractionConfig().reviewWindowHours * 3600000);
}

export async function assessMemberStatus(client, guild, discordId, { silentInit = false } = {}) {
  const result = await quickClassify(discordId);
  if (!result.member) return false;

  const currentStatus = result.status;
  const statusEmoji = result.emoji;
  const dailyPoints = result.points;

  const prevStatus = result.member._lastInteractionStatus;

  if (prevStatus === undefined && silentInit) {
    result.member._lastInteractionStatus = currentStatus;
    await result.member.save().catch(e => console.error('[InteractionMonitor]', e?.message));
    return true;
  }

  if (prevStatus === currentStatus) return false;

  await updateRoomEmoji(guild, discordId, statusEmoji);

  const user = await client.users.fetch(discordId).catch(() => null);
  if (user && currentStatus !== STATUS.PROTECTED && currentStatus !== STATUS.GRACE) {
    const ic = getInteractionConfig();
    const violatorThreshold = ic.violatorThreshold;
    const activeThreshold = ic.activeThreshold;

    let type;
    if (currentStatus === STATUS.VIOLATOR || currentStatus === STATUS.WARNED) type = 'violator';
    else if (currentStatus === STATUS.INACTIVE) type = 'inactive';
    else type = 'active';

    await sendStatusDM(user, type, dailyPoints, violatorThreshold, activeThreshold, guild);
  }

  result.member._lastInteractionStatus = currentStatus;
  await result.member.save().catch(e => console.error('[InteractionMonitor]', e?.message));

  return true;
}

export async function createGracePeriod(userId, reason, guild, client, relatedInfo) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + GRACE24H_MS);

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

async function sendNotificationLog(guild, title, description, fields, embedType = 'info') {
  const channelId = getInteractionConfig().channels.log;
  if (!guild || !channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  const fn = { warning: embedWarning, success: embedSuccess, info: embedInfo, error: embedError }[embedType] || embedInfo;
  await sendToChannel(channel, fn(title, description, fields));
}

async function sendStatusDM(user, type, points, violatorThreshold, activeThreshold, guild) {
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

export function startInteractionChecker(client) {
  startDailyClassification(client);
  startWeeklyCalibration(client);
  initializeInteractionStatus(client).catch(e => console.error('[Init]', e?.message));
  console.log(`⏰ تم تفعيل مراجعة التفاعل (محاسبة كل ${getInteractionConfig().reviewWindowHours} ساعة)`);
}

async function checkAllMembers(client) {
  await processAllMembers(client);
}

export { getWeeklyTrends, computeWeeklyStats, startWeeklyCalibration } from './weeklyCalibration.js';
export { analyzeChurn, analyzeBreakpoints } from './churnAnalyzer.js';
