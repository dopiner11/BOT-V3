import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Member from '../models/Member.js';
import PointLog from '../models/PointLog.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { assessMemberStatus } from '../utils/interactionMonitor.js';
import { warning as embedWarning } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logPoints } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

export default {
  data: new SlashCommandBuilder()
    .setName('تصفير_نقاط')
    .setDescription('تصفير نقاط عضو')
    .addUserOption(o => o.setName('العضو').setDescription('العضو المراد تصفيره').setRequired(true))
    .addStringOption(o => o.setName('السبب').setDescription('سبب التصفير').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const targetUser = interaction.options.getUser('العضو');
      const reason = interaction.options.getString('السبب');

      const member = await Member.findOne({ discordId: targetUser.id });
      if (!member) {
        await interaction.editReply('❌ العضو غير مسجل.');
        return;
      }

      const oldPoints = member.points || 0;
      member.points = 0;
      await member.save();
      await assessMemberStatus(interaction.client, interaction.guild, targetUser.id);

      if (oldPoints > 0) {
        await PointLog.create({ discordId: targetUser.id, memberRef: member._id, points: -oldPoints, reason: `تصفير: ${reason}`, actionBy: interaction.user.id });
      }

      await dmUser(targetUser, embedWarning('🧹 تم تصفير نقاطك',
        `لقد تم تصفير نقاط حسابك بالكامل.\n\n**السبب:** ${reason}\n**النقاط التي كانت لديك:** ${oldPoints}`));

      await logPoints(interaction.guild, {
        target: targetUser, mod: interaction.user, points: -oldPoints, reason, newTotal: 0, type: 'zero',
      });

      await interaction.editReply({ content: `✅ تم تصفير نقاط ${targetUser.tag} بنجاح.` });
    } catch (error) {
      console.error(`❌ Error in command:`, error);
      await interaction.editReply({ content: '❌ حدث خطأ أثناء تنفيذ الأمر.' }).catch(() => {});
    }
  }
};