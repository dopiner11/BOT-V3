import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getSender } from '../utils/broadcastSender.js';

export default {
  data: new SlashCommandBuilder()
    .setName('انقاذ')
    .setDescription('إرسال رسالة إنقاذ للأعضاء اللي انفك باندهم')
    .addStringOption(option =>
      option.setName('الرسالة')
        .setDescription('محتوى الرسالة اللي تنرسل للجميع')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('المدة')
        .setDescription('خلل كم دقيقة ندور على اللي انفك باندهم (افتراضي 60)')
        .setRequired(false)
        .setMinValue(5)
        .setMaxValue(1440)),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const messageContent = interaction.options.getString('الرسالة');
      const minutes = interaction.options.getInteger('المدة') || 60;
      const since = Date.now() - minutes * 60 * 1000;

      const scanEmbed = new EmbedBuilder()
        .setTitle('🔍 جاري البحث في سجل التدقيق...')
        .setColor(0x3498DB)
        .setTimestamp();

      await interaction.editReply({ embeds: [scanEmbed] });

      const unbannedUsers = [];
      const seen = new Set();
      let lastId = null;
      let hasMore = true;

      while (hasMore) {
        const fetched = await interaction.guild.fetchAuditLogs({
          type: 23,
          limit: 100,
          before: lastId || undefined,
        });

        const entries = [...fetched.entries.values()];
        if (entries.length === 0) break;

        let timeExpired = false;
        for (const entry of entries) {
          lastId = entry.id;
          if (entry.createdTimestamp < since) {
            timeExpired = true;
            break;
          }
          if (entry.action !== 23) continue;
          if (seen.has(entry.targetId)) continue;
          seen.add(entry.targetId);
          try {
            const user = await interaction.client.users.fetch(entry.targetId);
            unbannedUsers.push(user);
          } catch {}
        }

        if (timeExpired || entries.length < 100) hasMore = false;
      }

      if (unbannedUsers.length === 0) {
        return interaction.editReply({
          content: null,
          embeds: [new EmbedBuilder().setTitle('❌ لا يوجد أعضاء').setDescription(`لم يتم العثور على أي أعضاء تم فك باندهم خلال الـ ${minutes} دقيقة الماضية.`).setColor(0xE74C3C).setTimestamp()],
        });
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ تأكيد عملية الإنقاذ')
        .setDescription(`سيتم إرسال رسالة إنقاذ إلى **${unbannedUsers.length}** عضو`)
        .setColor(0xF39C12)
        .addFields(
          { name: 'عدد الأعضاء', value: `${unbannedUsers.length}`, inline: true },
          { name: 'الفترة', value: `آخر ${minutes} دقيقة`, inline: true },
          { name: 'الرسالة', value: messageContent.slice(0, 500), inline: false },
          { name: 'بواسطة', value: interaction.user.tag, inline: true },
        )
        .setTimestamp();

      const confirmId = `rescue_confirm_${interaction.user.id}`;
      const cancelConfirmId = `rescue_cancel_${interaction.user.id}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel('✅ تأكيد').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cancelConfirmId).setLabel('❌ إلغاء').setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

      const collected = await interaction.channel.awaitMessageComponent({
        filter: i => [confirmId, cancelConfirmId].includes(i.customId) && i.user.id === interaction.user.id,
        time: 30000,
      }).catch(() => null);

      if (!collected || collected.customId === cancelConfirmId) {
        const cancelledEmbed = new EmbedBuilder()
          .setTitle('✅ تم إلغاء العملية')
          .setColor(0x95A5A6)
          .setTimestamp();
        return interaction.editReply({ embeds: [cancelledEmbed], components: [] });
      }

      try { await collected.deferUpdate(); } catch {}

      let cancelled = false;
      const cancelSendId = `rescue_stop_${interaction.user.id}`;
      const stopRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cancelSendId).setLabel('⛔ إيقاف الإرسال').setStyle(ButtonStyle.Danger),
      );

      const liveEmbed = new EmbedBuilder()
        .setTitle('🆘 جاري إرسال رسائل الإنقاذ...')
        .setColor(0x3498DB)
        .addFields(
          { name: 'الإجمالي', value: `${unbannedUsers.length}`, inline: true },
          { name: '✅ تم الإرسال', value: '0', inline: true },
          { name: '❌ فشل', value: '0', inline: true },
          { name: 'الحالة', value: '🟢 جاري الإرسال...', inline: false },
        )
        .setTimestamp();

      const statusMsg = await interaction.editReply({ embeds: [liveEmbed], components: [stopRow] });

      const startTime = Date.now();
      let dmsSent = 0;
      let dmsFailed = 0;
      const inviteLink = interaction.guild.vanityURL
        ? `discord.gg/${interaction.guild.vanityURL}`
        : null;

      const sender = getSender() || interaction.client;

      async function updateLiveEmbed() {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const isDone = dmsSent + dmsFailed >= unbannedUsers.length;
        const embed = new EmbedBuilder()
          .setTitle(isDone ? '✅ تمت عملية الإنقاذ' : '🆘 جاري إرسال رسائل الإنقاذ...')
          .setColor(isDone ? 0x2ECC71 : 0x3498DB)
          .addFields(
            { name: 'الإجمالي', value: `${unbannedUsers.length}`, inline: true },
            { name: '✅ تم الإرسال', value: `${dmsSent}`, inline: true },
            { name: '❌ فشل', value: `${dmsFailed}`, inline: true },
            { name: '⏱ الوقت', value: `${elapsed} ثانية`, inline: true },
            { name: 'الحالة', value: cancelled ? '⛔ تم الإيقاف' : (isDone ? '✅ اكتمل' : '🟢 جاري الإرسال...'), inline: false },
          )
          .setTimestamp();
        try {
          await interaction.editReply({ embeds: [embed], components: isDone || cancelled ? [] : [stopRow] });
        } catch {}
      }

      const buttonCollector = statusMsg.createMessageComponentCollector({
        filter: i => i.customId === cancelSendId && i.user.id === interaction.user.id,
        time: 600000,
      });

      buttonCollector.on('collect', async (i) => {
        cancelled = true;
        try { await i.reply({ content: '⛔ تم إيقاف الإرسال.', flags: MessageFlags.Ephemeral }); } catch {}
        await updateLiveEmbed();
        buttonCollector.stop();
      });

      for (let i = 0; i < unbannedUsers.length && !cancelled; i++) {
        const user = unbannedUsers[i];
        try {
          const targetUser = sender.users.cache.get(user.id) || await sender.users.fetch(user.id).catch(() => null);
          if (targetUser) {
            const embed = new EmbedBuilder()
              .setTitle('🆘 تم إنقاذك!')
              .setDescription(messageContent)
              .setColor(0x2ECC71)
              .addFields(
                { name: 'السيرفر', value: interaction.guild.name, inline: true },
                { name: 'بواسطة', value: interaction.user.tag, inline: true },
              )
              .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
              .setTimestamp();
            if (inviteLink) {
              embed.addFields({ name: 'رابط السيرفر', value: inviteLink, inline: false });
            }
            await targetUser.send({ embeds: [embed] });
            dmsSent++;
          } else {
            dmsFailed++;
          }
        } catch {
          dmsFailed++;
        }

        if ((i + 1) % 5 === 0 || cancelled || i + 1 === unbannedUsers.length) {
          await updateLiveEmbed();
        }

        await new Promise(r => setTimeout(r, 1000));
      }

      if (!cancelled) {
        await updateLiveEmbed();
      }
    } catch (error) {
      console.error('❌ Error in rescue command:', error);
      try {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setTitle('❌ حدث خطأ').setDescription(error.message).setColor(0xE74C3C).setTimestamp()],
          components: [],
        });
      } catch {}
    }
  }
};
