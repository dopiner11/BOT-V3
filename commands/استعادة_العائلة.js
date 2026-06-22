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
    .setDescription('فحص أعضاء العائلة المتبندين وإلغاء حظرهم واستعادة روماتهم ورتبهم')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const config = loadConfig();
      const guild = interaction.guild;

      // 1. جلب قائمة المتبندين من السيرفر
      const bans = await guild.bans.fetch().catch(() => null);
      if (!bans) {
        return interaction.editReply('❌ فشل جلب قائمة المحظورين من السيرفر. تأكد من صلاحيات البوت.');
      }

      // 2. جلب الأعضاء المسجلين في قاعدة البيانات
      const dbMembers = await Member.find({});
      if (dbMembers.length === 0) {
        return interaction.editReply('❌ لا يوجد أعضاء مسجلين في قاعدة البيانات.');
      }

      // 3. تصفية الأعضاء المتبندين
      const bannedMembers = dbMembers.filter(m => bans.has(m.discordId));

      if (bannedMembers.length === 0) {
        return interaction.editReply('✅ لم يتم العثور على أي عضو عائلة متبند حالياً في السيرفر.');
      }

      await interaction.editReply(`🔄 تم العثور على **${bannedMembers.length}** عضو متبند. جاري معالجة الاستعادة...`);

      let unbannedCount = 0;
      let roomsCreated = 0;
      let rolesRestored = 0;
      const detailsList = [];

      for (const memberRec of bannedMembers) {
        try {
          // أ. فك الباند عن العضو
          await guild.bans.remove(memberRec.discordId, 'استعادة تلقائية لعضو العائلة').catch(() => {});
          unbannedCount++;

          // ب. حذف الروم القديم إن وجد
          if (memberRec.roomChannelId) {
            const oldChan = await guild.channels.fetch(memberRec.roomChannelId).catch(() => null);
            if (oldChan) {
              await oldChan.delete('حذف الروم القديم لعضو العائلة المتبند').catch(() => {});
            }
          }

          // ج. إنشاء روم جديد للعضو
          const catId = config.general?.categories?.memberRooms?.id;
          let newRoom = null;
          if (catId) {
            let levelCategory = 'اكثر من 40';
            const level = memberRec.level || 0;
            if (level < 25) levelCategory = 'تحت 25';
            else if (level < 40) levelCategory = 'تحت 40';

            newRoom = await guild.channels.create({
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

          memberRec.isActive = true; // إعادة تنشيط العضو في قاعدة البيانات
          await memberRec.save();

          // د. التحقق مما إذا كان العضو موجوداً بالفعل بالسيرفر (مثلاً لو تم فك بانده مسبقاً ودخل)
          const gm = await guild.members.fetch(memberRec.discordId).catch(() => null);
          if (gm) {
            // استعادة الاسم المستعار
            if (memberRec.gameName && memberRec.gameId) {
              await gm.setNickname(`IQ • ${memberRec.gameName} X.IRAQ 〢${memberRec.gameId}`).catch(() => {});
            }

            // استعادة الرتب
            const rolesToAdd = [];
            if (config.roles?.basic?.id) rolesToAdd.push(config.roles.basic.id);
            const jobRoleId = config.roles?.jobRoles?.[memberRec.jobNumber?.toString()]?.id;
            if (jobRoleId) rolesToAdd.push(jobRoleId);

            if (memberRec.currentRank && Array.isArray(config?.promotion?.ranks)) {
              const rankConfig = config.promotion.ranks.find(r => r.name === memberRec.currentRank);
              if (rankConfig?.roleId) rolesToAdd.push(rankConfig.roleId);
            }

            const uniqueRoles = [...new Set(rolesToAdd.filter(Boolean))];
            if (uniqueRoles.length > 0) {
              await gm.roles.add(uniqueRoles).catch(() => {});
              rolesRestored++;
            }
          }

          detailsList.push(`• **${memberRec.gameName || 'غير معروف'}** (<@${memberRec.discordId}>) - تم فك الباند ${newRoom ? 'وإنشاء روم' : ''}`);
        } catch (err) {
          console.error(`Error restoring member ${memberRec.discordId}:`, err);
        }

        // تأخير بسيط لمنع الـ Rate limit
        await new Promise(r => setTimeout(r, 300));
      }

      const resultEmbed = new EmbedBuilder()
        .setTitle('🛠️ اكتمال استعادة أعضاء العائلة')
        .setColor(0x2ECC71)
        .addFields(
          { name: 'الأعضاء المكتشفين', value: `${bannedMembers.length}`, inline: true },
          { name: 'تم فك الباند عن', value: `${unbannedCount}`, inline: true },
          { name: 'رومات جديدة', value: `${roomsCreated}`, inline: true },
          { name: 'رتب مسترجعة فوراً', value: `${rolesRestored}`, inline: true }
        )
        .setDescription(detailsList.slice(0, 15).join('\n') + (detailsList.length > 15 ? `\n*و ${detailsList.length - 15} آخرين...*` : ''))
        .setTimestamp();

      await interaction.editReply({ content: '✅ تمت العملية بنجاح.', embeds: [resultEmbed] });

    } catch (error) {
      console.error('Error in restore family command:', error);
      await interaction.editReply('❌ حدث خطأ أثناء تنفيذ أمر الاستعادة.');
    }
  }
};
