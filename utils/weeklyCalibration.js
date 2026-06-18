import { schedule } from 'node-cron';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Member from '../models/Member.js';
import WeeklyStat from '../models/WeeklyStat.js';
import DailyLog from '../models/DailyLog.js';
import PointLog from '../models/PointLog.js';
import { custom as embedCustom } from './embedStyles.js';
function getIraqMidnight() {
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

function formatDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baghdad',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 60000;

function loadConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < CONFIG_CACHE_TTL) return _configCache;
  try {
    _configCache = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    _configCacheTime = now;
  } catch {
    _configCache = _configCache || {};
  }
  return _configCache;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/* ===================================================================
   حساب الإحصائيات الأسبوعية (كل أحد 00:05 بغداد)
   =================================================================== */
export async function computeWeeklyStats() {
  const config = loadConfig();
  const configRanks = config.promotion?.ranks || [];
  const rankConfigMap = new Map();
  for (const rc of configRanks) rankConfigMap.set(rc.name, rc);

  const weekEnd = getIraqMidnight();
  const weekStart = new Date(weekEnd.getTime() - 7 * 86400000);

  const weekLabel = `${formatDate(weekStart)} ~ ${formatDate(new Date(weekEnd.getTime() - 86400000))}`;

  // Get all members
  const allMembers = await Member.find({});
  const activeMembers = allMembers.filter(m => m.isActive);

  // Get point logs for this week
  const pointLogsRaw = await PointLog.find({ createdAt: { $gte: weekStart, $lt: weekEnd } });

  // Aggregate points per member for the week
  const memberPoints = new Map();
  for (const log of pointLogsRaw) {
    const existing = memberPoints.get(log.discordId) || 0;
    memberPoints.set(log.discordId, existing + (log.points || 0));
  }

  // Calculate daily average per active member (for overall stats)
  const dailyAvgs = [];
  for (const m of activeMembers) {
    const weekTotal = memberPoints.get(m.discordId) || 0;
    const avg = Math.round(weekTotal / 7);
    dailyAvgs.push(avg);
  }
  dailyAvgs.sort((a, b) => a - b);

  const medianDailyPoints = percentile(dailyAvgs, 50);
  const meanDailyPoints = dailyAvgs.length > 0
    ? Math.round(dailyAvgs.reduce((s, v) => s + v, 0) / dailyAvgs.length)
    : 0;
  const p25 = percentile(dailyAvgs, 25);
  const p75 = percentile(dailyAvgs, 75);

  // Count members by ACTUAL DB rank names (not config)
  const rankMemberMap = new Map();
  for (const m of allMembers) {
    const name = m.currentRank || 'غير معروف';
    if (!rankMemberMap.has(name)) rankMemberMap.set(name, []);
    rankMemberMap.get(name).push(m);
  }

  // Per-rank stats
  const rankStats = [];
  for (const [rankName, members] of rankMemberMap) {
    const cfg = rankConfigMap.get(rankName);
    const memberCount = members.length;
    const activeCount = members.filter(m => m.isActive).length;
    const inactiveCount = memberCount - activeCount;

    const rankDailyAvgs = [];
    for (const m of members) {
      const weekTotal = memberPoints.get(m.discordId) || 0;
      const avg = Math.round(weekTotal / 7);
      rankDailyAvgs.push(avg);
    }
    rankDailyAvgs.sort((a, b) => a - b);
    rankStats.push({
      name: rankName,
      memberCount,
      activeCount,
      inactiveCount,
      p25: percentile(rankDailyAvgs, 25),
      p50: percentile(rankDailyAvgs, 50),
      p75: percentile(rankDailyAvgs, 75),
      mean: rankDailyAvgs.length > 0
        ? Math.round(rankDailyAvgs.reduce((s, v) => s + v, 0) / rankDailyAvgs.length)
        : 0,
      requiredPoints: cfg?.requiredPoints || 0,
      requiredDays: cfg?.requiredDays || 0,
    });
  }

  // Count by classification status from DailyLog (last 7 days average)
  const todayDate = formatDate(new Date());
  const sevenDaysAgo = formatDate(new Date(weekStart));
  const recentLogs = await DailyLog.find({
    date: { $gte: sevenDaysAgo, $lte: todayDate },
  });

  // Group by member, take the most recent status
  const memberStatusMap = new Map();
  for (const log of recentLogs) {
    memberStatusMap.set(log.discordId, log.status);
  }

  let violatorCount = 0, inactiveCount = 0, activeHighCount = 0, protectedCount = 0, graceCount = 0;
  for (const m of activeMembers) {
    const status = memberStatusMap.get(m.discordId) || 'unknown';
    switch (status) {
      case 'violator': case 'warned': violatorCount++; break;
      case 'inactive': inactiveCount++; break;
      case 'active_high': activeHighCount++; break;
      case 'protected': protectedCount++; break;
      case 'grace': graceCount++; break;
    }
  }

  // Count applications (from Member documents created this week)
  const newApplications = allMembers.filter(m => {
    const c = m.createdAt ? new Date(m.createdAt) : null;
    return c && c >= weekStart && c < weekEnd;
  }).length;

  // Count firings (isActive turned false this week via firedAt field)
  const firingsCount = allMembers.filter(m => {
    const f = m.firedAt ? new Date(m.firedAt) : null;
    return f && f >= weekStart && f < weekEnd;
  }).length;

  // Count promotions (members whose lastPromotion was this week)
  const promotionsCount = activeMembers.filter(m => {
    const p = m.lastPromotion ? new Date(m.lastPromotion) : null;
    return p && p >= weekStart && p < weekEnd;
  }).length;

  // Save
  const weekly = new WeeklyStat({
    weekStart,
    weekEnd,
    weekLabel,
    activeMembers: activeMembers.length,
    totalMembers: allMembers.length,
    medianDailyPoints,
    meanDailyPoints,
    p25,
    p75,
    violatorCount,
    inactiveCount,
    activeHighCount,
    protectedCount,
    graceCount,
    promotionsCount,
    firingsCount,
    newApplications,
    rankStats,
  });
  await weekly.save();

  console.log(`[WeeklyCalibration] ✅ حفظ إحصائيات الأسبوع: ${weekLabel}`);
  return weekly;
}

