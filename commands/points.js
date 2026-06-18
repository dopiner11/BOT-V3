import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Member from '../models/Member.js';
import { custom as embedCustom } from '../utils/embedStyles.js';

export default {
  data: new SlashCommandBuilder()
    .setName('نقاط')
    .setDescription('عرض نقاط عضو')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو المراد عرض نقاطه (اختياري)')
        .setRequired(false)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('العضو') || interaction.user;

    try {
      const member = await Member.findOne({ discordId: targetUser.id });

      if (!member) {
        return interaction.reply({
          content: '❌ هذا العضو غير مسجل في النظام!',
          flags: MessageFlags.Ephemeral
        });
      }

      const embed = embedCustom(0x00FF00, `📊 نقاط ${targetUser.username}`)
        .addFields(
          { name: '🏆 النقاط الحالية', value: member.points.toString(), inline: true },
          { name: '🎖️ الرتبة الحالية', value: member.currentRank, inline: true },
          { name: '📅 تاريخ الانضمام', value: member.joinDate ? member.joinDate.toLocaleDateString('ar-SA') : 'غير متوفر', inline: true }
        )
        .setThumbnail(targetUser.displayAvatarURL());

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });

    } catch (error) {
      console.error('Error fetching points:', error);
      await interaction.reply({
        content: '❌ حدث خطأ أثناء جلب النقاط!',
        flags: MessageFlags.Ephemeral
      });
    }
  },
};
