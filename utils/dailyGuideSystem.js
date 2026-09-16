import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { schedule } from 'node-cron';
import Member from '../models/Member.js';
import PointLog from '../models/PointLog.js';
import DailyLog from '../models/DailyLog.js';
import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';
import Grace24h from '../models/Grace24h.js';
import Warning from '../models/Warning.js';
import { loadConfig } from './configLoader.js';
import { success as embedSuccess, warning as embedWarning, info as embedInfo } from './embedStyles.js';
import { formatDate, getIraqMidnight, ensureDailyLog, calculateRankProgress, getInteractionConfig } from './interactionMonitor.js';

/* ===================================================================
   نظام الإشعارات اليومية للعضو — رسائل يومية بروم العضو الشخصي
   - 8:00 صباحاً (بغداد): خطة اليوم (النقاط المطلوبة + تقدم الترقية)
   - كل ساعة: إشعار الإنجاز لما يتوصل للهدف (فحص مجمّع)
   - نهاية اليوم: تنبيه بمستويين (مخالف صريح / خامل ناعم) + زر تذكرة
   =================================================================== */

const TZ = 'Asia/Baghdad';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getDailyGuideConfig() {
  const dg = loadConfig().dailyGuide || {};
  const im = getInteractionConfig();
  const gpRaw = dg.goalPoints?.value ?? dg.goalPoints;
  return {
    enabled: dg.enabled !== false,
    morningHour: dg.morningHour ?? 8,
    morningMinute: dg.morningMinute ?? 0,
    endOfDayHour: dg.endOfDayHour ?? 23,
    endOfDayMinute: dg.endOfDayMinute ?? 0,
    goalPoints: Number.isFinite(gpRaw) ? gpRaw : im.activeThreshold,
    helpChannelId: dg.helpChannelId || '',
    useRoom: dg.useRoom !== false,
  };
}

function getMainGuild(client) {
  const config = loadConfig();
  return client.guilds.cache.get(config.bot?.guildId);
}

function getBaghdadHourMinute() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  return { hour, minute };
}

async function getActiveMembersWithRoom() {
  return Member.find({ isActive: true, roomChannelId: { $ne: null, $ne: '' } });
}

async function getMemberRoom(guild, memberData) {
  const channelId = memberData?.roomChannelId;
  if (!guild || !channelId) return null;
  return guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
}

/* نقاط اليوم لجميع الأعضاء دفعة واحدة (بدل استعلام لكل عضو) */
async function getBatchTodayPoints(discordIds) {
  if (!discordIds.length) return {};
  const midnight = getIraqMidnight();
  const result = await PointLog.aggregate([
    { $match: { createdAt: { $gte: midnight }, discordId: { $in: discordIds } } },
    { $group: { _id: '$discordId', total: { $sum: '$points' } } },
  ]);
  const map = {};
  for (const r of result) map[r._id] = Math.max(0, r.total);
  return map;
}

async function getTodayPoints(discordId) {
  const midnight = getIraqMidnight();
  const result = await PointLog.aggregate([
    { $match: { createdAt: { $gte: midnight }, discordId } },
    { $group: { _id: '$discordId', total: { $sum: '$points' } } },
  ]);
  return result.length > 0 ? Math.max(0, result[0].total) : 0;
}

async function getMemberProtection(discordId) {
  const now = new Date();
  const graceDate = new Date(Date.now() - getInteractionConfig().graceDays * 24 * 60 * 60 * 1000);
  const [vacations, excuses, grace, isNew] = await Promise.all([
    Vacation.find({ status: 'active', endDate: { $gte: now }, memberId: discordId }),
    Excuse.find({ isActive: { $ne: false }, type: { $ne: 'تغير اسم' }, endDate: { $gte: now }, memberId: discordId }),
    Grace24h.findOne({ userId: discordId, expiresAt: { $gt: now } }),
    Member.findOne({ discordId, createdAt: { $gte: graceDate } }),
  ]);
  return {
    isProtected: vacations.length > 0 || excuses.length > 0,
    isGrace: !!(grace || isNew),
  };
}

/* الأعضاء اللي وصلهم إشعار معيّن لهذا اليوم */
async function getNotifiedMemberIds(logKey) {
  const today = formatDate(new Date());
  const logs = await DailyLog.find({ date: today, [logKey]: { $ne: null } });
  return new Set(logs.map(l => l.discordId));
}

