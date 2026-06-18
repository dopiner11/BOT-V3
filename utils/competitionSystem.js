import Competition from '../models/Competition.js';
import CompetitionWinner from '../models/CompetitionWinner.js';
import Member from '../models/Member.js';
import PointLog from '../models/PointLog.js';
import AttendanceLog from '../models/AttendanceLog.js';
import Report from '../models/Report.js';
import DailyLog from '../models/DailyLog.js';
import Warning from '../models/Warning.js';
import DoublePoints from '../models/DoublePoints.js';
import Vacation from '../models/Vacation.js';
import { logCompetition } from './logSystem.js';
import pointsManager from './pointsManager.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, gold as embedGold, custom as embedCustom } from './embedStyles.js';
import { dmUser } from './notificationSystem.js';
import { readFileSync } from 'fs';

let _client = null;
let _guild = null;
let watcherInterval = null;
let embedUpdateInterval = null;
let config = {};

const TYPE_LABELS = {
  points: 'نقاط',
  occupation: 'احتلال',
  reports: 'تقارير',
  streak: 'ستريك'
};

const MODE_LABELS = {
  cumulative: 'تراكمي',
  race: 'سباق'
};

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString('ar-IQ', { timeZone: 'Asia/Baghdad', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatRemaining(endsAt) {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'انتهت';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days} أيام ${hours} ساعات`;
  return `${hours} ساعات`;
}

function getDescription(type, mode, target) {
  const descs = {
    points: { cumulative: 'أعلى شخص يجمع نقاط خلال المدة', race: `أول شخص يجمع ${target} نقطة` },
    occupation: { cumulative: 'أعلى شخص يسجل ساعات احتلال خلال المدة', race: `أول شخص يسجل ${target} ساعة احتلال` },
    reports: { cumulative: 'أعلى شخص يقدم تقارير مقبولة خلال المدة', race: `أول شخص يقدم ${target} تقرير مقبول` },
    streak: { cumulative: 'أعلى شخص يحقق ستريك (أيام نشاط متتالية) خلال المدة', race: `أول شخص يحقق ${target} يوم ستريك (نشاط متتالي)` }
  };
  return descs[type]?.[mode] || '';
}

function loadConfig() {
  try {
    const cfg = JSON.parse(readFileSync('./config.json', 'utf-8'));
    config = cfg?.competitions || {};
    return config;
  } catch { config = {}; return config; }
}

function getConditionText(type) {
  const cfg2 = loadConfig();
  const conds = cfg2.conditions || [
    'المسابقة مخصصة لأفراد العائلة النشطين فقط',
    `يتم احتساب ${TYPE_LABELS[type] || 'النقاط'} من تاريخ بدء المسابقة فقط`,
    'في حال تساوي النتيجة، يفضل صاحب الستريك الأعلى',
    'يمنع استخدام أي طرق غش أو استغلال للثغرات',
    'قرارات اللجنة نهائية ولا تقبل الطعن',
    'سيتم الإعلان عن النتائج فور انتهاء المسابقة'
  ];
  return conds;
}

function prizesToLines(prizes) {
  if (!prizes?.length) return '';
  return prizes.map(p => {
    const rank = p.rank;
    const label = rank === 1 ? '<:first:1392466297345937458>' : rank === 2 ? '<:secound:1392466286193414285>' : rank === 3 ? '<:third:1392466291033378839>' : '**🏅';
    const rewards = (p.rewards || []).map(r => formatReward(r)).join(' + ');
    const rankName = rank === 1 ? 'الأول' : rank === 2 ? 'الثاني' : rank === 3 ? 'الثالث' : `الرابع`;
    if (rank <= 3) return `${label} **المركز ${rank === 1 ? 'الأول' : rank === 2 ? 'الثاني' : 'الثالث'} :**\n|| ${rewards} ||`;
    return `**🏅 المركز ${rankName} :**\n|| ${rewards} ||`;
  }).join('\n\n');
}

function formatReward(r) {
  switch (r.type) {
    case 'role': return `🎖️ <@&${r.value}>`;
    case 'points': return `⭐ ${r.value} نقطة`;
    case 'promotion': return '🚀 ترقية استثنائية';
    case 'warn_remove': return `🛡️ إلغاء ${r.value} إنذار`;
    case 'double_points': return `⚡ ضعف نقاط لمدة ${r.value} ساعة`;
    case 'title': return `👑 لقب "${r.value}"`;
    case 'leave': return `🏖️ إجازة داخلية ${r.value} أيام`;
    case 'money': return `💰 ${r.value} $`;
    default: return r.value || '';
  }
}

function resultsToLines(standings, prizes) {
  if (!standings?.length) return '';
  return standings.map((s, i) => {
    const rank = i + 1;
    const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
    const prize = prizes?.find(p => p.rank === rank);
    const rewards = prize?.rewards?.map(r => formatReward(r)).join(' + ') || '';
    return `${rankEmoji} **المركز ${rank === 1 ? 'الأول' : rank === 2 ? 'الثاني' : rank === 3 ? 'الثالث' : 'الرابع'} :** <@${s.userId}>\n|| ${rewards} ||`;
  }).join('\n\n');
}

function buildScoreKey(type) {
  switch (type) {
    case 'points': return 'points';
    case 'occupation': return 'minutes';
    case 'reports': return 'count';
    case 'streak': return 'streak';
    default: return 'score';
  }
}

function getScoreLabel(type) {
  switch (type) {
    case 'points': return 'نقطة';
    case 'occupation': return 'ساعة احتلال';
    case 'reports': return 'تقرير';
    case 'streak': return 'يوم ستريك';
    default: return 'نقطة';
  }
}

function formatScore(type, value) {
  if (type === 'occupation') {
    const hours = (value / 60).toFixed(1);
    return `${hours} ساعة`;
  }
  return value.toLocaleString();
}

export async function getStandings(competition) {
  try {
    const { type, mode, startedAt, endsAt, target, winnersCount } = competition;
    const startDate = new Date(startedAt);
    const endDate = new Date(endsAt);
    const now = Date.now();

    // جلب جميع الأعضاء النشطين
    const members = await Member.find({ isActive: true });
    const standings = [];

    for (const member of members) {
      let score = 0;
      let targetScore = target || 0;

      switch (type) {
        case 'points': {
          const logs = await PointLog.find({
            discordId: member.discordId,
            createdAt: { $gte: startDate, $lte: mode === 'race' && now < endDate.getTime() ? new Date(now) : endDate }
          });
          score = logs.reduce((sum, l) => sum + (l.points || 0), 0);
          break;
        }
        case 'occupation': {
          const logs = await AttendanceLog.find({
            date: { $gte: startDate.toISOString().slice(0, 10), $lte: endDate.toISOString().slice(0, 10) }
          });
          const userLogs = logs.filter(l => l.userId === member.discordId);
          score = userLogs.reduce((sum, l) => sum + (l.details?.sessionMinutes || 0), 0);
          break;
        }
        case 'reports': {
          const reports = await Report.find({
            reporterId: member.discordId,
            status: 'accepted',
            createdAt: { $gte: startDate, $lte: endDate }
          });
          score = reports.length;
          break;
        }
        case 'streak': {
          const dailyLogs = await DailyLog.find({
            discordId: member.discordId,
            date: { $gte: startDate.toISOString().slice(0, 10), $lte: endDate.toISOString().slice(0, 10) }
          });
          dailyLogs.sort((a, b) => a.date.localeCompare(b.date));
          let maxStreak = 0;
          let currentStreak = 0;
          for (const log of dailyLogs) {
            if (log.status === 'active_high') {
              currentStreak++;
              maxStreak = Math.max(maxStreak, currentStreak);
            } else {
              currentStreak = 0;
            }
          }
          score = maxStreak;
          break;
        }
      }

      if (score > 0) {
        standings.push({ userId: member.discordId, gameName: member.gameName, score, rank: member.currentRank });
      }
    }

    standings.sort((a, b) => b.score - a.score);
    return standings;
  } catch (err) {
    console.error('[Competition] getStandings error:', err);
    return [];
  }
}

export async function distributeRewards(competitionId) {
  try {
    const comp = await Competition.findById(competitionId);
    if (!comp || comp.status !== 'active') return { success: false, reason: 'not_found_or_not_active' };

    const standings = await getStandings(comp);
    const { prizes, winnersCount, name, type } = comp;
    const winners = standings.slice(0, winnersCount);
    const awarded = [];

    for (let i = 0; i < winners.length; i++) {
      const winner = standings[i];
      if (!winner) continue;
      const rank = i + 1;
      const prizeConfig = prizes?.find(p => p.rank === rank);
      if (!prizeConfig?.rewards?.length) continue;

      const memberData = await Member.findOne({ discordId: winner.userId });
      if (!memberData) continue;

      const member = _guild?.members?.cache?.get(winner.userId);
      const awardedRewards = [];

      for (const reward of prizeConfig.rewards) {
        try {
          switch (reward.type) {
            case 'role':
              if (member) await member.roles.add(reward.value).catch(() => {});
              awardedRewards.push(`🎖️ <@&${reward.value}>`);
              break;
            case 'points':
              await pointsManager.updateUserPoints(winner.userId, reward.value, `🏆 جائزة مسابقة: ${name}`);
              awardedRewards.push(`⭐ ${reward.value} نقطة`);
              break;
            case 'promotion': {
              try {
                if (!applyPromotion) {
                  const { applyPromotion: ap } = await import('./promotionManager.js');
                  applyPromotion = ap;
                }
                const { loadConfig } = await import('./configLoader.js');
                const cfg = loadConfig();
                const ranks = cfg.promotion?.ranks || [];
                const currentIdx = memberData.rank ?? -1;
                if (currentIdx >= 0 && currentIdx < ranks.length - 1 && member) {
                  await applyPromotion({
                    memberData: memberData,
                    guildMember: member,
                    newRank: ranks[currentIdx + 1],
                    newRankIndex: currentIdx + 1,
                    promoterId: 'SYSTEM',
                    promoterName: '🏆 مسابقة',
                    guild: _guild,
                  });
                  awardedRewards.push(`🚀 ترقية إلى ${ranks[currentIdx + 1].name}`);
                }
              } catch (e) { console.error('[Competition] promotion error:', e); }
              break;
            }
            case 'warn_remove': {
              const warnings = await Warning.find({ memberId: winner.userId, removed: false });
              for (let w = 0; w < Math.min(reward.value, warnings.length); w++) {
                warnings[w].removed = true;
                warnings[w].removedBy = '🏆 جائزة مسابقة';
                await warnings[w].save();
              }
              awardedRewards.push(`🛡️ إلغاء ${Math.min(reward.value, warnings.length)} إنذار`);
              break;
            }
            case 'double_points':
              await DoublePoints.create({
                userId: winner.userId,
                expiresAt: new Date(Date.now() + reward.value * 3600000)
              });
              awardedRewards.push(`⚡ ضعف نقاط ${reward.value} ساعة`);
              break;
            case 'title':
              if (!memberData.titles) memberData.titles = [];
              memberData.titles.push({ name: reward.value, competition: name, earnedAt: new Date() });
              await memberData.save();
              awardedRewards.push(`👑 لقب "${reward.value}"`);
              break;
            case 'leave':
              await Vacation.create({
                userId: winner.userId,
                type: 'internal_leave',
                startDate: new Date(),
                endDate: new Date(Date.now() + reward.value * 86400000),
                reason: `🏆 جائزة مسابقة: ${name}`
              });
              awardedRewards.push(`🏖️ إجازة داخلية ${reward.value} أيام`);
              break;
            case 'money':
              await SystemLog.create({
                type: 'competition',
                userId: winner.userId,
                action: `🏆 جائزة مالية ${reward.value}$ من مسابقة ${name}`,
                severity: 3
              });
              awardedRewards.push(`💰 ${reward.value}$`);
              break;
          }
        } catch (e) {
          console.error(`[Competition] Reward error for ${winner.userId}:`, e);
        }
      }

      // سجل الفائز
      await CompetitionWinner.create({
        competitionId: comp.id,
        competitionName: name,
        competitionMode: comp.mode,
        competitionType: type,
        userId: winner.userId,
        rank,
        score: winner.score,
        prizes: prizeConfig.rewards,
        wonAt: new Date()
      });

      awarded.push({ userId: winner.userId, rank, rewards: awardedRewards });
    }

    comp.status = 'ended';
    comp.endedAt = new Date();
    await comp.save();

    return { success: true, winners: awarded };
  } catch (err) {
    console.error('[Competition] distributeRewards error:', err);
    return { success: false, reason: err.message };
  }
}

export async function buildAnnouncementMessage(competition) {
  const { name, type, mode, days, startedAt, endsAt, target, prizes, createdBy, committeeRoleId, presidencyRoleId } = competition;
  const startDate = formatDate(startedAt);
  const endDate = formatDate(endsAt);
  const desc = getDescription(type, mode, target);
  const conds = getConditionText(type);
  const prizesBlock = prizesToLines(prizes || []);

  return `# إعلان هام لجميع أفراد العائلة الكرام <:pin:1392779046823268433>

تعلن <@&${committeeRoleId}> عن إقامة مسابقة بعنوان : **${name}** ولمدة **${days} أيام**

تبدأ المسابقة من يوم : **${startDate}**
وتنتهي يوم : **${endDate}**

<:wrong:1398696872444694699> **تنويه هام :**

> المسابقة مخصصة لأفراد العائلة فقط، ويتم تقييم المشاركين بالكامل بناءً على **${desc}**

**جوائز المسابقة سوف تشمل :**

${prizesBlock}

**سيتم اختيار الفائزين حسب :**

> **1 - ${conds[0] || ''}**
> **2 - ${conds[1] || ''}**
> **3 - ${conds[2] || ''}**
> **4 - ${conds[3] || ''}**
> **5 - ${conds[4] || ''}**
> **6 - ${conds[5] || ''}**

**توقيع مسؤول المسابقة 🖊️ :-** <@${createdBy}>

**تحت اشراف 🖊️ :-** [ <@&${presidencyRoleId}> <:emoji_10:1398696876290867240> ]

||@everyone|| `;
}

export async function buildResultsMessage(competition) {
  const standings = await getStandings(competition);
  const { name, startedAt, endsAt, winnersCount, prizes, createdBy, presidencyRoleId } = competition;
  const startDate = formatDate(startedAt);
  const endDate = formatDate(endsAt);
  const winners = standings.slice(0, winnersCount);
  const conds = getConditionText(competition.type);
  const resultsBlock = resultsToLines(winners, prizes);

  return `# إعلان هام لجميع أفراد القطاع <:pin:1392779046823268433>

**اعلان الفائزين في المسابقة**

بدأت المسابقة من يوم : **${startDate}**
وانتهت اليوم المصادف : **${endDate}**

**الفائزين في المسابقة :**

${resultsBlock}

**تم اختيار الفائزين حسب :**

> **1 - ${conds[0] || ''}**
> **2 - ${conds[1] || ''}**
> **3 - ${conds[2] || ''}**
> **4 - ${conds[3] || ''}**
> **5 - ${conds[4] || ''}**
> **6 - ${conds[5] || ''}**

**توقيع مسؤولين المسابقة 🖊️ :-** <@${createdBy}>

**تحت اشراف 🖊️ :-** [ <@&${presidencyRoleId}> <:emoji_10:1398696876290867240> ]`;
}

export async function buildCancellationMessage(competition) {
  const { name, startedAt, createdBy, presidencyRoleId } = competition;
  const startDate = formatDate(startedAt);
  const cancelDate = formatDate(new Date());

  return `# إلغاء مسابقة <:wrong:1398696872444694699>

**${name}**

للأسف، تم إلغاء المسابقة.

بدأت من يوم : **${startDate}**
ألغيت اليوم المصادف : **${cancelDate}**

**السبب :** إلغاء يدوي من الإدارة

**توقيع مسؤولين المسابقة 🖊️ :-** <@${createdBy}>

**تحت اشراف 🖊️ :-** [ <@&${presidencyRoleId}> <:emoji_10:1398696876290867240> ]`;
}

export async function buildCompetitionEmbed(competition) {
  const standings = await getStandings(competition);
  const { name, type, mode, target, winnersCount, prizes, endsAt, startedAt } = competition;
  const remaining = formatRemaining(endsAt);
  const total = standings.length;
  const displayCount = Math.min(10, total || 10);
  const topWinners = standings.slice(0, displayCount);

  const typeEmoji = type === 'points' ? '🏆' : type === 'occupation' ? '⏱️' : type === 'reports' ? '📋' : '🔥';
  const typeName = { points: 'نقاط', occupation: 'احتلال', reports: 'تقارير', streak: 'ستريك' }[type] || type;
  const modeLabel = mode === 'race' ? '🏁 سباق' : '📈 تراكمي';
  const header = `${typeEmoji} ${name} — ${modeLabel}`;

  const desc = getDescription(type, mode, target);
  let lines = [];

  // معلومات أساسية
  lines.push(`📅 ${formatDate(startedAt)} → ${formatDate(endsAt)}`);
  lines.push(`⏳ ${remaining} • 👥 ${total} متسابق • 🏅 ${winnersCount} فائز`);
  if (mode === 'race' && target) lines.push(`🎯 الهدف: ${target.toLocaleString()} ${getScoreLabel(type)}`);
  lines.push(`> ${desc}`);

  // الجوائز
  if (prizes?.length) {
    lines.push('');
    lines.push('**🎁 الجوائز**');
    for (const p of [...prizes].sort((a, b) => a.rank - b.rank)) {
      const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
      const medal = medals[p.rank] || '🏅';
      const rankName = p.rank === 1 ? 'الأول' : p.rank === 2 ? 'الثاني' : p.rank === 3 ? 'الثالث' : `#${p.rank}`;
      const rewards = (p.rewards || []).map(r => formatReward(r)).join(' + ');
      lines.push(`${medal} **المركز ${rankName}:** ${rewards}`);
    }
  }

  // الترتيب
  if (total > 0) {
    lines.push('');
    lines.push('**📊 الترتيب**');
    for (let i = 0; i < topWinners.length; i++) {
      const w = topWinners[i];
      const medals = ['🥇', '🥈', '🥉'];
      const emoji = medals[i] || `${i + 1}.`;
      const scoreVal = formatScore(type, w.score);
      let text = `${emoji} <@${w.userId}> — \`${scoreVal} ${getScoreLabel(type)}\``;
      if (mode === 'race' && target) {
        const pct = target > 0 ? Math.min(100, Math.round((w.score / target) * 100)) : 0;
        const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
        text += `\n└ \`${bar}\` ${pct}%`;
      } else {
        const prize = prizes?.find(p => p.rank === i + 1);
        const rewardText = prize?.rewards?.map(r => formatReward(r)).join(' + ');
        if (rewardText) text += `\n└ ${rewardText}`;
      }
      lines.push(text);
    }
    if (total > displayCount) lines.push(`...و ${total - displayCount} متسابق آخرين`);
  }

  const color = mode === 'race' ? 0xE74C3C : 0xF1C40F;
  const embed = embedCustom(color, header, lines.join('\n'));
  embed.setFooter({ text: `🆔 ${competition.id} • ${typeName} • ${modeLabel}` });
  embed.setTimestamp();
  return { embed, total };
}

