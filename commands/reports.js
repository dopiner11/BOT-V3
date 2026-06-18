// commands/reports.js
import { SlashCommandBuilder, MessageFlags, AttachmentBuilder } from 'discord.js';
import Member from '../models/Member.js';
import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';
import PointLog from '../models/PointLog.js';
import PersistentMessage from '../models/PersistentMessage.js';
import DailyLog from '../models/DailyLog.js';
import Grace24h from '../models/Grace24h.js';
import Warning from '../models/Warning.js';
import { STATUS, getIraqMidnight, getInteractionConfig } from '../utils/interactionMonitor.js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { success as embedSuccess, gold as embedGold, custom as embedCustom } from '../utils/embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DASHBOARD_KEY = 'interaction_dashboard';
const LEGACY_DASHBOARD_KEYS = ['webhook_report', 'reports_dashboard'];

export function resolveReportsChannelId(cfg) {
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

function loadConfig() {
  try {
    const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    try {
      const committeeDataPath = join(__dirname, '../.data/Committees.json');
      if (existsSync(committeeDataPath)) {
        const committeeList = JSON.parse(readFileSync(committeeDataPath, 'utf8'));
        if (committeeList && Object.keys(committeeList).length > 0) {
          config.committees = config.committees || {};
          const merged = {};
          for (const key of Object.keys(config.committees.list || {})) {
            merged[key] = { ...config.committees.list[key] };
          }
          for (const [key, data] of Object.entries(committeeList)) {
            if (merged[key]) Object.assign(merged[key], data);
            else merged[key] = data;
          }
          config.committees.list = merged;
        }
      }
    } catch {}
    return config;
  } catch { return {}; }
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

function isAdmin(interaction) {
  const config = loadConfig();
  const uid = interaction.user.id;
  const member = interaction.member;
  const founders = config.committees?.founders || [];
  const authorized = config.committees?.authorizedUsers || [];
  if (founders.includes(uid) || authorized.includes(uid)) return true;
  const presidency = config.committees?.list?.family_presidency;
  if (presidency?.roles) {
    const pRoles = [
      ...(presidency.roles.manager || []),
      ...(presidency.roles.deputy || []),
      ...(presidency.roles.member || []),
    ];
    if (pRoles.includes(uid)) return true;
    for (const r of pRoles) {
      if (member?.roles?.cache?.has(r)) return true;
    }
  }
  const iRoles = config.committees?.list?.interaction?.roles || {};
  for (const type of ['manager', 'deputy', 'member']) {
    for (const id of (iRoles[type] || [])) {
      if (id === uid || member?.roles?.cache?.has(id)) return true;
    }
  }
  return false;
}

async function loadReportBatchData() {
  const now = new Date();
  const graceDate = new Date(now.getTime() - getInteractionConfig().graceDays * 24 * 60 * 60 * 1000);

  const [
    members,
    activeVacations,
    activeExcuses,
    activeGracePeriods,
    recentPoints,
    newMembers,
    todayInactivityWarnings,
    allActiveWarnings
  ] = await Promise.all([
    Member.find({ isActive: true }),
    Vacation.find({ status: 'active', endDate: { $gte: now } }),
    Excuse.find({ isActive: true, type: { $ne: 'تغير اسم' }, endDate: { $gte: now } }),
    Grace24h.find({ expiresAt: { $gt: now } }),
    PointLog.aggregate([
      { $match: { createdAt: { $gte: getIraqMidnight() } } },
      { $group: { _id: '$discordId', total: { $sum: '$points' } } }
    ]),
    Member.find({ createdAt: { $gte: graceDate } }),
    Warning.find({ warningType: 'inactivity', status: 'active', removed: false }),
    Warning.find({ removed: false })
  ]);

  const pointsMap = new Map(recentPoints.map(p => [p._id, Math.max(0, p.total)]));
  const vacationsMap = new Map(activeVacations.map(v => [v.memberId, v]));
  const excusesMap = new Map(activeExcuses.map(e => [e.memberId, e]));
  const graceIds = new Set(newMembers.map(m => m.discordId));
  const activeGraceIds = new Set(activeGracePeriods.map(g => g.userId));
  const warnedIds = new Set(todayInactivityWarnings.map(w => w.memberId));
  
  const warningsMap = new Map();
  for (const w of allActiveWarnings) {
    warningsMap.set(w.memberId, (warningsMap.get(w.memberId) || 0) + 1);
  }

  const violatorThreshold = getInteractionConfig().violatorThreshold;
  const inactiveThreshold = getInteractionConfig().inactiveThreshold;

  return {
    members,
    pointsMap,
    vacationsMap,
    excusesMap,
    graceIds,
    activeGraceIds,
    warnedIds,
    warningsMap,
    violatorThreshold,
    inactiveThreshold,
    activeVacations,
    activeExcuses
  };
}

function classifyMemberLive(m, data) {
  const discordId = m.discordId;
  
  if (data.vacationsMap.has(discordId)) return 'vacation';
  if (data.excusesMap.has(discordId)) return 'excuse';
  if (data.graceIds.has(discordId) || data.activeGraceIds.has(discordId)) return 'grace';
  
  const points = data.pointsMap.get(discordId) ?? 0;
  if (points < data.violatorThreshold) {
    return data.warnedIds.has(discordId) ? 'warned' : 'violator';
  }
  if (points < data.inactiveThreshold) return 'inactive';
  return 'active_high';
}

async function getTopDaily(excludeIds, allowedIds) {
  const queryDate = getIraqMidnight();
  return await PointLog.aggregate([
    {
      $match: {
        createdAt: { $gte: queryDate },
        discordId: { $nin: excludeIds, $in: allowedIds },
        points: { $gt: 0 }
      }
    },
    { $group: { _id: '$discordId', totalPoints: { $sum: '$points' } } },
    { $sort: { totalPoints: -1 } },
    { $limit: 10 }
  ]);
}

async function getTopWeekly(excludeIds, allowedIds) {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return await PointLog.aggregate([
    {
      $match: {
        createdAt: { $gte: oneWeekAgo },
        discordId: { $nin: excludeIds, $in: allowedIds },
        points: { $gt: 0 }
      }
    },
    { $group: { _id: '$discordId', totalPoints: { $sum: '$points' } } },
    { $sort: { totalPoints: -1 } },
    { $limit: 10 }
  ]);
}

async function getTotalPointsToday(excludeIds, allowedIds) {
  const queryDate = getIraqMidnight();
  const result = await PointLog.aggregate([
    {
      $match: {
        createdAt: { $gte: queryDate },
        discordId: { $nin: excludeIds, $in: allowedIds }
      }
    },
    { $group: { _id: null, total: { $sum: '$points' } } }
  ]);
  return result[0]?.total || 0;
}

/* -------------------------------------------------------------------------- */
/*                           Core Report Generator                            */
/* -------------------------------------------------------------------------- */

async function generateReportEmbed(guild, allowedIds) {
  const batch = await loadReportBatchData();
  const vacationIds = batch.activeVacations.map(v => v.memberId);
  const excuseIds = batch.activeExcuses.map(e => e.memberId);
  const excludeIds = [...new Set([...vacationIds, ...excuseIds])];

  if (!allowedIds) {
    allowedIds = batch.members.map(m => m.discordId);
  }

  const [daily, weekly, totalPointsToday] = await Promise.all([
    getTopDaily(excludeIds, allowedIds),
    getTopWeekly(excludeIds, allowedIds),
    getTotalPointsToday(excludeIds, allowedIds)
  ]);

  const groups = {
    active_high: [],
    inactive: [],
    violator: [],
    warned: [],
    vacation: [],
    excuse: [],
    grace: []
  };

  for (const m of batch.members) {
    const status = classifyMemberLive(m, batch);
    const points = batch.pointsMap.get(m.discordId) ?? 0;
    const warningCount = batch.warningsMap.get(m.discordId) || 0;
    
    groups[status].push({
      discordId: m.discordId,
      points,
      warningCount,
      gameName: m.gameName || 'Unknown',
      vacation: batch.vacationsMap.get(m.discordId),
      excuse: batch.excusesMap.get(m.discordId)
    });
  }

  groups.active_high.sort((a, b) => b.points - a.points);
  groups.inactive.sort((a, b) => a.points - b.points);
  groups.violator.sort((a, b) => a.points - b.points);
  groups.warned.sort((a, b) => a.points - b.points);

  const baghdadNow = new Date().toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' });
  const embed = embedCustom('#2B2D31', '📊 تقرير التفاعل والنشاط المباشر 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪', `
▬▬▬ ﷽ ▬▬▬
🏛️ **نظام المراقبة والتحليل المباشر لتفاعل أعضاء العائلة**

• 👥 **عدد الأعضاء الكلي**: \`${guild.memberCount}\`
• 📈 **إجمالي نقاط اليوم**: \`${totalPointsToday}\` نقطة
• 🕒 **آخر تحديث**: <t:${Math.floor(Date.now() / 1000)}:R>

**📊 ملخص إحصائيات التفاعل اليومية:**
🟢 **متفاعل عالي**: \`${groups.active_high.length}\` | 🟡 **خامل**: \`${groups.inactive.length}\`
🔴 **مخالف**: \`${groups.violator.length}\`
🟤 **منذر**: \`${groups.warned.length}\` | 🏖️ **إجازات**: \`${groups.vacation.length}\`
📝 **أعذار**: \`${groups.excuse.length}\` | 🆕 **فترة سماح**: \`${groups.grace.length}\`

▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬
    `.trim())
    .setThumbnail(guild.iconURL({ dynamic: true }) || null)
    .setFooter({ text: `بغداد: ${baghdadNow} • يُحدَّث تلقائياً كل 10 دقائق`, iconURL: guild.iconURL() || undefined })
    .setTimestamp();

  const formatTop = (list) => {
    if (!list.length) return '*لا توجد بيانات تفاعل بعد*';
    const emojis = ['🥇', '🥈', '🥉', '✨', '⚡'];
    return list.map((x, i) => `${emojis[i] || '•'} <@${x._id}> — **${x.totalPoints}** نقطة`).join('\n');
  };

  embed.addFields(
    { name: '🔥 متفاعلو اليوم (أفضل 5)', value: formatTop(daily.slice(0, 5)), inline: true },
    { name: '📅 متفاعلو الأسبوع (أفضل 5)', value: formatTop(weekly.slice(0, 5)), inline: true },
    { name: '\u200b', value: '\u200b', inline: false }
  );

  const addLongField = (name, list, formatter) => {
    if (list.length === 0) return;
    let currentChunk = '';
    let chunkIndex = 1;
    list.forEach((item, index) => {
      const line = formatter(item, index) + '\n';
      if (currentChunk.length + line.length > 1000) {
        embed.addFields({ name: `${name} (${chunkIndex})`, value: currentChunk, inline: false });
        currentChunk = line;
        chunkIndex++;
      } else {
        currentChunk += line;
      }
    });
    if (currentChunk.trim().length > 0) {
      const title = chunkIndex > 1 ? `${name} (${chunkIndex})` : name;
      embed.addFields({ name: title, value: currentChunk, inline: false });
    }
  };

  addLongField(`🟢 متفاعل عالي - ${groups.active_high.length}`, groups.active_high, (m, i) => `🟢 **${i + 1}.** <@${m.discordId}> (${m.points}ن)`);
  addLongField(`🟡 الخاملون - ${groups.inactive.length}`, groups.inactive, (m, i) => `🟡 **${i + 1}.** <@${m.discordId}> (${m.points}ن)`);
  addLongField(`🔴 المخالفون - ${groups.violator.length}`, groups.violator, (m, i) => `🔴 **${i + 1}.** <@${m.discordId}> (${m.points}ن)`);
  addLongField(`🟤 منذرون (عدم تفاعل) - ${groups.warned.length}`, groups.warned, (m, i) => `🟤 **${i + 1}.** <@${m.discordId}> (${m.points}ن) - إنذارات: \`${m.warningCount}\``);
  addLongField(`🏖️ المجازون حالياً - ${groups.vacation.length}`, groups.vacation, (m, i) => `🏖️ **${i + 1}.** <@${m.discordId}> (ينتهي: <t:${Math.floor(new Date(m.vacation.endDate).getTime() / 1000)}:R>)`);
  addLongField(`📋 المعذورين حالياً - ${groups.excuse.length}`, groups.excuse, (m, i) => `📋 **${i + 1}.** <@${m.discordId}> (نوع: \`${m.excuse.type}\` | السبب: \`${m.excuse.reason}\`)`);
  addLongField(`🆕 فترة سماح - ${groups.grace.length}`, groups.grace, (m, i) => `🆕 **${i + 1}.** <@${m.discordId}> (سماح)`);

  const interactionData = {
    total: batch.members.length,
    active_high: groups.active_high.length,
    inactive: groups.inactive.length,
    violator: groups.violator.length,
    violatorWarned: groups.warned.length,
    protected: groups.vacation.length + groups.excuse.length,
    grace: groups.grace.length
  };

  return { embed, groups, interactionData };
}

/* -------------------------------------------------------------------------- */
/*                           Dashboard Updater                                */
/* -------------------------------------------------------------------------- */

let dashboardUpdateTimer = null;

async function findDashboardRecord() {
  for (const key of [DASHBOARD_KEY, ...LEGACY_DASHBOARD_KEYS]) {
    const rec = await PersistentMessage.findOne({ key });
    if (rec) return rec;
  }
  return null;
}

async function clearLegacyDashboardKeys() {
  for (const key of LEGACY_DASHBOARD_KEYS) {
    await PersistentMessage.deleteOne({ key }).catch(() => {});
  }
}

export function scheduleReportsDashboardUpdate(client, delayMs = 8000) {
  if (!client) return;
  if (dashboardUpdateTimer) clearTimeout(dashboardUpdateTimer);
  dashboardUpdateTimer = setTimeout(() => {
    dashboardUpdateTimer = null;
    updateReportsDashboard(client, false).catch(e =>
      console.error('❌ فشل تحديث لوحة التفاعل (مجدول):', e.message)
    );
  }, delayMs);
}

export async function updateReportsDashboard(client, forceReset = false) {
  const cfg = loadConfig();
  const channelId = resolveReportsChannelId(cfg);
  if (!channelId) {
    console.warn('⚠️ قناة تقرير التفاعل غير مضبوطة (points.channels.reports أو general.webhooks.report)');
    return false;
  }
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.warn(`⚠️ لم أجد قناة التقرير: ${channelId}`);
      return false;
    }
    const guild = channel.guild;
    const activeDbMembers = await Member.find({ isActive: true });
    const activeIds = activeDbMembers.map(m => m.discordId);
    const { embed } = await generateReportEmbed(guild, activeIds);

    let pMsg = await findDashboardRecord();
    let message = null;

    if (forceReset) {
      const keysToClear = [DASHBOARD_KEY, ...LEGACY_DASHBOARD_KEYS];
      for (const key of keysToClear) {
        const rec = await PersistentMessage.findOne({ key });
        if (rec?.messageId) {
          const old = await channel.messages.fetch(rec.messageId).catch(() => null);
          if (old?.deletable) await old.delete().catch(() => {});
        }
        await PersistentMessage.deleteOne({ key }).catch(() => {});
      }
      pMsg = null;
    } else if (pMsg) {
      message = await channel.messages.fetch(pMsg.messageId).catch(() => null);
    }

    if (message) {
      try {
        await message.edit({ embeds: [embed] });
      } catch (editError) {
        if ([50005, 10008, 10003].includes(editError.code)) {
          message = null;
          await PersistentMessage.deleteMany({ key: { $in: [DASHBOARD_KEY, ...LEGACY_DASHBOARD_KEYS] } }).catch(() => {});
        } else {
          throw editError;
        }
      }
    }

    if (!message) {
      message = await channel.send({ embeds: [embed] });
      await clearLegacyDashboardKeys();
      await PersistentMessage.findOneAndUpdate(
        { key: DASHBOARD_KEY },
        { key: DASHBOARD_KEY, guildId: guild.id, channelId: channel.id, messageId: message.id, updatedAt: new Date() },
        { upsert: true, new: true }
      );
    } else if (pMsg?.key !== DASHBOARD_KEY) {
      await clearLegacyDashboardKeys();
      await PersistentMessage.findOneAndUpdate(
        { key: DASHBOARD_KEY },
        { key: DASHBOARD_KEY, guildId: guild.id, channelId: channel.id, messageId: message.id, updatedAt: new Date() },
        { upsert: true, new: true }
      );
    }

    console.log(`✅ تم تحديث لوحة التفاعل (${forceReset ? 'إعادة إنشاء' : 'تعديل'})`);
    return true;
  } catch (error) {
    console.error('❌ Failed to update reports dashboard:', error);
    return false;
  }
}

