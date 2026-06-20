import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Member from '../models/Member.js';
import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';
import PointLog from '../models/PointLog.js';
import PersistentMessage from '../models/PersistentMessage.js';
import DailyLog from '../models/DailyLog.js';
import Grace24h from '../models/Grace24h.js';
import Warning from '../models/Warning.js';
import Attendance from '../models/Attendance.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STATS_KEY = 'stats_hub';
const REPORTS_CHANNEL_KEY = 'interaction_dashboard';
const PREFIX = 'stats_';
const PER_PAGE = 15;

let _configCache = null;
let _configCacheTime = 0;

function loadConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < 60000) return _configCache;
  try {
    const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    const committeeDataPath = join(__dirname, '../.data/Committees.json');
    try {
      const raw = readFileSync(committeeDataPath, 'utf8');
      const committeeList = JSON.parse(raw);
      if (committeeList && Object.keys(committeeList).length > 0) {
        config.committees = config.committees || {};
        config.committees.list = committeeList;
      }
    } catch {}
    _configCache = config;
    _configCacheTime = now;
  } catch { _configCache = _configCache || {}; }
  return _configCache;
}

function resolveStatsChannelId(cfg) {
  const wh = cfg?.general?.webhooks?.statsHub;
  if (wh) {
    const ch = wh.channelId;
    if (ch) {
      if (typeof ch === 'string' && ch.trim()) return ch.trim();
      if (typeof ch === 'object' && ch.id) return String(ch.id).trim();
    }
  }
  // fallback للتوافقية
  const candidates = [
    cfg?.channels?.reports,
    cfg?.points?.channels?.reports?.id,
    cfg?.general?.webhooks?.report?.channelId,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'object' && c.id) return String(c.id).trim();
  }
  return null;
}

function getIraqMidnight() {
  const now = new Date();
  const baghdad = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Baghdad' }));
  baghdad.setHours(0, 0, 0, 0);
  return baghdad;
}

function getInteractionConfig() {
  const cfg = loadConfig();
  const im = cfg.interactionMonitor || {};
  const v = (obj, fallback) => {
    if (obj === null || obj === undefined) return fallback;
    if (typeof obj === 'object' && 'value' in obj) return obj.value;
    return obj;
  };
  return {
    violatorThreshold: v(im.violatorThreshold, 100),
    inactiveThreshold: v(im.inactiveThreshold, 200),
    graceDays: v(im.graceDays, 1),
    maxWarnings: v(im.maxWarnings, 3),
  };
}

/* ===================================================================
   Data Loading
   =================================================================== */
