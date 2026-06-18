import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} from 'discord.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, neutral as embedNeutral, gold as embedGold, custom as embedCustom } from './embedStyles.js';
import { dmUser } from './notificationSystem.js';
import { logScenario } from './logSystem.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Scenario from '../models/Scenario.js';
import ScenarioAttendance from '../models/ScenarioAttendance.js';
import Member from '../models/Member.js';
import PointLog from '../models/PointLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  try {
    const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
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
          if (merged[key]) {
            Object.assign(merged[key], data);
          } else {
            merged[key] = data;
          }
        }
        config.committees.list = merged;
      }
    }
    return config;
  } catch { return {}; }
}

const scenarioTimers = new Map();
const editExpiryTimers = new Map();
const voteTimers = new Map();
const pendingExcuseActions = new Map();
const pendingCreateData = new Map();

function getScenarioId(customId) {
  const parts = customId.split('_');
  return parts[2] || null;
}

function extractUserIdFromExcuse(customId) {
  const parts = customId.split('_');
  return parts[3] || null;
}

function isInAnyCommittee(member, config) {
  const committees = config.committees?.list || {};
  for (const key of Object.keys(committees)) {
    const committee = committees[key];
    const roles = committee.roles || {};
    for (const type of ['manager', 'deputy', 'member']) {
      const list = roles[type] || [];
      for (const id of list) {
        if (id === member.id || member.roles?.cache?.has(id)) return true;
      }
    }
  }
  return false;
}

function isScenarioAdmin(member, scenario, config) {
  const uid = member.id;
  if ((config.committees?.founders || []).includes(uid)) return true;
  if ((config.committees?.authorizedUsers || []).includes(uid)) return true;
  const pRoles = config.committees?.list?.family_presidency?.roles?.member || [];
  for (const r of pRoles) { if (r === uid || member.roles?.cache?.has(r)) return true; }
  const iRoles = config.committees?.list?.interaction?.roles || {};
  for (const type of ['manager', 'deputy', 'member']) {
    for (const id of (iRoles[type] || [])) { if (id === uid || member.roles?.cache?.has(id)) return true; }
  }
  if (scenario.createdBy === uid) return true;
  if (scenario.supervisorId === uid) return true;
  if (scenario.deputySupervisorId === uid) return true;
  return false;
}

function parseIraqTime(dateStr, timeStr) {
  const cleanDate = dateStr.trim().replace(/-/g, '/');
  let year, month, day;
  
  // Try YYYY/MM/DD
  let match = cleanDate.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (match) {
    year = parseInt(match[1]);
    month = parseInt(match[2]) - 1;
    day = parseInt(match[3]);
  } else {
    // Try DD/MM/YYYY
    match = cleanDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      day = parseInt(match[1]);
      month = parseInt(match[2]) - 1;
      year = parseInt(match[3]);
    } else {
      // Try YY/MM/DD (assume 2000+)
      match = cleanDate.match(/^(\d{2})\/(\d{1,2})\/(\d{1,2})$/);
      if (match) {
        year = 2000 + parseInt(match[1]);
        month = parseInt(match[2]) - 1;
        day = parseInt(match[3]);
      } else {
        return null;
      }
    }
  }

  const cleanTime = timeStr.trim().toLowerCase();
  let hour = 0, minute = 0;

  // Try HH:MM am/pm or HH am/pm
  const ampmMatch = cleanTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampmMatch) {
    hour = parseInt(ampmMatch[1]);
    minute = ampmMatch[2] ? parseInt(ampmMatch[2]) : 0;
    const ampm = ampmMatch[3];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
  } else {
    // Try 24h format HH:MM or HH
    const regularMatch = cleanTime.match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (regularMatch) {
      hour = parseInt(regularMatch[1]);
      minute = regularMatch[2] ? parseInt(regularMatch[2]) : 0;
    } else {
      return null;
    }
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return new Date(Date.UTC(year, month, day, hour - 3, minute, 0));
}

function formatIraqTime(date) {
  return date.toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad', hour: 'numeric', minute: 'numeric', hour12: true });
}

function formatIraqDate(date) {
  return date.toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad', year: 'numeric', month: 'numeric', day: 'numeric' });
}

function formatDuration(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h} ساعة${m > 0 ? ` و ${m} دقيقة` : ''}`;
  return `${m} دقيقة`;
}

function iraqDateStrFromDate(date = new Date()) {
  const [y, m, d] = date.toLocaleString('en-CA', { timeZone: 'Asia/Baghdad' }).split(',')[0].split('-').map(Number);
  return `${y}/${m}/${d}`;
}

function parseVoteTimeOption(timeStr) {
  if (!timeStr?.trim()) return null;
  let start = parseIraqTime(iraqDateStrFromDate(), timeStr.trim());
  if (!start) return null;
  if (start.getTime() <= Date.now()) {
    const tomorrow = new Date(Date.now() + 86400000);
    start = parseIraqTime(iraqDateStrFromDate(tomorrow), timeStr.trim());
  }
  return start;
}

function tallyVotes(attendances) {
  const votes = {};
  for (const a of attendances) {
    if (a.status === 'voted' && a.votedOption) {
      votes[a.votedOption] = (votes[a.votedOption] || 0) + 1;
    }
  }
  return votes;
}

function buildSortedVoteOptions(votes, votingOptions = []) {
  const seen = new Set();
  const sorted = [...votingOptions].sort((a, b) => (votes[b] || 0) - (votes[a] || 0));
  for (const opt of Object.keys(votes)) {
    if (!sorted.includes(opt)) sorted.push(opt);
  }
  return sorted.filter(opt => { if (seen.has(opt)) return false; seen.add(opt); return true; });
}

function buildVoteOptionLines(votes, votingOptions) {
  const sorted = buildSortedVoteOptions(votes, votingOptions);
  const maxVotes = Math.max(1, ...sorted.map(opt => votes[opt] || 0));
  return sorted.map(opt => {
    const count = votes[opt] || 0;
    const barLen = Math.round((count / maxVotes) * 10);
    const bar = '⬛'.repeat(barLen) + '⬜'.repeat(10 - barLen);
    const label = count === 1 ? 'صوت' : 'أصوات';
    return `🕐 **${opt}**  →  ${bar}  ${count} ${label}`;
  });
}

// Helper: Build short mention list with truncation
function buildMentionList(arr, limit = 20) {
  if (!arr || arr.length === 0) return '`لا يوجد`';
  const mentions = arr.slice(0, limit).map(a => `<@${typeof a === 'string' ? a : a.userId}>`).join(' ');
  return arr.length > limit ? mentions + ` *(+${arr.length - limit})*` : mentions;
}

async function updateScenarioEmbed(scenario, guild) {
  try {
    const config = loadConfig();
    const channel = guild.channels.cache.get(scenario.channelId);
    if (!channel) return;
    const msg = await channel.messages.fetch(scenario.messageId).catch(() => null);
    if (!msg) return;

    const attendances = await ScenarioAttendance.find({ scenarioId: scenario._id });
    const registeredList  = attendances.filter(a => a.status === 'registered');
    const attendedList    = attendances.filter(a => a.status === 'attended');
    const excusedList     = attendances.filter(a => a.status === 'excused');
    const pendingList     = attendances.filter(a => a.excuseStatus === 'pending');
    const absentList      = attendances.filter(a => a.status === 'absent');

    const pts = config.scenarios?.points || {};
    const startTs = Math.floor(scenario.startTime.getTime() / 1000);
    let desc = '';

    if (scenario.status === 'cancelled') {
      desc = [
        '▬▬▬ ﷽ ▬▬▬',
        '❌ **تم إلغاء هذه العملية الميدانية بقرار إداري.**',
        '',
        `**🎬 عنوان العملية:** ${scenario.title}`,
        '**📝 السبب:** || تم إلغاء المهمة أو تأجيلها لوقت آخر ||',
        '',
        '▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬',
      ].join('\n');

    } else if (scenario.status === 'completed') {
      const totalPoints =
        (attendedList.length * (pts.attendance || 10)) +
        (scenario.supervisorId ? (pts.supervisor || 20) : 0) +
        (scenario.deputySupervisorId ? (pts.deputySupervisor || 15) : 0) +
        (pts.creator || 25);

      // Build excused list with reasons
      const excusedLines = excusedList.length > 0
        ? excusedList.slice(0, 15).map(a =>
            `  — <@${a.userId}>${a.excuseReason ? ` *(${a.excuseReason.slice(0, 40)})*` : ''}`
          ).join('\n') + (excusedList.length > 15 ? `\n  *(+${excusedList.length - 15} أكثر)*` : '')
        : '  — `لا يوجد`';

      desc = [
        '▬▬▬ ﷽ ▬▬▬',
        '🏁 **تم إنهاء العملية الميدانية بنجاح ورفع التقارير الميدانية!**',
        '',
        '**👑 الهيكل القيادي للعملية:**',
        `• 👑 **المشرف العام**: ${scenario.supervisorId ? `<@${scenario.supervisorId}>` : 'غير معين'}`,
        `• 👤 **نائب المسؤول**: ${scenario.deputySupervisorId ? `<@${scenario.deputySupervisorId}>` : 'غير معين'}`,
        '',
        '**📊 نتائج المشاركة النهائية:**',
        `• ✅ **الحضور (${attendedList.length} أبطال):** ${buildMentionList(attendedList)}`,
        `• 📋 **المعذورون (${excusedList.length} أعضاء):**`,
        excusedLines,
        `• ❌ **الغائبون (${absentList.length} أعضاء):** ${buildMentionList(absentList)}`,
        '',
        `**💰 النقاط الموزعة:** \`${totalPoints}\` نقطة تفاعل.`,
        '',
        '*نشكر التزام أبطال عائلة العراق ونحث الغائبين على الالتزام في العمليات القادمة.*',
        '▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬',
      ].join('\n');

    } else {
      // Active scenario — show live roster + countdown
      const regMentions = registeredList.length > 0
        ? registeredList.slice(0, 20).map(a => `<@${a.userId}>`).join(' ') +
          (registeredList.length > 20 ? ` *(+${registeredList.length - 20})*` : '')
        : '`لا يوجد مسجلون بعد`';

      const pendingMentions = pendingList.length > 0
        ? pendingList.map(a => `<@${a.userId}>`).join(' ')
        : '`لا يوجد`';

      const excusedMentions = excusedList.length > 0
        ? excusedList.slice(0, 10).map(a =>
            `<@${a.userId}>${a.excuseReason ? ` *(${a.excuseReason.slice(0, 30)})*` : ''}`
          ).join('\n')
        : '`لا يوجد`';

      desc = [
        '▬▬▬ ﷽ ▬▬▬',
        '📢 **تنويه لأعضاء العائلة الأبطال، تم التجهيز لعملية ميدانية جديدة!**',
        '',
        '> *"الاتحاد هو القوة. عندما يكون هناك عمل جماعي وتكامل، يمكن تحقيق أشياء عظيمة."*',
        '',
        '**📝 تفاصيل العملية:**',
        scenario.description,
        '',
        '**⏰ توقيت العملية (بتوقيت بغداد):**',
        ...(scenario.votedTime ? [
          `• 🗳️ **تم اختيار الوقت**: ${scenario.votedTime} بـ ${scenario._voteWinnerCount ?? '?'}/${scenario._voteTotalCount ?? '?'} صوت`,
        ] : []),
        `• 🕐 **البداية**: ${formatIraqTime(scenario.startTime)} (${formatIraqDate(scenario.startTime)})`,
        `• ⏳ **يبدأ خلال**: <t:${startTs}:R>`,
        `• ⏱️ **المدة**: ${formatDuration(scenario.endTime - scenario.startTime)}`,
        '',
        '**👑 الهيكل القيادي للعملية:**',
        `• 👑 **المشرف العام**: ${scenario.supervisorId ? `<@${scenario.supervisorId}>` : '`قيد الانتظار...`'}`,
        `• 👤 **نائب المسؤول**: ${scenario.deputySupervisorId ? `<@${scenario.deputySupervisorId}>` : '`قيد الانتظار...`'}`,
        '',
        `**✅ المسجلون للحضور (${registeredList.length}):**`,
        regMentions,
        '',
        `**📝 أعذار معلقة (${pendingList.length}):** ${pendingMentions}`,
        `**📋 أعذار مقبولة (${excusedList.length}):**`,
        excusedMentions,
        '',
        '📌 *يرجى تسجيل الحضور أو تقديم العذر عبر الأزرار أدناه.*',
        '▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬',
      ].join('\n');
    }

    // Truncate to Discord's 4096 limit
    if (desc.length > 4000) desc = desc.slice(0, 3990) + '\n*...(تم الاقتصار)*';

    const embed = (scenario.status === 'completed'
      ? embedSuccess(`🏁 ${scenario.title}`, desc)
      : scenario.status === 'cancelled'
        ? embedError('❌ سيناريو ملغي', desc)
        : embedInfo(`🎬 ${scenario.title}`, desc)
    ).setThumbnail(guild.iconURL() || null);

    if (scenario.status === 'active') {
      const rows = buildScenarioButtons(scenario, guild);
      await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
    } else if (scenario.status === 'completed') {
      const editWindow = config.scenarios?.editWindowMinutes || 60;
      const elapsed = Date.now() - (scenario.endTime?.getTime() || Date.now());
      const remaining = (editWindow * 60000) - elapsed;
      if (remaining > 0) {
        embed.setFooter({ text: `🕐 التعديل متاح لمدة ${formatDuration(remaining)}` });
        const rows = [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`scn_det_${scenario._id}`).setLabel('📋 تفاصيل المعذورين').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`scn_ed_${scenario._id}`).setLabel('✏️ تعديل').setStyle(ButtonStyle.Primary)
          )
        ];
        await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
      } else {
        embed.setFooter({ text: '🗂️ سيناريو منتهي' });
        await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
      }
    } else {
      await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
    }
  } catch (e) { console.error('[Scenario] updateEmbed:', e.message); }
}

