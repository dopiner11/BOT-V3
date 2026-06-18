import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Member from '../models/Member.js';
import Blacklist from '../models/Blacklist.js';
import TicketBlacklist from '../models/TicketBlacklist.js';
import AuctionBlacklist from '../models/AuctionBL.js';
import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';
import Warning from '../models/Warning.js';
import PointLog from '../models/PointLog.js';
import Attendance from '../models/Attendance.js';
import Report from '../models/Report.js';
import { calculateRankProgress } from '../utils/interactionMonitor.js';
import { getDaysInRank } from '../utils/promotionManager.js';
import { error as embedError, info as embedInfo, custom as embedCustom } from '../utils/embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function makeProgressBar(current, max, length = 8) {
  if (!max || max <= 0) return '``❌``';
  const filled = Math.round((current / max) * length);
  const bar = '🟩'.repeat(Math.min(filled, length)) + '⬜'.repeat(Math.max(length - filled, 0));
  return `${bar} ${Math.min(current, max)}/${max}`;
}

function formatDate(date) {
  if (!date) return 'غير محدد';
  return date.toLocaleDateString('ar-SA');
}

function timeAgo(date) {
  if (!date) return 'غير معروف';
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `منذ ${days} يوم`;
  if (hours > 0) return `منذ ${hours} ساعة`;
  return 'منذ أقل من ساعة';
}