async function loadStatsData() {
  const now = new Date();
  const midnight = getIraqMidnight();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const graceDate = new Date(now.getTime() - getInteractionConfig().graceDays * 24 * 60 * 60 * 1000);

  const [members, activeVacations, activeExcuses, activeGrace, warnings, activeWarnings, dailyPoints, weeklyPoints, attendance] = await Promise.all([
    Member.find({ isActive: true }),
    Vacation.find({ status: 'active', endDate: { $gte: now } }),
    Excuse.find({ isActive: true, type: { $ne: 'تغير اسم' }, endDate: { $gte: now } }),
    Grace24h.find({ expiresAt: { $gt: now } }),
    Warning.find({ warningType: 'inactivity', status: 'active', removed: false }),
    Warning.find({ removed: false }),
    PointLog.aggregate([{ $match: { createdAt: { $gte: midnight } } }, { $group: { _id: '$discordId', total: { $sum: '$points' } } }]),
    PointLog.aggregate([{ $match: { createdAt: { $gte: weekAgo } } }, { $group: { _id: '$discordId', total: { $sum: '$points' } } }]),
    Attendance.find({}),
  ]);

  const newMembers = await Member.find({ createdAt: { $gte: graceDate } });

  const vacMap = new Map(activeVacations.map(v => [v.memberId, v]));
  const excMap = new Map(activeExcuses.map(e => [e.memberId, e]));
  const graceIds = new Set(newMembers.map(m => m.discordId));
  const activeGraceIds = new Set(activeGrace.map(g => g.userId));
  const warnedTodayIds = new Set(warnings.map(w => w.memberId));
  const pointsMap = new Map(dailyPoints.map(p => [p._id, Math.max(0, p.total)]));
  const pointsWeeklyMap = new Map(weeklyPoints.map(p => [p._id, Math.max(0, p.total)]));

  const warningsMap = new Map();
  for (const w of activeWarnings) {
    warningsMap.set(w.memberId, (warningsMap.get(w.memberId) || 0) + 1);
  }

  const attMap = new Map();
  for (const a of attendance) {
    attMap.set(a.userId, { totalPoints: a.totalPoints || 0, totalHours: a.totalHours || 0 });
  }

  const { violatorThreshold, inactiveThreshold } = getInteractionConfig();

  // classify all members
  const classified = [];
  for (const m of members) {
    const did = m.discordId;
    let status;
    if (vacMap.has(did)) status = 'vacation';
    else if (excMap.has(did)) status = 'excuse';
    else if (graceIds.has(did) || activeGraceIds.has(did)) status = 'grace';
    else {
      const pts = pointsMap.get(did) ?? 0;
      if (pts < violatorThreshold) status = warnedTodayIds.has(did) ? 'warned' : 'violator';
      else if (pts < inactiveThreshold) status = 'inactive';
      else status = 'active_high';
    }
    const rank = m.currentRank || 'بدون رتبة';
    classified.push({
      discordId: did,
      gameName: m.gameName || 'Unknown',
      points: pointsMap.get(did) ?? 0,
      pointsWeekly: pointsWeeklyMap.get(did) ?? 0,
      status,
      rank,
      warningCount: warningsMap.get(did) || 0,
      vacation: vacMap.get(did),
      excuse: excMap.get(did),
      attendancePts: attMap.get(did)?.totalPoints || 0,
      attendanceHrs: attMap.get(did)?.totalHours || 0,
    });
  }

  // total daily points
  let totalPointsToday = 0;
  for (const p of dailyPoints) totalPointsToday += Math.max(0, p.total);

  // rank analysis
  const rankData = {};
  for (const c of classified) {
    if (!rankData[c.rank]) rankData[c.rank] = { members: [], totalPts: 0 };
    rankData[c.rank].members.push(c);
    rankData[c.rank].totalPts += c.points;
  }
  const rankSummary = Object.entries(rankData)
    .map(([rank, data]) => ({
      rank,
      count: data.members.length,
      avgPoints: data.members.length > 0 ? Math.round(data.totalPts / data.members.length) : 0,
      topMember: data.members.sort((a, b) => b.points - a.points)[0] || null,
    }))
    .sort((a, b) => b.count - a.count);

  return { classified, vacMap, excMap, pointsMap, pointsWeeklyMap, totalPointsToday, rankSummary, warningsMap };
}

/* ===================================================================
   Tab builders
   =================================================================== */
const TABS = {
  summary: { label: '📊 الملخص', color: 0x2B2D31, emoji: '📊' },
  members: { label: '🔍 التصنيفات', color: 0x3498DB, emoji: '🔍' },
  top: { label: '🏆 التوب', color: 0xFFD700, emoji: '🏆' },
  attendance: { label: '🏴‍☠️ الاحتلال', color: 0x5865F2, emoji: '🏴' },
  ranks: { label: '⚙️ التراتيب', color: 0x9B59B6, emoji: '⚙️' },
};

const TAB_ORDER = ['summary', 'members', 'top', 'attendance', 'ranks'];

