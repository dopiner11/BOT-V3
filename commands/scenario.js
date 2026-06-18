import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { handlePanelCommand } from '../utils/scenarioManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('سيناريوهات')
    .setDescription('لوحة تحكم السيناريوهات'),
  async execute(interaction) {
    return handlePanelCommand(interaction);
  }
};
