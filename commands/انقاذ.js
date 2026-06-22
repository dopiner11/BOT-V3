import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unbanAll } from '../utils/antiNukeSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
  data: new SlashCommandBuilder()
    .setName('انقاذ')
    .setDescription('فك الباند عن الكل وإرسال رسالة إنقاذ للجميع')
    .addStringOption(option =>
      option.setName('الرسالة')
        .setDescription('محتوى الرسالة اللي تنرسل للجميع')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const messageContent = interaction.options.getString('الرسالة');
      const bans = await interaction.guild.bans.fetch();
      const totalBans = bans.size;

      if (totalBans === 0) {
        return interaction.editReply('✅ لا يوجد أي عضو محظور في السيرفر.');
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ تأكيد عملية الإنقاذ')
        .setDescription(`هل أنت متأكد من فك الباند عن **${totalBans}** عضو وإرسال رسالة إنقاذ للجميع؟`)
        .setColor(0xF39C12)
        .addFields(
          { name: 'عدد الأعضاء', value: `${totalBans}`, inline: true },
          { name: 'الرسالة', value: messageContent.slice(0, 500), inline: false },
          { name: 'بواسطة', value: `${interaction.user.tag}`, inline: true },
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

      await interaction.editReply({ content: `🔄 جاري فك الباند وإرسال الرسائل... (0/${totalBans})`, components: [], embeds: [] });

      let unbanned = 0;
      let dmsSent = 0;
      let dmsFailed = 0;
      let failed = 0;
      const inviteLink = interaction.guild.vanityURL
        ? `discord.gg/${interaction.guild.vanityURL}`
        : null;

      try {
        for (const ban of bans.values()) {
          try {
            await interaction.guild.bans.remove(ban.user.id, `عملية إنقاذ بواسطة ${interaction.user.tag}`);
            unbanned++;
          } catch {
            failed++;
            continue;
          }

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

            await ban.user.send({ embeds: [embed] }).catch(() => {});
            dmsSent++;
          } catch {
            dmsFailed++;
          }

          if ((unbanned + failed) % 10 === 0) {
            await interaction.editReply({
              content: `🔄 جاري فك الباند وإرسال الرسائل... (${unbanned + failed}/${totalBans})`,
            }).catch(() => {});
          }

          await new Promise(r => setTimeout(r, 3000));
        }
      } catch {}

      const resultEmbed = new EmbedBuilder()
        .setTitle('✅ تمت عملية الإنقاذ بنجاح')
        .setColor(0x2ECC71)
        .addFields(
          { name: 'تم فك الباند', value: `${unbanned}`, inline: true },
          { name: 'فشل فك الباند', value: `${failed}`, inline: true },
          { name: 'رسائل وصلت', value: `${dmsSent}`, inline: true },
          { name: 'رسائل فشلت', value: `${dmsFailed}`, inline: true },
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
