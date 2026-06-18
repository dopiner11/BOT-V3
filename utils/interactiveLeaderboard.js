import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import Member from '../models/Member.js';
import Attendance from '../models/Attendance.js';
import PointLog from '../models/PointLog.js';
import DailyLog from '../models/DailyLog.js';
import { success as embedSuccess, error as embedError, custom as embedCustom } from './embedStyles.js';

const lbState = new Map();
const PER_PAGE = 10;

export const BTN = {
  TAB_POINTS: 'lb_pts',
  TAB_WEEKLY: 'lb_wk',
  TAB_ATTEND: 'lb_att',
  TAB_STREAK: 'lb_str',
  RANK: 'lb_rnk',
  PREV: 'lb_prv',
  NEXT: 'lb_nxt',
  REFRESH: 'lb_rfr',
};

export const ALL_LB_BUTTONS = new Set(Object.values(BTN));

function progressBar(current, max, len = 20) {
  const ratio = max > 0 ? Math.min(current / max, 1) : 0;
  const filled = Math.round(ratio * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled) + ` ${Math.round(ratio * 100)}%`;
}

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export function buildButtonRows(activeTab) {
  const style = (tab) => activeTab === tab ? ButtonStyle.Success : ButtonStyle.Secondary;
  const b = (id, label, s) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(s);

  const row1 = new ActionRowBuilder().addComponents(
    b(BTN.TAB_POINTS, '🏆 النقاط', style('points')),
    b(BTN.TAB_WEEKLY, '📅 أسبوعي', style('weekly')),
    b(BTN.TAB_ATTEND, '🏴‍☠️ الاحتلال', style('attendance')),
    b(BTN.TAB_STREAK, '🔥 ستريك', style('streak')),
  );

  const row2 = new ActionRowBuilder().addComponents(
    b(BTN.PREV, '◀️', ButtonStyle.Primary),
    b(BTN.NEXT, '▶️', ButtonStyle.Primary),
    b(BTN.RANK, '📊 مرتبتي', ButtonStyle.Secondary),
    b(BTN.REFRESH, '🔄 تحديث', ButtonStyle.Primary),
  );

  return [row1, row2];
}

async function getTotalCount(tab) {
  switch (tab) {
    case 'points': return await Member.countDocuments({ isActive: true });
    case 'weekly': return await Member.countDocuments({ isActive: true });
    case 'attendance': {
      const activeMembers = await Member.find({ isActive: true }, { discordId: 1 });
      const activeIds = activeMembers.map(m => m.discordId);
      return await Attendance.countDocuments({ userId: { $in: activeIds } });
    }
    case 'streak': return await Member.countDocuments({ isActive: true });
    default: return 0;
  }
}

async function getPointsPage(page) {
  const skip = (page - 1) * PER_PAGE;
  const members = await Member.find({ isActive: true }, { points: -1 }, skip + PER_PAGE);
  return members.slice(skip).map((m, i, arr) => ({
    discordId: m.discordId,
    points: m.points || 0,
    gapAbove: i > 0 ? (arr[i - 1].points || 0) - (m.points || 0) : null,
  })).slice(0, PER_PAGE);
}

async function getWeeklyPage(page) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const activeMembers = await Member.find({ isActive: true }, { discordId: 1 });
  const activeIds = new Set(activeMembers.map(m => m.discordId));
  const entries = await PointLog.aggregate([
    { $match: { createdAt: { $gte: sevenDaysAgo }, points: { $gt: 0 } } },
    { $group: { _id: '$discordId', totalPoints: { $sum: '$points' } } },
    { $sort: { totalPoints: -1 } },
  ]);
  const filtered = entries.filter(e => activeIds.has(e._id));
  const start = (page - 1) * PER_PAGE;
  return filtered.slice(start, start + PER_PAGE).map((e, i, arr) => ({
    discordId: e._id,
    points: e.totalPoints,
    gapAbove: i > 0 ? (arr[i - 1].totalPoints || 0) - (e.totalPoints || 0) : null,
  }));
}