export { generateReportEmbed };

export async function startReportSystem(client) {
  await updateReportsDashboard(client, false);
}

/* -------------------------------------------------------------------------- */
/*                         Subcommand Handlers                                */
/* -------------------------------------------------------------------------- */

async function handleView(interaction) {
  const ephemeral = interaction.options.getBoolean('مخفي') ?? true;
  await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : undefined });

  const guild = interaction.guild;
  const activeDbMembers = await Member.find({ isActive: true });
  const activeIds = activeDbMembers.map(m => m.discordId);
  const { embed, interactionData } = await generateReportEmbed(guild, activeIds);

  // Add a custom header for the admin view
  embed.setTitle('📊 التقرير الإداري المباشر - X.IRAQ System');
  embed.setColor(0x5865F2);

  await interaction.editReply({ embeds: [embed] });
}

async function handleUpdateDashboard(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let ok = await updateReportsDashboard(interaction.client, false);
  if (!ok) ok = await updateReportsDashboard(interaction.client, true);

  const channelId = resolveReportsChannelId(loadConfig());
  const embed = ok
    ? embedSuccess('✅ تم تحديث لوحة التفاعل', `تم تحديث التقرير المباشر في <#${channelId}> بأحدث البيانات (المتفاعلون، الخاملين، المخالفون، التوب).`)
    : embedCustom('#ED4245', '❌ فشل التحديث', 'تأكد من ضبط قناة التقرير في `config.json` تحت `points.channels.reports` أو `general.webhooks.report`.');

  await interaction.editReply({ embeds: [embed] });
}

