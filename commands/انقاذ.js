import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const messageContent = interaction.options.getString('الرسالة');
      const minutes = interaction.options.getInteger('المدة') || 60;
      const since = Date.now() - minutes * 60 * 1000;

      await interaction.editReply('🔄 جاري البحث في سجل التدقيق...');

      const unbannedUsers = [];
      const seen = new Set();
      let lastId = null;
      let hasMore = true;

      while (hasMore) {
        const fetched = await interaction.guild.fetchAuditLogs({
          type: 23,
          limit: 100,
          before: lastId,
        });

        const entries = [...fetched.entries.values()];
        if (entries.length === 0) break;

        let timeExpired = false;
        for (const entry of entries) {
          if (entry.createdTimestamp < since) { timeExpired = true; break; }
          if (entry.action !== 23) continue;
          if (seen.has(entry.targetId)) continue;
          seen.add(entry.targetId);
          try {
            const user = await interaction.client.users.fetch(entry.targetId);
            unbannedUsers.push(user);
          } catch {}
          lastId = entry.id;
        }

        if (timeExpired || entries.length < 100) hasMore = false;
      }

      if (unbannedUsers.length === 0) {
        return interaction.editReply('❌ لم يتم العثور على أي أعضاء تم فك باندهم خلال الـ ' + minutes + ' دقيقة الماضية.');
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
      const cancelId = `rescue_cancel_${interaction.user.id}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel('✅ تأكيد').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cancelId).setLabel('❌ إلغاء').setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

      const collected = await interaction.channel.awaitMessageComponent({
        filter: i => [confirmId, cancelId].includes(i.customId) && i.user.id === interaction.user.id,
        time: 30000,
      }).catch(() => null);

      if (!collected || collected.customId === cancelId) {
        return interaction.editReply({ content: '✅ تم إلغاء العملية.', components: [], embeds: [] });
      }

      await collected.deferUpdate();

      await interaction.editReply({ content: `🔄 جاري إرسال الرسائل... (0/${unbannedUsers.length})`, components: [], embeds: [] });

      let dmsSent = 0;
      let dmsFailed = 0;
      const inviteLink = interaction.guild.vanityURL
        ? `discord.gg/${interaction.guild.vanityURL}`
        : null;

      const batchSize = 10;
      for (let i = 0; i < unbannedUsers.length; i += batchSize) {
        const batch = unbannedUsers.slice(i, i + batchSize);
        await Promise.allSettled(batch.map(async (user) => {
          try {
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
            await user.send({ embeds: [embed] });
            dmsSent++;
          } catch {
            dmsFailed++;
          }
        }));
        await interaction.editReply({
          content: `🔄 جاري إرسال الرسائل... (${Math.min(i + batchSize, unbannedUsers.length)}/${unbannedUsers.length})`,
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('✅ تمت عملية الإنقاذ بنجاح')
        .setColor(0x2ECC71)
        .addFields(
          { name: 'الأعضاء', value: `${unbannedUsers.length}`, inline: true },
          { name: 'رسائل وصلت', value: `${dmsSent}`, inline: true },
          { name: 'رسائل فشلت', value: `${dmsFailed}`, inline: true },
          { name: 'الفترة', value: `آخر ${minutes} دقيقة`, inline: true },
          { name: 'بواسطة', value: interaction.user.tag, inline: true },
        )
        .setTimestamp();

      await interaction.editReply({ content: null, embeds: [resultEmbed], components: [] });
    } catch (error) {
      console.error('❌ Error in rescue command:', error);
      await interaction.editReply({ content: '❌ حدث خطأ أثناء تنفيذ عملية الإنقاذ.' }).catch(() => {});
    }
  }
};