function buildScenarioButtons(scenario, guild) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`scn_reg_${scenario._id}`).setLabel('✅ تسجيل حضور').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`scn_sup_${scenario._id}`).setLabel('👑 استلام مشرف').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`scn_dep_${scenario._id}`).setLabel('👤 نائب مسؤول').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`scn_exc_${scenario._id}`).setLabel('📝 تقديم عذر').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`scn_rem_${scenario._id}`).setLabel('🔔 تذكير').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`scn_ed_${scenario._id}`).setLabel('✏️ تعديل').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`scn_can_${scenario._id}`).setLabel('❌ إلغاء').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`scn_end_${scenario._id}`).setLabel('🏁 إنهاء').setStyle(ButtonStyle.Danger)
    )
  ];
  return rows;
}

function isVotingPhase(scenario) {
  return scenario?.status === 'active'
    && Array.isArray(scenario.votingOptions)
    && scenario.votingOptions.length > 0
    && !scenario.votedTime;
}

async function scnLog(guild, { event, details, mod, target, scenarioName }) {
  if (!guild) return;
  await logScenario(guild, { scenarioName, event, details, mod, target }).catch(e =>
    console.error('[Scenario] log:', e.message)
  );
}

function buildVoteButtons(scenario) {
  const options = scenario.votingOptions || [];
  const rows = [];
  let currentRow = new ActionRowBuilder();
  let count = 0;
  for (let idx = 0; idx < options.length; idx++) {
    const opt = options[idx];
    if (count >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      count = 0;
    }
    const label = opt.length > 20 ? opt.slice(0, 18) + '..' : opt;
    currentRow.addComponents(
      new ButtonBuilder().setCustomId(`scn_vote_${scenario._id}_${idx}`).setLabel(`🕐 ${label}`).setStyle(ButtonStyle.Secondary)
    );
    count++;
  }
  if (count > 0) rows.push(currentRow);
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`scn_unvote_${scenario._id}`).setLabel('🗳️ إلغاء صوتي').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`scn_endvote_${scenario._id}`).setLabel('🏁 إنهاء التصويت').setStyle(ButtonStyle.Danger)
    )
  );
  return rows;
}

async function scheduleEnd(scenario) {
  if (isVotingPhase(scenario)) return;
  const now = Date.now();
  const endTime = scenario.endTime?.getTime?.() || scenario.endTime;
  const delay = Math.max(0, endTime - now);
  if (scenarioTimers.has(scenario._id)) clearTimeout(scenarioTimers.get(scenario._id));
  const timer = setTimeout(async () => {
    try {
      const s = await Scenario.findById(scenario._id);
      if (s && s.status === 'active') await endScenario(s);
    } catch (e) { console.error('[Scenario] autoEnd:', e.message); }
  }, delay);
  scenarioTimers.set(scenario._id, timer);
}

async function scheduleReminder(scenario) {
  if (isVotingPhase(scenario)) return;
  const config = loadConfig();
  const mins = config.scenarios?.reminderMinutes || 60;
  const startTime = scenario.startTime?.getTime?.() || scenario.startTime;
  const now = Date.now();
  const delay = Math.max(0, startTime - now - (mins * 60000));
  if (delay > 0) {
    setTimeout(async () => {
      try {
        const s = await Scenario.findById(scenario._id);
        if (s && s.status === 'active') await sendReminder(s);
      } catch (e) { console.error('[Scenario] autoRemind:', e.message); }
    }, delay);
  }
}

async function scheduleEditExpiry(scenario, guild) {
  const config = loadConfig();
  const mins = config.scenarios?.editWindowMinutes || 60;
  const endTime = scenario.endTime?.getTime?.() || scenario.endTime;
  const now = Date.now();
  const delay = Math.max(0, (endTime + (mins * 60000)) - now);
  if (editExpiryTimers.has(scenario._id)) clearTimeout(editExpiryTimers.get(scenario._id));
  const timer = setTimeout(async () => {
    try {
      const s = await Scenario.findById(scenario._id);
      if (s) {
        const g = guild || await global.__discord_client?.guilds?.fetch?.(s.guildId).catch(() => null);
        if (g) {
          await updateScenarioEmbed(s, g);
          await archiveScenario(s, g);
        }
      }
    } catch (e) { console.error('[Scenario] editExpiry:', e.message); }
  }, delay);
  editExpiryTimers.set(scenario._id, timer);
}

function scheduleVoteEnd(scenario) {
  const endAt = scenario._voteEndsAt?.getTime?.() || scenario._voteEndsAt;
  if (!endAt) return;
  const delay = Math.max(0, endAt - Date.now());
  if (voteTimers.has(scenario._id)) clearTimeout(voteTimers.get(scenario._id));
  const timer = setTimeout(async () => {
    try {
      const s = await Scenario.findById(scenario._id);
      if (s && s.status === 'active' && s.votingOptions?.length > 0 && !s.votedTime) {
        await autoEndVote(s);
      }
    } catch (e) { console.error('[Scenario] autoVoteEnd:', e.message); }
  }, delay);
  voteTimers.set(scenario._id, timer);
}

async function finalizeVoteEnd(scenario, guild, { winner, winnerVotes, totalVotes, actorId = null }) {
  const durHours = parseFloat(scenario._durationHours) || 1;
  const parsedStart = parseVoteTimeOption(winner);
  scenario.startTime = parsedStart || new Date(Date.now() + 3600000);
  scenario.endTime = new Date(scenario.startTime.getTime() + (durHours * 3600000));
  scenario.votedTime = winner;
  scenario._voteWinnerCount = winnerVotes;
  scenario._voteTotalCount = totalVotes;
  scenario.votingOptions = [];
  const voteMsgId = scenario.messageId;
  scenario.messageId = null;
  await scenario.save();
  await ScenarioAttendance.deleteMany({ scenarioId: scenario._id });
  if (voteTimers.has(scenario._id)) {
    clearTimeout(voteTimers.get(scenario._id));
    voteTimers.delete(scenario._id);
  }
  const config = loadConfig();
  const channel = guild.channels.cache.get(scenario.channelId) || guild.channels.cache.get(config.scenarios?.announcementChannelId);
  if (channel && voteMsgId) {
    const msg = await channel.messages.fetch(voteMsgId).catch(() => null);
    if (msg) await msg.delete().catch(() => {});
  }
  const gifUrl = config.scenarios?.gifUrl;
  if (channel && gifUrl) await channel.send({ content: gifUrl }).catch(() => {});
  await sendAnnouncement(scenario, guild);
  await scheduleEnd(scenario);
  await scheduleReminder(scenario);
  await scnLog(guild, {
    scenarioName: scenario.title,
    mod: actorId,
    event: actorId ? 'انتهاء تصويت يدوي' : 'انتهاء تصويت تلقائي',
    details: `🗳️ الفائز: ${winner} (${winnerVotes}/${totalVotes} صوت) | البداية: ${formatIraqTime(scenario.startTime)}`,
  });
}

async function autoEndVote(scenario) {
  const guild = await global.__discord_client?.guilds?.fetch?.(scenario.guildId).catch(() => null);
  if (!guild) return;
  const attendances = await ScenarioAttendance.find({ scenarioId: scenario._id });
  const votes = tallyVotes(attendances);
  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const winner = sorted.length > 0 ? sorted[0][0] : (scenario.votingOptions?.[0] || '');
  const winnerVotes = sorted.length > 0 ? sorted[0][1] : 0;
  const totalVotes = Object.values(votes).reduce((s, v) => s + v, 0);
  await finalizeVoteEnd(scenario, guild, { winner, winnerVotes, totalVotes });
}

