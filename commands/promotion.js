import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import Member from '../models/Member.js';
import Nomination from '../models/Nomination.js';
import { applyPromotion, getDaysInRank, isOnLeave, sendBulkAnnouncement } from '../utils/promotionManager.js';
import { custom as embedCustom } from '../utils/embedStyles.js';
import { loadConfig } from '../utils/configLoader.js';

const config = loadConfig();
const LOG_CHANNEL_ID = config.logChannels?.promotion?.id || "1463557267340394674";

const activeQueues = new Map();

async function checkActiveNomination(discordId) {
  const existing = await Nomination.findOne({ targetId: discordId, ended: { $ne: true } });
  return existing;
}

export default {
  data: new SlashCommandBuilder()
    .setName('ترقيات')
    .setDescription('فحص وترقية الأعضاء')
    .addUserOption(option => option.setName('عضو').setDescription('فحص عضو محدد'))
    .addBooleanOption(option => option.setName('صامت').setDescription('بدون خاص')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser('عضو');
    const silent = interaction.options.getBoolean('صامت') || false;
    const ranks = config.promotion?.ranks || [];

    if (targetUser) {
      const m = await Member.findOne({ discordId: targetUser.id });
      if (!m) return interaction.editReply('❌ العضو غير مسجل في النظام.');

      const gm = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!gm) return interaction.editReply('❌ العضو غير موجود في السيرفر.');

      const currentRankIndex = (m.jobNumber || 1) - 1;
      const nextRankIndex = currentRankIndex + 1;
      const nextRank = ranks[nextRankIndex];
      const currentRank = ranks[currentRankIndex];

      if (!nextRank) return interaction.editReply('❌ العضو في أعلى رتبة بالفعل أو حدث خطأ في الرتب.');

      const activeNom = await checkActiveNomination(targetUser.id);
      if (activeNom) {
        return interaction.editReply(`⚠️ العضو لديه ترشيح نشط. لا يمكن ترقيته تلقائياً حتى ينتهي التصويت.`);
      }

      const onLeave = await isOnLeave(targetUser.id);
      if (onLeave) {
        return interaction.editReply(`⚠️ العضو في إجازة أو عذر حالياً. لا يمكن ترقيته.`);
      }

      const days = getDaysInRank(m);
      const hasDays = days >= (nextRank.requiredDays || 0);
      const hasPoints = (m.points || 0) >= (nextRank.requiredPoints || 0);

      if (hasDays && hasPoints) {
        await applyPromotion({
          memberData: m, guildMember: gm, newRank: nextRank, newRankIndex: nextRankIndex,
          promoterId: interaction.user.id, promoterName: interaction.user.tag,
          guild: interaction.guild, options: { silent }
        });
        await interaction.editReply(`✅ تم ترقية ${targetUser} بنجاح.`);
      } else if (hasDays || hasPoints) {
        await sendToPendingLog(interaction, m, gm, currentRank, nextRank, hasPoints, hasDays, nextRankIndex);
        await interaction.editReply(`⚠️ العضو مستوفي لأحد الشروط فقط. تم إرسال طلب إلى <#${LOG_CHANNEL_ID}> لاتخاذ القرار.`);
      } else {
        await interaction.editReply(`❌ العضو غير مستوفي للشروط (النقاط: ${m.points}/${nextRank.requiredPoints}, الأيام: ${days}/${nextRank.requiredDays}).`);
      }

    } else {
      const members = await Member.find({ isActive: true });
      let promoted = 0;
      let pending = 0;
      let checked = 0;
      const nomChecks = [];

      for (const m of members) {
        checked++;
        const gm = await interaction.guild.members.fetch(m.discordId).catch(() => null);
        if (!gm) continue;

        const currentRankIndex = (m.jobNumber || 1) - 1;
        const nextRankIndex = currentRankIndex + 1;
        const nextRank = ranks[nextRankIndex];

        if (!nextRank) continue;

        const currentRank = ranks[currentRankIndex];
        const days = getDaysInRank(m);
        const hasDays = days >= (nextRank.requiredDays || 0);
        const hasPoints = (m.points || 0) >= (nextRank.requiredPoints || 0);

        if (!hasDays && !hasPoints) continue;

        nomChecks.push({ m, gm, currentRank, nextRank, nextRankIndex, hasDays, hasPoints, days });
      }

      const activeNoms = await Nomination.find({ ended: { $ne: true } });
      const nominatedIds = new Set(activeNoms.map(n => n.targetId));

      const pendingItems = [];

      for (const { m, gm, currentRank, nextRank, nextRankIndex, hasDays, hasPoints } of nomChecks) {
        if (nominatedIds.has(m.discordId)) { pending++; continue; }
        if (await isOnLeave(m.discordId)) { console.log(`[Promotion] ${m.discordId} skipped (leave)`); continue; }

        pendingItems.push({ m, gm, currentRank, nextRank, nextRankIndex, hasDays, hasPoints, status: 'pending', reason: '' });
      }

      if (pendingItems.length > 0) {
        await sendQueueMessage(interaction, pendingItems);
        pending = pendingItems.length;
      }

      await interaction.editReply(`✅ انتهى فحص الترقيات: \n👥 تم فحص: **${checked}**\n⚠️ تم إرسال **${pending}** عضو لقائمة الانتظار.`);
    }
  }
};

