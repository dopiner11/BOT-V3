import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { schedule } from 'node-cron';
import Excuse from '../models/Excuse.js';
import Member from '../models/Member.js';
import { updateMemberRoomEmoji } from '../utils/roomStatusUpdater.js';
import { dmUser } from '../utils/notificationSystem.js';
import { info as embedInfo } from '../utils/embedStyles.js';
import { logVacation } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// قراءة إعدادات البوت (يتم قراءتها مرة واحدة أو عند الحاجة، هنا سنقرأها عند الحاجة داخل التفاعل لضمان التحديث، أو بشكل عام)
function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
  } catch {
    return {};
  }
}

// دالة الإرسال اليومي
async function sendDailyExcuseNotifications(client) {
  try {
    const config = loadConfig();
    const excuses = await Excuse.find({ isActive: true });
    const now = new Date();

    for (const excuse of excuses) {
      try {
        const remainingDays = Math.ceil((excuse.endDate - now) / (1000 * 60 * 60 * 24));

        // إذا كان السبب "منع اجرام" أو "اسباب اخرى" لا نرسل تذكير يومي
        if (excuse.type === 'منع اجرام' || excuse.type === 'اسباب اخرى') {
          continue;
        }

        const user = await client.users.fetch(excuse.memberId).catch(() => null);
        if (!user) continue;

        // إرسال التذكير اليومي (فقط للأعذار النشطة التي لم تنتهِ)
        if (remainingDays > 0) {
          try {
            await user.send({
              content: `📅 **تذكير يومي بالعذر**\n\n**نوع العذر:** ${excuse.type}\n**السبب:** ${excuse.reason}\n**الأيام المتبقية:** ${remainingDays} يوم\n**تاريخ الانتهاء:** ${excuse.endDate.toLocaleDateString('ar-SA')}\n\n✅ ستبقى نقاطك محفوظة خلال فترة العذر.`
            });
          } catch (sendError) { }

          // تسجيل في اللوغ (آخر 4 أيام)
          const logChannel = client.channels.cache.get(config.general?.channels?.logChannel?.id);
          if (logChannel && remainingDays <= 4 && remainingDays > 0) {
          }
        }

        excuse.lastNotified = new Date();
        await excuse.save();

      } catch (error) {
        console.log(`❌ خطأ في معالجة عذر لـ ${excuse.memberId}:`, error);
      }
    }
  } catch (error) {
    console.error('❌ خطأ في الإرسال اليومي:', error);
  }
}

// جدولة الإرسال اليومي
export function startExcuseNotifications(client) {
  // تشغيل كل يوم عند الساعة 8 صباحاً
  schedule('0 8 * * *', () => {
    sendDailyExcuseNotifications(client);
  });
  console.log('⏰ تم جدولة الإرسال اليومي للأعذار');
}

export default {
  data: new SlashCommandBuilder()
    .setName('اعذار')
    .setDescription('إضافة عذر لعضو')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو المراد إضافة عذر له')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('النوع')
        .setDescription('نوع العذر')
        .setRequired(true)
        .addChoices(
          { name: 'زيادة لفل', value: 'زيادة لفل' },
          { name: 'تغير اسم', value: 'تغير اسم' },
          { name: 'منع اجرام', value: 'منع اجرام' },
          { name: 'اسباب اخرى', value: 'اسباب اخرى' }
        ))
    .addStringOption(option =>
      option.setName('السبب')
        .setDescription('سبب العذر')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('المدة')
        .setDescription('مدة العذر بالأيام')
        .setRequired(true)
        .setMinValue(1)),

  async execute(interaction) {
    const config = loadConfig();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser('العضو');
    const type = interaction.options.getString('النوع');
    const reason = interaction.options.getString('السبب');
    const duration = interaction.options.getInteger('المدة');

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + duration);

    try {
      const existingExcuse = await Excuse.findOne({
        memberId: targetUser.id,
        isActive: true
      });

      if (existingExcuse) {
        return interaction.editReply({
          content: `❌ ${targetUser} لديه عذر نشط بالفعل حتى ${existingExcuse.endDate.toLocaleDateString('ar-SA')}`
        });
      }

      const excuse = new Excuse({
        memberId: targetUser.id,
        type,
        reason,
        duration,
        endDate,
        isActive: true
      });
      await excuse.save();

      // ✅ تحديث updatedAt للعضو إذا كان العذر من النوع المحمي (أي عدا "تغير اسم")
      if (type !== 'تغير اسم') {
        const memberRecord = await Member.findOne({ discordId: targetUser.id });
        if (memberRecord) {
          memberRecord.updatedAt = new Date();
          await memberRecord.save();
        }
        // تحديث ايموجي الروم إلى ⚫
        await updateMemberRoomEmoji(interaction.guild, targetUser.id);
      }

      // إعطاء الرتبة إذا كان السبب "زيادة لفل" أو "تغير اسم"
      if (type === 'زيادة لفل' || type === 'تغير اسم') {
        const roleId = config.general?.excuseRoles?.[type];
        if (roleId) {
          try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            await member.roles.add(roleId, `عذر: ${type} - ${reason}`);
          } catch (error) {
            console.error(`❌ خطأ في إعطاء الرتبة لـ ${targetUser.tag}:`, error);
          }
        }
      }

      await dmUser(targetUser, embedInfo('📋 تم إضافة عذر لك',
        `**النوع:** ${type}\n**السبب:** ${reason}\n**المدة:** ${duration} يوم\n**تاريخ الانتهاء:** ${endDate.toLocaleDateString('ar-SA')}`));

      // إعلان القرار
      const DECISION_CHANNEL_ID = config.general?.channels?.announcements?.id || config.logChannels?.vacation?.id || "1388879412581105694";
      const announcementChannel = interaction.guild.channels.cache.get(DECISION_CHANNEL_ID);

      if (announcementChannel) {
        // GIF
        await announcementChannel.send({
          content: 'https://media.discordapp.net/attachments/1391704768660901919/1453019015277711442/934_x_175_.gif?ex=697968a9&is=69781729&hm=4a1ecf0c0f3376e6f4eed6cea4987932d7951336dcc7ec713293c83c43c5443b&=&width=400&height=75'
        }).catch(() => null);

        // Decision Text
        const decisionMessage = `** قرار صادر من <@&1398210354860916756> بما هو آتي : **

**أعطاء عذر (${type}) ل كلا من :** 
- ${targetUser}

**تبدأ:** ${new Date().toLocaleDateString('ar-SA')}
**تنتهي:** ${endDate.toLocaleDateString('ar-SA')}
**السبب:** ${reason}

**توقيع ✍:** ${interaction.user}
**توقيع ✍:** <@&1398210354860916756>`;

        await announcementChannel.send({ content: decisionMessage }).catch(() => null);
      }

      await logVacation(interaction.guild, {
        target: targetUser, mod: interaction.user,
        start: new Date().toLocaleDateString('ar-SA'),
        end: endDate.toLocaleDateString('ar-SA'),
        type: `عذر: ${type}`, status: 'active',
      });

      await interaction.editReply({
        content: `✅ تم إضافة عذر لـ ${targetUser} لمدة ${duration} يوم.\n${type === 'زيادة لفل' || type === 'تغير اسم' ? 'تم إعطاء الرتبة المحددة للعضو.' : ''}`
      });

    } catch (error) {
      console.error('❌ خطأ في حفظ العذر:', error);
      await interaction.editReply({ content: '❌ حدث خطأ أثناء إضافة العذر!' });
    }
  }
};