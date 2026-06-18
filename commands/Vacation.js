import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Vacation from '../models/Vacation.js';
import Member from '../models/Member.js';
import { createGracePeriod } from '../utils/interactionMonitor.js';
import { updateMemberRoomEmoji } from '../utils/roomStatusUpdater.js';
import { updateReportsDashboard } from './reports.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { success as embedSuccess } from '../utils/embedStyles.js';
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
      vacation: ["1388879998739288154"]
    },
    roles: {
      vacation: "",
      ranks: [],
      jobRoles: {}
    },
    channels: {
      logs: null,
      announcements: "1391985954075443282"
    }
  };
}

// Helper: تقليم نص لطول الـ embed
function truncate(str = '', max = 1024) {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

export default {
  data: new SlashCommandBuilder()
    .setName('اجازة')
    .setDescription('منح إجازة لعضو')
    .addUserOption(option =>
      option.setName('الشخص')
        .setDescription('الشخص المراد منحه إجازة')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('السبب')
        .setDescription('سبب الإجازة')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('الايام')
        .setDescription('عدد أيام الإجازة')
        .setRequired(true)
        .setMinValue(1)),

  async execute(interaction) {
    // 1. Defer immediately to prevent 10062
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      console.log('✅ Vacation command executed');

      const DECISION_CHANNEL_ID = config.general?.channels?.announcements?.id || config.logChannels?.vacation?.id || "1388879412581105694";

      const targetUser = interaction.options.getUser('الشخص');
      const reason = interaction.options.getString('السبب');
      const days = interaction.options.getInteger('الايام');


      // التحقق من العضو في DB
      const member = await Member.findOne({ discordId: targetUser.id });

      const existingVacation = await Vacation.findOne({ memberId: targetUser.id, status: 'active' });
      if (existingVacation) {
        return await interaction.editReply({ content: '❌ هذا العضو لديه إجازة فعالة بالفعل!' });
      }

      // حساب التاريخ
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + days);

      // جمع الرتب الحالية
      const previousRoleIds = [];
      const discordMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (discordMember) {
        // نتحقق من جميع الرتب المهمة (Rank + Job Roles)
        if (config.promotion?.ranks && Array.isArray(config.promotion.ranks)) {
          config.promotion.ranks.forEach(r => {
            if (discordMember.roles.cache.has(r.roleId)) previousRoleIds.push(r.roleId);
          });
        }
        if (config.roles?.jobRoles) {
          Object.values(config.roles.jobRoles).forEach(role => {
            if (discordMember.roles.cache.has(role.id)) previousRoleIds.push(role.id);
          });
        }
        // إضافة أي رتب أخرى قد تكون مهمة إذا لزم الأمر، لكن سنكتفي بالموجود في الكونفج
      }

      // إنشاء وحفظ سجل الإجازة
      const vacation = new Vacation({
        memberId: targetUser.id,
        memberName: targetUser.tag,
        reason: reason,
        days: days,
        startDate: startDate,
        endDate: endDate,
        previousRoleIds: previousRoleIds,
        guildId: interaction.guild.id,
        givenBy: interaction.user.id,
        givenByName: interaction.user.tag,
        status: 'active'
      });

      await vacation.save();

      // ✅ تحديث updatedAt للعضو حتى لا يحسب خامل أثناء الإجازة
      const memberRecord = await Member.findOne({ discordId: targetUser.id });
      if (memberRecord) {
        memberRecord.updatedAt = new Date();
        await memberRecord.save();
      }

      // تحديث ايموجي الروم إلى ⚫
      await updateMemberRoomEmoji(interaction.guild, targetUser.id);

      // تحديث لوحة التقارير فوراً
      await updateReportsDashboard(interaction.client, false).catch(e => console.error('فشل تحديث التقرير:', e));

      // سحب الرتب وإعطاء رتبة الإجازة
      if (discordMember) {
        // سحب الرتب المسجلة
        if (previousRoleIds.length > 0) {
          await discordMember.roles.remove(previousRoleIds).catch(err => console.error('Error removing roles:', err));
        }

        // إعطاء رتبة الإجازة
        if (config.roles?.vacation?.id) {
          await discordMember.roles.add(config.roles.vacation.id).catch(err => console.error('Error adding vacation role:', err));
        }
      }

      // إرسال إعلان في قناة الإعلانات
      const announcementChannel = interaction.guild.channels.cache.get(DECISION_CHANNEL_ID);

      if (announcementChannel) {
        // GIF
        await announcementChannel.send({
          content: 'https://media.discordapp.net/attachments/1391704768660901919/1453019015277711442/934_x_175_.gif?ex=697968a9&is=69781729&hm=4a1ecf0c0f3376e6f4eed6cea4987932d7951336dcc7ec713293c83c43c5443b&=&width=400&height=75'
        }).catch(() => null);

        // Decision Text
        const decisionMessage = `** قرار صادر من <@&1398210354860916756> بما هو آتي : **

**أعطاء إجازة خارجية ل:** 

- ${targetUser}

**تبدأ:** ${startDate.toLocaleDateString('ar-SA')}
**تنتهي:** ${endDate.toLocaleDateString('ar-SA')}
**السبب:** ${reason}

-# ملاحظة: في حال مخالفة قوانين الإجازات ستتعرض للعقوبة المناسبة.

**توقيع ✍:**  ${interaction.user}

**توقيع ✍:** <@&1398210354860916756>`;

        await announcementChannel.send({ content: decisionMessage }).catch(() => null);
      }

      await dmUser(targetUser, embedSuccess('🏖️ تم منحك إجازة',
        null,
        [
          { name: 'المدة', value: `${days} يوم`, inline: true },
          { name: 'السبب', value: truncate(reason, 1024), inline: true },
          { name: 'تبدأ من', value: startDate.toLocaleDateString('ar-SA'), inline: true },
          { name: 'تنتهي في', value: endDate.toLocaleDateString('ar-SA'), inline: true },
          { name: 'بواسطة', value: interaction.user.tag, inline: true },
          { name: 'ملاحظة', value: 'سيتم استرجاع رتبك تلقائياً عند انتهاء الإجازة.', inline: false },
        ]));

      await logVacation(interaction.guild, {
        target: targetUser, mod: interaction.user,
        start: startDate.toLocaleDateString('ar-SA'),
        end: endDate.toLocaleDateString('ar-SA'),
        type: 'عادية', status: 'active',
      });

      await interaction.editReply({
        content: `✅ تم منح ${targetUser} إجازة لمدة ${days} يوم بنجاح!`
      });

    } catch (error) {
      console.error('خطأ في منح الإجازة:', error);
      await interaction.editReply({ content: `❌ حدث خطأ: ${error.message}` });
    }
  },
};

