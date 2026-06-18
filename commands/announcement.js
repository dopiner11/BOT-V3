import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { custom as embedCustom } from '../utils/embedStyles.js';
import { createModel } from '../data/db.js';
import Member from '../models/Member.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ScheduledTask = createModel('ScheduledTask');
let watcherInterval = null;

function loadConfig() {
  return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
}

function parseBaghdadTime(str) {
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [_, y, m, d, h, min] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, h - 3, min, 0));
  return isNaN(date.getTime()) ? null : date;
}

// ===== Scheduler functions =====

async function embedFromData(data) {
  if (!data) return null;
  const embed = embedCustom(data.color || null, data.title || '', data.description || null);
  if (data.image) embed.setImage(data.image);
  if (data.footer) embed.setFooter({ text: data.footer });
  if (data.timestamp) embed.setTimestamp(data.timestamp);
  return embed;
}

async function executeTask(client, task) {
  const guild = client.guilds.cache.get(task.guildId);
  if (!guild) throw new Error('Guild not found');

  if (task.type === 'announcement') {
    const embedData = task.payload?.embed
      ? { embeds: [await embedFromData(task.payload.embed)] }
      : { content: task.payload?.content || '' };

    const members = await Member.find({ isActive: true, roomChannelId: { $ne: null } });
    const to = task.targetOptions || {};

    if (to.roomChannels !== false) {
      for (const m of members) {
        const ch = guild.channels.cache.get(m.roomChannelId);
        if (ch) { await ch.send(embedData).catch(() => {}); await new Promise(r => setTimeout(r, 100)); }
      }
    }

    if (to.dm) {
      for (const m of members) {
        const member = guild.members.cache.get(m.discordId);
        if (member) { await member.send(embedData).catch(() => {}); await new Promise(r => setTimeout(r, 3000)); }
      }
    }

    if (to.mentionEveryone) {
      const config = loadConfig();
      const annId = config.general?.channels?.announcements?.id;
      if (annId) {
        const annCh = guild.channels.cache.get(annId);
        if (annCh) {
          const mentionContent = to.mentionContent || '@everyone';
          if (task.payload?.embed) {
            await annCh.send({ content: mentionContent, embeds: [await embedFromData(task.payload.embed)] }).catch(() => {});
          } else {
            await annCh.send({ content: `${mentionContent}\n${task.payload?.content || ''}` }).catch(() => {});
          }
        }
      }
    }
    return;
  }

  throw new Error(`Unknown task type: ${task.type}`);
}

async function logScheduledExecution(client, guild, task) {
  const config = loadConfig();
  const logChannelId = config.logChannels?.promotion?.id;
  if (!logChannelId) return;
  const logCh = guild.channels.cache.get(logChannelId);
  if (!logCh) return;
  const sender = task.senderId ? (await client.users.fetch(task.senderId).catch(() => null)) : null;

  const embed = embedCustom(0xFF6B35, '📅 تنويه مجدول - تم الإرسال')
    .addFields(
      { name: '👤 بواسطة', value: sender ? sender.tag : 'غير معروف', inline: true },
      { name: '📂 النوع', value: task.type, inline: true },
      { name: '🕐 الوقت المجدول', value: `<t:${Math.floor(new Date(task.scheduledAt).getTime() / 1000)}:F>` },
      { name: '📋 العنوان', value: task.logInfo?.title || 'بدون عنوان' }
    );
  await logCh.send({ embeds: [embed] }).catch(() => {});
}

export async function scheduleTask({ type, guildId, senderId, scheduledAt, payload, targetOptions, logInfo }) {
  const task = await ScheduledTask.create({ type, guildId, senderId, scheduledAt, payload, targetOptions, logInfo, sent: false, createdAt: new Date() });
  return task;
}

export async function cancelTask(taskId) {
  return ScheduledTask.findByIdAndDelete(taskId);
}

export async function listPending(guildId) {
  const all = await ScheduledTask.find({ sent: false });
  return all.filter(t => t.guildId === guildId);
}

export function stopWatcher() {
  if (watcherInterval) { clearInterval(watcherInterval); watcherInterval = null; }
}

export async function startWatcher(client) {
  watcherInterval = setInterval(async () => {
    try {
      const now = new Date();
      const due = await ScheduledTask.find({ sent: false });
      for (const task of due) {
        const scheduledAt = task.scheduledAt instanceof Date ? task.scheduledAt : new Date(task.scheduledAt);
        if (scheduledAt <= now) {
          try {
            await executeTask(client, task);
          } catch (e) {
            console.error('[Scheduler] execute error:', e.message);
          }
          task.sent = true;
          task.sentAt = new Date();
          await task.save();
          try {
            const guild = client.guilds.cache.get(task.guildId);
            if (guild) await logScheduledExecution(client, guild, task);
          } catch {}
        }
      }
    } catch (e) {
      console.error('[Scheduler] Watch error:', e.message);
    }
  }, 30000);
}

