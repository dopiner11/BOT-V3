import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Vacation from '../models/Vacation.js';
import { createGracePeriod } from '../utils/interactionMonitor.js';
import { updateMemberRoomEmoji } from '../utils/roomStatusUpdater.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { error as embedError } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logVacation } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let config;
try {
  config = JSON.parse(
    readFileSync(join(__dirname, '../config.json'), 'utf8')
  );
} catch (error) {
  console.error('Error reading config:', error);
  config = {
    permissions: {
      breakVacation: ["1388879998739288154"]
    },
    roles: {
      vacation: "",
    },
    channels: {
      logs: null,
      announcements: "1394234230812184586"
    }
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName('كسر-اجازة')
    .setDescription('كسر إجازة عضو وإنهائها قبل الوقت المحدد')
    .addUserOption(option =>
      option.setName('الشخص')
        .setDescription('الشخص المراد كسر إجازته')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('السبب')
        .setDescription('سبب كسر الإجازة')
        .setRequired(true)),

  async execute(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options.getUser('الشخص');
      const reason = interaction.options.getString('السبب');

      // البحث عن إجازة العضو الفعالة
      const vacation = await Vacation.findOne({
        memberId: targetUser.id,
        status: 'active'
      });

      if (!vacation) {
        return await interaction.editReply({
          content: '❌ هذا العضو ليس لديه إجازة فعالة!'
        });
      }

      // تحديث حالة الإجازة
      vacation.status = 'cancelled';
      vacation.cancelledAt = new Date();
      vacation.cancelledBy = interaction.user.id;
      vacation.cancelledByName = interaction.user.tag;
      vacation.cancellationReason = reason;
      await vacation.save();

      // إعادة الرتب للعضو
      const discordMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (discordMember) {
        // إزالة رتبة الإجازة
        if (config.roles?.vacation?.id) {
          await discordMember.roles.remove(config.roles?.vacation?.id).catch(err => console.error('Error removing vacation role:', err));
        }

        // استرجاع الرتب السابقة
        if (vacation.previousRoleIds && vacation.previousRoleIds.length > 0) {
          await discordMember.roles.add(vacation.previousRoleIds).catch(err => console.error('Error restoring roles:', err));
        }
      }

      // إنشاء فترة سماح 24 ساعة بعد كسر الإجازة (قبل تحديث الروم عشان الروم يعكس السماح)
      await createGracePeriod(targetUser.id, 'vacation_broken', interaction.guild, interaction.client, {
        reason,
        by: interaction.user.tag
      });

      // تحديث ايموجي الروم بعد كسر الإجازة
      await updateMemberRoomEmoji(interaction.guild, targetUser.id);

      await dmUser(targetUser, embedError('🚫 تم كسر إجازتك',
        null,
        [
          { name: 'السبب', value: reason, inline: true },
          { name: 'بواسطة', value: interaction.user.tag, inline: true },
          { name: 'تاريخ الإلغاء', value: new Date().toLocaleDateString('ar-SA'), inline: true },
          { name: 'تمت إعادة الرتب', value: '✅ تم إعادة رتبك الأصلية', inline: false },
        ]));

      await logVacation(interaction.guild, {
        target: targetUser, mod: interaction.user,
        start: vacation.startDate?.toLocaleDateString('ar-SA'),
        end: vacation.endDate?.toLocaleDateString('ar-SA'),
        type: 'عادية', status: 'cancelled',
      });

      await interaction.editReply({
        content: `✅ تم كسر إجازة ${targetUser} واسترجاع رتبه.`
      });

    } catch (error) {
      console.error('خطأ في كسر الإجازة:', error);
      await interaction.editReply({ content: `❌ حدث خطأ: ${error.message}` });
    }
  },
};