/**
 * وظيفة للتحقق الدوري من الإجازات المنتهية
 */
export async function checkExpiredVacations(client) {
  try {
    const Vacation = (await import('../models/Vacation.js')).default; // Dynamic import to be safe
    const now = new Date();
    const expiredList = await Vacation.find({ status: 'active', endDate: { $lte: now } });

    if (!expiredList.length) return;

    console.log(`🔎 Found ${expiredList.length} expired vacations.`);

    const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../config.json'), 'utf8'));

    for (const vac of expiredList) {
      try {
        vac.status = 'expired';
        await vac.save();

        const guild = await client.guilds.fetch(vac.guildId).catch(() => null);
        if (!guild) continue;

        // إنشاء فترة سماح 24 ساعة بعد انتهاء الإجازة
        await createGracePeriod(vac.memberId, 'vacation_ended', guild, client, null).catch(e => console.error('[Vacation]', e?.message));

        const member = await guild.members.fetch(vac.memberId).catch(() => null);

        // إزالة رتبة الإجازة
        if (config.roles?.vacation?.id && member) {
          await member.roles.remove(config.roles.vacation.id).catch(() => { });
        }

        // استرجاع الرتب السابقة
        if (vac.previousRoleIds?.length > 0 && member) {
          await member.roles.add(vac.previousRoleIds).catch(err => console.error(`Error restoring roles for ${vac.memberId}:`, err));
        }

        // تحديث ايموجي الروم بعد انتهاء الإجازة
        await updateMemberRoomEmoji(guild, vac.memberId);

        // إشعار العضو - لم نعد نرسل DM منفصل لأن createGracePeriod ترسل DM بالفعل

        await logVacation(guild, {
          target: { id: vac.memberId }, mod: null,
          start: vac.startDate?.toLocaleDateString('ar-SA'),
          end: vac.endDate?.toLocaleDateString('ar-SA'),
          type: 'انتهاء تلقائي', status: 'expired',
        });

      } catch (err) {
        console.error(`Error processing expired vacation for ${vac.memberId}:`, err);
      }
    }
  } catch (error) {
    console.error('Error in checkExpiredVacations:', error);
  }
}