async function sendReminder(scenario) {
  const config = loadConfig();
  const guild = await global.__discord_client?.guilds?.fetch?.(scenario.guildId).catch(() => null);
  if (!guild) return;

  // ===== تذكير ذكي: فقط من لم يسجل ولم يعتذر =====
  const attendances = await ScenarioAttendance.find({ scenarioId: scenario._id });
  const exemptIds = new Set(
    attendances
      .filter(a =>
        a.status === 'registered' ||
        a.status === 'attended' ||
        a.status === 'excused' ||
        a.excuseStatus === 'pending' ||
        a.excuseStatus === 'approved'
      )
      .map(a => a.userId)
  );

  // جلب جميع الأعضاء النشطين غير المسجلين
  const allMembers = await Member.find({ isActive: true });
  const targets = allMembers.filter(m => !exemptIds.has(m.discordId));

  const startTs = Math.floor(scenario.startTime.getTime() / 1000);
  let sent = 0;
  for (const member of targets) {
    if (member.roomChannelId) {
      const channel = guild.channels.cache.get(member.roomChannelId);
      if (channel) {
        try {
          await channel.send({
            content: `<@${member.discordId}>`,
            embeds: [embedWarning(
              '🔔 تذكير: لم تسجل حضورك!',
              `🎬 **${scenario.title}**\n` +
              `🕐 ${formatIraqTime(scenario.startTime)} (${formatIraqDate(scenario.startTime)})\n` +
              `⏳ **يبدأ خلال**: <t:${startTs}:R>\n\n` +
              `📝 ${scenario.description}\n\n` +
              `📌 *لم تسجل حضورك بعد — توجه لقناة السيناريو وسجل أو قدم عذرك.*`
            )]
          });
          sent++;
        } catch {}
      }
    }
    // Rate limit protection
    await new Promise(r => setTimeout(r, 120));
  }

  await logScenario(guild, {
    scenarioName: scenario.title,
    event: 'تذكير',
    details: `تم إرسال تذكير لـ ${sent} عضو غير مسجل من أصل ${allMembers.length} عضو نشط.`,
  });
}

async function endScenario(scenario, actorId = null) {
  if (isVotingPhase(scenario)) {
    console.warn(`[Scenario] تخطي إنهاء سيناريو "${scenario.title}" — لا يزال في مرحلة التصويت`);
    return;
  }
  const config = loadConfig();
  const guild = await global.__discord_client?.guilds?.fetch?.(scenario.guildId).catch(() => null);
  if (!guild) return;

  const attendances = await ScenarioAttendance.find({ scenarioId: scenario._id });

  // 1. تحويل المسجلين إلى حضور نهائي
  for (const att of attendances) {
    if (att.status === 'registered') {
      att.status = 'attended';
      await att.save();
    }
  }

  // 2. تسجيل كل الأعضاء النشطين الذين ليس لديهم سجل كغائبين
  const existingUserIds = new Set(attendances.map(a => a.userId));
  const allActiveMembers = await Member.find({ isActive: true });
  for (const m of allActiveMembers) {
    if (!existingUserIds.has(m.discordId)) {
      await ScenarioAttendance.create({
        scenarioId: scenario._id,
        userId: m.discordId,
        status: 'absent',
        registeredAt: new Date()
      });
    }
  }

  scenario.status = 'completed';
  if (!scenario.endTime) scenario.endTime = new Date();
  await scenario.save();

  // 3. توزيع النقاط
  const updatedAttendances = await ScenarioAttendance.find({ scenarioId: scenario._id });
  const actualAttended = updatedAttendances.filter(a => a.status === 'attended');
  const pts = config.scenarios?.points || { attendance: 10, supervisor: 20, creator: 25, deputySupervisor: 15 };

  for (const att of actualAttended) {
    const mem = await Member.findOne({ discordId: att.userId });
    if (mem) {
      mem.points = (mem.points || 0) + pts.attendance;
      await mem.save();
      att.pointsAwarded = pts.attendance;
      await att.save();

      // تسجيل لوغ النقاط لحضور السيناريو
      await PointLog.create({
        discordId: att.userId,
        memberRef: mem._id,
        points: pts.attendance,
        reason: `حضور سيناريو: ${scenario.title}`,
        actionBy: 'system'
      });
    }
  }
  if (scenario.supervisorId) {
    const sup = await Member.findOne({ discordId: scenario.supervisorId });
    if (sup) {
      sup.points = (sup.points || 0) + pts.supervisor;
      await sup.save();

      // تسجيل لوغ النقاط للمشرف
      await PointLog.create({
        discordId: scenario.supervisorId,
        memberRef: sup._id,
        points: pts.supervisor,
        reason: `مشرف سيناريو: ${scenario.title}`,
        actionBy: 'system'
      });
    }
  }
  if (scenario.deputySupervisorId) {
    const dep = await Member.findOne({ discordId: scenario.deputySupervisorId });
    if (dep) {
      dep.points = (dep.points || 0) + pts.deputySupervisor;
      await dep.save();

      // تسجيل لوغ النقاط للنائب
      await PointLog.create({
        discordId: scenario.deputySupervisorId,
        memberRef: dep._id,
        points: pts.deputySupervisor,
        reason: `نائب مشرف سيناريو: ${scenario.title}`,
        actionBy: 'system'
      });
    }
  }
  if (scenario.createdBy) {
    const cr = await Member.findOne({ discordId: scenario.createdBy });
    if (cr) {
      cr.points = (cr.points || 0) + pts.creator;
      await cr.save();

      // تسجيل لوغ النقاط لصانع السيناريو
      await PointLog.create({
        discordId: scenario.createdBy,
        memberRef: cr._id,
        points: pts.creator,
        reason: `صانع سيناريو: ${scenario.title}`,
        actionBy: 'system'
      });
    }
  }

  const absentCount = updatedAttendances.filter(a => a.status === 'absent').length;
  const excusedCount = updatedAttendances.filter(a => a.status === 'excused').length;

  const totalPoints = (actualAttended.length * pts.attendance) + (scenario.supervisorId ? pts.supervisor : 0) + (scenario.deputySupervisorId ? pts.deputySupervisor : 0) + (scenario.createdBy ? pts.creator : 0);
  await scnLog(guild, {
    scenarioName: scenario.title,
    mod: actorId,
    event: actorId ? 'إنهاء يدوي' : 'إنهاء تلقائي',
    details: `✅ ${actualAttended.length} حاضر | ❌ ${absentCount} غائب | 📋 ${excusedCount} معذور | 💰 ${totalPoints} نقطة موزعة`,
  });

  await sendSummaryAndRating(scenario, guild);
  await updateScenarioEmbed(scenario, guild);
  await scheduleEditExpiry(scenario, guild);
}

async function sendSummaryAndRating(scenario, guild) {
  const attendances = await ScenarioAttendance.find({ scenarioId: scenario._id });
  const attended = attendances.filter(a => a.status === 'attended');
  const absent = attendances.filter(a => a.status === 'absent');
  const excused = attendances.filter(a => a.status === 'excused');
  const pts = loadConfig().scenarios?.points || { attendance: 10, supervisor: 20, creator: 25, deputySupervisor: 15 };
  const total = (attended.length * pts.attendance) + (scenario.supervisorId ? pts.supervisor : 0) + (scenario.deputySupervisorId ? pts.deputySupervisor : 0) + (pts.creator);
  const embed = embedSuccess(`🏁 ملخص السيناريو: ${scenario.title}`,
    `👑 المشرف: ${scenario.supervisorId ? `<@${scenario.supervisorId}>` : 'غير معين'}\n` +
    `👤 نائب المسؤول: ${scenario.deputySupervisorId ? `<@${scenario.deputySupervisorId}>` : 'غير معين'}\n\n` +
    `✅ الحضور (${attended.length}): ${attended.map(a => `<@${a.userId}>`).join(' ') || 'لا أحد'}\n` +
    `❌ الغياب (${absent.length}): ${absent.map(a => `<@${a.userId}>`).join(' ') || 'لا أحد'}\n` +
    `📝 الأعذار (${excused.length}): ${excused.map(a => `<@${a.userId}>`).join(' ') || 'لا أحد'}\n\n` +
    `🔹 إجمالي النقاط الموزعة: ${total}`
  );
  const ratingRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`scn_rate_${scenario._id}_1`).setLabel('⭐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`scn_rate_${scenario._id}_2`).setLabel('⭐⭐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`scn_rate_${scenario._id}_3`).setLabel('⭐⭐⭐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`scn_rate_${scenario._id}_4`).setLabel('⭐⭐⭐⭐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`scn_rate_${scenario._id}_5`).setLabel('⭐⭐⭐⭐⭐').setStyle(ButtonStyle.Secondary)
  );
  const channel = guild.channels.cache.get(scenario.channelId);
  if (channel) {
    await channel.send({ embeds: [embed], components: [ratingRow] }).catch(() => {});
  }
}

async function archiveScenario(scenario, guild) {
  const config = loadConfig();
  const archiveId = config.scenarios?.archiveChannelId;
  if (!archiveId) return;
  const channel = guild.channels.cache.get(archiveId);
  if (!channel) return;
  const attendances = await ScenarioAttendance.find({ scenarioId: scenario._id });
  const attended = attendances.filter(a => a.status === 'attended');
  const absent = attendances.filter(a => a.status === 'absent');
  const excused = attendances.filter(a => a.status === 'excused');
  const pts = config.scenarios?.points || { attendance: 10, supervisor: 20, creator: 25, deputySupervisor: 15 };
  const total = (attended.length * pts.attendance) + (scenario.supervisorId ? pts.supervisor : 0) + (scenario.deputySupervisorId ? pts.deputySupervisor : 0) + (pts.creator);
  const avgRating = attendances.filter(a => a.rating).reduce((s, a) => s + a.rating, 0) / (attendances.filter(a => a.rating).length || 1);
  const embed = embedNeutral(`🏛️ أرشيف سيناريو: ${scenario.title}`,
    `📅 ${formatIraqDate(scenario.startTime)}\n` +
    `🕐 ${formatIraqTime(scenario.startTime)} → ${formatIraqTime(scenario.endTime)}\n` +
    `⏳ ${formatDuration(scenario.endTime - scenario.startTime)}\n\n` +
    `👑 المشرف: ${scenario.supervisorId ? `<@${scenario.supervisorId}>` : 'غير معين'}\n` +
    `👤 نائب المسؤول: ${scenario.deputySupervisorId ? `<@${scenario.deputySupervisorId}>` : 'غير معين'}\n` +
    `👨‍💻 المنشئ: <@${scenario.createdBy}>\n\n` +
    `✅ ${attended.length} حضور\n❌ ${absent.length} غياب\n📝 ${excused.length} أعذار\n\n` +
    `🔹 ${total} نقطة موزعة\n` +
    `⭐ متوسط التقييم: ${attendances.filter(a => a.rating).length > 0 ? avgRating.toFixed(1) : 'لا يوجد'}`
  ).setFooter({ text: `تاريخ الأرشفة: ${new Date().toLocaleString('ar-IQ')}` });
  const msg = await channel.send({ embeds: [embed] }).catch(() => {});
  if (msg) {
    scenario.archiveMessageId = msg.id;
    await scenario.save();
    await scnLog(guild, {
      scenarioName: scenario.title,
      event: 'أرشفة',
      details: `📦 تم أرشفة السيناريو في <#${archiveId}> | ✅ ${attended.length} حضور | ❌ ${absent.length} غياب`,
    });
  }
}

export async function initActiveScenarios(client) {
  global.__discord_client = client;
  const config = loadConfig();
  const editMins = config.scenarios?.editWindowMinutes || 60;
  const editMs = editMins * 60000;
  const now = Date.now();
  const active = await Scenario.find({ status: 'active' });
  let restoredVotes = 0;
  for (const s of active) {
    if (isVotingPhase(s)) {
      const voteEndsAt = s._voteEndsAt?.getTime?.() || s._voteEndsAt || 0;
      if (voteEndsAt && voteEndsAt <= now) {
        await autoEndVote(s);
      } else if (voteEndsAt) {
        scheduleVoteEnd(s);
        restoredVotes++;
      }
      continue;
    }
    await scheduleEnd(s);
    await scheduleReminder(s);
  }
  const completed = await Scenario.find({ status: 'completed', endTime: { $ne: null } });
  let restoredEdit = 0;
  for (const s of completed) {
    const endTime = s.endTime?.getTime?.() || s.endTime;
    if (endTime && (endTime + editMs) > now) {
      await scheduleEditExpiry(s, null);
      restoredEdit++;
    }
  }
  console.log(`[Scenarios] Restored ${active.length} active (${restoredVotes} تصويت) + ${restoredEdit} edit windows`);
}