async function buildProgressLines(discordId) {
  const rp = await calculateRankProgress(discordId);
  if (!rp) return [];
  const lines = [];
  lines.push(`🎖️ رتبتك: **${rp.currentRank}**`);
  if (rp.nextRank) {
    lines.push(`🎯 الرتبة القادمة: **${rp.nextRank}**`);
    lines.push(`🏆 باقيلك **${rp.pointsNeeded}** من **${rp.requiredPoints}** نقطة (عندك ${rp.points})`);
    lines.push(`📅 باقيلك **${rp.estimatedDaysForDays}** يوم من **${rp.requiredDays}**`);
    if (rp.avgDailyPoints) lines.push(`📊 معدلك اليومي: **${rp.avgDailyPoints}**`);
    if (rp.limitingFactor) lines.push(`⏳ العامل المحدد: **${rp.limitingFactor}**`);
  } else {
    lines.push('🚀 وصلت لأعلى رتبة!');
  }
  if (rp.streakCount > 0) {
    lines.push(rp.multiplier > 1
      ? `🔥 Streak: **${rp.streakCount}** يوم (×${rp.multiplier})`
      : `🔥 Streak: **${rp.streakCount}** يوم`);
  }
  return lines;
}

function buildRows({ progress = true, ticket = true } = {}) {
  const row = new ActionRowBuilder();
  if (progress) {
    row.addComponents(
      new ButtonBuilder().setCustomId('dg_progress').setEmoji('📈').setLabel('عرض تقدمي').setStyle(ButtonStyle.Primary)
    );
  }
  if (ticket) {
    row.addComponents(
      new ButtonBuilder().setCustomId('dg_ticket').setEmoji('🎫').setLabel('إجازة / عذر').setStyle(ButtonStyle.Secondary)
    );
  }
  return row.components.length ? [row] : [];
}

/* ===================================================================
   ١) رسالة الصباح — خطة اليوم
   =================================================================== */
async function sendMorningNotification(client, guild) {
  const dg = getDailyGuideConfig();
  const im = getInteractionConfig();
  const members = await getActiveMembersWithRoom();
  const notified = await getNotifiedMemberIds('morningNotifiedAt');
  const pointsMap = await getBatchTodayPoints(members.map(m => m.discordId));
  let sent = 0;

  for (const m of members) {
    try {
      if (notified.has(m.discordId)) continue;
      const room = await getMemberRoom(guild, m);
      if (!room) continue;

      const todayPoints = pointsMap[m.discordId] ?? 0;
      const progress = await buildProgressLines(m.discordId);

      const lines = [
        `📍 **خطتك لليوم — ${formatDate(new Date())}**`,
        '',
        `🎯 هدفك عشان تتفاعل 🟢: **${dg.goalPoints}** نقطة`,
        `🟡 دون الهدف وفوق **${im.violatorThreshold}** → خامل (محد يحاسبك)`,
        `🔴 أقل من **${im.violatorThreshold}** → مخالف 🔥 (يُحاسب)`,
        '',
        `📊 نقاطك الحالية: **${todayPoints}**`,
        ...progress,
        '',
        '💪 ابدأ يومك والاها! دليلك موجود بالأزرار تحت 👌',
      ];

      await room.send({
        content: `<@${m.discordId}>`,
        embeds: [embedInfo('🌅 خطة يومك', lines.join('\n'))],
        components: buildRows({ progress: true, ticket: true }),
      });

      const dailyLog = await ensureDailyLog(m.discordId);
      dailyLog.morningNotifiedAt = new Date().toISOString();
      await dailyLog.save();
      sent++;
    } catch (e) {
      console.error(`[DailyGuide] الصباح ${m.discordId}:`, e?.message);
    }
    await sleep(400);
  }
  console.log(`[DailyGuide] 🌅 تم إرسال خطة اليوم لـ ${sent} عضو`);
}

/* ===================================================================
   ٢) إشعار الإنجاز — لما يكمل العضو هدفه اليومي
   =================================================================== */
