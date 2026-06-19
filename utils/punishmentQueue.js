import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import DailyLog from '../models/DailyLog.js';
import Member from '../models/Member.js';
import Warning from '../models/Warning.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getInteractionConfig, STATUS, getStatusEmoji, quickClassify, updateRoomEmoji, formatDate, ensureDailyLog } from './interactionSystem.js';
import { warning as embedWarning, success as embedSuccess, info as embedInfo } from './embedStyles.js';
import { logWarning } from './logSystem.js';
import { dmUser } from './notificationSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
  } catch { return {}; }
}

const WARN_GIF = 'https://media.discordapp.net/attachments/1391704768660901919/1453017759565746197/934_x_175_.gif';

// In-memory queue store (map of messageId -> queue data)
const activeQueues = new Map();

/* ===================================================================
   بناء قائمة الانتظار — مسح الأعضاء المخالفين
   =================================================================== */
export async function buildWarningQueue(guild, client) {
  const todayDate = formatDate(new Date());
  const maxWarnings = getInteractionConfig().maxWarnings;

  // أعضاء مخالفين لم يسامحوا بعد
  const violatorLogs = await DailyLog.find({
    date: todayDate,
    status: { $in: [STATUS.VIOLATOR, STATUS.WARNED] },
    $or: [{ forgiven: { $ne: true } }, { forgiven: { $exists: false } }]
  });

  const items = [];

  for (const log of violatorLogs) {
    try {
      const memberData = await Member.findOne({ discordId: log.discordId });
      if (!memberData || !memberData.isActive) continue;

      const gm = await guild.members.fetch(log.discordId).catch(() => null);
      if (!gm) continue;

      const activeWarnings = await Warning.find({ memberId: log.discordId, warningType: 'inactivity', status: 'active', removed: false });
      const warningCount = activeWarnings.length;

      if (warningCount >= maxWarnings) continue;

      items.push({
        discordId: log.discordId,
        gm,
        memberData,
        dailyLog: log,
        warningCount,
        nextWarningNum: warningCount + 1,
        status: 'pending',
        reason: '',
      });
    } catch (e) {
      console.error(`[PunishmentQueue] Error building item for ${log.discordId}:`, e?.message);
    }
  }

  return items;
}

/* ===================================================================
   إرسال رسالة القائمة إلى قناة اللجنة
   =================================================================== */
export async function sendQueueMessage(guildOrInteraction, items) {
  const guild = guildOrInteraction.guild || guildOrInteraction;
  const alertChannelId = getInteractionConfig().channels.alert;
  const logChannel = alertChannelId ? (guild.channels.cache.get(alertChannelId) || await guild.channels.fetch(alertChannelId).catch(() => null)) : null;
  if (!logChannel || items.length === 0) return;

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('pun_queue_select')
    .setPlaceholder('اختر عضواً لعرض التفاصيل')
    .addOptions(items.slice(0, 25).map((item, i) => ({
      label: item.gm?.displayName || item.discordId,
      description: `إنذار (${item.nextWarningNum}) | ${item.status === 'approved' ? '✅' : item.status === 'rejected' ? '❌' : '⏳'}`,
      value: `${i}`,
    })));

  const allReviewed = items.every(item => item.status !== 'pending');
  const embed = embedWarning(`📋 قائمة الإنذارات — ${items.length} عضو`,
    queueSummary(items));

  const rows = [new ActionRowBuilder().addComponents(selectMenu)];
  const actionRow = new ActionRowBuilder();
  actionRow.addComponents(
    new ButtonBuilder().setCustomId('pun_queue_approve_all').setLabel('✅ قبول الكل').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pun_queue_reject_all').setLabel('❌ رفض الكل').setStyle(ButtonStyle.Danger),
  );
  rows.push(actionRow);
  if (allReviewed) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pun_queue_submit').setLabel('📨 إرسال القرارات').setStyle(ButtonStyle.Primary),
    ));
  }

  const msg = await logChannel.send({ embeds: [embed], components: rows });
  activeQueues.set(msg.id, { items, channelId: logChannel.id, messageId: msg.id, guild });
}

/* ===================================================================
   تحديث رسالة القائمة
   =================================================================== */
