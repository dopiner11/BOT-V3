import { schedule } from 'node-cron';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, neutral as embedNeutral, gold as embedGold, custom as embedCustom } from './embedStyles.js';
import { dmUser } from './notificationSystem.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import DailyChallenge from '../models/DailyChallenge.js';
import Member from '../models/Member.js';
import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';
import PointLog from '../models/PointLog.js';
import AttendanceLog from '../models/AttendanceLog.js';
import Report from '../models/Report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, '../config.json');

let assignTask = null;
let reminderTask = null;
let expireTask = null;
let preExpireTask = null;

function loadConfig() {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function getIraqMidnight() {
  const now = new Date();
  const offset = 3 * 60 * 60 * 1000;
  const iraq = new Date(now.getTime() + offset);
  iraq.setUTCHours(0, 0, 0, 0);
  return new Date(iraq.getTime() - offset);
}

function getIraqNoon() {
  const midnight = getIraqMidnight();
  return new Date(midnight.getTime() + 12 * 60 * 60 * 1000);
}

function todayDateStr() {
  const d = new Date();
  const offset = 3 * 60 * 60 * 1000;
  const iraq = new Date(d.getTime() + offset);
  const iraqHour = iraq.getUTCHours();
  const cfg = loadConfig().dailyChallenge || {};
  const assignTime = cfg.assignTime || '04:00';
  const [ah] = assignTime.split(':');
  const assignHour = parseInt(ah, 10);
  if (iraqHour < assignHour) {
    const yesterday = new Date(iraq.getTime() - 24 * 60 * 60 * 1000);
    return yesterday.toISOString().slice(0, 10);
  }
  return iraq.toISOString().slice(0, 10);
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function isProtectedMember(discordId) {
  const now = new Date();
  const [vacation, excuse] = await Promise.all([
    Vacation.findOne({ memberId: discordId, status: 'active', endDate: { $gte: now } }),
    Excuse.findOne({ memberId: discordId, isActive: { $ne: false }, type: { $ne: 'تغير اسم' }, endDate: { $gte: now } }),
  ]);
  return !!(vacation || excuse);
}

function formatLabel(template, vals) {
  let s = template;
  for (const [k, v] of Object.entries(vals)) s = s.replace(`{${k}}`, v);
  return s;
}

async function getChallengeConfig() {
  const config = loadConfig();
  return config.dailyChallenge || {};
}

async function getDailyStats() {
  const today = todayDateStr();
  const all = await DailyChallenge.find({ date: today });
  return {
    total: all.length,
    completed: all.filter(c => c.completed && !c.failed).length,
    failed: all.filter(c => c.failed).length,
    pending: all.filter(c => !c.completed && !c.failed).length,
    challenges: all,
  };
}

async function getOccupationMinutesToday(userId) {
  const todayStart = getIraqMidnight();
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const logs = await AttendanceLog.find({
    userId,
    timestamp: { $gte: todayStart, $lt: tomorrowStart },
  });
  return logs.reduce((sum, log) => {
    const mins = log.details?.sessionMinutes || 0;
    return sum + (typeof mins === 'number' ? mins : 0);
  }, 0);
}

async function getPointsToday(userId) {
  const todayStart = getIraqMidnight();
  const logs = await PointLog.find({ discordId: userId, createdAt: { $gte: todayStart } });
  return logs.reduce((sum, log) => sum + (log.points || 0), 0);
}

async function getReportsToday(userId) {
  const todayStart = getIraqMidnight();
  return Report.countDocuments({ reporterId: userId, createdAt: { $gte: todayStart } });
}

async function getTopPointsToday() {
  const todayStart = getIraqMidnight();
  const agg = await PointLog.aggregate([
    { $match: { createdAt: { $gte: todayStart } } },
    { $group: { _id: '$discordId', total: { $sum: '$points' } } },
    { $sort: { total: -1 } },
  ]);
  return agg;
}

async function getTopOccupationToday() {
  const todayStart = getIraqMidnight();
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const allLogs = await AttendanceLog.find({
    timestamp: { $gte: todayStart, $lt: tomorrowStart },
  });
  const byUser = {};
  for (const log of allLogs) {
    const mins = log.details?.sessionMinutes || 0;
    if (typeof mins === 'number' && mins > 0) {
      byUser[log.userId] = (byUser[log.userId] || 0) + mins;
    }
  }
  return Object.entries(byUser)
    .map(([userId, total]) => ({ _id: userId, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

async function getTopReportsToday() {
  const todayStart = getIraqMidnight();
  const agg = await Report.aggregate([
    { $match: { createdAt: { $gte: todayStart } } },
    { $group: { _id: '$reporterId', total: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);
  return agg;
}

async function verifyMemberChallenge(discordId, challenge) {
  const now = new Date();
  const challengeCreated = challenge.createdAt || now;

  switch (challenge.type) {
    case 'occupation': {
      const mins = await getOccupationMinutesToday(discordId);
      return { passed: mins >= challenge.requirement, current: Math.round(mins), required: challenge.requirement };
    }
    case 'reports': {
      const count = await getReportsToday(discordId);
      return { passed: count >= challenge.requirement, current: count, required: challenge.requirement };
    }
    case 'points': {
      const pts = await getPointsToday(discordId);
      return { passed: pts >= challenge.requirement, current: pts, required: challenge.requirement };
    }
    case 'golden_12h': {
      const deadline = new Date(challengeCreated.getTime() + 12 * 60 * 60 * 1000);
      const checkEnd = deadline < now ? deadline : now;
      const logs = await PointLog.find({
        discordId,
        createdAt: { $gte: challengeCreated, $lte: checkEnd },
      });
      const pts = logs.reduce((s, l) => s + (l.points || 0), 0);
      return { passed: pts >= challenge.requirement, current: pts, required: challenge.requirement, deadline };
    }
    case 'top_points': {
      const tops = await getTopPointsToday();
      const isTop = tops.length > 0 && tops[0]._id === discordId;
      const myPts = await getPointsToday(discordId);
      return { passed: isTop, current: myPts, top: tops[0]?._id, topValue: tops[0]?.total || 0 };
    }
    case 'top_occupation': {
      const tops = await getTopOccupationToday();
      const isTop = tops.length > 0 && tops[0]._id === discordId;
      const myMins = await getOccupationMinutesToday(discordId);
      return { passed: isTop, current: Math.round(myMins), top: tops[0]?._id, topValue: tops[0]?.total || 0 };
    }
    case 'top_reports': {
      const tops = await getTopReportsToday();
      const isTop = tops.length > 0 && tops[0]._id === discordId;
      const myReps = await getReportsToday(discordId);
      return { passed: isTop, current: myReps, top: tops[0]?._id, topValue: tops[0]?.total || 0 };
    }
    default:
      return { passed: false, current: 0, required: 0 };
  }
}

async function awardMember(discordId, challenge, client) {
  const reward = challenge.reward;
  const member = await Member.findOne({ discordId });
  if (member) {
    member.points = (member.points || 0) + reward;
    await member.save();
  }
  await PointLog.create({
    discordId,
    points: reward,
    reason: `🏆 مكافأة تحدي اليوم: ${getChallengeLabel(challenge)}`,
    actionBy: 'system_daily_challenge',
  });
  challenge.completed = true;
  challenge.completedAt = new Date();
  await challenge.save();
  await sendChallengeLog(discordId, challenge, client);
}

async function sendLogEmbed(client, title, description, color = 0x2B2D31) {
  const config = loadConfig();
  const channelId = config.dailyChallenge?.logChannelId || config.logChannels?.challenges?.id;
  if (!channelId) return;
  const embed = embedCustom(color, title, description);
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
  } catch { /* skip */ }
}

async function sendChallengeLog(discordId, challenge, client) {
  const config = loadConfig();
  const challengeLogId = config.dailyChallenge?.logChannelId || config.logChannels?.challenges?.id;
  const pointsLogId = config.logChannels?.points?.id;
  const member = await Member.findOne({ discordId });
  const gameName = member?.gameName || discordId;

  const embed = embedNeutral('🏆 تحدي اليوم — مكافأة', `
👤 **${gameName}** (<@${discordId}>)
🎮 **التحدي:** ${getChallengeLabel(challenge)}
💰 **المكافأة:** +${challenge.reward} نقطة ⭐
📅 **التاريخ:** ${todayDateStr()}
🕐 **الإكتمال:** <t:${Math.floor(Date.now() / 1000)}:R>
  `.trim());

  const logChannels = [challengeLogId, pointsLogId].filter(Boolean);
  for (const channelId of logChannels) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.send({ embeds: [embed] }).catch(e => console.error('[DailyChallenge]', e?.message || e));
    } catch { /* skip */ }
  }
}

function getChallengeLabel(challenge) {
  const labels = {
    occupation: `${Math.round(challenge.requirement / 60)} ساعات احتلال`,
    reports: `${challenge.requirement} تقارير`,
    points: `${challenge.requirement} نقطة`,
    golden_12h: 'أول 80 نقطة في 12 ساعة',
    top_points: 'الأكثر نقاطاً',
    top_occupation: 'الأكثر ساعات احتلال',
    top_reports: 'الأكثر تقارير',
  };
  return labels[challenge.type] || challenge.type;
}

async function buildChallengeEmbed(challenge, guild) {
  const member = await Member.findOne({ discordId: challenge.discordId });
  const gameName = member?.gameName || 'غير معروف';
  const cfg = await getChallengeConfig();
  const expireTime = cfg.expireTime || '21:00';
  const [eh, em] = expireTime.split(':');
  const deadline = new Date(new Date(challenge.date + 'T' + expireTime + ':00Z').getTime());
  const now = new Date();
  const isExpired = now > deadline;

  const statusText = challenge.failed ? '❌ فشل' : challenge.completed ? '✅ مكتمل' : isExpired ? '⌛ منتهي' : '⏳ قيد التنفيذ';
  const desc = `
👤 **${gameName}**
📅 **${challenge.date || todayDateStr()}**

🎮 **التحدي:** ${getChallengeLabel(challenge)}
💰 **المكافأة:** ${challenge.reward} نقطة ⭐
⏳ **الحالة:** ${statusText}
🕐 **ينتهي:** ${expireLabel} (<t:${Math.floor(deadline.getTime() / 1000)}:R>)
  `.trim();

  const embed = challenge.failed
    ? embedCustom(0x8B0000, `🎯 تحدي اليوم — ${guild?.name || 'X.IRAQ FAMILY'}`, desc)
    : embedNeutral(`🎯 تحدي اليوم — ${guild?.name || 'X.IRAQ FAMILY'}`, desc);

  return embed;
}

async function expirePendingChallenges(client) {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterdayStr = new Date(yesterday.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pending = await DailyChallenge.find({ date: yesterdayStr, completed: false, failed: { $ne: true } });
  if (pending.length === 0) return;
  const guild = client.guilds.cache.get(loadConfig().bot?.guildId);
  let expired = 0;
  for (const ch of pending) {
    try {
      ch.failed = true;
      await ch.save();
      if (ch.channelId && ch.messageId && guild) {
        try {
          const channel = await client.channels.fetch(ch.channelId).catch(() => null);
          if (channel) {
            const msg = await channel.messages.fetch(ch.messageId).catch(() => null);
            if (msg) {
              const embed = await buildChallengeEmbed(ch, guild);
              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ch_claim_${ch._id}`).setLabel('✅ تم اتمام التحدي').setStyle(ButtonStyle.Success).setDisabled(true),
              );
              await msg.edit({ embeds: [embed], components: [row] }).catch(e => console.error('[DailyChallenge]', e?.message || e));
            }
          }
        } catch { /* ignore */ }
      }
      expired++;
    } catch { /* skip */ }
  }
  if (expired > 0) {
    console.log(`[DailyChallenge] Expired ${expired} pending challenges from ${yesterdayStr}`);
    await sendLogEmbed(client, '⏰ انتهاء صلاحية التحديات', `انتهت صلاحية **${expired}** تحدي (لم تكتمل) لتاريخ ${yesterdayStr}`, 0x8B0000);
  }
}

async function sendPreExpireReminder(client) {
  const today = todayDateStr();
  const pending = await DailyChallenge.find({ date: today, completed: false, failed: { $ne: true } });
  if (pending.length === 0) return;
  const guild = client.guilds.cache.get(loadConfig().bot?.guildId);
  if (!guild) return;
  let warned = 0;
  for (const ch of pending) {
    try {
      const memberData = await Member.findOne({ discordId: ch.discordId });
      if (memberData?.roomChannelId) {
        const channel = guild.channels.cache.get(memberData.roomChannelId);
        if (channel) await channel.send({ content: `⚠️ **تنبيه:** يا <@${ch.discordId}>، راح ينتهي تحديك بعد 4 ساعات وانت لسا ما كملته! استعجل.` }).catch(e => console.error('[DailyChallenge]', e?.message || e));
      }
      try {
        const user = await client.users.fetch(ch.discordId).catch(() => null);
        if (user) await user.send({ content: `⚠️ **تنبيه تحدي اليوم:** يا ${user.username}، راح ينتهي تحديك في 𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 بعد 4 ساعات وانت لسا ما كملته! استعجل.` }).catch(e => console.error('[DailyChallenge]', e?.message || e));
      } catch { /* DM may fail */ }
      warned++;
    } catch { /* skip */ }
  }
  if (warned > 0) console.log(`[DailyChallenge] Pre-expire warned ${warned} members`);
}

async function assignDailyChallenges(client) {
  const cfg = await getChallengeConfig();
  if (!cfg.enabled) return;

  const today = todayDateStr();

  // Expire yesterday's pending challenges before assigning new ones
  await expirePendingChallenges(client);

  // Load existing challenges to skip members who already have one
  const existingChallenges = await DailyChallenge.find({ date: today });
  const existingMap = new Map(existingChallenges.map(c => [c.discordId, c]));

  const members = await Member.find({ isActive: true });
  const types = Object.entries(cfg.challengeTypes || {}).filter(([_, t]) => t.enabled);

  if (types.length === 0) {
    console.log('[DailyChallenge] No enabled challenge types');
    return;
  }

  const guild = client.guilds.cache.get(loadConfig().bot?.guildId);
  let assigned = 0;

  let skipped = 0;
  for (const member of members) {
    try {
      if (await isProtectedMember(member.discordId)) continue;
      if (existingMap.has(member.discordId)) {
        console.log(`[DailyChallenge] ${member.discordId} already has a challenge, skipping`);
        skipped++;
        continue;
      }

      const [typeKey, typeCfg] = pickRandom(types);
      let requirement, reward;

      if (typeCfg.variants) {
        const idx = Math.floor(Math.random() * typeCfg.variants.length);
        requirement = typeCfg.variants[idx];
        reward = typeCfg.rewards?.[idx] || typeCfg.reward || 50;
      } else {
        requirement = typeCfg.requirement || 0;
        reward = typeCfg.reward || 50;
      }

      const challenge = await DailyChallenge.create({
        discordId: member.discordId,
        date: today,
        type: typeKey,
        requirement,
        reward,
        completed: false,
      });

      const channel = guild?.channels.cache.get(member.roomChannelId);
      if (channel) {
        const embed = await buildChallengeEmbed(challenge, guild);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`ch_claim_${challenge._id}`)
            .setLabel('✅ تم اتمام التحدي')
            .setStyle(ButtonStyle.Success)
            .setDisabled(challenge.completed),
        );
        const msg = await channel.send({ content: `<@${member.discordId}>`, embeds: [embed], components: [row] }).catch(() => null);
        if (msg) {
          challenge.messageId = msg.id;
          challenge.channelId = channel.id;
          await challenge.save();
        }
      }
      assigned++;
    } catch (e) {
      console.error(`[DailyChallenge] Error assigning to ${member.discordId}:`, e.message);
    }
  }

  console.log(`[DailyChallenge] Assigned ${assigned}/${members.length} (skipped ${skipped} already had a challenge) for ${today}`);
  await sendLogEmbed(client, '📨 تعيين التحديات اليومية', `تم تعيين **${assigned}** تحدي جديد لليوم **${today}**\nتخطي ${skipped} عضو لديهم تحديات مسبقة`, 0x2B2D31);
}

async function sendReminder(client) {
  const today = todayDateStr();
  const pending = await DailyChallenge.find({ date: today, completed: false, failed: { $ne: true } });
  if (pending.length === 0) return;

  const guild = client.guilds.cache.get(loadConfig().bot?.guildId);
  if (!guild) return;

  let reminded = 0;
  for (const ch of pending) {
    try {
      const memberData = await Member.findOne({ discordId: ch.discordId });
      if (memberData?.roomChannelId) {
        const channel = guild.channels.cache.get(memberData.roomChannelId);
        if (channel) await channel.send({ content: `⏰ **تذكير:** يا <@${ch.discordId}>، لسه ما كملت تحديك! باقي وقت لتكملة تحديك.` }).catch(e => console.error('[DailyChallenge]', e?.message || e));
      }
      try {
        const user = await client.users.fetch(ch.discordId).catch(() => null);
        if (user) await user.send({ content: `⏰ **تذكير تحدي اليوم:** يا ${user.username}، لسه ما كملت تحديك في 𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘! باقي وقت لتكملة تحديك.` }).catch(e => console.error('[DailyChallenge]', e?.message || e));
      } catch { /* DM may fail */ }
      reminded++;
    } catch { /* skip */ }
  }
  console.log(`[DailyChallenge] Reminded ${reminded} members`);
}

export async function handleChallengeClaim(interaction) {
  const customId = interaction.customId;
  const challengeId = customId.replace('ch_claim_', '');
  const discordId = interaction.user.id;

  const challenge = await DailyChallenge.findById(challengeId);
  if (!challenge) {
    return interaction.reply({ content: '❌ هذا التحدي غير موجود أو تم حذفه.', flags: MessageFlags.Ephemeral });
  }

  if (challenge.discordId !== discordId) {
    return interaction.reply({ content: '❌ هذا التحدي مو مخصص لك.', flags: MessageFlags.Ephemeral });
  }

  if (challenge.failed) {
    return interaction.reply({ content: '❌ هذا التحدي انتهت مدته وفشل.', flags: MessageFlags.Ephemeral });
  }

  if (challenge.completed) {
    return interaction.reply({ content: '✅ لقد أكملت هذا التحدي مسبقاً!', flags: MessageFlags.Ephemeral });
  }

  const now = new Date();
  const age = now.getTime() - (challenge.createdAt || now).getTime();
  if (age > 24 * 60 * 60 * 1000) {
    return interaction.reply({ content: '⌛ انتهت مدة هذا التحدي (أكثر من 24 ساعة).', flags: MessageFlags.Ephemeral });
  }

  if (challenge.type === 'golden_12h') {
    const deadline = new Date((challenge.createdAt || now).getTime() + 12 * 60 * 60 * 1000);
    if (now > deadline) {
      return interaction.reply({ content: '⌛ انتهت الـ 12 ساعة المسموحة لهذا التحدي.', flags: MessageFlags.Ephemeral });
    }
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await verifyMemberChallenge(discordId, challenge);

  if (!result.passed) {
    const lines = [`❌ **لم تكمل التحدي بعد!**`];
    if (challenge.type.startsWith('top_')) {
      if (result.top && result.top !== discordId) {
        lines.push(`🏆 **المركز الأول:** <@${result.top}> — **${result.topValue}**`);
        lines.push(`📊 **إنجازك:** **${result.current}**`);
        lines.push(`\n⚠️ ما دام ما صرت الأول، تقدر تكمل وتجرب مرة ثانية.`);
      } else {
        lines.push(`📊 **إنجازك الحالي:** **${result.current}**`);
        lines.push(`\n⚠️ لسا ما وصلت للمطلوب، كمل تفاعل وارجع جرب.`);
      }
    } else if (result.required !== undefined) {
      lines.push(`📊 **المطلوب منك:** **${result.required}**`);
      lines.push(`📈 **إنجازك:** **${result.current}**`);
      const diff = result.required - result.current;
      lines.push(`\n⚠️ ناقصك **${diff > 0 ? diff : 0}** لتكمل التحدي.`);
    } else {
      lines.push(`\n⚠️ لسا ما استوفيت الشروط، كمل وارجع جرب.`);
    }
    lines.push(`⏳ لين ما ينتهي الوقت، لسه عندك فرصة.`);
    return interaction.editReply({ content: lines.join('\n') });
  }

  await awardMember(discordId, challenge, interaction.client);

  const guild = interaction.guild || interaction.client.guilds.cache.get(loadConfig().bot?.guildId);
  const embed = await buildChallengeEmbed(challenge, guild);

  if (challenge.channelId && challenge.messageId) {
    try {
      const ch = await interaction.client.channels.fetch(challenge.channelId).catch(() => null);
      if (ch) {
        const msg = await ch.messages.fetch(challenge.messageId).catch(() => null);
        if (msg) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`ch_claim_${challenge._id}`)
              .setLabel('✅ تم اتمام التحدي')
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
          );
          await msg.edit({ embeds: [embed], components: [row] }).catch(e => console.error('[DailyChallenge]', e?.message || e));
        }
      }
    } catch { /* ignore */ }
  }

  await interaction.editReply({ content: `✅ **تهانينا!** لقد أكملت التحدي وحصلت على **${challenge.reward}** نقطة ⭐` });
}

function isAdmin(interaction) {
  const cfg = loadConfig();
  const founders = cfg.committees?.founders || [];
  const authorized = cfg.committees?.authorizedUsers || [];
  if (founders.includes(interaction.user.id) || authorized.includes(interaction.user.id)) return true;
  if (interaction.memberPermissions?.has('Administrator')) return true;
  const committees = cfg.committees?.list || {};
  const memberRoles = interaction.member?.roles?.cache;
  if (!memberRoles) return false;
  for (const committee of Object.values(committees)) {
    for (const levelRoles of Object.values(committee.roles || {})) {
      for (const roleId of levelRoles) {
        if (memberRoles.has(roleId)) return true;
      }
    }
  }
  return false;
}

async function buildAdminPanel() {
  const today = todayDateStr();
  const stats = await getDailyStats();
  const cfg = await getChallengeConfig();
  const enabledTypes = Object.entries(cfg.challengeTypes || {}).filter(([_, t]) => t.enabled);

  const desc = `
${cfg.enabled ? '🟢' : '🔴'} **الحالة:** ${cfg.enabled ? 'نشط' : 'معطل'}
📅 **التاريخ:** ${today}

📊 **الإحصائيات:**
👥 إجمالي التحديات: **${stats.total}**
✅ مكتمل: **${stats.completed}**
❌ فاشل: **${stats.failed || 0}**
⏳ قيد التنفيذ: **${stats.pending}**
⭐ إجمالي المكافآت: ${stats.challenges.filter(c => c.completed && !c.failed).reduce((s, c) => s + c.reward, 0)} نقطة

⚙️ **الأنواع المفعلة (${enabledTypes.length}):**
${enabledTypes.map(([k]) => `✅ ${getTypeLabel(k)}`).join('\n')}
  `.trim();

  const embed = cfg.enabled
    ? embedNeutral('🎛️ تحديات اليوم — لوحة التحكم', desc)
    : embedCustom(0x8B0000, '🎛️ تحديات اليوم — لوحة التحكم', desc);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ch_toggle').setLabel(cfg.enabled ? '🔴 إيقاف' : '🟢 تشغيل').setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ch_config').setLabel('⚙️ الإعدادات').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ch_status').setLabel('📊 الإحصائيات').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ch_assign_all').setLabel('📨 إرسال للجميع').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ch_clear_active').setLabel('🗑️ حذف التحديات النشطة').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ch_manage').setLabel('👤 إدارة عضو').setStyle(ButtonStyle.Primary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ch_log').setLabel('📋 سجل المكافآت').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2, row3] };
}

export async function handleChallengeAdmin(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  }
  const panel = await buildAdminPanel();
  if (interaction.isButton()) {
    await interaction.update(panel);
  } else {
    await interaction.reply(panel);
  }
}

function getTypeLabel(key) {
  const labels = {
    occupation: 'ساعات الاحتلال',
    reports: 'تقارير',
    points: 'نقاط',
    golden_12h: 'أول 80 نقطة',
    top_points: 'الأكثر نقاطاً',
    top_occupation: 'الأكثر احتلال',
    top_reports: 'الأكثر تقارير',
  };
  return labels[key] || key;
}

export async function handleChallengeToggle(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const cfgPath = configPath;
  const config = loadConfig();
  if (!config.dailyChallenge) config.dailyChallenge = { enabled: true, challengeTypes: {} };
  config.dailyChallenge.enabled = !config.dailyChallenge.enabled;
  writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');
  if (config.dailyChallenge.enabled) {
    await startDailyChallenge(interaction.client);
  } else {
    stopDailyChallenge();
  }
  const panel = await buildAdminPanel();
  await interaction.update(panel);
  const status = config.dailyChallenge.enabled ? 'تشغيل' : 'إيقاف';
  await interaction.followUp({ content: `✅ تم ${status} نظام التحديات.`, flags: MessageFlags.Ephemeral });
  await sendLogEmbed(interaction.client, `🔄 ${status} نظام التحديات`,
    `**الحالة:** ${config.dailyChallenge.enabled ? '🟢 نشط' : '🔴 معطل'}\n**بواسطة:** <@${interaction.user.id}>`,
    config.dailyChallenge.enabled ? 0x2B2D31 : 0x8B0000);
}

export async function handleChallengeAssignAll(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  await interaction.deferUpdate();
  const today = todayDateStr();
  const existingChallenges = await DailyChallenge.find({ date: today });
  const existingMap = new Map(existingChallenges.map(c => [c.discordId, c]));
  const members = await Member.find({ isActive: true });
  let assigned = 0;
  let skipped = 0;
  const cfg = await getChallengeConfig();
  const types = Object.entries(cfg.challengeTypes || {}).filter(([_, t]) => t.enabled);
  const guild = interaction.guild || interaction.client.guilds.cache.get(loadConfig().bot?.guildId);
  for (const member of members) {
    try {
      if (await isProtectedMember(member.discordId)) continue;
      if (existingMap.has(member.discordId)) { skipped++; continue; }
      const [typeKey, typeCfg] = pickRandom(types);
      let requirement, reward;
      if (typeCfg.variants) {
        const idx = Math.floor(Math.random() * typeCfg.variants.length);
        requirement = typeCfg.variants[idx];
        reward = typeCfg.rewards?.[idx] || typeCfg.reward || 50;
      } else {
        requirement = typeCfg.requirement || 0;
        reward = typeCfg.reward || 50;
      }
      const challenge = await DailyChallenge.create({ discordId: member.discordId, date: today, type: typeKey, requirement, reward, completed: false });
      const channel = guild?.channels.cache.get(member.roomChannelId);
      if (channel) {
        const embed = await buildChallengeEmbed(challenge, guild);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ch_claim_${challenge._id}`).setLabel('✅ تم اتمام التحدي').setStyle(ButtonStyle.Success),
        );
        const msg = await channel.send({ content: `<@${member.discordId}>`, embeds: [embed], components: [row] }).catch(() => null);
        if (msg) { challenge.messageId = msg.id; challenge.channelId = channel.id; await challenge.save(); }
      }
      assigned++;
    } catch { /* skip */ }
  }
  const panel = await buildAdminPanel();
  await interaction.editReply(panel);
  await interaction.followUp({ content: skipped > 0 ? `✅ تم إرسال تحديات لـ **${assigned}** عضو (تخطينا ${skipped} لأن عندهم تحديات مسبقاً).` : `✅ تم إرسال تحديات لـ **${assigned}** عضو.`, flags: MessageFlags.Ephemeral });
}

export async function handleChallengeClearActive(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const active = await DailyChallenge.find({ completed: { $ne: true }, failed: { $ne: true } });
  if (active.length === 0) {
    return interaction.reply({ content: '📭 لا توجد تحديات نشطة للحذف.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  let deletedMessages = 0;
  for (const ch of active) {
    if (ch.channelId && ch.messageId) {
      try {
        const channel = await interaction.client.channels.fetch(ch.channelId).catch(() => null);
        if (channel) {
          const msg = await channel.messages.fetch(ch.messageId).catch(() => null);
          if (msg) { await msg.delete().catch(e => console.error('[DC]', e?.message)); deletedMessages++; }
        }
      } catch { /* ignore */ }
    }
  }
  await DailyChallenge.deleteMany({ completed: { $ne: true }, failed: { $ne: true } });
  const panel = await buildAdminPanel();
  await interaction.editReply(panel);
  await interaction.followUp({ content: `✅ تم حذف **${active.length}** تحدي نشط (${deletedMessages} رسالة محذوفة).`, flags: MessageFlags.Ephemeral });
  await sendLogEmbed(interaction.client, '🗑️ حذف التحديات النشطة',
    `تم حذف **${active.length}** تحدي نشط من قاعدة البيانات\n🗑️ **رسائل محذوفة:** ${deletedMessages}\n👤 **بواسطة:** <@${interaction.user.id}>`, 0x8B0000);
}

export async function handleChallengeStatus(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const stats = await getDailyStats();

  const today = todayDateStr();
  const lines = [`📊 **إحصائيات تحديات ${today}**\n`];
  lines.push(`👥 **الإجمالي:** ${stats.total}`);
  lines.push(`✅ **مكتمل:** ${stats.completed}`);
  lines.push(`❌ **فاشل:** ${stats.failed || 0}`);
  lines.push(`⏳ **قيد التنفيذ:** ${stats.pending}`);
  lines.push(`⭐ **المكافآت الممنوحة:** ${stats.challenges.filter(c => c.completed && !c.failed).reduce((s, c) => s + c.reward, 0)} نقطة`);

  const byType = {};
  for (const c of stats.challenges) {
    if (!byType[c.type]) byType[c.type] = { total: 0, completed: 0, failed: 0 };
    byType[c.type].total++;
    if (c.completed && !c.failed) byType[c.type].completed++;
    if (c.failed) byType[c.type].failed++;
  }
  lines.push(`\n📂 **حسب النوع:**`);
  for (const [type, data] of Object.entries(byType)) {
    lines.push(`${getTypeLabel(type)}: ✅${data.completed} ❌${data.failed || 0}/${data.total}`);
  }

  await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
}

export async function handleChallengeManage(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = await import('discord.js');
  const modal = new ModalBuilder()
    .setCustomId('ch_manage_modal')
    .setTitle('👤 إدارة تحدي عضو')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ch_manage_user')
          .setLabel('آيدي أو منشن العضو')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('مثال: 1489892734184591511 أو @user'),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleChallengeManageModal(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const raw = interaction.fields.getTextInputValue('ch_manage_user').trim();
  const discordId = raw.replace(/[<@!>]/g, '');
  const member = await Member.findOne({ discordId });
  if (!member) {
    return interaction.reply({ content: '❌ العضو غير موجود.', flags: MessageFlags.Ephemeral });
  }
  const today = todayDateStr();
  const existing = await DailyChallenge.findOne({ discordId, date: today });

  const statusText = existing ? (existing.failed ? '❌ فشل' : existing.completed ? '✅ مكتمل' : '⏳ قيد التنفيذ') : '—';
  const embed = embedNeutral(`👤 إدارة تحدي — ${member.gameName || discordId}`, existing
    ? `**التحدي الحالي:** ${getChallengeLabel(existing)}\n**المطلوب:** ${existing.requirement}\n**المكافأة:** ${existing.reward} نقطة\n**الحالة:** ${statusText}`
    : '🚫 **لا يوجد تحدي لهذا العضو اليوم.**');

  const rows = [];
  if (existing) {
    const actionBtns = [
      new ButtonBuilder().setCustomId(`ch_edit_${discordId}`).setLabel('✏️ تعديل').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ch_delete_${discordId}`).setLabel('🗑️ حذف التحدي').setStyle(ButtonStyle.Danger),
    ];
    if (!existing.completed && !existing.failed) {
      actionBtns.push(new ButtonBuilder().setCustomId(`ch_force_complete_${discordId}`).setLabel('✅ إعتباره مكتمل').setStyle(ButtonStyle.Success));
      actionBtns.push(new ButtonBuilder().setCustomId(`ch_force_fail_${discordId}`).setLabel('❌ إعتباره فاشل').setStyle(ButtonStyle.Danger));
    }
    actionBtns.push(new ButtonBuilder().setCustomId('ch_refresh_admin').setLabel('🔙 رجوع').setStyle(ButtonStyle.Secondary));
    rows.push(new ActionRowBuilder().addComponents(actionBtns));
  } else {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ch_add_${discordId}`).setLabel('➕ إضافة تحدي').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ch_refresh_admin').setLabel('🔙 رجوع').setStyle(ButtonStyle.Secondary),
    ));
  }

  await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
}

export async function handleChallengeAdd(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const discordId = interaction.customId.replace('ch_add_', '');
  const cfg = await getChallengeConfig();
  const types = Object.entries(cfg.challengeTypes || {}).filter(([_, t]) => t.enabled);
  if (types.length === 0) {
    return interaction.reply({ content: '❌ لا توجد أنواع تحديات مفعلة.', flags: MessageFlags.Ephemeral });
  }
  const select = new (await import('discord.js')).StringSelectMenuBuilder()
    .setCustomId(`ch_add_type_${discordId}`)
    .setPlaceholder('اختر نوع التحدي')
    .addOptions(types.map(([k, t]) => ({ label: getTypeLabel(k), value: k, description: t.label || '' })));
  const row = new ActionRowBuilder().addComponents(select);
  await interaction.reply({ content: '🎯 اختر نوع التحدي:', components: [row], flags: MessageFlags.Ephemeral });
}

export async function handleChallengeAddType(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const discordId = interaction.customId.replace('ch_add_type_', '');
  const typeKey = interaction.values[0];
  const cfg = await getChallengeConfig();
  const typeCfg = cfg.challengeTypes?.[typeKey];
  if (!typeCfg) return interaction.reply({ content: '❌ نوع غير موجود.', flags: MessageFlags.Ephemeral });

  const modal = new (await import('discord.js')).ModalBuilder()
    .setCustomId(`ch_add_confirm_${discordId}_${typeKey}`)
    .setTitle(`➕ إضافة تحدي: ${getTypeLabel(typeKey)}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new (await import('discord.js')).TextInputBuilder()
          .setCustomId('ch_add_reward')
          .setLabel('المكافأة (نقاط)')
          .setStyle((await import('discord.js')).TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(typeCfg.rewards?.[0] || typeCfg.reward || 50)),
      ),
    );

  if (!typeKey.startsWith('top_')) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new (await import('discord.js')).TextInputBuilder()
          .setCustomId('ch_add_req')
          .setLabel('المطلوب (الرقم)')
          .setStyle((await import('discord.js')).TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(typeCfg.variants?.[0] || typeCfg.requirement || 0)),
      ),
    );
  }
  await interaction.showModal(modal);
}

export async function handleChallengeAddConfirm(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const parts = interaction.customId.replace('ch_add_confirm_', '').split('_');
  const discordId = parts[0];
  const typeKey = parts.slice(1).join('_');
  const isTopType = typeKey.startsWith('top_');
  const req = isTopType ? 1 : parseInt(interaction.fields.getTextInputValue('ch_add_req'), 10);
  const reward = parseInt(interaction.fields.getTextInputValue('ch_add_reward'), 10);
  if (isNaN(reward) || (!isTopType && isNaN(req))) {
    return interaction.reply({ content: '❌ قيم غير صالحة.', flags: MessageFlags.Ephemeral });
  }
  const today = todayDateStr();
  await DailyChallenge.deleteOne({ discordId, date: today });
  const challenge = await DailyChallenge.create({
    discordId,
    date: today,
    type: typeKey,
    requirement: req,
    reward,
    completed: false,
  });
  const guild = interaction.guild || interaction.client.guilds.cache.get(loadConfig().bot?.guildId);
  const member = await Member.findOne({ discordId });
  if (member?.roomChannelId && guild) {
    const channel = guild.channels.cache.get(member.roomChannelId);
    if (channel) {
      const embed = await buildChallengeEmbed(challenge, guild);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ch_claim_${challenge._id}`)
          .setLabel('✅ تم اتمام التحدي')
          .setStyle(ButtonStyle.Success),
      );
      const msg = await channel.send({ content: `<@${discordId}>`, embeds: [embed], components: [row] }).catch(() => null);
      if (msg) {
        challenge.messageId = msg.id;
        challenge.channelId = channel.id;
        await challenge.save();
      }
    }
  }
  const updatedEmbed = embedNeutral(`👤 إدارة تحدي — ${member?.gameName || discordId}`, `**التحدي الحالي:** ${getChallengeLabel(challenge)}\n**المطلوب:** ${challenge.requirement}\n**المكافأة:** ${challenge.reward} نقطة\n**الحالة:** ⏳ قيد التنفيذ`);
  const updatedRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ch_edit_${discordId}`).setLabel('✏️ تعديل').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ch_delete_${discordId}`).setLabel('🗑️ حذف التحدي').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ch_refresh_admin').setLabel('🔙 رجوع').setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
  await interaction.followUp({ content: `✅ تم إضافة التحدي للعضو ${member?.gameName || discordId}.`, flags: MessageFlags.Ephemeral });
  await sendLogEmbed(interaction.client, '➕ إضافة تحدي لعضو',
    `**العضو:** <@${discordId}> (${member?.gameName || '?'})\n**التحدي:** ${getChallengeLabel(challenge)}\n**المطلوب:** ${challenge.requirement}\n**المكافأة:** ${challenge.reward} نقطة\n**بواسطة:** <@${interaction.user.id}>`, 0x2B2D31);
}

export async function handleChallengeEdit(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const discordId = interaction.customId.replace('ch_edit_', '');
  const today = todayDateStr();
  const existing = await DailyChallenge.findOne({ discordId, date: today });
  if (!existing) {
    return interaction.reply({ content: '❌ لا يوجد تحدي للتعديل.', flags: MessageFlags.Ephemeral });
  }
  const modal = new (await import('discord.js')).ModalBuilder()
    .setCustomId(`ch_edit_save_${discordId}`)
    .setTitle('✏️ تعديل التحدي')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new (await import('discord.js')).TextInputBuilder()
          .setCustomId('ch_edit_req')
          .setLabel('المطلوب الجديد')
          .setStyle((await import('discord.js')).TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(existing.requirement)),
      ),
      new ActionRowBuilder().addComponents(
        new (await import('discord.js')).TextInputBuilder()
          .setCustomId('ch_edit_reward')
          .setLabel('المكافأة الجديدة')
          .setStyle((await import('discord.js')).TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(existing.reward)),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleChallengeEditSave(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const discordId = interaction.customId.replace('ch_edit_save_', '');
  const req = parseInt(interaction.fields.getTextInputValue('ch_edit_req'), 10);
  const reward = parseInt(interaction.fields.getTextInputValue('ch_edit_reward'), 10);
  if (isNaN(req) || isNaN(reward)) {
    return interaction.reply({ content: '❌ قيم غير صالحة.', flags: MessageFlags.Ephemeral });
  }
  const today = todayDateStr();
  const existing = await DailyChallenge.findOne({ discordId, date: today });
  if (!existing) {
    return interaction.reply({ content: '❌ التحدي غير موجود.', flags: MessageFlags.Ephemeral });
  }
  existing.requirement = req;
  existing.reward = reward;
  await existing.save();

  const member = await Member.findOne({ discordId });
  const embed = embedCustom(0x2B2D31, `👤 إدارة تحدي — ${member?.gameName || discordId}`,
    `**التحدي الحالي:** ${getChallengeLabel(existing)}\n**المطلوب:** ${existing.requirement}\n**المكافأة:** ${existing.reward} نقطة\n**الحالة:** ${existing.failed ? '❌ فشل' : existing.completed ? '✅ مكتمل' : '⏳ قيد التنفيذ'}`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ch_edit_${discordId}`).setLabel('✏️ تعديل').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ch_delete_${discordId}`).setLabel('🗑️ حذف التحدي').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ch_refresh_admin').setLabel('🔙 رجوع').setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({ embeds: [embed], components: [row] });
  await interaction.followUp({ content: `✅ تم تعديل التحدي: المطلوب ${req}، المكافأة ${reward} نقطة.`, flags: MessageFlags.Ephemeral });
}

export async function handleChallengeDelete(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const discordId = interaction.customId.replace('ch_delete_', '');
  const today = todayDateStr();
  const existing = await DailyChallenge.findOne({ discordId, date: today });
  if (!existing) {
    return interaction.reply({ content: '❌ لا يوجد تحدي للحذف.', flags: MessageFlags.Ephemeral });
  }
  await DailyChallenge.deleteOne({ _id: existing._id });

  if (existing.channelId && existing.messageId) {
    try {
      const ch = await interaction.client.channels.fetch(existing.channelId).catch(() => null);
      if (ch) {
        const msg = await ch.messages.fetch(existing.messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    } catch { /* ignore */ }
  }

  const member = await Member.findOne({ discordId });
  const embed = embedCustom(0x2B2D31, `👤 إدارة تحدي — ${member?.gameName || discordId}`, '🚫 **لا يوجد تحدي لهذا العضو اليوم.**');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ch_add_${discordId}`).setLabel('➕ إضافة تحدي').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ch_refresh_admin').setLabel('🔙 رجوع').setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({ embeds: [embed], components: [row] });
  await interaction.followUp({ content: '✅ تم حذف التحدي.', flags: MessageFlags.Ephemeral });
  await sendLogEmbed(interaction.client, '🗑️ حذف تحدي عضو',
    `**العضو:** <@${discordId}> (${member?.gameName || '?'})\n**التحدي:** ${getChallengeLabel(existing)}\n**بواسطة:** <@${interaction.user.id}>`, 0x8B0000);
}

export async function handleChallengeForceComplete(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const discordId = interaction.customId.replace('ch_force_complete_', '');
  const today = todayDateStr();
  const challenge = await DailyChallenge.findOne({ discordId, date: today });
  if (!challenge || challenge.completed || challenge.failed) {
    return interaction.reply({ content: '❌ التحدي مكتمل أو فاشل مسبقاً أو غير موجود.', flags: MessageFlags.Ephemeral });
  }
  await awardMember(discordId, challenge, interaction.client);
  const guild = interaction.guild || interaction.client.guilds.cache.get(loadConfig().bot?.guildId);
  const embed = await buildChallengeEmbed(challenge, guild);
  if (challenge.channelId && challenge.messageId) {
    try {
      const ch = await interaction.client.channels.fetch(challenge.channelId).catch(() => null);
      if (ch) {
        const msg = await ch.messages.fetch(challenge.messageId).catch(() => null);
        if (msg) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ch_claim_${challenge._id}`).setLabel('✅ تم اتمام التحدي').setStyle(ButtonStyle.Success).setDisabled(true),
          );
          await msg.edit({ embeds: [embed], components: [row] }).catch(e => console.error('[DailyChallenge]', e?.message || e));
        }
      }
    } catch { /* ignore */ }
  }
  const member = await Member.findOne({ discordId });
  const updatedEmbed = embedCustom(0x2B2D31, `👤 إدارة تحدي — ${member?.gameName || discordId}`,
    `**التحدي الحالي:** ${getChallengeLabel(challenge)}\n**المطلوب:** ${challenge.requirement}\n**المكافأة:** ${challenge.reward} نقطة\n**الحالة:** ✅ مكتمل`);
  const updatedRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ch_edit_${discordId}`).setLabel('✏️ تعديل').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ch_delete_${discordId}`).setLabel('🗑️ حذف التحدي').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ch_refresh_admin').setLabel('🔙 رجوع').setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
  await interaction.followUp({ content: `✅ تم إكمال التحدي للعضو ${member?.gameName || discordId} ومنحه ${challenge.reward} نقطة.`, flags: MessageFlags.Ephemeral });
  await sendLogEmbed(interaction.client, '✅ إكمال تحدي إجباري',
    `**العضو:** <@${discordId}> (${member?.gameName || '?'})\n**التحدي:** ${getChallengeLabel(challenge)}\n**المكافأة:** +${challenge.reward} نقطة ⭐\n**بواسطة:** <@${interaction.user.id}>`, 0x2B2D31);
}

export async function handleChallengeForceFail(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const discordId = interaction.customId.replace('ch_force_fail_', '');
  const today = todayDateStr();
  const challenge = await DailyChallenge.findOne({ discordId, date: today });
  if (!challenge || challenge.completed || challenge.failed) {
    return interaction.reply({ content: '❌ التحدي مكتمل أو فاشل مسبقاً أو غير موجود.', flags: MessageFlags.Ephemeral });
  }
  challenge.failed = true;
  await challenge.save();

  const guild = interaction.guild || interaction.client.guilds.cache.get(loadConfig().bot?.guildId);
  const embed = await buildChallengeEmbed(challenge, guild);
  if (challenge.channelId && challenge.messageId) {
    try {
      const ch = await interaction.client.channels.fetch(challenge.channelId).catch(() => null);
      if (ch) {
        const msg = await ch.messages.fetch(challenge.messageId).catch(() => null);
        if (msg) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ch_claim_${challenge._id}`).setLabel('✅ تم اتمام التحدي').setStyle(ButtonStyle.Success).setDisabled(true),
          );
          await msg.edit({ embeds: [embed], components: [row] }).catch(e => console.error('[DailyChallenge]', e?.message || e));
        }
      }
    } catch { /* ignore */ }
  }
  const member = await Member.findOne({ discordId });
  const updatedEmbed = embedCustom(0x2B2D31, `👤 إدارة تحدي — ${member?.gameName || discordId}`,
    `**التحدي الحالي:** ${getChallengeLabel(challenge)}\n**المطلوب:** ${challenge.requirement}\n**المكافأة:** ${challenge.reward} نقطة\n**الحالة:** ❌ فشل`);
  const updatedRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ch_edit_${discordId}`).setLabel('✏️ تعديل').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ch_delete_${discordId}`).setLabel('🗑️ حذف التحدي').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ch_refresh_admin').setLabel('🔙 رجوع').setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });
  await interaction.followUp({ content: `✅ تم اعتبار التحدي فاشل للعضو ${member?.gameName || discordId}.`, flags: MessageFlags.Ephemeral });
  await sendLogEmbed(interaction.client, '❌ إعتبار تحدي فاشل (إجباري)',
    `**العضو:** <@${discordId}> (${member?.gameName || '?'})\n**التحدي:** ${getChallengeLabel(challenge)}\n**بواسطة:** <@${interaction.user.id}>`, 0x8B0000);
}

function buildConfigPanel(cfg) {
  const a = (utc) => {
    if (!utc) return '';
    const [h, m] = utc.split(':');
    const bh = (parseInt(h) + 3) % 24;
    return `${utc} UTC (${bh.toString().padStart(2, '0')}:${m} بغداد)`;
  };
  const desc = [
    `🟢 **النظام:** ${cfg.enabled ? 'نشط' : 'معطل'}`,
    `⏰ **التعيين:** ${a(cfg.assignTime || '04:00')}`,
    `⏰ **التذكير:** ${a(cfg.reminderTime || '14:00')}`,
    `⏰ **ما قبل الانتهاء:** ${a(cfg.preExpireTime || '17:00')}`,
    `⏰ **الانتهاء:** ${a(cfg.expireTime || '21:00')}`,
    ``,
    `📂 **أنواع التحديات** — اضغط على الزر لتفعيل/تعطيل:`,
  ].join('\n');

  const embed = embedCustom(0x2B2D31, '⚙️ إعدادات التحديات', desc);

  const typeEntries = Object.entries(cfg.challengeTypes || {});
  const emojiMap = { occupation: '⏱️', reports: '📋', points: '⭐', golden_12h: '🥇', top_points: '👑', top_occupation: '🎮', top_reports: '📊' };
  const buttons = typeEntries.map(([key, type]) =>
    new ButtonBuilder()
      .setCustomId(`ch_ctype_${key}`)
      .setLabel(`${(emojiMap[key] || '📌')} ${getTypeLabel(key)}`)
      .setStyle(type.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ch_time_config').setLabel('🕐 تعديل الأوقات').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ch_refresh_admin').setLabel('🔙 رجوع').setStyle(ButtonStyle.Secondary),
  );
  rows.push(navRow);
  return { embeds: [embed], components: rows };
}

export async function handleChallengeTimeConfig(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder: ModalRowBuilder } = await import('discord.js');
  const cfg = await getChallengeConfig();
  const modal = new ModalBuilder()
    .setCustomId('ch_time_save')
    .setTitle('🕐 تعديل أوقات التحديات')
    .addComponents(
      new ModalRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ch_time_assign')
          .setLabel('⏰ وقت التعيين (UTC)')
          .setStyle(TextInputStyle.Short)
          .setValue(cfg.assignTime || '04:00')
          .setPlaceholder('مثال: 04:00')
          .setRequired(true),
      ),
      new ModalRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ch_time_reminder')
          .setLabel('⏰ وقت التذكير (UTC)')
          .setStyle(TextInputStyle.Short)
          .setValue(cfg.reminderTime || '14:00')
          .setPlaceholder('مثال: 14:00')
          .setRequired(true),
      ),
      new ModalRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ch_time_pre_expire')
          .setLabel('⏰ وقت ما قبل الانتهاء (UTC)')
          .setStyle(TextInputStyle.Short)
          .setValue(cfg.preExpireTime || '17:00')
          .setPlaceholder('مثال: 17:00')
          .setRequired(true),
      ),
      new ModalRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ch_time_expire')
          .setLabel('⏰ وقت الانتهاء (UTC)')
          .setStyle(TextInputStyle.Short)
          .setValue(cfg.expireTime || '21:00')
          .setPlaceholder('مثال: 21:00')
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleChallengeTimeSave(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const assign = interaction.fields.getTextInputValue('ch_time_assign').trim();
  const reminder = interaction.fields.getTextInputValue('ch_time_reminder').trim();
  const preExpire = interaction.fields.getTextInputValue('ch_time_pre_expire').trim();
  const expire = interaction.fields.getTextInputValue('ch_time_expire').trim();
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timeRegex.test(assign) || !timeRegex.test(reminder) || !timeRegex.test(preExpire) || !timeRegex.test(expire)) {
    return interaction.reply({ content: '❌ الصيغة غير صحيحة. استخدم HH:MM بصيغة 24 ساعة (مثال: 04:00)', flags: MessageFlags.Ephemeral });
  }
  const cfgPath = configPath;
  const config = loadConfig();
  if (!config.dailyChallenge) config.dailyChallenge = { enabled: true, challengeTypes: {} };
  config.dailyChallenge.assignTime = assign;
  config.dailyChallenge.reminderTime = reminder;
  config.dailyChallenge.preExpireTime = preExpire;
  config.dailyChallenge.expireTime = expire;
  writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');

  // Restart cron tasks with new times
  const client = interaction.client;
  if (config.dailyChallenge.enabled) {
    startDailyChallenge(client);
  }

  await interaction.reply({ ...buildConfigPanel(config.dailyChallenge), flags: MessageFlags.Ephemeral });
  await sendLogEmbed(interaction.client, '🕐 تعديل أوقات التحديات',
    `⏰ **التعيين:** ${assign} UTC\n⏰ **التذكير:** ${reminder} UTC\n⏰ **ما قبل الانتهاء:** ${preExpire} UTC\n⏰ **الانتهاء:** ${expire} UTC\n👤 **بواسطة:** <@${interaction.user.id}>`, 0x2B2D31);
}

export async function handleChallengeConfig(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const cfg = await getChallengeConfig();
  await interaction.reply({ ...buildConfigPanel(cfg), flags: MessageFlags.Ephemeral });
}

export async function handleChallengeTypeToggle(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const typeKey = interaction.customId.replace('ch_ctype_', '');
  const cfgPath = configPath;
  const config = loadConfig();
  if (!config.dailyChallenge) config.dailyChallenge = { enabled: true, challengeTypes: {} };
  if (!config.dailyChallenge.challengeTypes) config.dailyChallenge.challengeTypes = {};
  if (!config.dailyChallenge.challengeTypes[typeKey]) {
    return interaction.reply({ content: `❌ نوع التحدي "${getTypeLabel(typeKey)}" غير موجود في الإعدادات.`, flags: MessageFlags.Ephemeral });
  }
  config.dailyChallenge.challengeTypes[typeKey].enabled = !config.dailyChallenge.challengeTypes[typeKey].enabled;
  writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8');
  await interaction.update(buildConfigPanel(config.dailyChallenge));
  const status = config.dailyChallenge.challengeTypes[typeKey].enabled ? 'تفعيل' : 'تعطيل';
  const color = config.dailyChallenge.challengeTypes[typeKey].enabled ? 0x2B2D31 : 0x8B0000;
  await sendLogEmbed(interaction.client, `⚙️ ${status} نوع تحدي`,
    `**النوع:** ${getTypeLabel(typeKey)}\n**الحالة:** ${status === 'تفعيل' ? '🟢 مفعل' : '🔴 معطل'}\n**بواسطة:** <@${interaction.user.id}>`, color);
}

export async function handleChallengeLog(interaction) {
  if (!isAdmin(interaction)) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
  const today = todayDateStr();
  const all = await DailyChallenge.find({ date: today, completed: true });
  const completed = all.filter(c => !c.failed);
  if (completed.length === 0) {
    return interaction.reply({ content: '📋 لا توجد مكافآت ممنوحة اليوم.', flags: MessageFlags.Ephemeral });
  }
  const lines = ['📋 **سجل المكافآت اليوم**\n'];
  for (const c of completed) {
    const member = await Member.findOne({ discordId: c.discordId });
    lines.push(`⭐ <@${c.discordId}> (${member?.gameName || '?'}) — ${getChallengeLabel(c)} → **+${c.reward}** نقطة`);
  }
  const shown = lines.slice(0, 11).join('\n');
  const hidden = completed.length - 10;
  const content = hidden > 0 ? `${shown}\n\n_و ${hidden} إضافي..._` : shown;
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

export function stopDailyChallenge() {
  if (assignTask) { assignTask.stop(); assignTask = null; }
  if (reminderTask) { reminderTask.stop(); reminderTask = null; }
  if (expireTask) { expireTask.stop(); expireTask = null; }
  if (preExpireTask) { preExpireTask.stop(); preExpireTask = null; }
  console.log('[DailyChallenge] Stopped');
}

export async function startDailyChallenge(client) {
  stopDailyChallenge();
  const cfg = await getChallengeConfig();
  if (!cfg.enabled) {
    console.log('[DailyChallenge] System is disabled in config');
    return;
  }
  const assignTime = cfg.assignTime || '04:00';
  const reminderTime = cfg.reminderTime || '14:00';
  const expireTime = cfg.expireTime || '21:00';
  const preExpireTime = cfg.preExpireTime || '17:00';
  const [ah, am] = assignTime.split(':');
  const [rh, rm] = reminderTime.split(':');
  const [eh, em] = expireTime.split(':');
  const [ph, pm] = preExpireTime.split(':');
  assignTask = schedule(`${am} ${ah} * * *`, () => assignDailyChallenges(client).catch(e => console.error('[DC] Assign error:', e)));
  reminderTask = schedule(`${rm} ${rh} * * *`, () => sendReminder(client).catch(e => console.error('[DC] Reminder error:', e)));
  expireTask = schedule(`${em} ${eh} * * *`, () => expirePendingChallenges(client).catch(e => console.error('[DC] Expire error:', e)));
  preExpireTask = schedule(`${pm} ${ph} * * *`, () => sendPreExpireReminder(client).catch(e => console.error('[DC] PreExpire error:', e)));
  console.log(`[DailyChallenge] Started: assign at ${assignTime} UTC, reminder at ${reminderTime} UTC, expire at ${expireTime} UTC, pre-expire at ${preExpireTime} UTC`);

  if (cfg.autoAssignOnStartup !== false) {
    setTimeout(async () => {
      const today = todayDateStr();
      const existing = await DailyChallenge.find({ date: today });
      if (existing.length === 0) {
        console.log('[DailyChallenge] No challenges for today, assigning...');
        await assignDailyChallenges(client).catch(e => console.error('[DC] Startup assign error:', e));
      }
    }, 15000);
  }
}
