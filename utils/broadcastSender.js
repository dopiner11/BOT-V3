import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { success as embedSuccess, custom as embedCustom } from './embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  try { return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8')); } catch { return {}; }
}

let senderClient = null;

export function setSenderClient(client) {
  senderClient = client;
}

function getSender() {
  return senderClient;
}

export class SendJob {
  constructor({ targets, payload, type, senderId, guild, sendMethod }) {
    this.targets = targets;
    this.payload = payload;
    this.type = type;
    this.senderId = senderId;
    this.guild = guild;
    this.sendMethod = sendMethod || 'dm';
    this.results = { sent: 0, failed: 0, errors: [], total: targets.length, dmClosed: 0, notFound: 0, other: 0 };
    this.status = 'pending';
    this.cancelled = false;
    this.startedAt = null;
    this.completedAt = null;
    this.currentIndex = 0;
  }

  cancel() {
    this.cancelled = true;
    this.status = 'cancelled';
  }
}

export class SenderQueue {
  constructor() {
    this.queue = [];
    this.currentJob = null;
    this.isProcessing = false;
  }

  add(job) {
    this.queue.push(job);
    if (!this.isProcessing) this.processNext();
    return job;
  }

  cancelCurrentJob() {
    if (this.currentJob && !this.currentJob.cancelled) {
      this.currentJob.cancel();
      return true;
    }
    return false;
  }

  getStatus() {
    return {
      pending: this.queue.length,
      processing: this.isProcessing,
      current: this.currentJob,
    };
  }

  async processNext() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      this.currentJob = null;
      return;
    }
    this.isProcessing = true;
    const job = this.queue.shift();
    this.currentJob = job;
    await this.executeJob(job);
    this.currentJob = null;
    this.processNext();
  }

  async executeJob(job) {
    const config = loadConfig();
    const delay = config.broadcast?.dmDelay || 3000;
    const maxRetries = config.broadcast?.maxRetries || 3;

    job.status = 'running';
    job.startedAt = new Date();

    for (let i = 0; i < job.targets.length; i++) {
      if (job.cancelled) {
        job.status = 'cancelled';
        break;
      }

      const target = job.targets[i];
      job.currentIndex = i + 1;

      let success = false;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (job.sendMethod === 'dm') {
            const sender = getSender();
            if (!sender) {
              job.results.other++;
              job.results.errors.push({ id: target.id, reason: 'sender_not_ready', attempt });
              break;
            }
            const user = await sender.users.fetch(target.id).catch(() => null);
            if (!user) {
              job.results.notFound++;
              job.results.errors.push({ id: target.id, reason: 'user_not_found', attempt });
              break;
            }
            await user.send(job.payload);
            success = true;
            break;
          } else {
            const channel = job.guild.channels.cache.get(target.channelId);
            if (!channel) {
              job.results.notFound++;
              job.results.errors.push({ id: target.id, reason: 'channel_not_found', attempt });
              break;
            }
            await channel.send(job.payload);
            success = true;
            break;
          }
        } catch (err) {
          if (err.code === 50007) {
            job.results.dmClosed++;
            job.results.errors.push({ id: target.id, reason: 'DMs closed', attempt });
            break;
          }
          if (err.code === 50001 || err.code === 50013) {
            job.results.other++;
            job.results.errors.push({ id: target.id, reason: 'missing_permissions', attempt });
            break;
          }
          if (err.code === 429) {
            const retryAfter = err.retryAfter ? err.retryAfter * 1000 : delay;
            await new Promise(r => setTimeout(r, retryAfter));
            continue;
          }
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, delay));
          } else {
            job.results.other++;
            job.results.errors.push({ id: target.id, reason: err.message, attempt });
          }
        }
      }

      if (success) job.results.sent++;
      else job.results.failed++;

      if (i < job.targets.length - 1 && !job.cancelled) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (job.status === 'running') {
      job.status = 'completed';
    }
    job.completedAt = new Date();
  }
}

export const queue = new SenderQueue();

export async function cancelBroadcast() {
  return queue.cancelCurrentJob();
}

export async function collectAllTargets(guild) {
  const members = await guild.members.fetch();
  return members.filter(m => !m.user.bot).map(m => ({ id: m.id, tag: m.user.tag }));
}

export async function collectRoleTargets(guild, roleId) {
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return [];
  return role.members.filter(m => !m.user.bot).map(m => ({ id: m.id, tag: m.user.tag }));
}

export async function collectUsersTargets(guild, userIds) {
  const members = await guild.members.fetch({ user: userIds }).catch(() => []);
  return members.filter(m => !m.user.bot).map(m => ({ id: m.id, tag: m.user.tag }));
}

