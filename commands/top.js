import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildLeaderboardEmbed, buildButtonRows } from '../utils/interactiveLeaderboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
const CHANNEL_ID = config.general?.webhooks?.top?.channelId?.id || '1393640951460921404';

export default {
  data: new SlashCommandBuilder()
    .setName('التوب')
    .setDescription('عرض لوبية أفضل الأعضاء التفاعلية'),

  async execute(interaction) {
    const channel = interaction.client.channels.cache.get(CHANNEL_ID);
    if (!channel) {
      return interaction.reply({ content: `❌ الروم ${CHANNEL_ID} غير موجود`, flags: MessageFlags.Ephemeral });
    }

    const { embed } = await buildLeaderboardEmbed(interaction.guild, 'points', 1);
    await channel.send({ embeds: [embed], components: buildButtonRows('points') });
    await interaction.reply({ content: `✅ تم النشر في <#${CHANNEL_ID}>`, flags: MessageFlags.Ephemeral });
  }
};
