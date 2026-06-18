import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { updateAttendancePanel } from '../utils/attendanceHandler.js';
export default {
  data: new SlashCommandBuilder()
    .setName('حضور')
    .setDescription('📋 إرسال لوحة تسجيل ساعات الاحتلال'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await updateAttendancePanel(interaction.guild);

    await interaction.editReply({ content: '✅ تم إرسال لوحة ساعات الاحتلال.' });
  }
};