export async function handleScenarioInteraction(interaction) {
  const customId = interaction.customId;
  try {
    if (interaction.isButton()) {
      if (customId === 'scn_panel_create') return handleCreateStart(interaction);
      if (customId === 'scn_panel_list') return handleListActive(interaction);
      if (customId === 'scn_stats') return handleStats(interaction);
    }
    if (customId === 'scn_panel') return handlePanelCommand(interaction);
    if (customId.startsWith('scn_create_type_')) return handleCreateTypeSelect(interaction);
    if (customId.startsWith('scn_reg_')) return handleRegister(interaction);
    if (customId.startsWith('scn_sup_')) return handleSupervisor(interaction);
    if (customId.startsWith('scn_dep_')) return handleDeputy(interaction);
    if (customId.startsWith('scn_exc_')) return handleExcuse(interaction);
    if (customId.startsWith('scn_acc_excuse_')) return handleAcceptExcuse(interaction);
    if (customId.startsWith('scn_rej_excuse_') && !customId.includes('_r_')) return handleRejectExcuse(interaction);
    if (customId.startsWith('scn_rem_')) return handleReminder(interaction);
    if (customId.startsWith('scn_ed_') && customId.split('_').length === 3) return handleEditSelect(interaction);
    if (customId.startsWith('scn_can_')) return handleCancel(interaction);
    if (customId.startsWith('scn_end_')) return handleEnd(interaction);
    if (customId.startsWith('scn_rate_')) return handleRating(interaction);
    if (customId.startsWith('scn_det_')) return handleDetails(interaction);
    if (customId.startsWith('scn_unvote_')) return handleUnvote(interaction);
    if (customId.startsWith('scn_vote_')) return handleVote(interaction);
    if (customId.startsWith('scn_endvote_')) return handleEndVote(interaction);

    if (interaction.isModalSubmit()) {
      if (customId === 'scn_create_vote_modal') return handleCreateModalVote(interaction);
      if (customId === 'scn_create_reg_modal') return handleCreateModal(interaction);
      if (customId.startsWith('scn_create_fixed_')) return handleCreateFixedModal(interaction);
      if (customId.startsWith('scn_create_vote_')) return handleCreateVoteModal(interaction);
      if (customId.startsWith('scn_ed_d_')) return handleEditDataModal(interaction);
      if (customId.startsWith('scn_rej_r_')) return handleRejectReasonModal(interaction);
      if (customId.startsWith('scn_exc_reason_')) return handleExcuseReasonModal(interaction);
    }

    if (interaction.isStringSelectMenu?.()) {
      if (customId.startsWith('scn_man_a_')) return handleManualAttend(interaction);
      if (customId.startsWith('scn_man_g_')) return handleManualAbsent(interaction);
      if (customId.startsWith('scn_ed_s_')) return handleEditMenuSelect(interaction);
    }
  } catch (e) {
    console.error('[Scenario] Error:', e.message);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ حدث خطأ أثناء تنفيذ العملية', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

export async function handlePanelCommand(interaction) {
  const embed = embedNeutral('𓆩🎬 غـرفة الـسـيـنـاريـوهـات والـعـمـلـيـات 𓆪', `
▬▬▬ ﷽ ▬▬▬
🏛️ **مرحباً بك في مركز قيادة وإدارة السيناريوهات والعمليات الميدانية** 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪

> *"القوة لا تأتي من القدرة الجسدية فقط، بل تأتي من الإرادة التي لا تقهر والتخطيط المحكم. قيادتنا للعمليات هي التي تصنع أمجاد العائلة."*

**🛡️ نبذة عن النظام:**
نظام العمليات والسيناريوهات صُمم لرفع كفاءة وتنسيق التكتيكات العسكرية والميدانية لعائلة **العراق**. من خلال هذه اللوحة، يُمكن للقادة والمسؤولين تنظيم وتسيير المهام الكبرى، وتوزيع النقاط للمتفاعلين وحصر الغياب والحضور بلمسة واحدة لتعزيز هيبة العائلة وتقدير جهود أبطالها.

**⚙️ أزرار التحكم والعمليات المتاحة:**
• ➕ **إنشاء سيناريو جديد**: جدولة وتجهيز عملية تكتيكية جديدة.
• 📋 **السيناريوهات الفعالة**: استعراض ومراقبة المهام الميدانية الجارية حالياً.
• 📊 **لوحة الإحصائيات**: استعراض مؤشرات الكفاءة وأفضل المتفاعلين بالعمليات.

**📌 تنبيهات هامة للمشرفين والقادة:**
- يرجى تحديد التواريخ والأوقات بدقة لتفادي أي تعارض في المهام.
- الحضور والغياب يُحسب تلقائياً فور إنهاء العملية ويؤثر مباشرة في ترقيات الأعضاء.
- العضو الذي يملك عذراً مقبولاً يُمكنه التقديم عبر الزر المخصص في إعلان السيناريو.

▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬
    `.trim())
    .setColor(0x2B2D31)
    .setThumbnail(interaction.guild?.iconURL() || null)
    .setFooter({ text: '𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 • إدارة العمليات والسيناريوهات الميدانية' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('scn_panel_create').setLabel('➕ إنشاء سيناريو').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('scn_panel_list').setLabel('📋 السيناريوهات الفعالة').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('scn_stats').setLabel('📊 إحصائيات').setStyle(ButtonStyle.Secondary)
  );
  await interaction.reply({ embeds: [embed], components: [row] });
}

async function handleCreateStart(interaction) {
  const modal = new ModalBuilder().setCustomId('scn_create_vote_modal').setTitle('➕ إنشاء سيناريو جديد');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('📌 العنوان').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('📝 الوصف').setStyle(TextInputStyle.Paragraph).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('⏳ المدة (ساعات)').setStyle(TextInputStyle.Short).setRequired(true))
  );
  await interaction.showModal(modal);
}

async function handleCreateModal(interaction) {
  // Defer immediately to avoid 3-second Discord timeout
  await interaction.deferReply({ ephemeral: true });

  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description');
  const dateStr = interaction.fields.getTextInputValue('date');
  const timeStr = interaction.fields.getTextInputValue('time');
  const durationStr = interaction.fields.getTextInputValue('duration');
  const duration = parseFloat(durationStr);
  if (isNaN(duration) || duration <= 0) {
    return interaction.editReply({ content: '⚠️ المدة يجب أن تكون رقماً أكبر من 0' });
  }
  const startTime = parseIraqTime(dateStr, timeStr);
  if (!startTime || isNaN(startTime.getTime())) {
    return interaction.editReply({ content: '⚠️ صيغة التاريخ أو الوقت غير صحيحة. مثال: 2026/3/2 و 3pm' });
  }
  if (startTime.getTime() <= Date.now()) {
    return interaction.editReply({ content: '⚠️ الوقت المدخل في الماضي، الرجاء إدخال وقت مستقبلي' });
  }
  const endTime = new Date(startTime.getTime() + (duration * 3600000));
  const guildId = interaction.guildId;
  const config = loadConfig();
  const channelId = config.scenarios?.announcementChannelId || interaction.channelId;
  const scenario = await Scenario.create({
    title, description, startTime, endTime,
    channelId, guildId, createdBy: interaction.user.id,
    supervisorId: null, deputySupervisorId: null,
    status: 'active', messageId: null, createdAt: new Date(),
    votingOptions: [], votedTime: null, averageRating: 0, archiveMessageId: null
  });
  await interaction.editReply({ content: `✅ تم إنشاء السيناريو: **${title}**` });
  await sendAnnouncement(scenario, interaction.guild);
  await scheduleEnd(scenario);
  await scheduleReminder(scenario);
  await scnLog(interaction.guild, {
    scenarioName: title,
    mod: interaction.user.id,
    event: 'إنشاء',
    details: `⏰ وقت محدد — البداية: ${formatIraqTime(startTime)} (${formatIraqDate(startTime)}) | المدة: ${duration} ساعة`,
  });
}

async function handleCreateModalVote(interaction) {
  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description');
  const durationStr = interaction.fields.getTextInputValue('duration');
  const duration = parseFloat(durationStr);
  if (isNaN(duration) || duration <= 0) {
    return interaction.reply({ content: '⚠️ المدة يجب أن تكون رقماً أكبر من 0', flags: MessageFlags.Ephemeral });
  }
  const id = `${interaction.user.id}_${Date.now()}`;
  pendingCreateData.set(id, { title, description, duration, durationStr });
  setTimeout(() => pendingCreateData.delete(id), 300000);
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`scn_create_type_${id}`)
      .setPlaceholder('اختر طريقة تحديد الوقت')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('⏰ وقت محدد').setDescription('أدخل تاريخ ووقت محدد').setValue('fixed'),
        new StringSelectMenuOptionBuilder().setLabel('🗳️ تصويت').setDescription('دع الأعضاء يختارون الوقت').setValue('vote')
      )
  );
  await interaction.reply({
    content: `📌 **${title}**\n📝 ${description}\n⏳ ${duration} ساعة\n\nاختر طريقة تحديد الوقت:`,
    components: [row],
    flags: MessageFlags.Ephemeral
  });
}

async function handleCreateTypeSelect(interaction) {
  const id = interaction.customId.replace('scn_create_type_', '');
  const data = pendingCreateData.get(id);
  if (!data) {
    return interaction.reply({ content: '⚠️ انتهت صلاحية الجلسة، الرجاء البدء من جديد', flags: MessageFlags.Ephemeral });
  }
  pendingCreateData.delete(id);
  if (interaction.values[0] === 'fixed') {
    const modal = new ModalBuilder().setCustomId(`scn_create_fixed_${Date.now()}`).setTitle('⏰ تحديد وقت السيناريو');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title_h').setLabel('العنوان').setStyle(TextInputStyle.Short).setValue(data.title)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc_h').setLabel('الوصف').setStyle(TextInputStyle.Paragraph).setValue(data.description)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dur_h').setLabel('المدة').setStyle(TextInputStyle.Short).setValue(data.durationStr)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('date').setLabel('📅 التاريخ (2026/3/2)').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('time').setLabel('🕐 الوقت (3pm أو 7 am)').setStyle(TextInputStyle.Short).setRequired(true))
    );
    await interaction.showModal(modal);
  } else {
    const modal = new ModalBuilder().setCustomId(`scn_create_vote_${Date.now()}`).setTitle('🗳️ إعداد التصويت');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title_h').setLabel('العنوان').setStyle(TextInputStyle.Short).setValue(data.title)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc_h').setLabel('الوصف').setStyle(TextInputStyle.Paragraph).setValue(data.description)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('dur_h').setLabel('المدة').setStyle(TextInputStyle.Short).setValue(data.durationStr)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('times').setLabel('🕐 الأوقات المقترحة').setStyle(TextInputStyle.Paragraph).setPlaceholder('1pm 2am 3am\nأو 1 pm, 2 am, 3 am').setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('voteDuration').setLabel('⏳ مدة التصويت (ساعات)').setStyle(TextInputStyle.Short).setPlaceholder('مثال: 2').setRequired(true))
    );
    await interaction.showModal(modal);
  }
}

