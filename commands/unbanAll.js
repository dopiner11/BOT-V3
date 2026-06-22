import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unbanAll } from '../utils/antiNukeSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
  data: new SlashCommandBuilder()
    .setName('فك_الباند_الجماعي')
    .setDescription('فك الباند عن جميع الأعضاء الممنوعين من السيرفر'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const bans = await interaction.guild.bans.fetch();
      const totalBans = bans.size;

      if (totalBans === 0) {
        return interaction.editReply('✅ لا يوجد أي عضو محظور في السيرفر.');
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ تأكيد فك الباند الجماعي')
        .setDescription(`هل أنت متأكد من فك الباند عن **${totalBans}** عضو؟`)
        .setColor(0xF39C12)
        .addFields(
          { name: 'عدد الأعضاء', value: `${totalBans}`, inline: true },
          { name: 'بواسطة', value: `${interaction.user.tag}`, inline: true },
        )
        .setTimestamp();

      const confirmId = `confirm_unban_${interaction.user.id}`;
      const cancelId = `cancel_unban_${interaction.user.id}`;

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

      const result = await unbanAll(interaction.guild, interaction.user);

      const resultEmbed = new EmbedBuilder()
        .setTitle(result.unbanned > 0 ? '✅ تم فك الباند الجماعي' : '❌ فشلت العملية')
        .setColor(result.unbanned > 0 ? 0x2ECC71 : 0xE74C3C)
        .addFields(
          { name: 'تم فك الباند', value: `${result.unbanned}`, inline: true },
          { name: 'فشل', value: `${result.failed}`, inline: true },
          { name: 'بواسطة', value: `${interaction.user.tag}`, inline: true },
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [resultEmbed], components: [] });
    } catch (error) {
      console.error('❌ Error in unban all command:', error);
      await interaction.editReply({ content: '❌ حدث خطأ أثناء فك الباند الجماعي.' }).catch(() => {});
    }
  }
};
