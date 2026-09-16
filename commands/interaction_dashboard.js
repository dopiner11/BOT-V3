import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('لوحة-التفاعل')
    .setDescription('📊 فتح لوحة إدارة نظام التفاعل والنقاط والاحتلال'),

  async execute(interaction) {
    const { openInteractionDashboard } = await import('../utils/interactionDashboard.js');
    await openInteractionDashboard(interaction);
  }
};