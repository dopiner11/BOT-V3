import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handleChallengeAdmin } from '../utils/dailyChallenge.js';

export default {
  data: new SlashCommandBuilder()
    .setName('تحديات')
    .setDescription('🎛️ لوحة تحكم التحديات اليومية'),

  async execute(interaction) {
    await handleChallengeAdmin(interaction);
  }
};
