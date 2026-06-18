import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Member from '../models/Member.js';
import PointLog from '../models/PointLog.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { assessMemberStatus } from '../utils/interactionMonitor.js';
import { logPoints } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

export default {
  data: new SlashCommandBuilder()
    .setName('تصفير_النقاط_للجميع')
    .setDescription('⚠️ تصفير نقاط جميع الأعضاء')
    .addStringOption(o => o.setName('تأكيد').setDescription('اكتب: تأكيد').setRequired(true))
    .addStringOption(o => o.setName('السبب').setDescription('السبب').setRequired(true)),

  async execute(interaction) {
    if (interaction.options.getString('تأكيد') !== 'تأكيد') {
      await interaction.reply({ content: '❌ اكتب "تأكيد" حرفياً لتنفيذ الأمر.', flags: MessageFlags.Ephemeral });
      return;
    }

    const reason = interaction.options.getString('السبب');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      try {
        const members = await Member.find({ points: { $gt: 0 } });
        let count = 0;

        for (const m of members) {
          const old = m.points;
          m.points = 0;
          await m.save();
          await PointLog.create({ discordId: m.discordId, memberRef: m._id, points: -old, reason: `تصفير جماعي: ${reason}`, actionBy: interaction.user.id });
          await assessMemberStatus(interaction.client, interaction.guild, m.discordId);
          count++;
        }

        await logPoints(interaction.guild, {
          mod: interaction.user, points: 0, reason, newTotal: 0, type: 'zero_all', count,
        });

        await interaction.editReply(`✅ تم تصفير نقاط **${count}** عضو بنجاح.`);
      } catch (e) {
        await interaction.editReply('❌ حدث خطأ أثناء تنفيذ الأمر.');
      }
    } catch (error) {
      console.error(`❌ Error in command:`, error);
      await interaction.editReply({ content: '❌ حدث خطأ أثناء تنفيذ الأمر.' }).catch(() => {});
    }
  }
};