/* ===================================================================
   جلب آخر N من الإحصائيات الأسبوعية للاتجاهات
   =================================================================== */
export async function getWeeklyTrends(weeks = 6) {
  const all = await WeeklyStat.find({});
  all.sort((a, b) => {
    const da = new Date(a.weekStart).getTime();
    const db = new Date(b.weekStart).getTime();
    return db - da;
  });
  return all.slice(0, weeks).reverse();
}

/* ===================================================================
   إرسال تقرير المعايرة إلى القناة المحددة في config
   =================================================================== */
async function sendCalibrationReport(client, weekly) {
  const config = loadConfig();
  const channelId = config.logChannels?.calibration?.id;
  if (!channelId) {
    console.log('[WeeklyCalibration] ⏭ لم يتم تحديد قناة المعايرة (logChannels.calibration فارغ)');
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.error(`[WeeklyCalibration] ❌ القناة ${channelId} غير موجودة`);
    return;
  }

  const ranks = config.promotion?.ranks || [];
  const totalClassified = (weekly.violatorCount || 0) + (weekly.inactiveCount || 0)
    + (weekly.activeHighCount || 0)
    + (weekly.protectedCount || 0) + (weekly.graceCount || 0);

  let desc = `**📅 ${weekly.weekLabel || 'التقرير الأسبوعي'}**\n\n`;
  desc += `**📈 P50 (الوسيط):** ${weekly.medianDailyPoints || 0} نقطة/يوم\n`;
  desc += `**📊 P25:** ${weekly.p25 || 0} | **P75:** ${weekly.p75 || 0}\n`;
  desc += `**👥 نشطون:** ${weekly.activeMembers || 0} / ${weekly.totalMembers || 0}\n\n`;
  desc += `**🔴 مخالفون:** ${weekly.violatorCount || 0}\n`;
  desc += `**🟡 خاملون:** ${weekly.inactiveCount || 0}\n`;
  desc += `**🟢 متفاعلون:** ${weekly.activeHighCount || 0}\n`;
  desc += `**⚫ محميون:** ${weekly.protectedCount || 0}\n\n`;
  desc += `**📈 ترقيات:** ${weekly.promotionsCount || 0}\n`;
  desc += `**⛔ فصل:** ${weekly.firingsCount || 0}\n`;
  desc += `**🆕 تقديمات:** ${weekly.newApplications || 0}\n`;

  // Add per-rank summary
  if (weekly.rankStats && weekly.rankStats.length > 0) {
    desc += '\n**🏆 تحليل الرتب:**\n';
    for (const r of weekly.rankStats) {
      const estDays = r.p50 > 0 ? Math.ceil((ranks.find(rr => rr.name === r.name)?.requiredPoints || 0) / r.p50) : null;
      const requiredDays = ranks.find(rr => rr.name === r.name)?.requiredDays || 0;
      let emoji = '✅';
      if (estDays && estDays > requiredDays + 2) emoji = '🐢';
      else if (estDays && estDays < requiredDays - 2) emoji = '🚀';
      desc += `${emoji} **${r.name}** — P50: ${r.p50} | أعضاء: ${r.memberCount}`;
      if (estDays) desc += ` | تقدير: ${estDays}يوم`;
      desc += '\n';
    }
  }

  const embed = embedCustom(0x2B2D31, '📊 تقرير المعايرة الأسبوعي', desc.trim())
    .setFooter({ text: 'للتقرير الكامل استخدم /معايرة' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cal_approve').setLabel('✅ موافقة').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('cal_deny').setLabel('❌ رفض').setStyle(ButtonStyle.Danger),
  );

  await channel.send({ embeds: [embed], components: [row] });
  console.log(`[WeeklyCalibration] ✅ تم إرسال التقرير الأسبوعي إلى <#${channelId}>`);
}

/* ===================================================================
   بدء المجدول الأسبوعي
   =================================================================== */
let schedulerStarted = false;

export function startWeeklyCalibration(client) {
  if (schedulerStarted) return;
  // 21:05 UTC Saturday = 00:05 Baghdad Sunday
  schedule('5 21 * * 6', async () => {
    console.log('[WeeklyCalibration] 🌙 بدء حساب الإحصائيات الأسبوعية...');
    try {
      const weekly = await computeWeeklyStats();
      console.log('[WeeklyCalibration] ✅ الإحصائيات الأسبوعية اكتملت');

      if (client) {
        await sendCalibrationReport(client, weekly);
      }
    } catch (e) {
      console.error('[WeeklyCalibration] ❌ خطأ:', e);
    }
  });
  schedulerStarted = true;
  console.log('[WeeklyCalibration] ⏰ تم جدولة الإحصائيات الأسبوعية (الأحد 00:05 بغداد)');
}