async function getAttendancePage(page) {
  const activeMembers = await Member.find({ isActive: true }, { discordId: 1 });
  const activeIds = activeMembers.map(m => m.discordId);
  const skip = (page - 1) * PER_PAGE;
  const records = await Attendance.find({ userId: { $in: activeIds } }, { totalPoints: -1 }, skip + PER_PAGE);
  return records.slice(skip).map((r, i, arr) => ({
    discordId: r.userId,
    points: r.totalPoints || 0,
    gapAbove: i > 0 ? (arr[i - 1].totalPoints || 0) - (r.totalPoints || 0) : null,
  })).slice(0, PER_PAGE);
}

const STREAK_STATUSES = ['active_high', 'active'];

async function getStreakPage(page) {
  const activeMembers = await Member.find({ isActive: true }, { discordId: 1 });
  const skip = (page - 1) * PER_PAGE;
  const batch = activeMembers.slice(skip, skip + PER_PAGE);

  const entries = [];
  for (const m of batch) {
    const logs = await DailyLog.find({ discordId: m.discordId }, { date: -1 }, 365);
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    for (const log of logs) {
      if (!STREAK_STATUSES.includes(log.status)) break;
      const logDate = new Date(log.date);
      const expectedDate = new Date(today);
      expectedDate.setDate(expectedDate.getDate() - streak);
      const diffDays = Math.round((expectedDate - logDate) / 86400000);
      if (diffDays === 0) { streak++; continue; }
      if (diffDays === 1) { streak++; continue; }
      break;
    }
    entries.push({ discordId: m.discordId, points: streak });
  }

  entries.sort((a, b) => b.points - a.points);
  return entries.map((e, i, arr) => ({
    discordId: e.discordId,
    points: e.points,
    gapAbove: i > 0 && arr[i - 1].points ? arr[i - 1].points - e.points : null,
  }));
}

const TAB_CONFIG = {
  points: { title: 'لوبية النقاط', emoji: '🏆', color: 0xFFD700, fetcher: getPointsPage },
  weekly: { title: 'لوبية الأسبوع', emoji: '📅', color: 0x00AE86, fetcher: getWeeklyPage },
  attendance: { title: 'الاحتلال', emoji: '🏴‍☠️', color: 0x5865F2, fetcher: getAttendancePage },
  streak: { title: 'لوبية الستريك', emoji: '🔥', color: 0xED4245, fetcher: getStreakPage },
};

export async function buildLeaderboardEmbed(guild, tab = 'points', page = 1) {
  const cfg = TAB_CONFIG[tab] || TAB_CONFIG.points;
  const data = await cfg.fetcher(page);
  const totalCount = await getTotalCount(tab);
  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));
  const startRank = (page - 1) * PER_PAGE + 1;

  const embed = embedCustom(cfg.color, `${cfg.emoji} ${cfg.title}`).setFooter({ text: `🕐 آخر تحديث • الصفحة ${page}/${totalPages} • ${totalCount} عضو` });

  if (data.length === 0) {
    embed.setDescription('> لا يوجد بيانات متاحة');
    return { embed, totalPages };
  }

  let desc = '';
  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    const rank = startRank + i;
    const medal = rank <= 10 ? MEDALS[rank - 1] : `\`#${rank}\``;
    const pts = entry.points || 0;
    const gap = entry.gapAbove ? ` (−${entry.gapAbove})` : '';
    const unit = tab === 'streak' ? 'يوم' : 'نقطة';
    desc += `${medal} <@${entry.discordId}> — ${pts} ${unit}${gap}\n`;
  }

  embed.setDescription(desc);
  return { embed, totalPages };
}

