import Member from '../models/Member.js';
import PointLog from '../models/PointLog.js';
import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';
import { success as embedSuccess, info as embedInfo } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logHiring } from '../utils/logSystem.js';
import { loadConfig } from '../utils/configLoader.js';

const NOM_GIF = 'https://media.discordapp.net/attachments/1391704768660901919/1453017759565746197/934_x_175_.gif?ex=6979677d&is=697815fd&hm=25cad4a05c4c0a463592f296df1c220c508c3093b37c177bc0b332df019ded5a=&width=1553&height=291';

export async function applyPromotion({ memberData, guildMember, newRank, newRankIndex, promoterId, promoterName, guild, options = {} }) {
  const config = loadConfig();
  const ranks = config.promotion?.ranks || [];
  const oldRank = ranks[(memberData.jobNumber || 1) - 1];
  const oldPoints = memberData.points || 0;
  const oldDays = getDaysInRank(memberData);
  const silent = options.silent || false;

  for (const r of ranks) {
    if (r.roleId && guildMember.roles.cache.has(r.roleId))
      await guildMember.roles.remove(r.roleId).catch(e => console.error('[Promotion] remove rank role:', e?.message));
  }
  if (newRank?.roleId) await guildMember.roles.add(newRank.roleId).catch(e => console.error('[Promotion] add rank role:', e?.message));

  const historyEntry = {
    from: oldRank?.name || 'غير معروف',
    to: newRank?.name || 'غير معروف',
    fromRankIndex: (memberData.jobNumber || 1) - 1,
    toRankIndex: newRankIndex,
    pointsConsumed: oldPoints,
    daysInRank: oldDays,
    promotedBy: promoterId,
    promotedByName: promoterName,
    reason: options.reason || '',
    date: new Date(),
    type: options.type || 'ترقية'
  };

  memberData.points = 0;
  memberData.jobNumber = newRankIndex + 1;
  memberData.currentRank = newRank?.name || `رتبة ${newRankIndex + 1}`;
  memberData.lastPromotionDate = new Date();
  if (!memberData.promotionHistory) memberData.promotionHistory = [];
  memberData.promotionHistory.push(historyEntry);
  await memberData.save();

  if (oldPoints > 0) {
    await PointLog.create({
      discordId: memberData.discordId,
      memberRef: memberData._id,
      points: -oldPoints,
      reason: `${options.type || 'ترقية'} إلى ${newRank?.name || 'رتبة جديدة'}`,
      actionBy: promoterId
    });
  }

  const promoRoleId = config.committees?.list?.promotion?.roles?.member?.[0]
    || config.committees?.list?.promotion?.roles?.deputy?.[0]
    || config.committees?.list?.promotion?.roles?.manager?.[0]
    || '1421916208357310554';
  const presRoleId = config.committees?.list?.family_presidency?.roles?.member?.[0]
    || '1451612325927714927';

  if (!options.skipAnnouncement) {
    const decChannelId = config.general?.channels?.announcements?.id || '1391985954075443282';
    const decChannel = guild.channels.cache.get(decChannelId) || await guild.channels.fetch(decChannelId).catch(() => null);
    if (decChannel) {
      await decChannel.send({ content: NOM_GIF }).catch(e => console.error('[Promotion]', e?.message));
      const announcementText = options.announcementText || `**▬▬▬▬▬▬▬▬ ﷽ ▬▬▬▬▬▬▬▬**
 
**وقرار اخر صادر من  <@&${presRoleId}>   و اللجنة المسؤولة <@&${promoRoleId}> عن شؤون الاعضاء داخل العائلة بعد المراجعه و النظر لـ التفاعل الاستثنائي  وبعد المراجعه و التدقيق و تعديل بعض البيانات قررنا التالي : **
 
### تقرر اعطاء ترقية لكل من المذكور أدناه : 
 
- <@${memberData.discordId}>
   
 
> **بترقية العضاء المذكورين  أعلاه لـ  :  <@&${newRank?.roleId}>     **
 
> **وتسليمه المسؤوليات التالية : ${newRank?.responsibilities || 'لا توجد مسؤوليات إضافية'}  **
 
## نتمنى لكم الاستمرار في تميزكم فى عملكم.
 
-# يمكنك تقديم تظلم من خلال <#1388879337171980420> 
 
-** إمــضــاء و تــوقــيــع ✍️ **:   <@&${promoRoleId}>  
-** إمــضــاء و تــوقــيــع محرر القرار ✍️ **:   ${promoterName}
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`;
      await decChannel.send({ content: announcementText });
    }
  }

  if (!silent) {
    await dmUser(guildMember, embedSuccess('🎉 مبروك الترقية!',
      `تمت ترقيتك إلى **${newRank?.name}**.\n\nاستمر في العمل الجاد! 💪`));
  }

  await logHiring(guild, {
    target: guildMember, mod: { id: promoterId, tag: promoterName },
    role: newRank?.name || 'رتبة جديدة',
    details: `${oldRank?.name || 'غير معروف'} → ${newRank?.name || 'غير معروف'} | نقاط: ${oldPoints} | أيام: ${oldDays}`,
  });
  await logPromotionAction(guild, 'promote', memberData.discordId, promoterId,
    `${oldRank?.name || 'غير معروف'} → ${newRank?.name || 'غير معروف'} | النقاط: ${oldPoints} | الأيام: ${oldDays}`);
}

