import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import Member from '../models/Member.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
}

export default {
  data: new SlashCommandBuilder()
    .setName('استعادة_العائلة')
    .setDescription('فحص رتب ورومات أعضاء العائلة واستعادتها لمن يفتقدها')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const config = loadConfig();
      const guild = interaction.guild;

      // 1. جلب قائمة المتبندين من السيرفر
      const bans = await guild.bans.fetch().catch(() => new Map());

      // 2. جلب الأعضاء المسجلين والنشطين في قاعدة البيانات
      const dbMembers = await Member.find({ isActive: true });
      if (dbMembers.length === 0) {
        return interaction.editReply('❌ لا يوجد أعضاء نشطين مسجلين في قاعدة البيانات.');
      }

      await interaction.editReply(`🔄 تم العثور على **${dbMembers.length}** عضو في قاعدة البيانات. جاري فحص الرتب والرومات وتعديل النواقص...`);

      let unbannedCount = 0;
      let roomsCreated = 0;
      let rolesRestored = 0;
      let nicknamesRestored = 0;
      const detailsList = [];

      for (const memberRec of dbMembers) {
        try {
          // أ. فحص إذا كان العضو محظوراً (Banned) في السيرفر
          if (bans.has(memberRec.discordId)) {
            await guild.bans.remove(memberRec.discordId, 'استعادة تلقائية لعضو العائلة').catch(() => {});
            unbannedCount++;
          }

          // ب. التحقق من وجود العضو في السيرفر
          const gm = await guild.members.fetch(memberRec.discordId).catch(() => null);

          // ج. فحص وصيانة الروم الخاص بالعضو
          let roomNeedsCreation = false;
          if (memberRec.roomChannelId) {
            const chan = guild.channels.cache.get(memberRec.roomChannelId) || await guild.channels.fetch(memberRec.roomChannelId).catch(() => null);
            if (!chan) {
              roomNeedsCreation = true;
            }
          } else {
            roomNeedsCreation = true;
          }

          if (roomNeedsCreation) {
            // حذف الروم القديم إن وجد تالفاً في قاعدة البيانات
            if (memberRec.roomChannelId) {
              const oldChan = await guild.channels.fetch(memberRec.roomChannelId).catch(() => null);
              if (oldChan) {
                await oldChan.delete('حذف روم قديم تالف').catch(() => {});
              }
            }

            // إنشاء روم جديد
            const catId = config.general?.categories?.memberRooms?.id;
            if (catId) {
              let levelCategory = 'اكثر من 40';
              const level = memberRec.level || 0;
              if (level < 25) levelCategory = 'تحت 25';
              else if (level < 40) levelCategory = 'تحت 40';

              const newRoom = await guild.channels.create({
                name: `🏠〢${memberRec.gameName || 'عضو'}-xiraq・${memberRec.gameId || 'ايدي'}・${levelCategory}`,
                parent: catId,
                permissionOverwrites: [
                  { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                  { id: memberRec.discordId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
                ]
              }).catch(() => null);

              if (newRoom) {
                roomsCreated++;
                memberRec.roomChannelId = newRoom.id;
              }
            }
          }

          // د. إذا كان العضو متواجد في السيرفر، نقوم بفحص وإكمال رتبه والاسم المستعار
          if (gm) {
            // 1. استعادة الاسم المستعار إن اختلف
            const expectedNickname = `IQ • ${memberRec.gameName} X.IRAQ 〢${memberRec.gameId}`;
            if (gm.nickname !== expectedNickname) {
              await gm.setNickname(expectedNickname).catch(() => {});
              nicknamesRestored++;
            }

            // 2. فحص وإضافة الرتب الناقصة
            const rolesToAdd = [];
            if (config.roles?.basic?.id && !gm.roles.cache.has(config.roles.basic.id)) {
              rolesToAdd.push(config.roles.basic.id);
            }
            const jobRoleId = config.roles?.jobRoles?.[memberRec.jobNumber?.toString()]?.id;
            if (jobRoleId && !gm.roles.cache.has(jobRoleId)) {
              rolesToAdd.push(jobRoleId);
            }

            if (memberRec.currentRank && Array.isArray(config?.promotion?.ranks)) {
              const rankConfig = config.promotion.ranks.find(r => r.name === memberRec.currentRank);
              if (rankConfig?.roleId && !gm.roles.cache.has(rankConfig.roleId)) {
                rolesToAdd.push(rankConfig.roleId);
              }
            }

            const uniqueRoles = [...new Set(rolesToAdd.filter(Boolean))];
            if (uniqueRoles.length > 0) {
              await gm.roles.add(uniqueRoles).catch(() => {});
              rolesRestored++;
            }

            // 3. تحديث صلاحيات الروم الحالي للعضو المتواجد
            if (memberRec.roomChannelId) {
              const room = guild.channels.cache.get(memberRec.roomChannelId);
              if (room) {
                await room.permissionOverwrites.edit(gm.id, {
                  ViewChannel: true,
                  SendMessages: true
                }).catch(() => {});
              }
            }
          }

          // حفظ التعديلات في قاعدة البيانات
          await memberRec.save();

          if (roomNeedsCreation || (gm && (rolesRestored > 0 || nicknamesRestored > 0))) {
            detailsList.push(`• **${memberRec.gameName || 'عضو'}** (<@${memberRec.discordId}>) - تم فحص رتبه وصيانة رومه`);
          }
        } catch (err) {
          console.error(`Error restoring member ${memberRec.discordId}:`, err);
        }

        // تأخير بسيط لمنع الـ Rate limit
        await new Promise(r => setTimeout(r, 200));
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('🛠️ صيانة واستعادة أعضاء العائلة')
        .setColor(0x2ECC71)
        .addFields(
          { name: 'الأعضاء المفحوصين', value: `${dbMembers.length}`, inline: true },
          { name: 'فك الباند عن', value: `${unbannedCount}`, inline: true },
          { name: 'رومات تم إنشاؤها', value: `${roomsCreated}`, inline: true },
          { name: 'أعضاء استعيدت رتبهم', value: `${rolesRestored}`, inline: true },
          { name: 'أعضاء عُدل اسمهم', value: `${nicknamesRestored}`, inline: true }
        )
        .setDescription(detailsList.length > 0 
          ? detailsList.slice(0, 15).join('\n') + (detailsList.length > 15 ? `\n*و ${detailsList.length - 15} آخرين تم تعديلهم...*` : '')
          : '✅ جميع رومات ورتب الأعضاء سليمة ومطابقة لقاعدة البيانات!'
        )
        .setTimestamp();

      await interaction.editReply({ content: '✅ تمت صيانة واستعادة البيانات بنجاح.', embeds: [resultEmbed] });

    } catch (error) {
      console.error('Error in restore family command:', error);
      await interaction.editReply('❌ حدث خطأ أثناء تنفيذ أمر الاستعادة والصيانة.');
    }
  }
};