async function updateQueueMessage(queue) {
  const logChannel = queue.guild.channels.cache.get(queue.channelId) || await queue.guild.channels.fetch(queue.channelId).catch(() => null);
  if (!logChannel) return;
  const msg = await logChannel.messages.fetch(queue.messageId).catch(() => null);
  if (!msg) return;

  const allReviewed = queue.items.every(item => item.status !== 'pending');
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('pun_queue_select')
    .setPlaceholder('اختر عضواً لعرض التفاصيل')
    .addOptions(queue.items.slice(0, 25).map((item, i) => ({
      label: item.gm?.displayName || item.discordId,
      description: `إنذار (${item.nextWarningNum}) | ${item.status === 'approved' ? '✅' : item.status === 'rejected' ? '❌' : '⏳'}`,
      value: `${i}`,
    })));

  const embed = embedWarning(`📋 قائمة الإنذارات — ${queue.items.length} عضو`,
    queueSummary(queue.items));

  const rows = [new ActionRowBuilder().addComponents(selectMenu)];
  const actionRow = new ActionRowBuilder();
  actionRow.addComponents(
    new ButtonBuilder().setCustomId('pun_queue_approve_all').setLabel('✅ قبول الكل').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('pun_queue_reject_all').setLabel('❌ رفض الكل').setStyle(ButtonStyle.Danger),
  );
  rows.push(actionRow);
  if (allReviewed) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pun_queue_submit').setLabel('📨 إرسال القرارات').setStyle(ButtonStyle.Primary),
    ));
  }

  await msg.edit({ embeds: [embed], components: rows });
}

function queueSummary(items) {
  return items.map((item, i) => {
    const icon = item.status === 'approved' ? '✅' : item.status === 'rejected' ? '❌' : '⏳';
    const statusText = item.status === 'approved' ? 'مقبول'
      : item.status === 'rejected' ? `مرفوض (${item.reason || 'بدون سبب'})`
      : 'بانتظار المراجعة';
    return `${icon} ${i + 1}. ${item.gm} — إنذار (${item.nextWarningNum}) — ${statusText}`;
  }).join('\n');
}

/* ===================================================================
   معالجة تفاعلات القائمة (أزرار + Select Menu)
   =================================================================== */
