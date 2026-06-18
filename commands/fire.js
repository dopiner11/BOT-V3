import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import Member from '../models/Member.js';
import Warning from '../models/Warning.js';
import PointLog from '../models/PointLog.js';
import Attendance from '../models/Attendance.js';
import AttendanceLog from '../models/AttendanceLog.js';
import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';
import Ticket from '../models/Ticket.js';
import Blacklist from '../models/Blacklist.js';
import Nomination from '../models/Nomination.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { warning as embedWarning, error as embedError } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logFire } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

// Utility to safely truncate text for embed fields
function truncate(str = '', max = 1024) {
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

function extractUserIds(input) {
  if (!input || typeof input !== 'string') return [];
  const ids = new Set();
  const mentionPattern = /<@!?(\d{17,20})>/g;
  let match;
  while ((match = mentionPattern.exec(input)) !== null) ids.add(match[1]);
  const allNumbers = input.match(/\d+/g) || [];
  for (const n of allNumbers) if (n.length >= 17 && n.length <= 20) ids.add(n);
  return Array.from(ids).filter(id => /^\d{17,20}$/.test(id));
}

async function removeMemberRoles(discordMember, memberRecord, configRoles) {
  try {
    const rolesToRemove = [];
    if (configRoles?.basic?.id) rolesToRemove.push(configRoles.basic.id);
    if (memberRecord?.jobNumber && configRoles?.jobRoles?.[memberRecord.jobNumber]?.id) rolesToRemove.push(configRoles.jobRoles[memberRecord.jobNumber].id);
    if (memberRecord?.currentRank && Array.isArray(config?.promotion?.ranks)) {
      const rankConfig = config.promotion.ranks.find(r => r.name === memberRecord.currentRank);
      if (rankConfig?.roleId) rolesToRemove.push(rankConfig.roleId);
    }
    const uniqueRoleIds = [...new Set(rolesToRemove.filter(Boolean))];
    const existing = uniqueRoleIds.filter(rid => discordMember.roles.cache.has(rid));
    if (existing.length > 0) await discordMember.roles.remove(existing).catch(() => { });
  } catch (e) { }
}

async function deleteMemberRoom(memberRecord, guild) {
  try {
    const channelId = memberRecord?.roomChannelId;
    if (!channelId) return;
    const roomChannel = await guild.channels.fetch(channelId).catch(() => null);
    if (roomChannel && roomChannel.deletable) await roomChannel.delete().catch(() => { });
  } catch (e) { }
}

// إزالة جميع التحذيرات النشطة للعضو
async function removeMemberWarnings(userId, reason, removedBy, removedByName) {
  try {
    const activeWarnings = await Warning.find({
      memberId: userId,
      removed: false,
      status: 'active'
    });

    if (activeWarnings.length === 0) {
      return { count: 0, warnings: [] };
    }

    const updateResult = await Warning.updateMany(
      { memberId: userId, removed: false, status: 'active' },
      {
        $set: {
          removed: true,
          status: 'fired',
          removedBy: removedBy,
          removedByName: removedByName,
          removedAt: new Date(),
          removalReason: `تم الفصل من العائلة - ${reason}`,
          firedAt: new Date(),
          firedBy: removedBy,
          firedByName: removedByName
        }
      }
    );

    return {
      count: updateResult.modifiedCount || activeWarnings.length,
      warnings: activeWarnings
    };
  } catch (error) {
    console.error(`Error removing warnings for user ${userId}:`, error);
    return { count: 0, warnings: [], error: error.message };
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('فصل')
    .setDescription('فصل عضو أو عدة أعضاء من العائلة')
    .addStringOption(o => o.setName('المعرفات').setDescription('أدخل معرف العضو أو المنشن').setRequired(true))
    .addStringOption(o => o.setName('السبب').setDescription('سبب الفصل').setRequired(true)),

  async execute(interaction) {
    const membersInput = interaction.options.getString('المعرفات');
    const reason = interaction.options.getString('السبب');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const userIds = extractUserIds(membersInput);
    if (!userIds || userIds.length === 0) return interaction.editReply('❌ لم يتم العثور على أي أعضاء صحيحين.');

    const confirmEmbed = embedWarning('⚠️ تأكيد فصل الأعضاء',
        `هل أنت متأكد من فصل **${userIds.length}** عضو/أعضاء؟\n\n**السبب:** ${reason}`);

    const confirmId = `confirm_fire_${interaction.user.id}`;
    const cancelId = `cancel_fire_${interaction.user.id}`;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel('✅ تأكيد').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cancelId).setLabel('❌ إلغاء').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

    const filter = i => [confirmId, cancelId].includes(i.customId) && i.user.id === interaction.user.id;
    const collected = await interaction.channel.awaitMessageComponent({ filter, time: 30000 }).catch(() => null);

    if (!collected || collected.customId === cancelId) {
        return interaction.editReply({ content: '✅ تم إلغاء العملية.', components: [] });
    }

    await collected.deferUpdate();

    const results = { success: [], failed: [], notFound: [] };
    const warningsStats = [];

    for (const userId of userIds) {
      try {
        const memberRecord = await Member.findOne({ discordId: userId });
        if (!memberRecord) { results.notFound.push(userId); continue; }
        if (!memberRecord.isActive) { results.failed.push({ id: userId, error: 'العضو مفصول سابقاً' }); continue; }

        const discordMember = await interaction.guild.members.fetch(userId).catch(() => null);
        const user = await interaction.client.users.fetch(userId).catch(() => null);

        const memberBefore = await Member.findOne({ discordId: userId });
        const oldPoints = memberBefore?.points || 0;
        const oldRank = memberBefore?.currentRank || 'غير معروف';

        // Remove Warnings
        const warningsResult = await removeMemberWarnings(userId, reason, interaction.user.id, interaction.user.tag);
        warningsStats.push({ userId, count: warningsResult.count });

        // كسر الإجازات الفعالة
        const activeVacations = await Vacation.find({ memberId: userId, status: 'active' });
        const vacationsBroken = activeVacations.length;
        if (vacationsBroken > 0) {
          await Vacation.updateMany(
            { memberId: userId, status: 'active' },
            { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: interaction.user.id, cancelledByName: interaction.user.tag, cancellationReason: `فصل: ${reason}` } }
          );
        }

        // إلغاء الأعذار النشطة
        const activeExcuses = await Excuse.find({ memberId: userId, isActive: true });
        const excusesCancelled = activeExcuses.length;
        if (excusesCancelled > 0) {
          await Excuse.updateMany(
            { memberId: userId, isActive: true },
            { $set: { isActive: false, cancelledBy: interaction.user.id, cancelledAt: new Date(), cancellationReason: `فصل: ${reason}` } }
          );
        }

        if (discordMember) {
          await removeMemberRoles(discordMember, memberRecord, config.roles || {});
          await deleteMemberRoom(memberRecord, interaction.guild);
        }

        if (user) {
          let dmDesc = `لقد تم اتخاذ قرار بفصلك من عائلة X.IRAQ.\n\n**السبب:** ${reason}`;
          if (warningsResult.count > 0) dmDesc += `\n\n**📝 تم إزالة ${warningsResult.count} تحذير(ات) من سجلك بسبب الفصل.**`;
          if (vacationsBroken > 0) dmDesc += `\n**🏖️ تم كسر ${vacationsBroken} إجازة.**`;
          if (excusesCancelled > 0) dmDesc += `\n**📋 تم إلغاء ${excusesCancelled} عذر.**`;
          await dmUser(user, embedError('🚫 تم فصلك من العائلة', dmDesc));
        }

        // حذف جلسات الحضور (البيانات التاريخية تبقى للإحصائيات)
        await Promise.all([
          Attendance.deleteMany({ userId }),
          AttendanceLog.deleteMany({ userId }),
          Ticket.deleteMany({ userId }),
          Ticket.deleteMany({ creatorId: userId }),
        ]);

        await Member.findOneAndUpdate({ discordId: userId }, { $set: { lastActiveRank: oldRank, isActive: false, points: 0, currentRank: 'مفصول', firedAt: new Date(), firedBy: interaction.user.id, lastInactiveNoticeAt: null, violatorWarningSentAt: null, _lastInteractionStatus: null } });
        results.success.push({ id: userId, mention: `<@${userId}>`, username: user ? user.username : 'Unknown', oldPoints, oldRank, warningsCount: warningsResult.count, vacationsBroken, excusesCancelled });

      } catch (e) {
        results.failed.push({ id: userId, error: e.message });
      }
    }

    const totalWarningsRemoved = warningsStats.reduce((sum, stat) => sum + stat.count, 0);
    const totalVacationsBroken = results.success.reduce((sum, s) => sum + (s.vacationsBroken || 0), 0);
    const totalExcusesCancelled = results.success.reduce((sum, s) => sum + (s.excusesCancelled || 0), 0);

    // Announcement
    if (results.success.length > 0) {
      const annChannel = interaction.guild.channels.cache.get(config.general?.channels?.announcements?.id || "1391985954075443282");
      if (annChannel) {
        await annChannel.send({ content: 'https://media.discordapp.net/attachments/1391704768660901919/1453017755392671899/934_x_175_.gif' });

        let extraInfo = '';
        if (totalWarningsRemoved > 0) extraInfo += `\n**تم إزالة ${totalWarningsRemoved} تحذير(ات).**`;
        if (totalVacationsBroken > 0) extraInfo += `\n**تم كسر ${totalVacationsBroken} إجازة.**`;
        if (totalExcusesCancelled > 0) extraInfo += `\n**تم إلغاء ${totalExcusesCancelled} عذر.**`;

        const decision = `
**قرار صادر من قيادة 𓆩 <:Family:1516647836744417320> 𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪**

**بعد الاطلاع على ملف العضو وإيقافه عن العمل قررنا الآتي:**

**فصل للمدعو/ين:**
${results.success.map(m => `- ${m.mention}`).join('\n')}

**السبب:** ${truncate(reason, 800)}
${extraInfo}

**امضاء محرر القرار:** ${interaction.user}
**امضاء لجنة العقوبات:** <@&1398212916389478442>

**▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬**`.trim();
        await annChannel.send({ content: decision });
      }
    }

    const resFields = [
      { name: '👤 المسؤول', value: interaction.user.tag, inline: true },
      { name: '📝 السبب', value: truncate(reason, 900), inline: true },
    ];
    const resEmbed = results.success.length ? embedError('🔥 تقرير فصل أعضاء', null, resFields) : embedWarning('🔥 تقرير فصل أعضاء', null, resFields);

    if (results.success.length) {
      const details = results.success.map((s, i) =>
        `**${i + 1}.** ${s.mention}\n┗ الرتبة: ${s.oldRank} | النقاط المحذوفة: ${s.oldPoints} | التحذيرات الملغاة: ${s.warningsCount}${s.vacationsBroken ? ` | إجازات ملغاة: ${s.vacationsBroken}` : ''}${s.excusesCancelled ? ` | أعذار ملغاة: ${s.excusesCancelled}` : ''}`
      ).join('\n');

      const totalPointsRemoved = results.success.reduce((sum, s) => sum + (s.oldPoints || 0), 0);
      const totalWarningsRemoved2 = warningsStats.reduce((sum, s) => sum + s.count, 0);

      resEmbed.addFields(
        { name: `✅ المفصولون (${results.success.length})`, value: details, inline: false },
        {
          name: '📊 ملخص الخسائر',
          value: `**إجمالي النقاط المحذوفة:** ${totalPointsRemoved}\n**إجمالي التحذيرات الملغاة:** ${totalWarningsRemoved2}${totalVacationsBroken ? `\n**الإجازات الملغاة:** ${totalVacationsBroken}` : ''}${totalExcusesCancelled ? `\n**الأعذار الملغاة:** ${totalExcusesCancelled}` : ''}`,
          inline: false
        }
      );
    }
    if (results.notFound.length) {
      resEmbed.addFields({ name: '❓ غير موجودين', value: results.notFound.map(id => `<@${id}>`).join('\n'), inline: false });
    }
    if (results.failed.length) {
      resEmbed.addFields({ name: '❌ فشل', value: results.failed.map(f => `<@${f.id}>: ${f.error}`).join('\n'), inline: false });
    }

    for (const s of results.success) {
      await logFire(interaction.guild, {
        target: { id: s.id }, mod: interaction.user, reason,
        totalWarnings: s.warningsCount, totalPoints: s.oldPoints,
        vacationsBroken: s.vacationsBroken || 0, excusesCancelled: s.excusesCancelled || 0,
      });
    }

    await interaction.editReply({ embeds: [resEmbed] });
  }
};