function baseEmbed(tab) {
  const t = TABS[tab] || TABS.summary;
  const embed = new EmbedBuilder()
    .setColor(t.color)
    .setFooter({ text: '🕐 آخر تحديث: ' + new Date().toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' }) })
    .setTimestamp();
  return embed;
}

const STATUS_LABELS = {
  active_high: { emoji: '🟢', name: 'متفاعل عالي' },
  inactive: { emoji: '🟡', name: 'خامل' },
  violator: { emoji: '🔴', name: 'مخالف' },
  warned: { emoji: '🟤', name: 'منذر' },
  vacation: { emoji: '🏖️', name: 'إجازة' },
  excuse: { emoji: '📝', name: 'عذر' },
  grace: { emoji: '🆕', name: 'سماح' },
};

/* ---------- Summary ---------- */
function buildSummaryEmbed(data) {
  const embed = baseEmbed('summary')
    .setTitle('📊 مركز الإحصائيات الموحد 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪');

  const groups = { active_high: [], inactive: [], violator: [], warned: [], vacation: [], excuse: [], grace: [] };
  for (const c of data.classified) {
    if (groups[c.status]) groups[c.status].push(c);
  }
  groups.active_high.sort((a, b) => b.points - a.points);
  groups.inactive.sort((a, b) => a.points - b.points);
  groups.violator.sort((a, b) => a.points - b.points);

  const totalWith = groups.active_high.length + groups.inactive.length + groups.violator.length + groups.warned.length;
  const totalProtected = groups.vacation.length + groups.excuse.length;
  const totalGrace = groups.grace.length;

  // daily top 5
  const dailyTop = [...data.classified].sort((a, b) => b.points - a.points).slice(0, 5);
  const weeklyTop = [...data.classified].sort((a, b) => b.pointsWeekly - a.pointsWeekly).slice(0, 5);

  let desc = '';
  desc += '▬▬▬ ﷽ ▬▬▬\n';
  desc += `👥 **إجمالي الأعضاء النشطين**: \`${data.classified.length}\`\n`;
  desc += `📈 **إجمالي نقاط اليوم**: \`${data.totalPointsToday.toLocaleString()}\` نقطة\n`;
  desc += `🕐 **آخر تحديث**: <t:${Math.floor(Date.now() / 1000)}:R>\n\n`;
  desc += '**📊 ملخص التصنيفات:**\n';
  desc += `${STATUS_LABELS.active_high.emoji} **${STATUS_LABELS.active_high.name}**: \`${groups.active_high.length}\`　　${STATUS_LABELS.inactive.emoji} **${STATUS_LABELS.inactive.name}**: \`${groups.inactive.length}\`\n`;
  desc += `${STATUS_LABELS.violator.emoji} **${STATUS_LABELS.violator.name}**: \`${groups.violator.length}\`　　${STATUS_LABELS.warned.emoji} **${STATUS_LABELS.warned.name}**: \`${groups.warned.length}\`\n`;
  desc += `${STATUS_LABELS.vacation.emoji} **${STATUS_LABELS.vacation.name}**: \`${groups.vacation.length}\`　　${STATUS_LABELS.excuse.emoji} **${STATUS_LABELS.excuse.name}**: \`${groups.excuse.length}\`\n`;
  desc += `${STATUS_LABELS.grace.emoji} **${STATUS_LABELS.grace.name}**: \`${groups.grace.length}\`\n\n`;

  // top daily
  const medals = ['🥇', '🥈', '🥉', '✨', '⚡'];
  desc += '**🏆 أفضل 5 نقاط اليوم:**\n';
  if (dailyTop.length === 0) desc += '*لا توجد بيانات*\n';
  else {
    for (let i = 0; i < dailyTop.length; i++) {
      if (dailyTop[i].points > 0) desc += `${medals[i] || '•'} <@${dailyTop[i].discordId}> — **${dailyTop[i].points.toLocaleString()}** نقطة\n`;
    }
  }
  desc += '\n**📅 أفضل 5 هذا الأسبوع:**\n';
  if (weeklyTop.length === 0) desc += '*لا توجد بيانات*\n';
  else {
    for (let i = 0; i < weeklyTop.length; i++) {
      if (weeklyTop[i].pointsWeekly > 0) desc += `${medals[i] || '•'} <@${weeklyTop[i].discordId}> — **${weeklyTop[i].pointsWeekly.toLocaleString()}** نقطة\n`;
    }
  }

  desc += '\n▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬';

  embed.setDescription(desc);
  embed.setThumbnail(data.guild?.iconURL({ dynamic: true }) || null);
  return { embed, totalPages: 1 };
}

/* ---------- Members (Classification) ---------- */
function buildMembersEmbed(data, page = 1) {
  const statusOrder = ['active_high', 'inactive', 'violator', 'warned', 'vacation', 'excuse', 'grace'];
  const allGroups = statusOrder.flatMap(s => {
    const members = data.classified.filter(c => c.status === s);
    const sl = STATUS_LABELS[s];
    return members.map(m => ({ ...m, statusLabel: `${sl.emoji} ${sl.name}` }));
  });

  if (allGroups.length === 0) {
    const embed = baseEmbed('members').setTitle('🔍 التصنيفات').setDescription('*لا يوجد أعضاء*');
    return { embed, totalPages: 1 };
  }

  const totalPages = Math.max(1, Math.ceil(allGroups.length / PER_PAGE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * PER_PAGE;
  const slice = allGroups.slice(start, start + PER_PAGE);

  let desc = '';
  for (let i = 0; i < slice.length; i++) {
    const m = slice[i];
    const rank = start + i + 1;
    const ptsStr = m.points > 0 ? ` — ${m.points}ن` : '';
    const warnStr = m.warningCount > 0 ? ` ⚠️x${m.warningCount}` : '';
    desc += `**${rank}.** ${m.statusLabel} <@${m.discordId}>${ptsStr}${warnStr}\n`;
  }

  const embed = baseEmbed('members')
    .setTitle('🔍 التصنيفات')
    .setDescription(desc)
    .setFooter({ text: `🕐 آخر تحديث • الصفحة ${safePage}/${totalPages} • ${allGroups.length} عضو` });

  return { embed, totalPages };
}

/* ---------- Top ---------- */
function buildTopEmbed(data, page = 1) {
  const sortedDaily = [...data.classified].filter(c => c.points > 0).sort((a, b) => b.points - a.points);
  const sortedWeekly = [...data.classified].filter(c => c.pointsWeekly > 0).sort((a, b) => b.pointsWeekly - a.pointsWeekly);

  const isWeekly = page === 2;
  const list = isWeekly ? sortedWeekly : sortedDaily;
  const title = isWeekly ? '📅 لوبية الأسبوع' : '🏆 لوبية اليوم';
  const field = isWeekly ? 'pointsWeekly' : 'points';
  const unit = 'نقطة';

  if (list.length === 0) {
    const embed = baseEmbed('top').setTitle(title).setDescription('*لا توجد بيانات*');
    return { embed, totalPages: 2 };
  }

  const totalPages = list.length > 50 ? 2 : 1; // 50 members per page, but we'll just show 2 pages max
  const maxShow = 20;
  const slice = list.slice(0, maxShow);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

  let desc = '';
  for (let i = 0; i < slice.length; i++) {
    const medal = medals[i] || `\`#${i + 1}\``;
    const pts = slice[i][field];
    const gap = i > 0 && slice[i - 1][field] > 0 ? ` (−${(slice[i - 1][field] - pts).toLocaleString()})` : '';
    desc += `${medal} <@${slice[i].discordId}> — **${pts.toLocaleString()}** ${unit}${gap}\n`;
  }

  const embed = baseEmbed('top')
    .setTitle(title)
    .setDescription(desc)
    .setFooter({ text: `🕐 آخر تحديث • الصفحة ${page}/2` });

  return { embed, totalPages: 2 };
}

/* ---------- Attendance ---------- */
function buildAttendanceEmbed(data, page = 1) {
  const sorted = [...data.classified].filter(c => c.attendancePts > 0 || c.attendanceHrs > 0)
    .sort((a, b) => b.attendancePts - a.attendancePts);

  if (sorted.length === 0) {
    const embed = baseEmbed('attendance').setTitle('🏴‍☠️ إحصائيات الاحتلال').setDescription('*لا توجد بيانات احتلال*');
    return { embed, totalPages: 1 };
  }

  const totalPages = Math.max(1, Math.ceil(sorted.length / PER_PAGE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * PER_PAGE;
  const slice = sorted.slice(start, start + PER_PAGE);
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

  let desc = '';
  for (let i = 0; i < slice.length; i++) {
    const m = slice[i];
    const rank = start + i + 1;
    const medal = medals[rank - 1] || `\`#${rank}\``;
    desc += `${medal} <@${m.discordId}> — **${m.attendancePts}** نقطة | ${m.attendanceHrs} ساعة\n`;
  }

  const embed = baseEmbed('attendance')
    .setTitle('🏴‍☠️ إحصائيات الاحتلال')
    .setDescription(desc)
    .setFooter({ text: `🕐 آخر تحديث • الصفحة ${safePage}/${totalPages} • ${sorted.length} عضو` });

  return { embed, totalPages };
}

/* ---------- Ranks ---------- */
function buildRanksEmbed(data, page = 1) {
  const { rankSummary } = data;
  if (rankSummary.length === 0) {
    const embed = baseEmbed('ranks').setTitle('⚙️ تحليل التراتيب').setDescription('*لا توجد بيانات تراتيب*');
    return { embed, totalPages: 1 };
  }

  const totalPages = Math.max(1, Math.ceil(rankSummary.length / PER_PAGE));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * PER_PAGE;
  const slice = rankSummary.slice(start, start + PER_PAGE);

  let desc = '';
  for (const r of slice) {
    const memberRef = r.topMember ? `<@${r.topMember.discordId}>` : '—';
    desc += `**${r.rank}**\n👥 ${r.count} عضو | 📊 متوسط ${r.avgPoints}ن | 🥇 ${memberRef}\n\n`;
  }

  const embed = baseEmbed('ranks')
    .setTitle('⚙️ تحليل التراتيب')
    .setDescription(desc || '*لا توجد بيانات*')
    .setFooter({ text: `🕐 آخر تحديث • الصفحة ${safePage}/${totalPages} • ${rankSummary.length} رتبة` });

  return { embed, totalPages };
}

/* ===================================================================
   Button builders
   =================================================================== */
function buildButtons(activeTab, currentPage, totalPages) {
  const styleFor = (tab) => activeTab === tab ? ButtonStyle.Success : ButtonStyle.Secondary;

  const row1 = new ActionRowBuilder();
  for (const tab of TAB_ORDER) {
    const t = TABS[tab];
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}tab_${tab}`)
        .setLabel(t.label)
        .setStyle(styleFor(tab))
    );
  }

  const row2 = new ActionRowBuilder();
  const hasPages = totalPages > 1;
  row2.addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}prev`)
      .setLabel('◀️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasPages || currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}page`)
      .setLabel(`🔢 ${currentPage}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}next`)
      .setLabel('▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasPages || currentPage >= totalPages),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}refresh`)
      .setLabel('🔄 تحديث')
      .setStyle(ButtonStyle.Primary),
  );

  return [row1, row2];
}

/* ===================================================================
   Hub state (per message)
   =================================================================== */
const hubState = new Map();

function getState(msgId) {
  if (!hubState.has(msgId)) hubState.set(msgId, { tab: 'summary', page: 1 });
  return hubState.get(msgId);
}

/* ===================================================================
   Main update function
   =================================================================== */
export async function updateStatsHub(client) {
  const cfg = loadConfig();
  const channelId = resolveStatsChannelId(cfg);
  if (!channelId) {
    console.warn('⚠️ [StatsHub] قناة الإحصائيات غير محددة في config.json');
    return false;
  }

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) { console.warn(`⚠️ [StatsHub] القناة ${channelId} غير موجودة`); return false; }

    const guild = channel.guild;
    const rawData = await loadStatsData();
    rawData.guild = guild;

    // try to find existing message
    let pMsg = await PersistentMessage.findOne({ key: STATS_KEY });
    // also check legacy key
    if (!pMsg) pMsg = await PersistentMessage.findOne({ key: REPORTS_CHANNEL_KEY });
    let message = pMsg ? await channel.messages.fetch(pMsg.messageId).catch(() => null) : null;

    if (!message) {
      pMsg = null; // clear reference
    }

    // get or init state
    const msgId = message?.id || 'new';
    const state = getState(msgId);

    const { embed, totalPages } = await buildTabContent(state.tab, rawData, state.page);
    const components = buildButtons(state.tab, state.page, totalPages);

    if (message) {
      await message.edit({ embeds: [embed], components });
    } else {
      message = await channel.send({ embeds: [embed], components });
    }

    // save/re-assign persistent record
    await PersistentMessage.deleteMany({ key: { $in: [STATS_KEY, REPORTS_CHANNEL_KEY] } });
    await PersistentMessage.findOneAndUpdate(
      { key: STATS_KEY },
      { key: STATS_KEY, guildId: guild.id, channelId: channel.id, messageId: message.id, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    // sync state key to message id
    if (msgId === 'new') {
      hubState.set(message.id, state);
    } else if (msgId !== message.id) {
      hubState.set(message.id, hubState.get(msgId));
      hubState.delete(msgId);
    }

    return true;
  } catch (error) {
    console.error('❌ [StatsHub] فشل التحديث:', error.message);
    return false;
  }
}

async function buildTabContent(tab, rawData, page) {
  switch (tab) {
    case 'summary': return buildSummaryEmbed(rawData);
    case 'members': return buildMembersEmbed(rawData, page);
    case 'top': return buildTopEmbed(rawData, page);
    case 'attendance': return buildAttendanceEmbed(rawData, page);
    case 'ranks': return buildRanksEmbed(rawData, page);
    default: return buildSummaryEmbed(rawData);
  }
}

/* ===================================================================
   Scheduled update (debounced)
   =================================================================== */
let updateTimer = null;

export function scheduleStatsUpdate(client, delayMs = 3000) {
  if (!client) return;
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    updateTimer = null;
    updateStatsHub(client).catch(e => console.error('❌ [StatsHub] تحديث مجدول فشل:', e.message));
  }, delayMs);
}

/* ===================================================================
   Start on boot + periodic update every 10 minutes
   =================================================================== */
let statsInterval = null;

export async function startStatsHub(client) {
  await updateStatsHub(client);
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(() => {
    updateStatsHub(client).catch(e => console.error('❌ [StatsHub] دوري فشل:', e.message));
  }, 10 * 60 * 1000);
}

export function stopStatsHub() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

/* ===================================================================
   Interaction handler (buttons)
   =================================================================== */
export async function handleStatsInteraction(interaction) {
  if (!interaction.isButton()) return false;
  const { customId, message } = interaction;
  if (!customId.startsWith(PREFIX)) return false;

  const state = getState(message.id);

  if (customId === `${PREFIX}refresh`) {
    const cfg = loadConfig();
    const channelId = resolveStatsChannelId(cfg);
    if (!channelId) {
      await interaction.reply({ content: '❌ قناة الإحصائيات غير محددة', ephemeral: true });
      return true;
    }
    await interaction.deferUpdate().catch(() => {});
    const rawData = await loadStatsData();
    rawData.guild = interaction.guild;
    const { embed, totalPages } = await buildTabContent(state.tab, rawData, state.page);
    const components = buildButtons(state.tab, state.page, totalPages);
    await message.edit({ embeds: [embed], components }).catch(() => {});
    return true;
  }

  if (customId === `${PREFIX}prev`) {
    const cfg = loadConfig();
    const channelId = resolveStatsChannelId(cfg);
    if (!channelId) return true;
    if (state.page <= 1) return true;
    state.page--;
    await interaction.deferUpdate().catch(() => {});
    const rawData = await loadStatsData();
    rawData.guild = interaction.guild;
    const { embed, totalPages } = await buildTabContent(state.tab, rawData, state.page);
    const components = buildButtons(state.tab, state.page, totalPages);
    await message.edit({ embeds: [embed], components }).catch(() => {});
    hubState.set(message.id, state);
    return true;
  }

  if (customId === `${PREFIX}next`) {
    const cfg = loadConfig();
    const channelId = resolveStatsChannelId(cfg);
    if (!channelId) return true;
    if (!state.page) state.page = 1;
    state.page++;
    await interaction.deferUpdate().catch(() => {});
    const rawData = await loadStatsData();
    rawData.guild = interaction.guild;
    const { embed, totalPages } = await buildTabContent(state.tab, rawData, state.page);
    const components = buildButtons(state.tab, state.page, totalPages);
    await message.edit({ embeds: [embed], components }).catch(() => {});
    hubState.set(message.id, state);
    return true;
  }

  // tab switch
  if (customId.startsWith(`${PREFIX}tab_`)) {
    const tab = customId.slice(`${PREFIX}tab_`.length);
    if (!TABS[tab]) return true;
    state.tab = tab;
    state.page = 1;
    await interaction.deferUpdate().catch(() => {});
    const rawData = await loadStatsData();
    rawData.guild = interaction.guild;
    const { embed, totalPages } = await buildTabContent(tab, rawData, 1);
    const components = buildButtons(tab, 1, totalPages);
    await message.edit({ embeds: [embed], components }).catch(() => {});
    hubState.set(message.id, state);
    return true;
  }

  return true;
}