async function handleCreateFixedModal(interaction) {
  // Defer immediately to avoid 3-second Discord timeout
  await interaction.deferReply({ ephemeral: true });

  const title = interaction.fields.getTextInputValue('title_h');
  const description = interaction.fields.getTextInputValue('desc_h');
  const durationStr = interaction.fields.getTextInputValue('dur_h');
  const dateStr = interaction.fields.getTextInputValue('date');
  const timeStr = interaction.fields.getTextInputValue('time');
  const duration = parseFloat(durationStr);
  const startTime = parseIraqTime(dateStr, timeStr);
  if (!startTime || isNaN(startTime.getTime())) {
    return interaction.editReply({ content: '⚠️ صيغة التاريخ أو الوقت غير صحيحة' });
  }
  if (isNaN(duration) || duration <= 0) {
    return interaction.editReply({ content: '⚠️ المدة يجب أن تكون رقماً أكبر من 0' });
  }
  if (startTime.getTime() <= Date.now()) {
    return interaction.editReply({ content: '⚠️ الوقت المدخل في الماضي، الرجاء إدخال وقت مستقبلي' });
  }
  const endTime = new Date(startTime.getTime() + (duration * 3600000));
  const config = loadConfig();
  const channelId = config.scenarios?.announcementChannelId || interaction.channelId;
  const scenario = await Scenario.create({
    title, description, startTime, endTime, channelId, guildId: interaction.guildId,
    createdBy: interaction.user.id, supervisorId: null, deputySupervisorId: null,
    status: 'active', messageId: null, createdAt: new Date(),
    votingOptions: [], votedTime: null, averageRating: 0, archiveMessageId: null
  });
  await interaction.editReply({ content: `✅ تم إنشاء السيناريو: **${title}**` });
  await sendAnnouncement(scenario, interaction.guild);
  await scheduleEnd(scenario);
  await scheduleReminder(scenario);
  await scnLog(interaction.guild, {
    scenarioName: title,
    mod: interaction.user.id,
    event: 'إنشاء',
    details: `⏰ وقت محدد — البداية: ${formatIraqTime(startTime)} (${formatIraqDate(startTime)}) | المدة: ${duration} ساعة`,
  });
}

async function handleCreateVoteModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const title = interaction.fields.getTextInputValue('title_h');
  const description = interaction.fields.getTextInputValue('desc_h');
  const durationStr = interaction.fields.getTextInputValue('dur_h');
  const timesRaw = interaction.fields.getTextInputValue('times');
  const voteDurationStr = interaction.fields.getTextInputValue('voteDuration');
  const duration = parseFloat(durationStr);
  const voteHours = parseFloat(voteDurationStr);

  if (isNaN(duration) || duration <= 0 || isNaN(voteHours) || voteHours <= 0) {
    return interaction.editReply({ content: '⚠️ المدة والأوقات يجب أن تكون أرقاماً صحيحة' });
  }

  // Parse times: split by comma, newline, or space
  const options = timesRaw.split(/[,\n\s]+/).map(s => s.trim()).filter(Boolean);
  if (options.length < 2) {
    return interaction.editReply({ content: '⚠️ أدخل على الأقل خيارين للتصويت' });
  }
  if (options.length > 10) {
    return interaction.editReply({ content: '⚠️ الحد الأقصى 10 خيارات' });
  }

  const config = loadConfig();
  const channelId = config.scenarios?.announcementChannelId || interaction.channelId;
  const voteEndsAt = new Date(Date.now() + voteHours * 3600000);
  const placeholderStart = new Date(voteEndsAt.getTime() + 3600000);
  const placeholderEnd = new Date(placeholderStart.getTime() + duration * 3600000);
  const scenario = await Scenario.create({
    title, description, startTime: placeholderStart, endTime: placeholderEnd, channelId,
    guildId: interaction.guildId, createdBy: interaction.user.id,
    supervisorId: null, deputySupervisorId: null, status: 'active',
    messageId: null, createdAt: new Date(),
    votingOptions: options, votedTime: null, averageRating: 0, archiveMessageId: null,
    _durationHours: duration,
    _voteDurationHours: voteHours,
    _voteEndsAt: voteEndsAt
  });
  await interaction.editReply({ content: `✅ تم إنشاء التصويت للسيناريو: **${title}** (مدة التصويت: ${voteHours} ساعة)` });
  await sendVoteAnnouncement(scenario, interaction.guild);
  scheduleVoteEnd(scenario);
  await scnLog(interaction.guild, {
    scenarioName: title,
    mod: interaction.user.id,
    event: 'بدء تصويت',
    details: `🗳️ الخيارات: ${options.join(' | ')} | مدة التصويت: ${voteHours} ساعة | مدة السيناريو: ${duration} ساعة`,
  });
}

async function sendAnnouncement(scenario, guild) {
  const config = loadConfig();
  const channel = guild.channels.cache.get(scenario.channelId) || guild.channels.cache.get(config.scenarios?.announcementChannelId);
  if (!channel) return;
  const gifUrl = config.scenarios?.gifUrl;
  const desc = `▬▬▬ ﷽ ▬▬▬
📢 **تنويه لأعضاء العائلة الأبطال، تم التجهيز لعملية ميدانية جديدة!**

> *"الاتحاد هو القوة. عندما يكون هناك عمل جماعي وتكامل، يمكن تحقيق أشياء عظمية."*

**📝 تفاصيل العملية:**
${scenario.description}

**⏰ توقيت العملية (بتوقيت بغداد):**
${scenario.votedTime ? `• 🗳️ **تم اختيار الوقت**: ${scenario.votedTime} بـ ${scenario._voteWinnerCount ?? '?'}/${scenario._voteTotalCount ?? '?'} صوت\n` : ''}• 🕐 **البداية**: ${formatIraqTime(scenario.startTime)} (${formatIraqDate(scenario.startTime)})
• ⏳ **المدة المتوقعة**: ${formatDuration(scenario.endTime - scenario.startTime)}

**👑 الهيكل القيادي للعملية:**
• 👑 **المشرف العام**: ${scenario.supervisorId ? `<@${scenario.supervisorId}>` : '\`قيد الانتظار...\`'}
• 👤 **نائب المسؤول**: ${scenario.deputySupervisorId ? `<@${scenario.deputySupervisorId}>` : '\`قيد الانتظار...\`'}

**👥 المسجلين للمهمة:**
• 🔹 عدد الأعضاء الجاهزين: \`0\` عضواً

📌 *يرجى من جميع المعنيين تسجيل الحضور بالضغط على الزر أدناه والاستعداد الكامل قبل الوقت المحدد.*
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`;
  const embed = embedInfo(`🎬 سـيـنـاريـو جـديـد: ${scenario.title}`, desc.trim())
    .setThumbnail(guild.iconURL() || null);
  const rows = buildScenarioButtons(scenario, guild);
  let msg;
  if (gifUrl) {
    await channel.send({ content: gifUrl }).catch(() => {});
  }
  await channel.send({ content: '@everyone', embeds: [embed], components: rows }).then(m => { msg = m; }).catch(() => {});
  if (msg) {
    scenario.messageId = msg.id;
    await scenario.save();
  }
}

async function sendVoteAnnouncement(scenario, guild) {
  const config = loadConfig();
  const channel = guild.channels.cache.get(scenario.channelId) || guild.channels.cache.get(config.scenarios?.announcementChannelId);
  if (!channel) return;

  const attendances = await ScenarioAttendance.find({ scenarioId: scenario._id });
  const votes = tallyVotes(attendances);
  const totalVotes = Object.values(votes).reduce((s, v) => s + v, 0);
  const optionsLines = buildVoteOptionLines(votes, scenario.votingOptions);
  const memberCount = await Member.countDocuments({ isActive: true });
  const endsAt = scenario._voteEndsAt?.getTime?.() || Date.now() + (parseFloat(scenario._voteDurationHours) || 1) * 3600000;
  const remainingMs = Math.max(0, endsAt - Date.now());

  const voteDesc = `▬▬▬ ﷽ ▬▬▬
🏛️ **دعوة للمشاركة في اختيار وقت العملية الميدانية**

> *"التشاور وتبادل الآراء هما ركيزة نجاح العمل القيادي."*

**📝 تفاصيل العملية:**
${scenario.description}

**⏳ المدة**: \`${scenario._durationHours || '?'}\` ساعة

━━━━━━━━━━━━━━
🗳️ **نتائج التصويت:**
${optionsLines.join('\n')}
━━━━━━━━━━━━━━
⏰ **التصويت ينتهي بعد**: ${formatDuration(remainingMs)}
📌 **المجموع**: ${totalVotes} ${totalVotes === 1 ? 'صوت' : 'أصوات'} من ${memberCount} عضو
━━━━━━━━━━━━━━
📌 *يرجى اختيار الوقت الأنسب عبر الأزرار أدناه — يمكنك تغيير صوتك لاحقاً*`;
  const embed = embedGold(`🗳️ تصويت على وقت السيناريو: ${scenario.title}`, voteDesc.trim())
    .setThumbnail(guild.iconURL() || null);

  const rows = buildVoteButtons(scenario);
  const gifUrl = config.scenarios?.voteGifUrl || config.scenarios?.gifUrl;
  let msg;
  if (gifUrl) {
    await channel.send({ content: gifUrl }).catch(() => {});
  }
  await channel.send({ content: '@everyone', embeds: [embed], components: rows }).then(m => { msg = m; }).catch(() => {});
  if (msg) {
    scenario.messageId = msg.id;
    await scenario.save();
  }
}

async function handleRegister(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active') {
    return interaction.reply({ content: '⚠️ هذا السيناريو غير نشط', flags: MessageFlags.Ephemeral });
  }
  const existing = await ScenarioAttendance.findOne({ scenarioId, userId: interaction.user.id });
  if (existing) {
    if (existing.status === 'attended') {
      return interaction.reply({ content: '✅ أنت مسجل كحاضر فعلاً', flags: MessageFlags.Ephemeral });
    }
    if (existing.status === 'excused') {
      return interaction.reply({ content: '📝 لديك عذر مقبول، لا يمكن إلغائه من هنا', flags: MessageFlags.Ephemeral });
    }
    if (existing.status === 'registered') {
      await ScenarioAttendance.deleteOne({ _id: existing._id });
      await updateScenarioEmbed(scenario, interaction.guild);
      await scnLog(interaction.guild, {
        scenarioName: scenario.title,
        target: interaction.user.id,
        event: 'إلغاء تسجيل',
        details: 'ألغى العضو تسجيل حضوره',
      });
      return interaction.reply({ content: '❌ تم إلغاء تسجيل الحضور', flags: MessageFlags.Ephemeral });
    }
  }
  await ScenarioAttendance.create({ scenarioId, userId: interaction.user.id, status: 'registered', registeredAt: new Date() });
  await updateScenarioEmbed(scenario, interaction.guild);
  await scnLog(interaction.guild, {
    scenarioName: scenario.title,
    target: interaction.user.id,
    event: 'تسجيل حضور',
    details: 'سجّل العضو حضوره للسيناريو',
  });
  await interaction.reply({ content: '✅ تم تسجيل حضورك ✓\nاضغط مرة ثانية للإلغاء', flags: MessageFlags.Ephemeral });
}