async function sendToPendingLog(interaction, m, gm, currentRank, nextRank, hasPoints, hasDays, nextRankIndex) {
  const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID) || await interaction.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (logChannel) {
    const embed = embedCustom(0xFFA500, '⚠️ طلب ترقية (شروط جزئية)',
      `العضو: ${gm} (<@${m.discordId}>) مستوفي لأحد الشروط فقط.\n\nاستخدم الأمر /ترقيات بدون تحديد عضو لإجراء فحص شامل وإرسال قائمة انتظار.`)
      .addFields(
        { name: '👤 العضو', value: `${gm} (${m.discordId})`, inline: true },
        { name: '📉 الرتبة الحالية', value: currentRank?.roleId ? `<@&${currentRank.roleId}>` : (currentRank?.name || 'غير معروف'), inline: true },
        { name: '📈 الرتبة المرشحة', value: nextRank?.roleId ? `<@&${nextRank.roleId}>` : (nextRank?.name || 'غير معروف'), inline: true },
        { name: '💰 النقاط', value: `${m.points} / ${nextRank.requiredPoints} (${hasPoints ? '✅' : '❌'})`, inline: true },
        { name: '📅 الأيام', value: `${getDaysInRank(m)} / ${nextRank.requiredDays} (${hasDays ? '✅' : '❌'})`, inline: true },
        { name: '🕒 آخر ترقية', value: m.lastPromotionDate ? `<t:${Math.floor(new Date(m.lastPromotionDate).getTime() / 1000)}:R>` : 'غير مسجل', inline: true }
      );

    await logChannel.send({ content: `طلب ترقية تلقائي (جزئي) من فحص ${interaction.user}`, embeds: [embed] });
  }
}

async function queueSummary(items) {
  return items.map((item, i) => {
    const icon = item.status === 'approved' ? '🟢' : item.status === 'rejected' ? '🔴' : '🟡';
    const statusText = item.status === 'approved' ? '✅ مقبول' : item.status === 'rejected' ? `❌ مرفوض (${item.reason || 'بدون سبب'})` : '⏳ بانتظار المراجعة';
    return `${icon} ${i + 1}. ${item.gm} — ${item.currentRank?.name || '?'} ← ${item.nextRank?.name || '?'}\n      نقاط: ${item.m.points}/${item.nextRank?.requiredPoints} أيام: ${getDaysInRank(item.m)}/${item.nextRank?.requiredDays}  ${statusText}`;
  }).join('\n');
}

