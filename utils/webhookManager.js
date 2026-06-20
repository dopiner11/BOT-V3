import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import PersistentMessage from '../models/PersistentMessage.js';
import { custom as embedCustom } from './embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configPath = join(__dirname, '../config.json');
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

let webhookInterval;

export async function startWebhookSystem(client) {
  if (webhookInterval) clearInterval(webhookInterval);

  setTimeout(async () => {
    console.log('🔄 Starting committee webhook system...');
    await updateAllCommittees(client);
    console.log('✅ Committee webhook system started.');
  }, 8000);

  webhookInterval = setInterval(async () => {
    try {
      await updateAllCommittees(client);
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
  return false;
}