// ===== Command =====

export default {
  data: new SlashCommandBuilder()
    .setName('تنويه')
    .setDescription('📢 إرسال تنويه للأعضاء')
    .addStringOption(o => o.setName('العنوان').setDescription('عنوان التنويه').setRequired(true))
    .addStringOption(o => o.setName('النص').setDescription('نص التنويه').setRequired(true))
    .addStringOption(o => o.setName('الصورة').setDescription('رابط الصورة').setRequired(false))
    .addStringOption(o => o.setName('وقت_الجدولة').setDescription('جدولة الإرسال (تنسيق: YYYY-MM-DD HH:MM بغداد)').setRequired(false))
    .addStringOption(o => o.setName('خيارات_الإرسال').setDescription('خيارات إضافية')
      .addChoices(
        { name: '📨 بدون منشن', value: 'normal' },
        { name: '📢 مع @everyone', value: 'everyone' },
        { name: '📩 إرسال DM + الرومات', value: 'dm' },
        { name: '📩 DM + @everyone', value: 'dm_everyone' }
      ).setRequired(false)),

  async execute(interaction) {
    const title = interaction.options.getString('العنوان');
    const text = interaction.options.getString('النص');
    const image = interaction.options.getString('الصورة');
    const scheduleTime = interaction.options.getString('وقت_الجدولة');
    const sendOption = interaction.options.getString('خيارات_الإرسال') || 'normal';

    const embed = embedCustom(0xFF6B35, `📢 ${title}`, text).setFooter({ text: 'إدارة العائلة' });
    if (image) embed.setImage(image);

    if (scheduleTime) {
      const parsed = parseBaghdadTime(scheduleTime);
      if (!parsed || parsed <= new Date()) {
        return interaction.reply({ content: '❌ الوقت غير صالح أو في الماضي. التنسيق: YYYY-MM-DD HH:MM (بغداد)', flags: MessageFlags.Ephemeral });
      }

      await scheduleTask({
        type: 'announcement',
        guildId: interaction.guildId,
        senderId: interaction.user.id,
        scheduledAt: parsed,
        payload: { embed: { title: `📢 ${title}`, description: text, color: '#FF6B35', image, footer: 'إدارة العائلة', timestamp: new Date().toISOString() } },
        targetOptions: {
          roomChannels: true,
          dm: sendOption === 'dm' || sendOption === 'dm_everyone',
          mentionEveryone: sendOption === 'everyone' || sendOption === 'dm_everyone',
          mentionContent: '@everyone',
        },
        logInfo: { title },
      });

      return interaction.reply({
        content: `📅 تم جدولة التنويه ليوم **${scheduleTime}** بنجاح!\n🕐 سيرسل تلقائياً في الوقت المحدد.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const members = await Member.find({ isActive: true, roomChannelId: { $ne: null } });
    const config = loadConfig();
    const dmOption = sendOption === 'dm' || sendOption === 'dm_everyone';
    const mentionOption = sendOption === 'everyone' || sendOption === 'dm_everyone';

    let sent = 0;

    for (const m of members) {
      const ch = interaction.guild.channels.cache.get(m.roomChannelId);
      if (ch) { await ch.send({ embeds: [embed] }).catch(() => {}); sent++; }
      await new Promise(r => setTimeout(r, 100));
    }

    if (dmOption) {
      for (const m of members) {
        const member = await interaction.guild.members.fetch(m.discordId).catch(() => null);
        if (member) { await member.send({ embeds: [embed] }).catch(() => {}); sent++; }
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    if (mentionOption) {
      const annId = config.general?.channels?.announcements?.id;
      if (annId) {
        const annCh = interaction.guild.channels.cache.get(annId);
        if (annCh) await annCh.send({ content: '@everyone', embeds: [embed] }).catch(() => {});
      }
    }

    const logChannelId = config.logChannels?.promotion?.id;
    if (logChannelId) {
      const logCh = interaction.guild.channels.cache.get(logChannelId);
      if (logCh) {
        const optionsLabel = dmOption ? 'DM + الرومات' : (mentionOption ? 'الرومات + @everyone' : 'الرومات فقط');
        const logEmbed = embedCustom(0xFF6B35, '📢 إرسال تنويه')
          .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
          .addFields(
            { name: 'العنوان', value: title, inline: true },
            { name: 'عدد المستلمين', value: sent.toString(), inline: true },
            { name: 'خيارات الإرسال', value: optionsLabel, inline: true }
          );
        await logCh.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }

    const parts = [`✅ تم إرسال التنويه لـ **${sent}** عضو.`];
    if (dmOption) parts.push('📩 تم الإرسال عبر DM أيضاً.');
    if (mentionOption) parts.push('📢 تم وضع منشن في قناة الإعلانات.');
    await interaction.editReply(parts.join('\n'));
  },
};
