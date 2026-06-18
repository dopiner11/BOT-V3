import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Excuse from '../models/Excuse.js';
import { createGracePeriod } from '../utils/interactionMonitor.js';
import { updateMemberRoomEmoji } from '../utils/roomStatusUpdater.js';
import { error as embedError } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logVacation } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
  } catch {
    return {};
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('كسر_عذر')
    .setDescription('إلغاء عذر لعضو')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو المراد إلغاء عذره')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('السبب')
        .setDescription('سبب إلغاء العذر')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = loadConfig();

    const targetUser = interaction.options.getUser('العضو');
    const reason = interaction.options.getString('السبب');

    try {
      // البحث عن عذر نشط
      const excuse = await Excuse.findOne({
        memberId: targetUser.id,
        isActive: true
      });

      if (!excuse) {
        return interaction.editReply({
          content: `❌ ${targetUser} ليس لديه عذر نشط`
        });
      }

      // إزالة الرتبة إذا كان نوع العذر "زيادة لفل" أو "تغير اسم"
      if (excuse.type === 'زيادة لفل' || excuse.type === 'تغير اسم') {
        const roleId = config.general?.excuseRoles?.[excuse.type];
        if (roleId) {
          try {
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (member && member.roles.cache.has(roleId)) {
              await member.roles.remove(roleId, `كسر عذر: ${excuse.type} - ${reason}`);
            }
          } catch (error) {
            console.error(`❌ خطأ في إزالة الرتبة من ${targetUser.tag}:`, error);
          }
        }
      }

      // تحديث العذر
      excuse.isActive = false;
      excuse.cancelledBy = interaction.user.id;
      excuse.cancelledAt = new Date();
      excuse.cancellationReason = reason;
      await excuse.save();

      // إنشاء فترة سماح 24 ساعة بعد كسر العذر (إلا إذا كان النوع "زيادة لفل") - قبل تحديث الروم
      if (excuse.type !== 'زيادة لفل') {
        await createGracePeriod(targetUser.id, 'excuse_broken', interaction.guild, interaction.client, {
          reason,
          by: interaction.user.tag,
          type: excuse.type
        });
      }

      // تحديث ايموجي الروم بعد إلغاء العذر
      await updateMemberRoomEmoji(interaction.guild, targetUser.id);

      await dmUser(targetUser, embedError('❌ تم إلغاء عذرك',
        `**سبب الإلغاء:** ${reason}\n**بواسطة:** ${interaction.user.tag}\n**نوع العذر الملغي:** ${excuse.type}`));

      await logVacation(interaction.guild, {
        target: targetUser, mod: interaction.user,
        start: excuse.startDate?.toLocaleDateString('ar-SA'),
        end: excuse.endDate?.toLocaleDateString('ar-SA'),
        type: `عذر: ${excuse.type}`, status: 'cancelled',
      });

      await interaction.editReply({
        content: `✅ تم إلغاء عذر ${targetUser} بنجاح.`
      });
    } catch (error) {
      console.error('❌ خطأ في إلغاء العذر:', error);
      await interaction.editReply({ content: '❌ حدث خطأ أثناء إلغاء العذر!' });
    }
  }
};