export default {
  data: new SlashCommandBuilder()
    .setName('معلومات')
    .setDescription('عرض معلومات عضو كاملة')
    .addUserOption(option =>
      option.setName('العضو')
        .setDescription('العضو المراد عرض معلوماته')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser('العضو');
    const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

    try {
      const [
        member, activeBlacklist, ticketBlacklist, auctionBlacklist,
        activeVacation, activeExcuse,
        activeWarnings, attendance, recentPoints, totalEarned, promoHistory,
        reportCount
      ] = await Promise.all([
        Member.findOne({ discordId: targetUser.id }),
        Blacklist.findOne({ userId: targetUser.id, isActive: true }),
        TicketBlacklist.findOne({ userId: targetUser.id, expiresAt: { $gt: new Date() } }),
        (async () => {
          const ab = await AuctionBlacklist.findOne({ userId: targetUser.id });
          if (!ab) return null;
          if (ab.expiresAt && new Date(ab.expiresAt) <= new Date()) return null;
          return ab;
        })(),
        Vacation.findOne({ memberId: targetUser.id, status: 'active', endDate: { $gte: new Date() } }),
        Excuse.findOne({ memberId: targetUser.id, isActive: true, endDate: { $gte: new Date() } }),
        Warning.find({ memberId: targetUser.id, removed: false }, { createdAt: -1 }, 5),
        Attendance.findOne({ userId: targetUser.id }),
        PointLog.find({ discordId: targetUser.id }, { createdAt: -1 }, 5),
        (async () => {
          const all = await PointLog.find({ discordId: targetUser.id, points: { $gt: 0 } });
          return all.reduce((sum, p) => sum + (p.points || 0), 0);
        })(),
        PointLog.find({ discordId: targetUser.id, reason: /ترقية/i }, { createdAt: -1 }, 2),
        Report ? Report.countDocuments({ reporterId: targetUser.id }) : Promise.resolve(0)
      ]);

      const rankProgress = await calculateRankProgress(targetUser.id).catch(() => null);

      const statusBadges = [];
      if (member?.isActive) statusBadges.push('✅ عضو نشط');
      else if (member) statusBadges.push('⛔ منقطع');
      else statusBadges.push('❌ غير مسجل');
      if (!member?.isActive && member?.firedAt) statusBadges.push('🔥 مفصول');
      if (activeBlacklist) statusBadges.push('🚫 بلاك ليست');
      if (ticketBlacklist) statusBadges.push('🚫 حظر تذاكر');
      if (auctionBlacklist) statusBadges.push('🚫 حظر مزادات');
      if (activeVacation) statusBadges.push('🏖️ إجازة');
      if (activeExcuse) statusBadges.push('📄 عذر');

      const hasPenalties = !!(activeBlacklist || ticketBlacklist || auctionBlacklist || activeVacation || activeExcuse || (member && !member.isActive));

      const badgeStr = statusBadges.join(' | ') || 'لا توجد معلومات';

      function buildMainPage() {
        const embed = embedCustom(member?.isActive ? '#00ff00' : '#ff0000', `📋 معلومات ${targetUser.username}`, badgeStr)
          .setThumbnail(targetUser.displayAvatarURL())
          .setFooter({ text: 'الصفحة 1/3 • 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘𓆪' });

        if (!member) return embed;

        const joinDate = member.joinDate ? new Date(member.joinDate) : null;
        const daysSinceJoin = joinDate ? Math.floor((Date.now() - joinDate) / 86400000) : null;

        embed.addFields(
          { name: '🆔 اللعبة', value: member.gameId || 'غير محدد', inline: true },
          { name: '👤 الاسم', value: member.gameName || 'غير محدد', inline: true },
          { name: '📈 الفل', value: member.level?.toString() || 'غير محدد', inline: true },
          { name: '💼 الرقم الوظيفي', value: member.jobNumber?.toString() || 'غير محدد', inline: true },
          { name: '🏆 النقاط', value: member.points?.toString() || '0', inline: true },
          { name: '🎖️ الرتبة', value: member.currentRank || 'غير محدد', inline: true },
          { name: '📅 تاريخ الانضمام', value: formatDate(joinDate), inline: true },
          { name: '⏳ منذ', value: daysSinceJoin ? `${daysSinceJoin} يوم` : 'غير محدد', inline: true },
          { name: '👤 المُعين', value: member.hiredBy ? `<@${member.hiredBy}>` : 'غير محدد', inline: true }
        );

        const nextRankIndex = config.promotion?.ranks?.findIndex(r => r.name === member.currentRank);
        const nextRank = nextRankIndex !== undefined && nextRankIndex >= 0 && nextRankIndex < config.promotion.ranks.length - 1
          ? config.promotion.ranks[nextRankIndex + 1] : null;

        if (nextRank) {
          const daysProg = makeProgressBar(getDaysInRank(member), nextRank.requiredDays);
          const pointsProg = makeProgressBar(member.points || 0, nextRank.requiredPoints);

          let extraInfo = '';
          if (rankProgress) {
            if (rankProgress.avgDailyPoints) {
              extraInfo += `\n📊 معدلك اليومي: ${rankProgress.avgDailyPoints} نقطة`;
            }
            if (rankProgress.limitingFactor) {
              extraInfo += `\n⏳ العامل المحدد: **${rankProgress.limitingFactor}**`;
            }
            if (rankProgress.streakCount > 0) {
              extraInfo += `\n🔥 Streak: ${rankProgress.streakCount} يوم${rankProgress.multiplier > 1 ? ` (×${rankProgress.multiplier})` : ''}`;
            }
          }

          embed.addFields({
            name: '📈 التقدم للرتبة القادمة',
            value: `**الرتبة القادمة:** ${nextRank.name}\n📅 الأيام: ${daysProg}\n🏆 النقاط: ${pointsProg}${extraInfo}`,
            inline: false
          });
        }

        embed.addFields({
          name: '📋 تفاصيل العضوية',
          value: `**طريقة التوظيف:** ${member.joinMethod || 'غير محدد'}\n**أيام الرتبة:** ${getDaysInRank(member)}\n**إجمالي النقاط المكتسبة:** ${totalEarned}`,
          inline: false
        });

        return embed;
      }

      function buildActivityPage() {
        const embed = embedInfo(`📊 نشاط ${targetUser.username}`, badgeStr)
          .setThumbnail(targetUser.displayAvatarURL())
          .setFooter({ text: 'الصفحة 2/3 • 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘𓆪' });

        const activityTime = member?.lastUserActivity || member?.lastActivity;
        if (activityTime) {
          const lastActive = new Date(activityTime);
          const daysSince = Math.floor((Date.now() - lastActive) / 86400000);
          let activityStatus = '🟢 نشط';
          if (daysSince > 7) activityStatus = '🟡 غير نشط مؤخراً';
          if (daysSince > 14) activityStatus = '🔴 غير نشط';
          if (daysSince > 30) activityStatus = '💀 مهمل';
          embed.addFields({
            name: '⏰ آخر نشاط',
            value: `**الحالة:** ${activityStatus}\n**التاريخ:** ${formatDate(lastActive)}\n**قبل:** ${daysSince} يوم`,
            inline: false
          });
        }

        if (attendance) {
          embed.addFields({
            name: '🎮 ساعات الاحتلال',
            value: `**الجلسات:** ${attendance.totalSessions || 0}\n**الدقائق:** ${attendance.totalMinutes || 0}\n**نقاط الاحتلال:** ${attendance.totalPoints || 0}${attendance.lastLogin ? `\n**آخر دخول:** ${timeAgo(attendance.lastLogin)}` : ''}`,
            inline: false
          });
        }

        if (reportCount > 0 || totalEarned > 0) {
          embed.addFields({
            name: '📊 إحصائيات عامة',
            value: `**التقارير المقدمة:** ${reportCount}\n**إجمالي النقاط المكتسبة:** ${totalEarned}\n**التحذيرات النشطة:** ${activeWarnings?.length || 0}`,
            inline: false
          });
        }

        if (activeWarnings?.length > 0) {
          const warnFields = activeWarnings.map((w, i) =>
            `**#${i + 1}** ${w.typeName || w.warningType || 'تحذير'} — ${w.reason?.substring(0, 40)}`
          ).join('\n');
          embed.addFields({ name: '⚠️ التحذيرات النشطة', value: warnFields, inline: false });
        }

        if (recentPoints?.length > 0) {
          const ptsList = recentPoints.map(p =>
            `**${p.points > 0 ? '+' : ''}${p.points}** — ${p.reason?.substring(0, 30)} (${timeAgo(p.createdAt)})`
          ).join('\n');
          embed.addFields({ name: '🔄 آخر تغييرات النقاط', value: ptsList, inline: false });
        }

        if (promoHistory?.length > 0) {
          const promoList = promoHistory.map(p =>
            `**${p.reason}** (${formatDate(p.createdAt)})`
          ).join('\n');
          embed.addFields({ name: '🎖️ تاريخ الترقيات', value: promoList, inline: false });
        }

        return embed;
      }

      function buildPenaltyPage() {
        const embed = embedError(`⚖️ عقوبات ${targetUser.username}`, badgeStr)
          .setThumbnail(targetUser.displayAvatarURL())
          .setFooter({ text: 'الصفحة 3/3 • 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘𓆪' });

        if (activeBlacklist) {
          let blInfo = `**السبب:** ${activeBlacklist.reason}\n**التصنيف:** ${activeBlacklist.category || 'أخرى'}\n**المدة:** ${activeBlacklist.duration === 0 ? '🚫 دائمة' : `${activeBlacklist.duration} يوم`}\n**تاريخ الإضافة:** ${formatDate(activeBlacklist.createdAt)}`;
          if (activeBlacklist.expiresAt) {
            const remaining = Math.ceil((activeBlacklist.expiresAt - new Date()) / 86400000);
            blInfo += `\n**تاريخ الانتهاء:** ${formatDate(activeBlacklist.expiresAt)}\n**الأيام المتبقية:** ${remaining} يوم`;
          }
          embed.addFields({ name: '🚫 بلاك ليست (تقديم)', value: blInfo, inline: false });
        }

        if (ticketBlacklist) {
          const remaining = Math.ceil((ticketBlacklist.expiresAt - new Date()) / 86400000);
          embed.addFields({
            name: '🚫 حظر تذاكر',
            value: `**السبب:** ${ticketBlacklist.reason}\n**تاريخ الانتهاء:** ${formatDate(ticketBlacklist.expiresAt)}\n**الأيام المتبقية:** ${remaining} يوم`,
            inline: false
          });
        }

        if (auctionBlacklist) {
          let info = `**السبب:** ${auctionBlacklist.reason}\n**بواسطة:** <@${auctionBlacklist.adminId}>`;
          if (auctionBlacklist.expiresAt) {
            const remaining = Math.ceil((auctionBlacklist.expiresAt - new Date()) / 86400000);
            info += `\n**تاريخ الانتهاء:** ${formatDate(auctionBlacklist.expiresAt)}\n**الأيام المتبقية:** ${remaining} يوم`;
          } else {
            info += '\n🚫 دائم';
          }
          embed.addFields({ name: '🚫 حظر مزادات', value: info, inline: false });
        }

        if (activeVacation) {
          const remaining = Math.ceil((activeVacation.endDate - new Date()) / 86400000);
          embed.addFields({
            name: '🏖️ الإجازة',
            value: `**السبب:** ${activeVacation.reason}\n**المدة:** ${activeVacation.days} يوم\n**تاريخ البداية:** ${formatDate(activeVacation.startDate)}\n**تاريخ الانتهاء:** ${formatDate(activeVacation.endDate)}\n**الأيام المتبقية:** ${remaining} يوم`,
            inline: false
          });
        }

        if (activeExcuse) {
          const remaining = Math.ceil((activeExcuse.endDate - new Date()) / 86400000);
          embed.addFields({
            name: '📄 العذر',
            value: `**النوع:** ${activeExcuse.type}\n**السبب:** ${activeExcuse.reason}\n**المدة:** ${activeExcuse.duration} يوم\n**تاريخ الانتهاء:** ${formatDate(activeExcuse.endDate)}\n**الأيام المتبقية:** ${remaining} يوم`,
            inline: false
          });
        }

        if (member && !member.isActive) {
          let reason = '';
          if (member.firedAt) {
            reason = `**🔥 مفصول**\n**التاريخ:** ${formatDate(member.firedAt)}\n**بواسطة:** ${member.firedBy ? `<@${member.firedBy}>` : 'غير معروف'}`;
          } else if (member.leftReason) {
            reason = `**⛔ منقطع**\n**التاريخ:** ${formatDate(member.leftDate)}\n**السبب:** ${member.leftReason}`;
          }
          if (reason) embed.addFields({ name: '❌ حالة العضوية', value: reason, inline: false });
        }

        if (embed.data.fields?.length === 0) {
          embed.setDescription(`${badgeStr}\n\n✅ لا توجد عقوبات نشطة لهذا العضو.`);
        }

        return embed;
      }

      let currentPage = 1;
      const totalPages = hasPenalties ? 3 : 2;

      const pages = [buildMainPage, buildActivityPage];
      if (hasPenalties) pages.push(buildPenaltyPage);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('mp_prev').setLabel('◀ السابق').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('mp_next').setLabel('التالي ▶').setStyle(ButtonStyle.Primary)
      );

      const msg = await interaction.editReply({ embeds: [pages[0]()], components: totalPages > 1 ? [row] : [] });

      if (totalPages <= 1) return;

      const collector = msg.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 120000
      });

      collector.on('collect', async i => {
        if (i.customId === 'mp_prev' && currentPage > 1) currentPage--;
        else if (i.customId === 'mp_next' && currentPage < totalPages) currentPage++;
        else return;

        const prevBtn = new ButtonBuilder().setCustomId('mp_prev').setLabel('◀ السابق').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 1);
        const nextBtn = new ButtonBuilder().setCustomId('mp_next').setLabel('التالي ▶').setStyle(ButtonStyle.Primary).setDisabled(currentPage === totalPages);

        try {
          await i.update({ embeds: [pages[currentPage - 1]()], components: [new ActionRowBuilder().addComponents(prevBtn, nextBtn)] });
        } catch (e) {
          if (e.code !== 10062) console.error('❌ خطأ في تحديث صفحة المعلومات:', e);
        }
      });

      collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => {});
      });

    } catch (error) {
      console.error('❌ خطأ في معلومات العضو:', error);
      await interaction.editReply({ content: '❌ حدث خطأ أثناء جلب معلومات العضو!' });
    }
  },
};