async function sendQueueMessage(interaction, items) {
  const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID) || await interaction.guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel) return;

  const memberId = interaction.user.id;
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`prom_queue_select_${memberId}`)
    .setPlaceholder('اختر عضواً لعرض التفاصيل')
    .addOptions(items.slice(0, 25).map((item, i) => ({
      label: `${item.gm?.displayName || item.m.discordId}`,
      description: `${item.currentRank?.name || '?'} ← ${item.nextRank?.name || '?'} | ${item.status}`,
      value: `${i}`,
    })));

  const allReviewed = items.every(item => item.status !== 'pending');
  const embed = embedCustom(0xFFA500, `⏳ قائمة الترقيات المعلقة — ${items.length} عضو`,
    `حالة المراجعة:\n${await queueSummary(items)}`);

  const rows = [new ActionRowBuilder().addComponents(selectMenu)];
  const actionRow = new ActionRowBuilder();
  actionRow.addComponents(
    new ButtonBuilder().setCustomId(`prom_queue_approve_${memberId}`).setLabel('✅ قبول الكل').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`prom_queue_reject_${memberId}`).setLabel('❌ رفض الكل').setStyle(ButtonStyle.Danger),
  );
  rows.push(actionRow);
  if (allReviewed) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prom_queue_submit_${memberId}`).setLabel('📨 إرسال الترقيات').setStyle(ButtonStyle.Primary),
    ));
  }

  const msg = await logChannel.send({ embeds: [embed], components: rows });
  activeQueues.set(msg.id, { ownerId: memberId, items, channelId: logChannel.id, messageId: msg.id, interaction });
}

async function updateQueueMessage(queue, reasonMap = {}) {
  const guild = queue.interaction.guild;
  const logChannel = guild.channels.cache.get(queue.channelId) || await guild.channels.fetch(queue.channelId).catch(() => null);
  if (!logChannel) return;
  const msg = await logChannel.messages.fetch(queue.messageId).catch(() => null);
  if (!msg) return;

  const memberId = queue.ownerId;
  const allReviewed = queue.items.every(item => item.status !== 'pending');
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`prom_queue_select_${memberId}`)
    .setPlaceholder('اختر عضواً لعرض التفاصيل')
    .addOptions(queue.items.slice(0, 25).map((item, i) => ({
      label: `${item.gm?.displayName || item.m.discordId}`,
      description: `${item.currentRank?.name || '?'} ← ${item.nextRank?.name || '?'} | ${item.status}`,
      value: `${i}`,
    })));

  const embed = embedCustom(0xFFA500, `⏳ قائمة الترقيات المعلقة — ${queue.items.length} عضو`,
    `حالة المراجعة:\n${await queueSummary(queue.items)}`);

  const rows = [new ActionRowBuilder().addComponents(selectMenu)];
  const actionRow = new ActionRowBuilder();
  actionRow.addComponents(
    new ButtonBuilder().setCustomId(`prom_queue_approve_${memberId}`).setLabel('✅ قبول الكل').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`prom_queue_reject_${memberId}`).setLabel('❌ رفض الكل').setStyle(ButtonStyle.Danger),
  );
  rows.push(actionRow);
  if (allReviewed) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`prom_queue_submit_${memberId}`).setLabel('📨 إرسال الترقيات').setStyle(ButtonStyle.Primary),
    ));
  }

  await msg.edit({ embeds: [embed], components: rows });
}

export async function handlePromotionQueueInteraction(interaction) {
  const { customId, user } = interaction;
  if (!customId.startsWith('prom_queue_')) return;

  // Find queue owned by this user
  let queue = null;
  let queueMsgId = null;
  for (const [msgId, q] of activeQueues) {
    if (q.ownerId === user.id) { queue = q; queueMsgId = msgId; break; }
  }
  if (!queue) return interaction.reply({ content: '❌ انتهت صلاحية الجلسة.', flags: MessageFlags.Ephemeral });
  const ownerId = user.id;

  // Handle select menu
  if (interaction.isStringSelectMenu() && customId.startsWith('prom_queue_select_')) {
    const index = parseInt(interaction.values[0]);
    const item = queue.items[index];
    if (!item) return interaction.reply({ content: '❌ العضو غير موجود.', flags: MessageFlags.Ephemeral });

    const ranks = config.promotion?.ranks || [];
    const currentRank = ranks[(item.m.jobNumber || 1) - 1];
    const nextRank = ranks[item.nextRankIndex];
    const days = getDaysInRank(item.m);
    const embed = embedCustom(0xFFA500, `📋 تفاصيل ${item.gm?.displayName || item.m.discordId}`,
      `${item.gm} — ${currentRank?.name || '?'} ← ${nextRank?.name || '?'}\nالحالة: ${item.status === 'approved' ? '✅ مقبول' : item.status === 'rejected' ? `❌ مرفوض (${item.reason})` : '⏳ بانتظار المراجعة'}`)
      .addFields(
        { name: '📅 الأيام في الرتبة', value: `${days}/${nextRank?.requiredDays || '?'}`, inline: true },
        { name: '⭐ النقاط', value: `${item.m.points || 0}/${nextRank?.requiredPoints || '?'}`, inline: true },
      );

    const row = new ActionRowBuilder();
    if (item.status !== 'approved') {
      row.addComponents(new ButtonBuilder().setCustomId(`prom_queue_item_approve_${ownerId}_${index}`).setLabel('✅ قبول').setStyle(ButtonStyle.Success));
    }
    if (item.status !== 'rejected') {
      row.addComponents(new ButtonBuilder().setCustomId(`prom_queue_item_reject_${ownerId}_${index}`).setLabel('❌ رفض').setStyle(ButtonStyle.Danger));
    }
    const components = row.components.length > 0 ? [row] : [];
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    return;
  }

  // Handle approve all
  if (interaction.isButton() && customId.startsWith('prom_queue_approve_')) {
    await interaction.deferUpdate();
    for (const item of queue.items) {
      if (item.status === 'pending' || item.status === 'rejected') {
        item.status = 'approved';
        item.reason = '';
      }
    }
    await updateQueueMessage(queue);
    return;
  }

  // Handle reject all
  if (interaction.isButton() && customId.startsWith('prom_queue_reject_')) {
    const modal = new ModalBuilder()
      .setCustomId(`prom_queue_reject_all_${ownerId}_${Date.now()}`)
      .setTitle('❌ رفض الكل — السبب العام');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prom_queue_reject_all_reason')
          .setLabel('السبب العام للرفض')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
    await interaction.showModal(modal).catch(() => {});
    return;
  }

  // Handle submit
  if (interaction.isButton() && customId.startsWith('prom_queue_submit_')) {
    await interaction.deferUpdate();
    const approved = queue.items.filter(item => item.status === 'approved');
    const rejected = queue.items.filter(item => item.status === 'rejected');

    if (approved.length === 0) {
      return interaction.followUp({ content: '❌ لا يوجد أعضاء مقبولين للإرسال.', flags: MessageFlags.Ephemeral });
    }

    // Apply promotions (skip individual announcements)
    const applied = [];
    const errors = [];
    for (const item of approved) {
      try {
        const m = await Member.findOne({ discordId: item.m.discordId });
        const gm = await interaction.guild.members.fetch(item.m.discordId).catch(() => null);
        if (!m || !gm) { errors.push(item.m.discordId); continue; }
        await applyPromotion({
          memberData: m, guildMember: gm,
          newRank: item.nextRank, newRankIndex: item.nextRankIndex,
          promoterId: interaction.user.id, promoterName: interaction.user.tag,
          guild: interaction.guild,
          options: { type: 'ترقية (موافقة على طلب)', skipAnnouncement: true }
        });
        applied.push(item);
      } catch (e) {
        console.error(`[Promotion] ${item.m.discordId} error:`, e.message);
        errors.push(item.m.discordId);
      }
    }

    // Send bulk announcement
    if (applied.length > 0) {
      await sendBulkAnnouncement(interaction.guild, applied, interaction.user.tag);
    }

    // Log rejections
    const { logPromotionAction } = await import('../utils/promotionManager.js');
    for (const item of rejected) {
      await logPromotionAction(interaction.guild, 'reject', item.m.discordId, interaction.user.id,
        `السبب: ${item.reason || 'عام'}\nرفض من قائمة الانتظار`);
    }

    // Clean up
    activeQueues.delete(queueMsgId);

    const embed = embedCustom(0x2ECC71, '📨 تم إرسال الترقيات',
      `✅ تمت ترقية **${applied.length}** أعضاء.\n❌ تم رفض **${rejected.length}** أعضاء.${errors.length ? `\n⚠️ فشل **${errors.length}** أعضاء.` : ''}`)
      .addFields(
        { name: '✅ المقبولون', value: applied.map(a => `<@${a.m.discordId}>`).join('\n') || 'لا يوجد', inline: true },
        { name: '❌ المرفوضون', value: rejected.map(r => `<@${r.m.discordId}> — ${r.reason || 'بدون سبب'}`).join('\n') || 'لا يوجد', inline: true },
      );
    await interaction.editReply({ embeds: [embed], components: [] });
    return;
  }

  // Handle individual approve
  if (interaction.isButton() && customId.startsWith('prom_queue_item_approve_')) {
    await interaction.deferUpdate();
    const index = parseInt(parts[5]);
    if (queue.items[index]) {
      queue.items[index].status = 'approved';
      queue.items[index].reason = '';
    }
    await updateQueueMessage(queue);
    return;
  }

  // Handle individual reject (opens modal)
  if (interaction.isButton() && customId.startsWith('prom_queue_item_reject_')) {
    const index = parseInt(parts[5]);
    const modal = new ModalBuilder()
      .setCustomId(`prom_queue_reject_item_${ownerId}_${index}_${Date.now()}`)
      .setTitle('❌ رفض العضو');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prom_queue_reject_item_reason')
          .setLabel('سبب الرفض')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
    await interaction.showModal(modal).catch(() => {});
    return;
  }
}

export async function handlePromotionQueueModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const { customId, user } = interaction;

  // Find queue owned by this user
  let queue = null;
  for (const [, q] of activeQueues) {
    if (q.ownerId === user.id) { queue = q; break; }
  }
  if (!queue) return interaction.reply({ content: '❌ انتهت صلاحية الجلسة.', flags: MessageFlags.Ephemeral });

  // Reject all modal
  if (customId.startsWith('prom_queue_reject_all_')) {
    const reason = interaction.fields.getTextInputValue('prom_queue_reject_all_reason');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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

  // Reject item modal
  if (customId.startsWith('prom_queue_reject_item_')) {
    const index = parseInt(customId.split('_')[6]);
    const reason = interaction.fields.getTextInputValue('prom_queue_reject_item_reason');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (queue.items[index]) {
      queue.items[index].status = 'rejected';
      queue.items[index].reason = reason;
    }
    await updateQueueMessage(queue);
    await interaction.editReply({ content: `✅ تم رفض العضو.` });
    return;
  }
}