async function handleSupervisor(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active') {
    return interaction.reply({ content: '⚠️ هذا السيناريو غير نشط', flags: MessageFlags.Ephemeral });
  }
  // Ensure we have a full GuildMember with role information
  let member = interaction.member;
  if (!member || !member.roles?.cache) {
    member = await interaction.guild.members.fetch(interaction.user.id);
  }
  const config = loadConfig();
  if (!isInAnyCommittee(member, config) && !isScenarioAdmin(member, scenario, config)) {
    return interaction.reply({ content: '❌ يجب أن تكون في لجنة أو أن تكون مسؤولاً لتستلم المشرف', flags: MessageFlags.Ephemeral });
  }
  if (scenario.supervisorId) {
    if (scenario.supervisorId === interaction.user.id) {
      // إلغاء استلام المشرف
      scenario.supervisorId = null;
      await scenario.save();
      await updateScenarioEmbed(scenario, interaction.guild);
      await scnLog(interaction.guild, { scenarioName: scenario.title, mod: interaction.user.id, event: 'إلغاء مشرف', details: 'ألغى استلام المشرف' });
      return interaction.reply({ content: '❌ تم إلغاء استلام المشرف', flags: MessageFlags.Ephemeral });
    } else {
      return interaction.reply({ content: `👑 المشرف موجود مسبقاً: <@${scenario.supervisorId}>`, flags: MessageFlags.Ephemeral });
    }
  }

  // لا يمكن استلام مشرف إذا كنت نائب مسؤول
  if (scenario.deputySupervisorId === interaction.user.id) {
    return interaction.reply({ content: '❌ لا يمكنك استلام مشرف وأنت نائب مسؤول. إلغاء نائب مسؤول أولاً.', flags: MessageFlags.Ephemeral });
  }

  scenario.supervisorId = interaction.user.id;
  await scenario.save();
  await updateScenarioEmbed(scenario, interaction.guild);
  await scnLog(interaction.guild, { scenarioName: scenario.title, mod: interaction.user.id, event: 'استلام مشرف', details: 'تعيّن كمشرف عام للسيناريو' });
  await interaction.reply({ content: `✅ تم تعيينك مشرفاً للسيناريو: ${scenario.title}`, flags: MessageFlags.Ephemeral });
}


async function handleDeputy(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active') {
    return interaction.reply({ content: '⚠️ هذا السيناريو غير نشط', flags: MessageFlags.Ephemeral });
  }
  let member = interaction.member;
  if (!member || !member.roles?.cache) {
    member = await interaction.guild.members.fetch(interaction.user.id);
  }
  const config = loadConfig();
  if (!isInAnyCommittee(member, config) && !isScenarioAdmin(member, scenario, config)) {
    return interaction.reply({ content: '❌ يجب أن تكون في لجنة أو أن تكون مسؤولاً لتستلم نائب مسؤول', flags: MessageFlags.Ephemeral });
  }
  if (scenario.deputySupervisorId) {
    if (scenario.deputySupervisorId === interaction.user.id) {
      // إلغاء استلام نائب مسؤول
      scenario.deputySupervisorId = null;
      await scenario.save();
      await updateScenarioEmbed(scenario, interaction.guild);
      await scnLog(interaction.guild, { scenarioName: scenario.title, mod: interaction.user.id, event: 'إلغاء نائب مسؤول', details: 'ألغى استلام نائب المسؤول' });
      return interaction.reply({ content: '❌ تم إلغاء استلام نائب مسؤول', flags: MessageFlags.Ephemeral });
    } else {
      return interaction.reply({ content: `👤 النائب موجود مسبقاً: <@${scenario.deputySupervisorId}>`, flags: MessageFlags.Ephemeral });
    }
  }
  // لا يمكن استلام نائب مسؤول إذا كنت المشرف
  if (scenario.supervisorId === interaction.user.id) {
    return interaction.reply({ content: '❌ لا يمكنك استلام نائب مسؤول وأنت مشرف. إلغاء المشرف أولاً.', flags: MessageFlags.Ephemeral });
  }
  scenario.deputySupervisorId = interaction.user.id;
  await scenario.save();
  await updateScenarioEmbed(scenario, interaction.guild);
  await scnLog(interaction.guild, { scenarioName: scenario.title, mod: interaction.user.id, event: 'استلام نائب مسؤول', details: 'تعيّن كنائب مسؤول للسيناريو' });
  await interaction.reply({ content: `✅ تم تعيينك نائب مسؤول للسيناريو: ${scenario.title}`, flags: MessageFlags.Ephemeral });
}

async function handleExcuse(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active') {
    return interaction.reply({ content: '⚠️ هذا السيناريو غير نشط', flags: MessageFlags.Ephemeral });
  }
  const att = await ScenarioAttendance.findOne({ scenarioId, userId: interaction.user.id });

  // حالات خاصة — رد سريع
  if (att?.excuseStatus === 'approved') {
    att.excuseStatus = null;
    att.excuseReason = null;
    att.excuseTicketChannelId = null;
    att.status = 'registered';
    await att.save();
    return interaction.reply({ content: '✅ تم إلغاء العذر', flags: MessageFlags.Ephemeral });
  }
  if (att?.excuseStatus === 'pending') {
    return interaction.reply({ content: `📝 عذرك قيد المراجعة في التذكرة: <#${att.excuseTicketChannelId}>`, flags: MessageFlags.Ephemeral });
  }
  if (att?.excuseStatus === 'rejected') {
    return interaction.reply({ content: '❌ تم رفض عذرك مسبقاً، تواصل مع الإدارة', flags: MessageFlags.Ephemeral });
  }

  // ===== عرض Modal لجمع سبب العذر أولاً =====
  const modal = new ModalBuilder()
    .setCustomId(`scn_exc_reason_${scenarioId}`)
    .setTitle('📝 تقديم عذر للسيناريو');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('excuse_reason')
        .setLabel('اكتب سبب عذرك بوضوح')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(5)
        .setPlaceholder('مثال: عندي امتحان / سفر طارئ / ظروف صحية...')
    )
  );
  await interaction.showModal(modal);
}

async function handleExcuseReasonModal(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const scenarioId = interaction.customId.replace('scn_exc_reason_', '');
  const excuseReason = interaction.fields.getTextInputValue('excuse_reason');

  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active') {
    return interaction.editReply({ content: '⚠️ هذا السيناريو لم يعد نشطاً' });
  }

  let att = await ScenarioAttendance.findOne({ scenarioId, userId: interaction.user.id });
  if (!att) {
    att = await ScenarioAttendance.create({ scenarioId, userId: interaction.user.id, status: 'registered', registeredAt: new Date() });
  }

  try {
    const { createTicket } = await import('./ticketManager.js');
    const result = await createTicket(interaction.guild, interaction.user.id, 'scenario_excuse');

    att.excuseStatus = 'pending';
    att.excuseTicketChannelId = result.channelId;
    att.excuseReason = excuseReason; // حفظ السبب مباشرة
    await att.save();

    if (result.channel) {
      const excuseEmbed = embedInfo('📝 طلب عذر لسيناريو',
        `**العضو:** <@${interaction.user.id}>\n**السيناريو:** ${scenario.title}\n\n**📋 سبب العذر:**\n> ${excuseReason}`);

      const excuseRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`scn_acc_excuse_${scenario._id}_${interaction.user.id}`)
          .setLabel('✅ قبول العذر')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`scn_rej_excuse_${scenario._id}_${interaction.user.id}`)
          .setLabel('❌ رفض العذر')
          .setStyle(ButtonStyle.Danger)
      );

      await result.channel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [excuseEmbed],
        components: [excuseRow]
      }).catch(() => {});
    }

    await updateScenarioEmbed(scenario, interaction.guild);
    await scnLog(interaction.guild, {
      scenarioName: scenario.title,
      target: interaction.user.id,
      event: 'تقديم عذر',
      details: `السبب: ${excuseReason.slice(0, 200)} | التذكرة: <#${result.channelId}>`,
    });
    await interaction.editReply({ content: `✅ تم تقديم عذرك بنجاح!\n📋 **السبب المسجّل:** ${excuseReason}\n📌 **تذكرة المراجعة:** <#${result.channelId}>` });
  } catch (e) {
    if (e.message?.includes('لديك تذكرة') || e.message?.includes('open')) {
      return interaction.editReply({ content: '⚠️ لديك تذكرة مفتوحة حالياً، أنهِها أولاً ثم حاول مجدداً' });
    }
    return interaction.editReply({ content: `❌ فشل فتح التذكرة: ${e.message}` });
  }
}

async function handleAcceptExcuse(interaction) {
  const parts = interaction.customId.split('_');
  const scenarioId = parts[3], userId = parts[4];
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario) return;
  const att = await ScenarioAttendance.findOne({ scenarioId, userId });
  if (!att) return;
  att.excuseStatus = 'approved';
  att.status = 'excused';
  await att.save();
  if (att.excuseTicketChannelId) {
    const ch = interaction.guild.channels.cache.get(att.excuseTicketChannelId);
    if (ch) {
      await ch.send({ content: '✅ تم قبول العذر. سيتم حذف هذا الروم خلال 5 ثوانٍ...' }).catch(() => {});
      setTimeout(async () => {
        await ch.delete().catch(() => {});
      }, 5000);
    }
  }
  await updateScenarioEmbed(scenario, interaction.guild);
  await scnLog(interaction.guild, {
    scenarioName: scenario.title,
    mod: interaction.user.id,
    target: userId,
    event: 'قبول عذر',
    details: att.excuseReason ? `السبب: ${att.excuseReason.slice(0, 200)}` : 'تم قبول العذر',
  });
  await interaction.reply({ content: `✅ تم قبول عذر <@${userId}>`, flags: MessageFlags.Ephemeral });
}

async function handleRejectExcuse(interaction) {
  const parts = interaction.customId.split('_');
  const scenarioId = parts[3], userId = parts[4];
  const modal = new ModalBuilder().setCustomId(`scn_rej_r_${scenarioId}_${userId}`).setTitle('❌ رفض العذر');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('سبب الرفض').setStyle(TextInputStyle.Paragraph).setRequired(true)
    )
  );
  await interaction.showModal(modal);
}

async function handleRejectReasonModal(interaction) {
  const parts = interaction.customId.split('_');
  const scenarioId = parts[3], userId = parts[4];
  const reason = interaction.fields.getTextInputValue('reason');
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario) return;
  const att = await ScenarioAttendance.findOne({ scenarioId, userId });
  if (att) {
    att.excuseStatus = 'rejected';
    att.status = 'registered';
    await att.save();
  }
  try {
    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (user) {
      await dmUser(user, embedError('❌ تم رفض عذرك',
        `رفض عذرك للسيناريو **${scenario.title}**\nالسبب: ${reason}`));
    }
  } catch {}
  if (att?.excuseTicketChannelId) {
    const ch = interaction.guild.channels.cache.get(att.excuseTicketChannelId);
    if (ch) await ch.delete().catch(() => {});
  }
  await updateScenarioEmbed(scenario, interaction.guild);
  await scnLog(interaction.guild, {
    scenarioName: scenario.title,
    mod: interaction.user.id,
    target: userId,
    event: 'رفض عذر',
    details: `سبب الرفض: ${reason.slice(0, 300)}`,
  });
  await interaction.reply({ content: `❌ تم رفض عذر <@${userId}>\nالسبب: ${reason}`, flags: MessageFlags.Ephemeral });
}