async function checkDailyGoalReached(client, guild) {
  const dg = getDailyGuideConfig();
  const members = await getActiveMembersWithRoom();
  const notified = await getNotifiedMemberIds('goalNotifiedAt');
  const pointsMap = await getBatchTodayPoints(members.map(m => m.discordId));
  let sent = 0;

  for (const m of members) {
    try {
      if (notified.has(m.discordId)) continue;
      const todayPoints = pointsMap[m.discordId] ?? 0;
      if (todayPoints < dg.goalPoints) continue;

      const room = await getMemberRoom(guild, m);
      if (!room) continue;

      const progress = await buildProgressLines(m.discordId);
      const lines = [
        `🎉 حققت هدفك اليوم 🟢`,
        `📊 نقاطك اليوم: **${todayPoints}** (المطلوب ${dg.goalPoints})`,
        ...progress,
        '',
        '💪 استمر بنفس القوة، وشوف ارتقاءك القادم!',
      ];

      await room.send({
        content: `<@${m.discordId}>`,
        embeds: [embedSuccess('✨ أحسنت!', lines.join('\n'))],
        components: buildRows({ progress: true, ticket: false }),
      });

      const dailyLog = await ensureDailyLog(m.discordId);
      dailyLog.goalNotifiedAt = new Date().toISOString();
      await dailyLog.save();
      sent++;
    } catch (e) {
      console.error(`[DailyGuide] الإنجاز ${m.discordId}:`, e?.message);
    }
    await sleep(150);
  }
  if (sent > 0) console.log(`[DailyGuide] ✨ إشعارات الإنجاز: ${sent} عضو`);
}

/* ===================================================================
   ٣) رسالة نهاية اليوم — بمستويين:
       مخالف (< حد المخالف) → تحذير صريح بإنذار/عقوبة
       خامل (فوق حد المخالف و دون الهدف) → تنبيه ناعم بدون تهديد
   =================================================================== */
async function sendEndOfDayWarning(client, guild) {
  const dg = getDailyGuideConfig();
  const im = getInteractionConfig();
  const members = await getActiveMembersWithRoom();
  const notified = await getNotifiedMemberIds('eodNotifiedAt');
  const pointsMap = await getBatchTodayPoints(members.map(m => m.discordId));
  const maxWarnings = getInteractionConfig().maxWarnings;
  let sent = 0;

  for (const m of members) {
    try {
      if (notified.has(m.discordId)) continue;

      const { isProtected, isGrace } = await getMemberProtection(m.discordId);
      if (isProtected || isGrace) continue;

      const todayPoints = pointsMap[m.discordId] ?? 0;
      if (todayPoints >= dg.goalPoints) continue;

      const room = await getMemberRoom(guild, m);
      if (!room) continue;

      const warnings = await Warning.find({ memberId: m.discordId, warningType: 'inactivity', status: 'active', removed: false });
      const isViolator = todayPoints < im.violatorThreshold;

      let embed, lines;
      if (isViolator) {
        lines = [
          `📊 نقاطك اليوم: **${todayPoints}** (المطلوب ${dg.goalPoints})`,
          `⚠️ إنذارات عدم التفاعل: **${warnings.length}/${maxWarnings}**`,
          '',
          `🔴 أنت مصنف **مخالف** اليوم — لم تصل حتى للحد الأدنى (**${im.violatorThreshold}**).`,
          'لو استمر وضعك هكذا سيتم رفعك للجنة العقوبات وقد تأخذ إنذاراً.',
          '🎫 وفّر نفسك: خذ **إجازة او عذر** قبل ما تسجل عليك المخالفة!',
        ];
        embed = embedWarning('⚠️ لم تتفاعل اليوم!', lines.join('\n'));
      } else {
        lines = [
          `📊 نقاطك اليوم: **${todayPoints}** (المطلوب ${dg.goalPoints})`,
          '',
          `🟡 أنت **خامل** اليوم — محد يحاسبك، بـس ما حققت هدفك.`,
          'حاول تكمل غداً عشان توصل للتفاعل 🟢.',
          '🎫 عندك عذر أو راح تغيب؟ افتح تذكرة **إجازة / عذر** من الزر.',
        ];
        embed = embedInfo('🌙 ختام اليوم', lines.join('\n'));
      }

      await room.send({
        content: `<@${m.discordId}>`,
        embeds: [embed],
        components: buildRows({ progress: true, ticket: true }),
      });

      const dailyLog = await ensureDailyLog(m.discordId);
      dailyLog.eodNotifiedAt = new Date().toISOString();
      await dailyLog.save();
      sent++;
    } catch (e) {
      console.error(`[DailyGuide] نهاية اليوم ${m.discordId}:`, e?.message);
    }
    await sleep(400);
  }
  console.log(`[DailyGuide] ⚠️ تم تنبيه ${sent} عضو بنهاية اليوم`);
}

