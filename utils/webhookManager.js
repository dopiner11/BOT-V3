import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import PersistentMessage from '../models/PersistentMessage.js';
import { buildLeaderboardEmbed, buildButtonRows } from './interactiveLeaderboard.js';
import { custom as embedCustom } from './embedStyles.js';

let _reportsCommand = null;
let _attendanceHandler = null;
let _competitionSystem = null;
async function getReportsCmd() {
  if (!_reportsCommand) _reportsCommand = await import('../commands/reports.js');
  return _reportsCommand;
}
async function getAttendanceHandler() {
  if (!_attendanceHandler) _attendanceHandler = await import('./attendanceHandler.js');
  return _attendanceHandler;
}
async function getCompetitionSystem() {
  if (!_competitionSystem) _competitionSystem = await import('./competitionSystem.js');
  return _competitionSystem;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let configPath = join(__dirname, '../config.json');
const committeeDataPath = join(__dirname, '../.data/Committees.json');
function loadConfig() {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const committeeList = (() => {
      try { if (existsSync(committeeDataPath)) return JSON.parse(readFileSync(committeeDataPath, 'utf8')); } catch {}
      return null;
    })();
    if (committeeList && Object.keys(committeeList).length > 0) {
      config.committees = config.committees || {};
      config.committees.list = committeeList;
    }
    return config;
  } catch { return {}; }
}

/* ===================================================================
   إيمبد تقرير التفاعل + التوب
   =================================================================== */


async function buildTopEmbed(guild) {
  const { embed } = await buildLeaderboardEmbed(guild, 'points', 1);
  return embed;
}

/* ===================================================================
   ويبهوك اللجان — كل لجنة في قناتها
   =================================================================== */

function buildCommitteePayload(committeeKey, committeeConfig) {
  const managers = (committeeConfig.roles?.manager || []).map(id => `<@${id}>`);
  const deputies = (committeeConfig.roles?.deputy || []).map(id => `<@${id}>`);
  const members = (committeeConfig.roles?.member || []).map(id => `<@${id}>`);

  const embed = embedCustom(0xFF9900, `🏛️ ${committeeConfig.name}`)
    .setFooter({ text: 'يتم تحديث هذه اللوحة تلقائياً كل 10 دقائق' });

  let desc = '';
  if (managers.length > 0) desc += `**👑 المسؤول**\n${managers.join(' ')}\n\n`;
  if (deputies.length > 0) desc += `**🌟 النائب**\n${deputies.join(' ')}\n\n`;
  if (members.length > 0) desc += `**👥 الأعضاء**\n${members.join(' ')}\n\n`;
  if (!desc) desc = 'لا يوجد أعضاء في هذه اللجنة';

  embed.setDescription(desc);
  return embed;
}

