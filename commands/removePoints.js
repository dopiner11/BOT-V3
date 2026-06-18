import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Member from '../models/Member.js';
import PointLog from '../models/PointLog.js';
import { assessMemberStatus } from '../utils/interactionMonitor.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { error as embedError } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logPoints } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

export default {
  data: new SlashCommandBuilder()
    .setName('تنقيص_نقاط')
    .setDescription('تنقيص نقاط عضو')
    .addUserOption(o => o.setName('العضو').setDescription('العضو المراد خصم نقاطه').setRequired(true))
    .addIntegerOption(o => o.setName('النقاط').setDescription('عدد النقاط').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('السبب').setDescription('سبب الخصم').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const targetUser = interaction.options.getUser('العضو');
      const points = interaction.options.getInteger('النقاط');
      const reason = interaction.options.getString('السبب');

      const member = await Member.findOne({ discordId: targetUser.id });
      if (!member) {
        await interaction.editReply('❌ العضو غير مسجل.');
        return;
      }

      member.points = Math.max(0, (member.points || 0) - points);
      await member.save();
      await assessMemberStatus(interaction.client, interaction.guild, targetUser.id);

      await PointLog.create({ discordId: targetUser.id, memberRef: member._id, points: -points, reason: `خصم: ${reason}`, actionBy: interaction.user.id });

      await dmUser(targetUser, embedError('📉 انخفضت نقاطك',
        `تم خصم **${points}** نقطة من حسابك.\n\n**السبب:** ${reason}\n**الإجمالي الآن:** ${member.points}`));

      await logPoints(interaction.guild, {
        target: targetUser, mod: interaction.user, points: -points, reason, newTotal: member.points, type: 'remove',
      });

      await interaction.editReply({ content: `✅ تم خصم ${points} نقطة من ${targetUser.tag}.` });
    } catch (error) {
      console.error(`❌ Error in command:`, error);
      await interaction.editReply({ content: '❌ حدث خطأ أثناء تنفيذ الأمر.' }).catch(() => {});
    }
  }
};