export async function handleQueueInteraction(interaction) {
  const { customId, guild } = interaction;
  if (!customId.startsWith('pun_queue_')) return false;

  let queue = null;
  let queueMsgId = null;
  for (const [msgId, q] of activeQueues) {
    if (q.messageId === msgId || (interaction.message && interaction.message.id === q.messageId)) {
      queue = q;
      queueMsgId = msgId;
      break;
    }
  }
  if (!queue) {
    return interaction.reply({ content: '❌ انتهت صلاحية الجلسة.', flags: MessageFlags.Ephemeral });
  }

  // Select Menu — عرض تفاصيل العضو
  if (interaction.isStringSelectMenu() && customId === 'pun_queue_select') {
    const index = parseInt(interaction.values[0]);
    const item = queue.items[index];
    if (!item) return interaction.reply({ content: '❌ العضو غير موجود.', flags: MessageFlags.Ephemeral });

    const embed = embedInfo(`📋 تفاصيل ${item.gm?.displayName || item.discordId}`,
      `${item.gm}\nالحالة: ${item.status === 'approved' ? '✅ مقبول' : item.status === 'rejected' ? `❌ مرفوض (${item.reason})` : '⏳ بانتظار المراجعة'}`)
      .addFields(
        { name: '⚠️ الإنذار', value: `${item.nextWarningNum}/3`, inline: true },
        { name: '📊 نقاط اليوم', value: `${item.dailyLog.points || 0}`, inline: true },
        { name: '📅 أيام المخالفة', value: `${item.dailyLog.daysAsViolator || 0}`, inline: true },
      );

    const row = new ActionRowBuilder();
    if (item.status !== 'approved') {
      row.addComponents(new ButtonBuilder().setCustomId(`pun_queue_item_approve_${index}`).setLabel('✅ قبول').setStyle(ButtonStyle.Success));
    }
    if (item.status !== 'rejected') {
      row.addComponents(new ButtonBuilder().setCustomId(`pun_queue_item_reject_${index}`).setLabel('❌ رفض').setStyle(ButtonStyle.Danger));
    }
    const components = row.components.length > 0 ? [row] : [];
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    return true;
  }

  // قبول الكل
  if (interaction.isButton() && customId === 'pun_queue_approve_all') {
    await interaction.deferUpdate();
    for (const item of queue.items) {
      if (item.status === 'pending' || item.status === 'rejected') {
        item.status = 'approved';
        item.reason = '';
      }
    }
    await updateQueueMessage(queue);
    return true;
  }

  // رفض الكل — يفتح مودال سبب واحد
  if (interaction.isButton() && customId === 'pun_queue_reject_all') {
    const modal = new ModalBuilder()
      .setCustomId('pun_queue_reject_all_modal')
      .setTitle('❌ سبب الرفض للكل');

    const reasonInput = new TextInputBuilder()
      .setCustomId('pun_queue_reject_all_reason')
      .setLabel('السبب')
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(1)
      .setMaxLength(500)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
    return true;
  }

  // قبول فردي
  if (interaction.isButton() && customId.startsWith('pun_queue_item_approve_')) {
    await interaction.deferUpdate();
    const index = parseInt(customId.split('_').pop());
    if (queue.items[index]) {
      queue.items[index].status = 'approved';
      queue.items[index].reason = '';
    }
    await updateQueueMessage(queue);
    return true;
  }

  // رفض فردي
  if (interaction.isButton() && customId.startsWith('pun_queue_item_reject_')) {
    const index = parseInt(customId.split('_').pop());
    const modal = new ModalBuilder()
      .setCustomId(`pun_queue_reject_item_modal_${index}`)
      .setTitle('❌ سبب الرفض');

    const reasonInput = new TextInputBuilder()
      .setCustomId('pun_queue_reject_item_reason')
      .setLabel('السبب')
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(1)
      .setMaxLength(500)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
    return true;
  }

  // إرسال القرارات
  if (interaction.isButton() && customId === 'pun_queue_submit') {
    await interaction.deferUpdate();
    const approved = queue.items.filter(item => item.status === 'approved');
    const rejected = queue.items.filter(item => item.status === 'rejected');

    if (approved.length === 0) {
      await interaction.followUp({ content: '❌ لا يوجد أعضاء مقبولين لإرسال القرارات.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await executeBatchWarnings(guild, approved, interaction.user);

    activeQueues.delete(queueMsgId);

    await interaction.followUp({
      content: `✅ تم إصدار القرار لـ **${approved.length}** أعضاء.${rejected.length > 0 ? `\n❌ تم رفض **${rejected.length}** أعضاء.` : ''}`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  return false;
}

/* ===================================================================
   معالجة مودالات الرفض
   =================================================================== */
export async function handleQueueModal(interaction) {
  const customId = interaction.customId;

  if (customId === 'pun_queue_reject_all_modal') {
    const reason = interaction.fields.getTextInputValue('pun_queue_reject_all_reason');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let queue = null;
    for (const [, q] of activeQueues) {
      if (q.messageId) { queue = q; break; }
    }
    if (!queue) return interaction.editReply({ content: '❌ انتهت صلاحية الجلسة.' });

    for (const item of queue.items) {
      if (item.status === 'pending' || item.status === 'approved') {
        item.status = 'rejected';
        item.reason = reason;
      }
    }
    await updateQueueMessage(queue);
    await interaction.editReply({ content: '✅ تم رفض جميع الأعضاء.' });
    return;
  }

  if (customId.startsWith('pun_queue_reject_item_modal_')) {
    const index = parseInt(customId.replace('pun_queue_reject_item_modal_', ''));
    const reason = interaction.fields.getTextInputValue('pun_queue_reject_item_reason');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let queue = null;
    for (const [, q] of activeQueues) {
      if (q.messageId) { queue = q; break; }
    }
    if (!queue || !queue.items[index]) return interaction.editReply({ content: '❌ انتهت صلاحية الجلسة.' });

    queue.items[index].status = 'rejected';
    queue.items[index].reason = reason;
    await updateQueueMessage(queue);
    await interaction.editReply({ content: '✅ تم رفض العضو.' });
    return;
  }
}

/* ===================================================================
   تنفيذ الدفعة — تطبيق الإنذارات + إرسال قرار موحد + GIF
   =================================================================== */
async function executeBatchWarnings(guild, approvedList, executor) {
  const applied = [];
  const errors = [];

  for (const item of approvedList) {
    try {
      const warning = new Warning({
        memberId: item.discordId,
        memberName: executor.tag,
        warningType: 'inactivity',
        typeName: 'عدم تفاعل',
        reason: 'عدم تفاعل مستمر (قرار جماعي من لجنة العقوبات)',
        givenBy: executor.id,
        givenByName: executor.tag,
        status: 'active',
        removed: false,
      });
      await warning.save();

      const config = loadConfig();
      const warningNum = item.nextWarningNum;
      if (item.gm) {
        let warningRoleId = config.warnings?.roles?.[warningNum.toString()];
        const actualRoleId = warningRoleId?.id || warningRoleId;
        if (actualRoleId) {
          await item.gm.roles.add(actualRoleId).catch(e => console.error('Failed to add warning role:', e));
        }
      }

      // تحديث DailyLog
      const dailyLog = await ensureDailyLog(item.discordId);
      if (dailyLog) {
        dailyLog.warningCount = warningNum;
        await dailyLog.save();
      }

      // تحديث الإيموجي
      await updateRoomEmoji(guild, item.discordId, getStatusEmoji(STATUS.WARNED)).catch(() => {});

      // إرسال DM
      const user = await guild.client.users.fetch(item.discordId).catch(() => null);
      if (user) {
        const remaining = 3 - warningNum;
        let msg = `🟤 **تم تسجيل إنذار بعدم التفاعل.**\nمعك الآن ${warningNum} من ٣ إنذارات.\n`;
        if (remaining > 0) {
          msg += `عند وصول ٣ إنذارات يصير العضو جاهزاً للفصل.\n🎫 توجه للتذاكر إذا كان عندك عذر.`;
        } else {
          msg += `⚠️ وصلت ٣ إنذارات — اللجنة مخولة بفصلك.`;
        }
        await user.send(msg).catch(() => {});
      }

      // تسجيل في سجل العقوبات
      await logWarning(guild, {
        target: `<@${item.discordId}>`,
        mod: `<@${executor.id}>`,
        reason: 'عدم تفاعل مستمر',
        warningCount: warningNum,
        totalWarnings: 3,
      });

      // تحديث _lastInteractionStatus
      item.memberData._lastInteractionStatus = STATUS.WARNED;
      await item.memberData.save().catch(() => {});

      applied.push(item);
    } catch (e) {
      console.error(`[PunishmentQueue] Error executing warn for ${item.discordId}:`, e?.message);
      errors.push(item.discordId);
    }
  }

  // إرسال القرار الموحد + GIF
  if (applied.length > 0) {
    await sendBulkWarningDecision(guild, applied, executor);
  }

  if (errors.length > 0) {
    console.error(`[PunishmentQueue] Failed to warn ${errors.length} members:`, errors.join(', '));
  }
}

/* ===================================================================
   إرسال القرار الموحد — GIF واحد + نص يمنشن كل المحذّرين
   =================================================================== */
async function sendBulkWarningDecision(guild, appliedList, executor) {
  const config = loadConfig();
  const decisionChannelId = config.warnings?.channels?.warningDecision?.id || getInteractionConfig().channels.decisions;
  const decisionChannel = decisionChannelId ? (guild.channels.cache.get(decisionChannelId) || await guild.channels.fetch(decisionChannelId).catch(() => null)) : null;
  const basicRoleId = config.roles?.basic?.id || '';

  if (!decisionChannel) return;

  // GIF واحد
  await decisionChannel.send({ content: WARN_GIF }).catch(e => console.error('[PunishmentQueue] GIF send failed:', e?.message));

  // القرار الموحد — نفس النص القديم لكن يمنشن الكل
  const membersList = appliedList.map(item => `- <@${item.discordId}>`).join('\n');
  const detailsList = appliedList.map(item => {
    const numArabic = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس'][item.nextWarningNum - 1] || `${item.nextWarningNum}`;
    return `> • **بإعطاء تحذير (${numArabic})** — <@${item.discordId}>`;
  }).join('\n');

  const decision = `
▬▬▬ ﷽ ▬▬▬
<:Family:1516647836744417320> **قرار إداري صادر من قيادة العائلة** 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 

**لكلاً من :**  
${membersList}

**السبب :**  || عدم تفاعل مستمر ||

${detailsList}

-# ملاحظة : عند بلوغ 3 تحذيرات سيتم اتخاذ إجراء الفصل التلقائي.
**تــوقــيــع مسؤول القرار ✍:** ${executor}

||<@&${basicRoleId}>||
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`.trim();

  await decisionChannel.send({ content: decision }).catch(() => {});
}