export async function updateCompetitionEmbed(client, competitionId) {
  try {
    const comp = await Competition.findById(competitionId);
    if (!comp || comp.status === 'cancelled') return;

    const channel = client.channels.cache.get(comp.channelId);
    if (!channel) return;

    const { embed } = await buildCompetitionEmbed(comp);

    if (comp.messageId) {
      try {
        const msg = await channel.messages.fetch(comp.messageId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch {
        // الرسالة انمسحت — ننشر جديدة
      }
    }

    const msg = await channel.send({ embeds: [embed] });
    comp.messageId = msg.id;
    await comp.save();
  } catch (err) {
    console.error('[Competition] updateCompetitionEmbed error:', err);
  }
}

export async function updateAllCompetitionEmbeds(client) {
  try {
    const active = await Competition.find({ status: 'active' });
    for (const comp of active) {
      await updateCompetitionEmbed(client, comp.id);
    }
  } catch (err) {
    console.error('[Competition] updateAllCompetitionEmbeds error:', err);
  }
}

export async function endCompetition(competitionId, client, actorId = null) {
  try {
    const comp = await Competition.findById(competitionId);
    if (!comp || comp.status !== 'active') return { success: false };

    const result = await distributeRewards(competitionId);
    if (!result.success) return result;

    // إعلان النتائج
    const cfg = loadConfig();
    const annChannel = client.channels.cache.get(cfg.announcementChannelId);
    if (annChannel) {
      const msg = await buildResultsMessage(comp);
      try {
        await annChannel.send(msg);
      } catch (e) {
        // قناة الإعلانات القديمة
      }
    }

    // تحديث Embed
    const channel = client.channels.cache.get(comp.channelId);
    if (channel && comp.messageId) {
      try {
        const msg = await channel.messages.fetch(comp.messageId);
        const endEmbed = gold(
          `🏆 انتهت المسابقة — ${comp.name}`,
          `تم الإعلان عن النتائج وصرف الجوائز 🎉`
        );
        await msg.edit({ embeds: [endEmbed], components: [] });
      } catch {}
    }

    // DM للفائزين
    if (result.winners) {
      for (const w of result.winners) {
        const dmText = `🎉 **مبروك!** فزت بالمركز ${w.rank === 1 ? 'الأول' : w.rank === 2 ? 'الثاني' : w.rank === 3 ? 'الثالث' : `ال ${w.rank}`} في مسابقة **${comp.name}**!\n\n${w.rewards.map(r => `✅ ${r}`).join('\n')}`;
        try {
          const user = await client.users.fetch(w.userId);
          if (user) await user.send(dmText).catch(() => {});
        } catch {}
      }
    }

    const guild = client.guilds.cache.get(comp.guildId) || client.guilds.cache.first();
    const winnerText = result.winners?.length
      ? result.winners.map(w => `${w.rank === 1 ? '🥇' : w.rank === 2 ? '🥈' : w.rank === 3 ? '🥉' : `#${w.rank}`} <@${w.userId}>`).join('\n')
      : 'لا فائزين';
    if (guild) {
      await logCompetition(guild, {
        mod: actorId || comp.createdBy,
        competitionName: comp.name,
        compType: TYPE_LABELS[comp.type],
        compMode: MODE_LABELS[comp.mode],
        event: actorId ? 'إنهاء يدوي' : 'إنهاء تلقائي',
        details: `الفائزون:\n${winnerText}`,
      });
    }

    return result;
  } catch (err) {
    console.error('[Competition] endCompetition error:', err);
    return { success: false, reason: err.message };
  }
}

export async function cancelCompetition(competitionId, client, actorId = null) {
  try {
    const comp = await Competition.findById(competitionId);
    if (!comp || comp.status !== 'active') return { success: false };

    comp.status = 'cancelled';
    comp.endedAt = new Date();
    await comp.save();

    // إعلان الإلغاء
    const cfg = loadConfig();
    const annChannel = client.channels.cache.get(cfg.announcementChannelId);
    if (annChannel) {
      const msg = await buildCancellationMessage(comp);
      try { await annChannel.send(msg); } catch {}
    }

    // تحديث Embed
    const channel = client.channels.cache.get(comp.channelId);
    if (channel && comp.messageId) {
      try {
        const msg = await channel.messages.fetch(comp.messageId);
        const cancelEmbed = warning('❌ ألغيت المسابقة', `تم إلغاء **${comp.name}** بدون صرف جوائز.`);
        await msg.edit({ embeds: [cancelEmbed], components: [] });
      } catch {}
    }

    const guild = client.guilds.cache.get(comp.guildId) || client.guilds.cache.first();
    if (guild) {
      await logCompetition(guild, {
        mod: actorId || comp.createdBy,
        competitionName: comp.name,
        compType: TYPE_LABELS[comp.type],
        compMode: MODE_LABELS[comp.mode],
        event: actorId ? 'إلغاء يدوي' : 'إلغاء',
        details: 'تم إلغاء المسابقة بدون صرف جوائز',
      });
    }

    return { success: true };
  } catch (err) {
    console.error('[Competition] cancelCompetition error:', err);
    return { success: false, reason: err.message };
  }
}

export async function createCompetition(data, client) {
  try {
    const competition = await Competition.create({
      name: data.name,
      type: data.type,
      mode: data.mode,
      status: 'active',
      startedAt: new Date(),
      endsAt: new Date(Date.now() + data.days * 86400000),
      target: data.target || null,
      days: data.days,
      winnersCount: data.winnersCount,
      prizes: data.prizes || [],
      createdBy: data.createdBy,
      creatorName: data.creatorName || '',
      committeeRoleId: data.committeeRoleId || '',
      presidencyRoleId: data.presidencyRoleId || '',
      channelId: data.channelId || ''
    });

    // إعلان البداية
    const cfg = loadConfig();
    const annChannel = client.channels.cache.get(cfg.announcementChannelId || data.announcementChannelId);
    if (annChannel) {
      try { await annChannel.send('https://media.discordapp.net/attachments/1391704768660901919/1453017760354533487/934_x_175_.gif?ex=6a28befd&is=6a276d7d&hm=d145ca177cd25e058194566895570db4242d8e2e50af39d5fbb7ccde0effb877&=&width=1552&height=291'); } catch {}
      const msg = await buildAnnouncementMessage(competition);
      try { await annChannel.send({ content: msg, allowedMentions: { parse: ['roles', 'everyone'] } }); } catch {}
    }

    // نشر Embed
    await updateCompetitionEmbed(client, competition.id);

    const guild = client.guilds.cache.get(data.guildId) || client.guilds.cache.first();
    if (guild) {
      await logCompetition(guild, {
        mod: data.createdBy,
        competitionName: competition.name,
        compType: TYPE_LABELS[data.type],
        compMode: MODE_LABELS[data.mode],
        event: 'إنشاء',
        details: `المدة: ${data.days} يوم | الفائزون: ${data.winnersCount} | الهدف: ${data.target || 'تراكمي'}`,
      });
    }

    return { success: true, competition };
  } catch (err) {
    console.error('[Competition] createCompetition error:', err);
    return { success: false, reason: err.message };
  }
}

export async function startCompetitionSystem(client) {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;
    _client = client;
    _guild = guild;
    loadConfig();

    // وجّد جميع المسابقات النشطة
    const active = await Competition.find({ status: 'active' });
    if (active.length) {
      console.log(`[Competition] ✅ استعادة ${active.length} مسابقة نشطة`);
      for (const comp of active) {
        await updateCompetitionEmbed(client, comp.id);
      }
    }

    // وقف أي واتشر قديم
    if (watcherInterval) clearInterval(watcherInterval);

    // واتشر كل 60 ثانية
    watcherInterval = setInterval(async () => {
      try {
        const activeComps = await Competition.find({ status: 'active' });
        const now = Date.now();

        for (const comp of activeComps) {
          // فحص انتهاء المدة
          if (now >= new Date(comp.endsAt).getTime()) {
            console.log(`[Competition] ⏰ انتهت مدة المسابقة "${comp.name}"`);
            await endCompetition(comp.id, client);
            continue;
          }

          // فحص إشعار نصف المدة
          if (!comp._halfNotified) {
            const halfTime = new Date(comp.startedAt).getTime() + (new Date(comp.endsAt).getTime() - new Date(comp.startedAt).getTime()) / 2;
            if (now >= halfTime) {
              comp._halfNotified = true;
              await comp.save();
              const standings = await getStandings(comp);
              const total = standings.length;
              const top5 = standings.slice(0, 5);
              const embed = info(
                `🏆 تحديث مسابقة ${comp.name}`,
                `⏰ وصلنا لنصف المدة! باقي ${formatRemaining(comp.endsAt)} على النهاية.`
              );
              for (let i = 0; i < top5.length; i++) {
                const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
                embed.addFields({ name: `${emoji} ${top5[i].gameName || top5[i].userId}`, value: `${formatScore(comp.type, top5[i].score)} ${getScoreLabel(comp.type)}`, inline: true });
              }
              if (total > 5) embed.addFields({ name: `و ${total - 5} آخرين`, value: '\u200B', inline: true });
              const updateChannel = client.channels.cache.get(config.updateChannelId);
              if (updateChannel) await updateChannel.send({ embeds: [embed] }).catch(() => {});
              const logCh = client.channels.cache.get(config.logChannelId);
              if (logCh) await logCh.send(`⏰ **${comp.name}** — نصف المدة، ${total} متسابق`).catch(() => {});
            }
          }

          // فحص السباق — إذا member حقق الهدف
          if (comp.mode === 'race' && comp.target) {
            const standings = await getStandings(comp);
            const finished = standings.filter(s => s.score >= comp.target);
            if (finished.length > 0) {
              console.log(`[Competition] 🏁 ${finished.length} أعضاء حققوا هدف السباق`);
              const logCh = client.channels.cache.get(config.logChannelId);
              if (logCh) await logCh.send(`🏁 **${comp.name}** — ${finished.length} متسابق حقق الهدف، جارٍ إنهاء المسابقة`).catch(() => {});
              await endCompetition(comp.id, client);
            }
          }
        }
      } catch (e) {
        console.error('[Competition] Watcher error:', e);
      }
    }, 60_000);

    // تحديث Emebd كل 10 دقائق
    if (embedUpdateInterval) clearInterval(embedUpdateInterval);
    embedUpdateInterval = setInterval(() => {
      updateAllCompetitionEmbeds(client).catch(e => console.error('[Competition] Embed update error:', e));
    }, 600_000);

    console.log('[Competition] ✅ نظام المسابقات جاهز');
  } catch (err) {
    console.error('[Competition] بدء النظام فشل:', err);
  }
}

export async function getCompetitionHistory(page = 1, perPage = 10) {
  try {
    const all = await CompetitionWinner.find({}, { wonAt: -1 });
    const total = all.length;
    const totalPages = Math.ceil(total / perPage) || 1;
    const start = (page - 1) * perPage;
    const items = all.slice(start, start + perPage);
    return { items, total, totalPages, page };
  } catch (err) {
    console.error('[Competition] getCompetitionHistory error:', err);
    return { items: [], total: 0, totalPages: 1, page: 1 };
  }
}