async function handleExport(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const activeDbMembers = await Member.find({ isActive: true });
  const activeIds = activeDbMembers.map(m => m.discordId);
  const { groups } = await generateReportEmbed(guild, activeIds);

  const lines = [];
  const now = new Date().toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad' });

  lines.push(`📋 تقرير التصدير الإداري - ${now}`);
  lines.push(`${'='.repeat(50)}`);

  if (groups.violator.length > 0) {
    lines.push(`\n🔴 المخالفون (${groups.violator.length}):`);
    for (const m of groups.violator) {
      lines.push(`  • ${m.discordId} | ${m.gameName} | نقاط: ${m.points}`);
    }
  }

  if (groups.warned.length > 0) {
    lines.push(`\n🟤 المنذرون (${groups.warned.length}):`);
    for (const m of groups.warned) {
      lines.push(`  • ${m.discordId} | ${m.gameName} | نقاط: ${m.points} | إنذارات: ${m.warningCount}`);
    }
  }

  if (groups.inactive.length > 0) {
    lines.push(`\n🟡 الخاملون (${groups.inactive.length}):`);
    for (const m of groups.inactive) {
      lines.push(`  • ${m.discordId} | ${m.gameName} | نقاط اليوم: ${m.points}`);
    }
  }

  if (groups.active_high.length > 0) {
    lines.push(`\n🟢 متفاعلون عال (${groups.active_high.length}) — أفضل 20:`);
    for (const m of groups.active_high.slice(0, 20)) {
      lines.push(`  • ${m.discordId} | ${m.gameName} | نقاط اليوم: ${m.points}`);
    }
  }

  if (groups.vacation.length > 0) {
    lines.push(`\n🏖️ مجازون (${groups.vacation.length}):`);
    for (const m of groups.vacation) {
      lines.push(`  • ${m.discordId} | ${m.gameName}`);
    }
  }

  if (groups.excuse.length > 0) {
    lines.push(`\n📋 معذورون (${groups.excuse.length}):`);
    for (const m of groups.excuse) {
      lines.push(`  • ${m.discordId} | ${m.gameName} | ${m.excuse?.type || 'عذر'}`);
    }
  }

  lines.push(`\n${'='.repeat(50)}`);
  lines.push(`يحتاج متابعة: ${groups.violator.length + groups.warned.length + groups.inactive.length} عضو`);
  lines.push(`إجمالي الأعضاء النشطين: ${groups.violator.length + groups.warned.length + groups.inactive.length + groups.active_high.length + groups.vacation.length + groups.excuse.length + groups.grace.length}`);

  const content = lines.join('\n');
  const buf = Buffer.from(content, 'utf8');
  const attachment = new AttachmentBuilder(buf, { name: `report_${Date.now()}.txt` });

  const summaryEmbed = embedGold('📤 تصدير تقرير التفاعل',
      `**🔴 مخالفون:** ${groups.violator.length}\n` +
      `**🟤 منذرون:** ${groups.warned.length}\n` +
      `**🟡 خاملون:** ${groups.inactive.length}\n` +
      `**🟢 متفاعلون:** ${groups.active_high.length}\n` +
      `**🏖️ مجازون:** ${groups.vacation.length} | **📋 معذورون:** ${groups.excuse.length}\n\n` +
      `تم إرفاق ملف نصي بتوقيت بغداد.`
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [summaryEmbed], files: [attachment] });
}

/* -------------------------------------------------------------------------- */
/*                              Slash Command                                 */
/* -------------------------------------------------------------------------- */

export default {
  data: new SlashCommandBuilder()
    .setName('تقارير')
    .setDescription('نظام التقارير الإداري لمتابعة نشاط الأعضاء')
    .addSubcommand(sub =>
      sub.setName('عرض')
        .setDescription('عرض تقرير النشاط المباشر للأعضاء')
        .addBooleanOption(opt =>
          opt.setName('مخفي')
            .setDescription('هل تريد إظهار التقرير للجميع؟ (افتراضي: مخفي)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('تحديث_اللوحة')
        .setDescription('تحديث لوحة التقارير الدائمة في قناة التقارير (حذف القديمة وإرسال جديدة)')
    )
    .addSubcommand(sub =>
      sub.setName('تصدير')
        .setDescription('تصدير قائمة المخالفين والخاملين كملف نصي')
    ),

  async execute(interaction) {
    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: '❌ ليس لديك صلاحية لاستخدام أوامر التقارير.',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'عرض') return handleView(interaction);
    if (sub === 'تحديث_اللوحة') return handleUpdateDashboard(interaction);
    if (sub === 'تصدير') return handleExport(interaction);
  }
};