/* ===================================================================
   تصدير للاستدعاء اليدوي من لوحة التفاعل
   =================================================================== */
export { sendMorningNotification, checkDailyGoalReached, sendEndOfDayWarning };

/* ===================================================================
   الجدولة (بتوقيت بغداد) + استدراك الصباح عند الإقلاع
   =================================================================== */
let _started = false;

export function startDailyGuide(client) {
  if (_started) return;
  const cfg = getDailyGuideConfig();
  const guild = () => getMainGuild(client);

  schedule(`${cfg.morningMinute} ${cfg.morningHour} * * *`, async () => {
    if (!getDailyGuideConfig().enabled) return;
    try {
      await sendMorningNotification(client, guild());
    } catch (e) {
      console.error('[DailyGuide] مهمة الصباح:', e?.message);
    }
  }, { timezone: TZ });

  schedule('5 * * * *', async () => {
    if (!getDailyGuideConfig().enabled) return;
    try {
      await checkDailyGoalReached(client, guild());
    } catch (e) {
      console.error('[DailyGuide] مهمة الإنجاز:', e?.message);
    }
  }, { timezone: TZ });

  schedule(`${cfg.endOfDayMinute} ${cfg.endOfDayHour} * * *`, async () => {
    if (!getDailyGuideConfig().enabled) return;
    try {
      await sendEndOfDayWarning(client, guild());
    } catch (e) {
      console.error('[DailyGuide] مهمة نهاية اليوم:', e?.message);
    }
  }, { timezone: TZ });

  _started = true;

  // استدراك: لو البوت اشتغل بعد وقت الصباح، نرسل خطة اليوم للّي ما وصلتهم
  setTimeout(async () => {
    try {
      if (!getDailyGuideConfig().enabled) return;
      const { hour } = getBaghdadHourMinute();
      if (hour >= cfg.morningHour) {
        await sendMorningNotification(client, guild());
      }
    } catch (e) {
      console.error('[DailyGuide] استدراك الصباح:', e?.message);
    }
  }, 8000);

  console.log(`[DailyGuide] ⏰ جدولة الإشعارات (بغداد): صباح ${cfg.morningHour}:${String(cfg.morningMinute).padStart(2, '0')} | نهاية اليوم ${cfg.endOfDayHour}:${String(cfg.endOfDayMinute).padStart(2, '0')} | فحص الهدف كل ساعة`);
}

/* ===================================================================
   الأزرار
   =================================================================== */
export async function handleDailyGuideButton(interaction) {
  if (!interaction.isButton()) return false;
  const { customId } = interaction;
  if (customId !== 'dg_progress' && customId !== 'dg_ticket') return false;

  if (customId === 'dg_progress') {
    try {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const rp = await calculateRankProgress(interaction.user.id);
      if (!rp) return interaction.editReply({ content: '❌ أنت غير مسجل في نظام النقاط.' });

      const todayPoints = await getTodayPoints(interaction.user.id);
      const dg = getDailyGuideConfig();
      const lines = [
        `📊 نقاطك اليوم: **${todayPoints}** (المطلوب ${dg.goalPoints})`,
        ...(await buildProgressLines(interaction.user.id)),
      ];
      const embed = embedInfo('📈 تقدمك نحو الترقية', lines.join('\n'));
      return interaction.editReply({ embeds: [embed] });
    } catch (e) {
      console.error('[DailyGuide] زر التقدم:', e?.message);
      return interaction.editReply({ content: '❌ حدث خطأ، حاول لاحقاً.' }).catch(() => {});
    }
  }

  if (customId === 'dg_ticket') {
    try {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const { createTicket } = await import('./ticketManager.js');
      const result = await createTicket(interaction.guild, interaction.user.id, 'senior_management');
      return interaction.editReply(`✅ **تم إنشاء تذكرتك:** <#${result.channelId}>\nاشرح فيها سبب إجازتك/عذرك وسيتعامل معك فريق الإدارة العليا.`);
    } catch (e) {
      return interaction.editReply({ content: `❌ ${e.message}` }).catch(() => {});
    }
  }

  return false;
}