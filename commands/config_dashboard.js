import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('لوحة-البوت')
    .setDescription('⚙️ فتح لوحة إدارة إعدادات البوت'),

  async execute(interaction) {
    const { openConfigDashboard } = await import('../utils/configDashboard.js');
    await openConfigDashboard(interaction);
  }
};