export async function updateSingleCommittee(client, committeeKey, committeeConfig) {
  const channelId = committeeConfig.channelId;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const embed = buildCommitteePayload(committeeKey, committeeConfig);
    const key = `webhook_committee_${committeeKey}`;

    const allMentions = [
      ...(committeeConfig.roles?.manager || []),
      ...(committeeConfig.roles?.deputy || []),
      ...(committeeConfig.roles?.member || [])
    ].map(id => `<@${id}>`).join(' ');

    let pMsg = await PersistentMessage.findOne({ key });
    let message = pMsg ? await channel.messages.fetch(pMsg.messageId).catch(() => null) : null;

    if (message) {
      await message.edit({ embeds: [embed] }).catch(() => { message = null; });
    }

    if (!message) {
      message = await channel.send({
        content: allMentions || undefined,
        embeds: [embed]
      });
      await PersistentMessage.findOneAndUpdate(
        { key },
        { key, messageId: message.id, updatedAt: new Date() },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error(`❌ Webhook [committee/${committeeKey}] error:`, err.message);
  }
}

async function updateAllCommittees(client) {
  const config = loadConfig();
  const list = config.committees?.list || {};

  for (const [key, committee] of Object.entries(list)) {
    if (!committee.channelId) continue;
    await updateSingleCommittee(client, key, committee);
    await new Promise(r => setTimeout(r, 1500));
  }
}

/* ===================================================================
   إرسال/تحديث رسالة لقناة واحدة (تقرير + توب)
   =================================================================== */

const WEBHOOK_TYPES = ['report', 'top'];

async function updateWebhook(client, type) {
  if (type === 'report') {
    const { updateReportsDashboard } = await getReportsCmd();
    await updateReportsDashboard(client, false);
    return;
  }

  const config = loadConfig();
  const whConfig = config.general?.webhooks?.[type];
  const channelId = typeof whConfig?.channelId === 'object' ? whConfig.channelId?.id : whConfig?.channelId;
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const guild = channel.guild;
    let embed;
    if (type === 'top') embed = await buildTopEmbed(guild);
    else return;

    let pMsg = await PersistentMessage.findOne({ key: `webhook_${type}` });
    let message = pMsg ? await channel.messages.fetch(pMsg.messageId).catch(() => null) : null;
    const components = buildButtonRows('points');

    if (message) {
      await message.edit({ embeds: [embed], components }).catch(() => { message = null; });
    }

    if (!message) {
      message = await channel.send({ embeds: [embed], components });
      await PersistentMessage.findOneAndUpdate(
        { key: `webhook_${type}` },
        { key: `webhook_${type}`, guildId: guild.id, channelId: channel.id, messageId: message.id, updatedAt: new Date() },
        { upsert: true }
      );
    }
  } catch (err) {
    console.error(`❌ Webhook [${type}] error:`, err.message);
  }
}

/* ===================================================================
   التشغيل — بدون حذف، فقط edit أو send
   =================================================================== */

let webhookInterval;

export async function startWebhookSystem(client) {
  if (webhookInterval) clearInterval(webhookInterval);

  setTimeout(async () => {
    console.log('🔄 Starting webhook system...');

    for (const type of WEBHOOK_TYPES) {
      await updateWebhook(client, type);
      await new Promise(r => setTimeout(r, 1500));
    }

    await updateAllCommittees(client);

    const { updateAttendanceDashboard } = await getAttendanceHandler();
    await updateAttendanceDashboard(client, false).catch(e => console.error('[Webhook]', e?.message));

    const { updateAllCompetitionEmbeds } = await getCompetitionSystem();
    await updateAllCompetitionEmbeds(client).catch(e => console.error('[Webhook] competition:', e?.message));

    console.log('✅ Webhook system started.');
  }, 8000);

  webhookInterval = setInterval(async () => {
    try {
      for (const type of WEBHOOK_TYPES) {
        await updateWebhook(client, type);
        await new Promise(r => setTimeout(r, 1500));
      }

      await updateAllCommittees(client);

      const { updateAttendanceDashboard } = await getAttendanceHandler();
      await updateAttendanceDashboard(client, false).catch(e => console.error('[Webhook]', e?.message));

      const { updateAllCompetitionEmbeds } = await getCompetitionSystem();
      await updateAllCompetitionEmbeds(client).catch(e => console.error('[Webhook] competition:', e?.message));
    } catch (err) {
      if (err.code !== 'UND_ERR_SOCKET' && err.code !== 'ECONNRESET' && err.code !== 'EPIPE' && err.code !== 'ETIMEDOUT') {
        console.error('❌ Webhook interval error:', err.message);
      }
    }
  }, 10 * 60 * 1000);
}

export function stopWebhookSystem() {
  if (webhookInterval) {
    clearInterval(webhookInterval);
    webhookInterval = null;
  }
}

export async function forceUpdateWebhook(client, type) {
  if (type === 'committees') {
    await updateAllCommittees(client);
    return true;
  }
  if (type === 'report') {
    const { updateReportsDashboard } = await getReportsCmd();
    await updateReportsDashboard(client, true);
    return true;
  }
  if (!WEBHOOK_TYPES.includes(type)) return false;
  await PersistentMessage.deleteOne({ key: `webhook_${type}` });
  await updateWebhook(client, type);
  return true;
}