export async function sendBulkAnnouncement(guild, approvedList, promoterName) {
  const config = loadConfig();
  const ranks = config.promotion?.ranks || [];
  const promoRoleId = config.committees?.list?.promotion?.roles?.member?.[0]
    || config.committees?.list?.promotion?.roles?.deputy?.[0]
    || config.committees?.list?.promotion?.roles?.manager?.[0]
    || '1421916208357310554';
  const presRoleId = config.committees?.list?.family_presidency?.roles?.member?.[0]
    || '1451612325927714927';
  const decChannelId = config.general?.channels?.announcements?.id || '1391985954075443282';
  const decChannel = guild.channels.cache.get(decChannelId) || await guild.channels.fetch(decChannelId).catch(() => null);
  if (!decChannel) return;

  const grouped = {};
  for (const item of approvedList) {
    const rankName = item.nextRank?.name || 'رتبة جديدة';
    if (!grouped[rankName]) grouped[rankName] = [];
    grouped[rankName].push(item.m.discordId);
  }

  const membersList = approvedList.map(item => `- <@${item.m.discordId}>`).join('\n');
  const rolesList = Object.entries(grouped)
    .map(([name, ids]) => `**${name}:** ${ids.map(id => `<@${id}>`).join(' - ')}`).join('\n');

  await decChannel.send({ content: NOM_GIF }).catch(e => console.error('[Promotion]', e?.message));
  await decChannel.send({ content: `**▬▬▬▬▬▬▬▬ ﷽ ▬▬▬▬▬▬▬▬**
 
**وقرار اخر صادر من  <@&${presRoleId}>   و اللجنة المسؤولة <@&${promoRoleId}> عن شؤون الاعضاء داخل العائلة بعد المراجعه و النظر لـ التفاعل الاستثنائي  وبعد المراجعه و التدقيق و تعديل بعض البيانات قررنا التالي : **
 
### تقرر اعطاء ترقية لكل من المذكورين أدناه :
 
${membersList}
 
> **بترقية الاعضاء المذكورين أعلاه لـ :**
${rolesList}
 
## نتمنى لكم الاستمرار في تميزكم فى عملكم.
 
-# يمكنك تقديم تظلم من خلال <#1388879337171980420> 
 
-** إمــضــاء و تــوقــيــع ✍️ **:   <@&${promoRoleId}>  
-** إمــضــاء و تــوقــيــع محرر القرار ✍️ **:   ${promoterName}
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬` });
}

export async function logPromotionAction(guild, action, memberId, promoterId, details) {
  const config = loadConfig();
  const logChannelId = config.logChannels?.promotion?.id;
  if (!logChannelId) return;
  const channel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!channel) return;
  const colors = { promote: 0x2ECC71, reject: 0xE74C3C, nominate: 0x3498DB, exceptional: 0xF1C40F };
  const embed = new (await import('discord.js')).EmbedBuilder()
    .setColor(colors[action] || 0x95A5A6)
    .setTitle({ promote: '✅ ترقية', reject: '❌ رفض', nominate: '🗳️ ترشيح', exceptional: '⭐ ترقية استثنائية' }[action] || action)
    .addFields(
      { name: '👤 العضو', value: `<@${memberId}>`, inline: true },
      { name: '👮 منفذ الإجراء', value: `<@${promoterId}>`, inline: true },
      { name: '📋 التفاصيل', value: details, inline: false },
      { name: '📅 التاريخ', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
    )
    .setTimestamp()
    .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });
  await channel.send({ embeds: [embed] }).catch(e => console.error('[Promotion] audit log:', e?.message));
}

export function getDaysInRank(memberData, excludeVacationMs = 0) {
  if (!memberData?.lastPromotionDate) return 0;
  const totalMs = Date.now() - new Date(memberData.lastPromotionDate).getTime() - excludeVacationMs;
  return Math.max(0, Math.floor(totalMs / 86400000));
}

export async function isOnLeave(discordId) {
  try {
    const now = new Date();
    const [vacations, excuses] = await Promise.all([
      Vacation.find({ memberId: discordId, status: 'active', endDate: { $gte: now } }),
      Excuse.find({ memberId: discordId, isActive: { $ne: false }, type: { $ne: 'تغير اسم' }, endDate: { $gte: now } })
    ]);
    return vacations.length > 0 || excuses.length > 0;
  } catch { return false; }
}

export async function getVacationMsSince(discordId, sinceDate) {
  try {
    const vacations = await Vacation.find({
      memberId: discordId, status: 'active',
      startDate: { $gte: sinceDate }
    });
    let totalMs = 0;
    for (const v of vacations) {
      const start = new Date(v.startDate).getTime();
      const end = new Date(v.endDate).getTime();
      totalMs += Math.max(0, end - start);
    }
    return totalMs;
  } catch { return 0; }
}
