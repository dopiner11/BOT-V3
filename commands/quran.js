import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('قران')
    .setDescription('🕋 إرسال أو تحديث لوحة التحكم بمشغل القرآن الكريم'),

  async execute(interaction) {
    const { handleQuranInteraction } = await import('../utils/quranPlayer.js');
    await handleQuranInteraction(interaction);
  }
};