async function handleReminder(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario) return;
  if (!isScenarioAdmin(interaction.member, scenario, loadConfig())) {
    return interaction.reply({ content: '❌ لا تملك الصلاحية لإرسال التذكير', flags: MessageFlags.Ephemeral });
  }
  await sendReminder(scenario);
  await scnLog(interaction.guild, {
    scenarioName: scenario.title,
    mod: interaction.user.id,
    event: 'تذكير يدوي',
    details: 'أرسل المشرف تذكيراً للأعضاء غير المسجلين',
  });
  await interaction.reply({ content: '✅ تم إرسال التذكير', flags: MessageFlags.Ephemeral });
}

async function handleEditSelect(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario) return;
  if (!isScenarioAdmin(interaction.member, scenario, loadConfig())) {
    return interaction.reply({ content: '❌ لا تملك الصلاحية للتعديل', flags: MessageFlags.Ephemeral });
  }
  if (scenario.status === 'completed') {
    const config = loadConfig();
    const mins = config.scenarios?.editWindowMinutes || 60;
    const elapsed = Date.now() - (scenario.endTime?.getTime?.() || Date.now());
    if (elapsed > mins * 60000) {
      return interaction.reply({ content: '⛔ انتهت صلاحية السيناريو، لا يمكنك تعديله', flags: MessageFlags.Ephemeral });
    }
  }
  if (scenario.status === 'active') {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`scn_ed_s_${scenarioId}`)
        .setPlaceholder('اختر نوع التعديل')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('✏️ تعديل البيانات').setDescription('تعديل العنوان والوصف والوقت').setValue('data'),
          new StringSelectMenuOptionBuilder().setLabel('✅ تسجيل حضور يدوي').setDescription('تسجيل عضو كحاضر').setValue('attend'),
          new StringSelectMenuOptionBuilder().setLabel('❌ تسجيل غياب يدوي').setDescription('تسجيل عضو كغائب').setValue('absent')
        )
    );
    await interaction.reply({ content: '✏️ اختر نوع التعديل:', components: [row], flags: MessageFlags.Ephemeral });
  } else {
    const attendances = await ScenarioAttendance.find({ scenarioId });
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`scn_ed_s_${scenarioId}`)
        .setPlaceholder('اختر نوع التعديل')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('✏️ تعديل البيانات').setDescription('تعديل العنوان والوصف والوقت').setValue('data'),
          new StringSelectMenuOptionBuilder().setLabel('✅ تسجيل حضور يدوي').setDescription('تسجيل عضو كحاضر').setValue('attend'),
          new StringSelectMenuOptionBuilder().setLabel('❌ تسجيل غياب يدوي').setDescription('تسجيل عضو كغائب').setValue('absent')
        )
    );
    await interaction.reply({ content: '✏️ اختر نوع التعديل:', components: [row], flags: MessageFlags.Ephemeral });
  }
}

async function handleEditMenuSelect(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const value = interaction.values[0];
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario) return;
  if (value === 'data') {
    const modal = new ModalBuilder().setCustomId(`scn_ed_d_${scenarioId}`).setTitle('✏️ تعديل بيانات السيناريو');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('📌 العنوان').setStyle(TextInputStyle.Short).setValue(scenario.title || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('📝 الوصف').setStyle(TextInputStyle.Paragraph).setValue(scenario.description || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('date').setLabel('📅 التاريخ (2026/3/2)').setStyle(TextInputStyle.Short).setValue(formatIraqDate(scenario.startTime) || '')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('time').setLabel('🕐 الوقت (3pm)').setStyle(TextInputStyle.Short).setValue('')),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('⏳ المدة (ساعات)').setStyle(TextInputStyle.Short).setValue(String((scenario.endTime - scenario.startTime) / 3600000)))
    );
    return interaction.showModal(modal);
  }
  const attendances = await ScenarioAttendance.find({ scenarioId });
  let filtered;
  // Show all attendances regardless of status for editing
  filtered = attendances;
  if (filtered.length === 0) {
    return interaction.reply({ content: '⚠️ لا يوجد أعضاء مناسبين لهذا الخيار', flags: MessageFlags.Ephemeral });
  }
  
  const userIds = filtered.slice(0, 24).map(a => a.userId);
  let membersMap = new Map();
  try {
    membersMap = await interaction.guild.members.fetch({ user: userIds });
  } catch (e) {
    console.error('[Scenario] Failed to fetch members for manual attendance names:', e.message);
  }

  const optionsCount = Math.min(24, filtered.length);
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(value === 'attend' ? `scn_man_a_${scenarioId}` : `scn_man_g_${scenarioId}`)
      .setPlaceholder(value === 'attend' ? 'اختر الأعضاء لتسجيل حضورهم' : 'اختر الأعضاء لتسجيل غيابهم')
      .setMinValues(1)
      .setMaxValues(optionsCount)
      .addOptions(filtered.slice(0, 24).map(a => {
        const m = membersMap.get(a.userId);
        const displayName = m ? m.displayName : `مستخدم (${a.userId})`;
        return new StringSelectMenuOptionBuilder()
          .setLabel(displayName)
          .setValue(a.userId);
      }))
  );
  await interaction.update({ content: value === 'attend' ? 'اختر الأعضاء لتسجيل الحضور:' : 'اختر الأعضاء لتسجيل الغياب:', components: [row] });
}

async function handleEditDataModal(interaction) {
  // Defer immediately to avoid 3-second Discord timeout
  await interaction.deferReply({ ephemeral: true });

  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario) return interaction.editReply({ content: '⚠️ السيناريو غير موجود' });
  const title = interaction.fields.getTextInputValue('title');
  const description = interaction.fields.getTextInputValue('description');
  const dateStr = interaction.fields.getTextInputValue('date');
  const timeStr = interaction.fields.getTextInputValue('time');
  const durationStr = interaction.fields.getTextInputValue('duration');
  const duration = parseFloat(durationStr);
  if (dateStr && timeStr) {
    const st = parseIraqTime(dateStr, timeStr);
    if (st && !isNaN(st.getTime()) && st.getTime() > Date.now()) {
      scenario.startTime = st;
      scenario.endTime = new Date(st.getTime() + (duration * 3600000));
      if (scenario.status === 'active') {
        await scheduleEnd(scenario);
      }
    }
  }
  scenario.title = title;
  scenario.description = description;
  await scenario.save();
  await updateScenarioEmbed(scenario, interaction.guild);
  await scnLog(interaction.guild, {
    scenarioName: title,
    mod: interaction.user.id,
    event: 'تعديل',
    details: 'تم تحديث عنوان/وصف/وقت السيناريو',
  });
  await interaction.editReply({ content: '✅ تم تعديل البيانات بنجاح' });
}

async function handleManualAttend(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const userIds = interaction.values;
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario) return;

  const config = loadConfig();
  const pts = config.scenarios?.points || { attendance: 10, supervisor: 20, creator: 25, deputySupervisor: 15 };

  for (const userId of userIds) {
    const att = await ScenarioAttendance.findOne({ scenarioId, userId });
    if (att) {
      if (att.status !== 'attended') {
        att.status = 'attended';
        if (scenario.status === 'completed') {
          if (!att.pointsAwarded || att.pointsAwarded === 0) {
            const member = await Member.findOne({ discordId: userId });
            if (member) {
              member.points = (member.points || 0) + pts.attendance;
              await member.save();
              att.pointsAwarded = pts.attendance;
              
              // تسجيل لوغ النقاط عند الحضور اليدوي بعد اكتمال السيناريو
              await PointLog.create({
                discordId: userId,
                memberRef: member._id,
                points: pts.attendance,
                reason: `تسجيل حضور يدوي في السيناريو: ${scenario.title}`,
                actionBy: interaction.user.id
              });
            }
          }
        }
        await att.save();
      }
    }
  }
  await updateScenarioEmbed(scenario, interaction.guild);
  const userMentions = userIds.map(uid => `<@${uid}>`).join(', ');
  await scnLog(interaction.guild, {
    scenarioName: scenario.title,
    mod: interaction.user.id,
    event: 'حضور يدوي',
    details: `الأعضاء: ${userMentions}`,
  });
  await interaction.reply({ content: `✅ تم تسجيل حضور الأعضاء: ${userMentions} يدوياً`, flags: MessageFlags.Ephemeral });
}

async function handleManualAbsent(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const userIds = interaction.values;
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario) return;
  for (const userId of userIds) {
    const att = await ScenarioAttendance.findOne({ scenarioId, userId });
    if (att) {
      if (att.status !== 'absent') {
        if (att.pointsAwarded > 0) {
          const member = await Member.findOne({ discordId: userId });
          if (member) {
            member.points = Math.max(0, (member.points || 0) - att.pointsAwarded);
            await member.save();

            // تسجيل لوغ النقاط عند الغياب اليدوي بعد اكتمال السيناريو
            await PointLog.create({
              discordId: userId,
              memberRef: member._id,
              points: -att.pointsAwarded,
              reason: `خصم حضور (غياب يدوي) في السيناريو: ${scenario.title}`,
              actionBy: interaction.user.id
            });
          }
        }
        att.status = 'absent';
        att.pointsAwarded = 0;
        await att.save();
      }
    }
  }
  await updateScenarioEmbed(scenario, interaction.guild);
  const userMentions = userIds.map(uid => `<@${uid}>`).join(', ');
  await scnLog(interaction.guild, {
    scenarioName: scenario.title,
    mod: interaction.user.id,
    event: 'غياب يدوي',
    details: `الأعضاء: ${userMentions}`,
  });
  await interaction.reply({ content: `❌ تم تسجيل غياب الأعضاء: ${userMentions}`, flags: MessageFlags.Ephemeral });
}

async function handleVote(interaction) {
  const parts = interaction.customId.split('_');
  const scenarioId = parts[2];
  const optIndex = parseInt(parts[3], 10);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active' || !scenario.votingOptions?.length) return;
  const votedOption = scenario.votingOptions[optIndex];
  if (!votedOption) {
    return interaction.reply({ content: '⚠️ خيار التصويت غير صالح', flags: MessageFlags.Ephemeral });
  }
  const existing = await ScenarioAttendance.findOne({ scenarioId, userId: interaction.user.id, status: 'voted' });
  if (existing) {
    if (existing.votedOption === votedOption) {
      await ScenarioAttendance.deleteOne({ _id: existing._id });
      await updateVoteEmbed(scenario, interaction.guild);
      return interaction.reply({ content: `❌ تم إلغاء صوتك للوقت: ${votedOption}`, flags: MessageFlags.Ephemeral });
    }
    existing.votedOption = votedOption;
    await existing.save();
    await updateVoteEmbed(scenario, interaction.guild);
    return interaction.reply({ content: `✅ تم تغيير صوتك إلى: ${votedOption}`, flags: MessageFlags.Ephemeral });
  }
  await ScenarioAttendance.create({ scenarioId, userId: interaction.user.id, status: 'voted', votedOption, registeredAt: new Date() });
  await updateVoteEmbed(scenario, interaction.guild);
  await interaction.reply({ content: `✅ تم تسجيل صوتك للوقت: ${votedOption}`, flags: MessageFlags.Ephemeral });
}