export async function buildPersonalRankEmbed(guild, userId) {
  const user = await guild.client.users.fetch(userId).catch(() => null);
  const member = await Member.findOne({ discordId: userId });

  if (!member) {
    return embedError('📊 مرتبتك', '> ❌ أنت غير مسجل في العائلة');
  }

  const userPoints = member.points || 0;
  const aboveCount = await Member.countDocuments({ isActive: true, points: { $gt: userPoints } });
  const rank = aboveCount + 1;
  const totalMembers = await Member.countDocuments({ isActive: true });

  const top10 = await Member.find({ isActive: true }, { points: -1 }, 10);
  const top10Threshold = top10.length >= 10 ? (top10[9].points || 0) : (top10.length > 0 ? (top10[top10.length - 1].points || 0) : 0);

  let aboveUser = null, belowUser = null;
  const above = await Member.find(
    { isActive: true, discordId: { $ne: userId }, points: { $gt: userPoints } },
    { points: 1 },
    1
  );
  if (above.length > 0) aboveUser = above[0];

  const below = await Member.find(
    { isActive: true, discordId: { $ne: userId }, points: { $lt: userPoints } },
    { points: -1 },
    1
  );
  if (below.length > 0) belowUser = below[0];

  const gapAbove = aboveUser ? aboveUser.points - userPoints : null;
  const gapBelow = belowUser ? userPoints - belowUser.points : null;

  const pct = totalMembers > 0 ? (rank / totalMembers) : 0.5;
  let badge, badgeColor;
  if (pct <= 0.2) { badge = '🟢 نشيط جداً'; badgeColor = 0x00FF00; }
  else if (pct <= 0.5) { badge = '🔵 نشيط'; badgeColor = 0x3498DB; }
  else if (pct <= 0.75) { badge = '🟡 متوسط'; badgeColor = 0xF1C40F; }
  else if (pct <= 0.95) { badge = '🟠 ضعيف'; badgeColor = 0xE67E22; }
  else { badge = '🔴 خامل'; badgeColor = 0xE74C3C; }

  const embed = embedCustom(badgeColor, `📊 مرتبة ${user?.username || userId}`)
    .setThumbnail(user?.displayAvatarURL({ dynamic: true }) || null);

  let desc = `**المرتبة:** #${rank} من ${totalMembers}\n`;
  desc += `**النقاط:** ${userPoints.toLocaleString()}\n`;
  desc += `**التصنيف:** ${badge}\n\n`;

  if (gapAbove !== null) {
    desc += `⬆️ تفصلك **${gapAbove.toLocaleString()} نقطة** عن #${rank - 1} (<@${aboveUser.discordId}>)\n`;
  }
  if (gapBelow !== null) {
    desc += `⬇️ يبعد عنك **${gapBelow.toLocaleString()} نقطة** #${rank + 1} (<@${belowUser.discordId}>)\n`;
  }
  if (top10Threshold > 0 && userPoints < top10Threshold) {
    const needed = top10Threshold - userPoints;
    desc += `\n🎯 للوصول للتوب 10 تحتاج **${needed.toLocaleString()} نقطة** إضافية\n`;
    desc += progressBar(userPoints, top10Threshold) + '\n';
  } else if (top10Threshold > 0) {
    desc += '\n🎉 **أنت ضمن التوب 10!** 🎉\n';
  }

  embed.setDescription(desc);
  return embed;
}

export async function handleLeaderboardInteraction(interaction) {
  const { customId, message, guild } = interaction;
  if (!ALL_LB_BUTTONS.has(customId)) return false;

  if (customId === BTN.RANK) {
    const embed = await buildPersonalRankEmbed(guild, interaction.user.id);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return true;
  }

  const state = lbState.get(message.id) || { tab: 'points', page: 1 };

  switch (customId) {
    case BTN.TAB_POINTS:
      state.tab = 'points'; state.page = 1; break;
    case BTN.TAB_WEEKLY:
      state.tab = 'weekly'; state.page = 1; break;
    case BTN.TAB_ATTEND:
      state.tab = 'attendance'; state.page = 1; break;
    case BTN.TAB_STREAK:
      state.tab = 'streak'; state.page = 1; break;
    case BTN.PREV:
      if (state.page > 1) state.page--; break;
    case BTN.NEXT: {
      const total = await getTotalCount(state.tab);
      const max = Math.max(1, Math.ceil(total / PER_PAGE));
      if (state.page < max) state.page++; break;
    }
    case BTN.REFRESH:
      break;
  }

  lbState.set(message.id, state);

  const { embed } = await buildLeaderboardEmbed(guild, state.tab, state.page);
  await interaction.update({ embeds: [embed], components: buildButtonRows(state.tab) });
  return true;
}

export function clearLeaderboardState() {
  lbState.clear();
}