export async function collectOnlineTargets(guild) {
  const members = await guild.members.fetch();
  return members.filter(m => !m.user.bot && m.presence?.status !== 'offline').map(m => ({ id: m.id, tag: m.user.tag }));
}

export async function collectVoiceTargets(guild, channelId) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return [];
  return channel.members.filter(m => !m.user.bot).map(m => ({ id: m.id, tag: m.user.tag }));
}

export async function logBroadcastComplete(job) {
  const config = loadConfig();
  const logChannelId = config.broadcast?.logChannelId;
  if (!logChannelId || !job.guild) return;

  try {
    const channel = await job.guild.channels.fetch(logChannelId).catch(() => null);
    if (!channel) return;

    const duration = job.startedAt ? ((job.completedAt - job.startedAt) / 1000).toFixed(1) : '0';
    const broadColor = job.results.failed === 0 ? '#00ff00' : '#ff9900';
    const statusEmoji = job.status === 'cancelled' ? '⛔' : (job.results.failed === 0 ? '✅' : '⚠️');

    const fields = [
      { name: '👤 أرسل بواسطة', value: `<@${job.senderId}>`, inline: true },
      { name: '📂 النوع', value: job.type, inline: true },
      { name: '📊 العدد الإجمالي', value: `${job.results.total}`, inline: true },
      { name: '✅ تم الإرسال', value: `${job.results.sent}`, inline: true },
      { name: '❌ فشل', value: `${job.results.failed}`, inline: true },
      { name: '⏱ المدة', value: `${duration} ثانية`, inline: true },
    ];

    const errorDetails = [];
    if (job.results.dmClosed > 0) errorDetails.push(`DMs مقفلة: ${job.results.dmClosed}`);
    if (job.results.notFound > 0) errorDetails.push(`غير موجود: ${job.results.notFound}`);
    if (job.results.other > 0) errorDetails.push(`أخرى: ${job.results.other}`);
    if (errorDetails.length > 0) {
      fields.push({ name: '📋 تفصيل الفشل', value: errorDetails.join(' | '), inline: false });
    }

    const embed = embedCustom(parseInt(broadColor.replace('#', ''), 16), `${statusEmoji} تقرير إرسال البرودكاست`)
      .addFields(fields);

    if (job.startedAt) embed.addFields({ name: '🕐 وقت البدء', value: `<t:${Math.floor(job.startedAt.getTime() / 1000)}:F>` });
    if (job.completedAt) embed.addFields({ name: '🕐 وقت الانتهاء', value: `<t:${Math.floor(job.completedAt.getTime() / 1000)}:F>` });

    if (job.results.errors.length > 0) {
      const errorSummary = job.results.errors.slice(0, 10).map(e => `<@${e.id}>: ${e.reason}`).join('\n');
      if (errorSummary) embed.addFields({ name: '❌ أسباب الفشل (أول 10)', value: errorSummary });
      if (job.results.errors.length > 10) {
        embed.addFields({ name: 'ملاحظة', value: `+ ${job.results.errors.length - 10} خطأ آخر` });
      }
    }

    await channel.send({ embeds: [embed] });
  } catch (e) {
    console.error('❌ Broadcast log error:', e.message);
  }
}

export async function refreshBroadcastStatus(interaction) {
  const status = queue.getStatus();
  const job = status.current || status.pending > 0 ? queue.queue[0] : null;

  const embed = embedCustom(0x2B2D31, '📡 حالة نظام البرودكاست')
    .addFields(
      { name: '⏳ في الإنتظار', value: `${status.pending}`, inline: true },
      { name: '⚙️ قيد التشغيل', value: status.processing ? 'نعم' : 'لا', inline: true }
    )
    .setFooter({ text: 'يتم التحديث يدوياً' });

  if (job) {
    const total = job.results.total;
    const progress = total > 0 ? ((job.currentIndex / total) * 100).toFixed(1) : 0;
    embed.addFields(
      { name: '📊 التقدم', value: `${job.currentIndex}/${total} (${progress}%)` },
      { name: '✅ تم', value: `${job.results.sent}`, inline: true },
      { name: '❌ فشل', value: `${job.results.failed}`, inline: true },
      { name: '📂 النوع', value: job.type, inline: true }
    );
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('refresh_broadcast_status')
      .setLabel('🔄 تحديث')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('cancel_broadcast')
      .setLabel('❌ إلغاء البث')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!status.processing)
  );

  await interaction.update({ embeds: [embed], components: [row] });
}