async function handleUnvote(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active') return;
  const existing = await ScenarioAttendance.findOne({ scenarioId, userId: interaction.user.id, status: 'voted' });
  if (!existing) {
    return interaction.reply({ content: '⚠️ لم تصوّت بعد', flags: MessageFlags.Ephemeral });
  }
  const prev = existing.votedOption;
  await ScenarioAttendance.deleteOne({ _id: existing._id });
  await updateVoteEmbed(scenario, interaction.guild);
  await interaction.reply({ content: `❌ تم إلغاء صوتك للوقت: ${prev}`, flags: MessageFlags.Ephemeral });
}

async function updateVoteEmbed(scenario, guild) {
  try {
    const config = loadConfig();
    const channel = guild.channels.cache.get(scenario.channelId) || guild.channels.cache.get(config.scenarios?.announcementChannelId);
    if (!channel) return;
    const msg = await channel.messages.fetch(scenario.messageId).catch(() => null);
    if (!msg) return;

    const attendances = await ScenarioAttendance.find({ scenarioId: scenario._id });
    const votes = tallyVotes(attendances);
    const totalVotes = Object.values(votes).reduce((s, v) => s + v, 0);
    const optionsLines = buildVoteOptionLines(votes, scenario.votingOptions);
    const memberCount = await Member.countDocuments({ isActive: true });
    const endsAt = scenario._voteEndsAt?.getTime?.() || Date.now();
    const remainingMs = Math.max(0, endsAt - Date.now());
    const voteDesc = `▬▬▬ ﷽ ▬▬▬
🏛️ **دعوة للمشاركة في اختيار وقت العملية الميدانية**

> *"التشاور وتبادل الآراء هما ركيزة نجاح العمل القيادي."*

**📝 تفاصيل العملية:**
${scenario.description}

**⏳ المدة**: \`${scenario._durationHours || '?'}\` ساعة

━━━━━━━━━━━━━━
🗳️ **نتائج التصويت:**
${optionsLines.join('\n')}
━━━━━━━━━━━━━━
⏰ **التصويت ينتهي بعد**: ${formatDuration(remainingMs)}
📌 **المجموع**: ${totalVotes} ${totalVotes === 1 ? 'صوت' : 'أصوات'} من ${memberCount} عضو
━━━━━━━━━━━━━━
📌 *يمكنك تغيير صوتك بالضغط على خيار آخر أو إلغاء صوتك*`;
    const embed = embedGold(`🗳️ تصويت على وقت السيناريو: ${scenario.title}`, voteDesc.trim()).setThumbnail(guild.iconURL() || null);
    const rows = buildVoteButtons(scenario);
    await msg.edit({ embeds: [embed], components: rows }).catch(() => {});
  } catch (e) { console.error('[Scenario] updateVoteEmbed:', e.message); }
}

async function handleEndVote(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active') return;
  if (!isScenarioAdmin(interaction.member, scenario, loadConfig())) {
    return interaction.reply({ content: '❌ لا تملك الصلاحية', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ ephemeral: true });
  const attendances = await ScenarioAttendance.find({ scenarioId });
  const votes = tallyVotes(attendances);
  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const winner = sorted.length > 0 ? sorted[0][0] : (scenario.votingOptions?.[0] || '');
  const winnerVotes = sorted.length > 0 ? sorted[0][1] : 0;
  const totalVotes = Object.values(votes).reduce((s, v) => s + v, 0);
  await finalizeVoteEnd(scenario, interaction.guild, {
    winner, winnerVotes, totalVotes, actorId: interaction.user.id
  });
  await interaction.editReply({ content: `✅ تم إنهاء التصويت، الوقت الفائز: **${winner}** (${winnerVotes} صوت)` });
}

async function handleCancel(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active') {
    return interaction.reply({ content: '⚠️ هذا السيناريو غير نشط', flags: MessageFlags.Ephemeral });
  }
  if (!isScenarioAdmin(interaction.member, scenario, loadConfig())) {
    return interaction.reply({ content: '❌ لا تملك الصلاحية لإلغاء السيناريو', flags: MessageFlags.Ephemeral });
  }
  // Defer before heavy operations
  await interaction.deferReply({ ephemeral: true });
  scenario.status = 'cancelled';
  await scenario.save();
  if (scenarioTimers.has(scenario._id)) { clearTimeout(scenarioTimers.get(scenario._id)); scenarioTimers.delete(scenario._id); }
  if (voteTimers.has(scenario._id)) { clearTimeout(voteTimers.get(scenario._id)); voteTimers.delete(scenario._id); }
  await updateScenarioEmbed(scenario, interaction.guild);
  const attendances = await ScenarioAttendance.find({ scenarioId });
  for (const a of attendances) {
    if (a.excuseTicketChannelId) {
      const ch = interaction.guild.channels.cache.get(a.excuseTicketChannelId);
      if (ch) await ch.delete().catch(() => {});
    }
  }
  await scnLog(interaction.guild, {
    scenarioName: scenario.title,
    mod: interaction.user.id,
    event: isVotingPhase(scenario) ? 'إلغاء (أثناء تصويت)' : 'إلغاء',
    details: 'تم إلغاء السيناريو',
  });
  await interaction.editReply({ content: '❌ تم إلغاء السيناريو' });
}

async function handleEnd(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const scenario = await Scenario.findById(scenarioId);
  if (!scenario || scenario.status !== 'active') {
    return interaction.reply({ content: '⚠️ هذا السيناريو غير نشط أو منتهي', flags: MessageFlags.Ephemeral });
  }
  if (!isScenarioAdmin(interaction.member, scenario, loadConfig())) {
    return interaction.reply({ content: '❌ لا تملك الصلاحية لإنهاء السيناريو', flags: MessageFlags.Ephemeral });
  }
  // Defer before the very heavy endScenario operation
  await interaction.deferReply({ ephemeral: true });
  await endScenario(scenario, interaction.user.id);
  await interaction.editReply({ content: '🏁 تم إنهاء السيناريو' });
}

async function handleRating(interaction) {
  const parts = interaction.customId.split('_');
  const scenarioId = parts[2];
  const rating = parseInt(parts[3]);
  const att = await ScenarioAttendance.findOne({ scenarioId, userId: interaction.user.id });
  if (!att) {
    return interaction.reply({ content: '⚠️ يجب أن تكون مسجلاً في هذا السيناريو لتقييمه', flags: MessageFlags.Ephemeral });
  }
  if (att.rating) {
    return interaction.reply({ content: `⭐ قيمت هذا السيناريو من قبل (${'⭐'.repeat(att.rating)})`, flags: MessageFlags.Ephemeral });
  }
  att.rating = rating;
  await att.save();
  const scenario = await Scenario.findById(scenarioId);
  if (scenario) {
    const ratings = (await ScenarioAttendance.find({ scenarioId })).filter(a => a.rating);
    scenario.averageRating = ratings.reduce((s, a) => s + a.rating, 0) / ratings.length;
    await scenario.save();
    await scnLog(interaction.guild, {
      scenarioName: scenario.title,
      target: interaction.user.id,
      event: 'تقييم',
      details: `⭐ ${rating}/5 | المتوسط: ${scenario.averageRating.toFixed(1)}`,
    });
  }
  await interaction.reply({ content: `✅ شكراً على تقييمك! (${'⭐'.repeat(rating)})`, flags: MessageFlags.Ephemeral });
}

async function handleDetails(interaction) {
  const scenarioId = customIdToId(interaction.customId);
  const attendances = await ScenarioAttendance.find({ scenarioId, status: 'excused' });
  if (attendances.length === 0) {
    return interaction.reply({ content: '📝 لا يوجد معذورين في هذا السيناريو', flags: MessageFlags.Ephemeral });
  }
  const lines = attendances.map(a => `<@${a.userId}> — ${a.excuseReason || 'بدون سبب'}`);
  await interaction.reply({ embeds: [embedInfo('📋 تفاصيل المعذورين', lines.join('\n'))], flags: MessageFlags.Ephemeral });
}

async function handleListActive(interaction) {
  const scenarios = await Scenario.find({ status: 'active' });
  if (scenarios.length === 0) {
    return interaction.reply({ content: '📋 لا يوجد سيناريوهات فعالة حالياً', flags: MessageFlags.Ephemeral });
  }
  const lines = scenarios.map((s, i) => `${i + 1}. **${s.title}** — 🕐 ${formatIraqTime(s.startTime)} — [الذهاب للإعلان](https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId})`);
  await interaction.reply({ embeds: [embedInfo('📋 السيناريوهات الفعالة', lines.join('\n'))], flags: MessageFlags.Ephemeral });
}

async function handleStats(interaction) {
  const all = await Scenario.find({});
  const total = all.length;
  const completed = all.filter(s => s.status === 'completed').length;
  const cancelled = all.filter(s => s.status === 'cancelled').length;
  const active = all.filter(s => s.status === 'active').length;
  const attendances = await ScenarioAttendance.find({});
  const totalPoints = attendances.reduce((s, a) => s + (a.pointsAwarded || 0), 0);
  const attendanceCount = attendances.filter(a => a.status === 'attended').length;
  const totalReg = attendances.length || 1;
  const rate = Math.round((attendanceCount / totalReg) * 100);
  const userCounts = {};
  for (const a of attendances.filter(a => a.status === 'attended')) {
    userCounts[a.userId] = (userCounts[a.userId] || 0) + 1;
  }
  const top3 = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const avgRating = attendances.filter(a => a.rating).length > 0
    ? (attendances.filter(a => a.rating).reduce((s, a) => s + a.rating, 0) / attendances.filter(a => a.rating).length).toFixed(1)
    : 'لا يوجد';
  const statsDesc =
    `📈 إجمالي السيناريوهات: **${total}**\n` +
    `✅ منتهي: **${completed}**\n` +
    `❌ ملغي: **${cancelled}**\n` +
    `🟢 نشط: **${active}**\n\n` +
    `🔹 إجمالي النقاط الموزعة: **${totalPoints}**\n` +
    `📊 نسبة الحضور: **${rate}%**\n` +
    `⭐ متوسط التقييم: **${avgRating}**\n\n` +
    `🏆 أكثر الأعضاء حضوراً:\n` +
    (top3.length > 0 ? top3.map(([id, count], i) => `  ${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} <@${id}> — ${count} سيناريو`).join('\n') : '  لا يوجد');
  await interaction.reply({ embeds: [embedInfo('📊 إحصائيات السيناريوهات', statsDesc)], flags: MessageFlags.Ephemeral });
}

function customIdToId(customId) {
  const parts = customId.split('_');
  return parts[parts.length - 1];
}

export async function handleScenarioExcuseMessage(message) {
  try {
    const att = await ScenarioAttendance.findOne({ excuseTicketChannelId: message.channel.id, userId: message.author.id });
    if (att) {
      att.excuseReason = message.content;
      await att.save();
      await message.react('📝').catch(() => {});
    }
  } catch (e) {
    console.error('[Scenario] handleScenarioExcuseMessage error:', e);
  }
}
