import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } from 'discord.js';
import Warning from '../models/Warning.js';
import Member from '../models/Member.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { updateRoomEmoji, STATUS, getInteractionConfig } from '../utils/interactionMonitor.js';
import { scheduleStatsUpdate } from '../utils/statsHub.js';
import { warning as embedWarning, error as embedError, success as embedSuccess } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logWarning } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseMembers(str) {
  const ids = new Set();
  const matches = str.matchAll(/<@!?(\d+)>|(\d{17,20})/g);
  for (const m of matches) {
    ids.add(m[1] || m[2]);
  }
  return [...ids];
}

export default {
  data: new SlashCommandBuilder()
    .setName('تحذير')
    .setDescription('إصدار تحذير رسمي أو شفوي لعضو أو أكثر')
    .addStringOption(option => option.setName('الأعضاء').setDescription('الأعضاء (id أو mention — افصل بينهم بمسافة)').setRequired(true))
    .addStringOption(option => option.setName('السبب').setDescription('سبب التحذير').setRequired(true)),

  async execute(interaction) {
    try {
      const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const raw = interaction.options.getString('الأعضاء');
      const reason = interaction.options.getString('السبب');
      const discordIds = parseMembers(raw);

      if (discordIds.length === 0) {
        return interaction.editReply('❌ لم يتم العثور على أي عضو. استخدم ID أو Mention.');
      }

      // جلب كل الأعضاء
      const members = [];
      for (const id of discordIds) {
        const m = await interaction.guild.members.fetch(id).catch(() => null);
        if (m) members.push(m);
      }

      if (members.length === 0) {
        return interaction.editReply('❌ جميع المعرفات المدخلة غير موجودة في السيرفر.');
      }

      if (members.length !== discordIds.length) {
        const found = members.map(m => m.id);
        const missing = discordIds.filter(id => !found.includes(id));
        await interaction.editReply({ content: `⚠️ تم تجاهل ${missing.length} معرف غير موجود: \`${missing.join(', ')}\`` });
      }

      // اختيار النوع
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('warning_type_select')
        .setPlaceholder('اختر نوع التحذير')
        .addOptions([
          { label: 'تحذير شفوي', value: 'oral', description: 'تنبيه بسيط لا يسجل في الإحصائيات' },
          { label: 'تحذير عدم تفاعل', value: 'inactivity', description: 'تحذير مسجل بسبب قلة التفاعل' },
          { label: 'تحذير سلوك/عقوبة', value: 'punishment', description: 'تحذير مسجل بسبب مخالفة سلوكية' }
        ]);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const targetsList = members.map(m => `<@${m.id}>`).join(' ');
      await interaction.editReply({
        content: `📝 **تحديد نوع التحذير لـ (${members.length}) أعضاء**\n${targetsList}\n\n**السبب:** ${reason}`,
        components: [row]
      });

      const selectInteraction = await interaction.channel.awaitMessageComponent({
        filter: i => i.user.id === interaction.user.id && i.customId === 'warning_type_select',
        time: 30000
      }).catch(() => null);

      if (!selectInteraction) {
        return interaction.editReply({ content: '❌ انتهى الوقت. لم يتم إصدار التحذيرات.', components: [] });
      }

      const type = selectInteraction.values[0];
      await selectInteraction.deferUpdate();

      const createdList = [];
      const failedList = [];

      for (const targetMember of members) {
        try {
          const targetUser = targetMember.user;

          if (type === 'oral') {
            const warning = new Warning({
              memberId: targetUser.id,
              memberName: targetUser.tag,
              reason,
              warningType: 'oral',
              typeName: 'شفوي',
              removed: false,
              status: 'active',
              givenBy: interaction.user.id,
              givenByName: interaction.user.tag
            });
            await warning.save();

            await dmUser(targetUser, embedWarning('⚠️ تنبيه شفوي',
              `لقد تلقيت تنبيهاً شفوياً في عائلة X.IRAQ.\n\n**السبب:** \`${reason}\`\n**المسؤول:** ${interaction.user.tag}`));

            await logWarning(interaction.guild, {
              target: targetUser, mod: interaction.user, reason: `شفوي — ${reason}`, warningCount: 0, totalWarnings: 0,
            });

            createdList.push({ targetUser, type: 'شفوي', num: null });
            continue;
          }

          const activeCount = await Warning.countDocuments({ memberId: targetUser.id, removed: false });
          const warningNum = activeCount + 1;
          const numArabic = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس'][activeCount] || `${warningNum}`;

          if (type === 'inactivity') {
            const memberDoc = await Member.findOne({ discordId: targetUser.id });
            if (memberDoc) {
              memberDoc.lastActivity = new Date();
              await memberDoc.save();
            }
          }

          const warning = new Warning({
            memberId: targetUser.id,
            memberName: targetUser.tag,
            reason,
            warningType: type,
            typeName: type === 'inactivity' ? 'نقص تفاعل' : 'عقوبة إدارية',
            removed: false,
            status: 'active',
            givenBy: interaction.user.id,
            givenByName: interaction.user.tag
          });
          await warning.save();

          const warningRoleId = config.warnings?.roles?.[warningNum.toString()];
          if (warningRoleId) {
            await targetMember.roles.add(warningRoleId).catch(e => console.error('Failed to add warning role:', e));
          }

          await dmUser(targetUser, embedError(`⚠️ تحذير رسمي (${numArabic})`,
            `لقد تم إصدار تحذير بحقك في عائلة X.IRAQ.\n\n**السبب:** \`${reason}\`\n**النوع:** ${warning.typeName}\n**المسؤول:** ${interaction.user.tag}\n**عدد تحذيراتك الحالية:** ${warningNum}`));

          await logWarning(interaction.guild, {
            target: targetUser, mod: interaction.user, reason, warningCount: warningNum, totalWarnings: 3,
          });

          // تحديث ايموجي الروم
          if (type === 'inactivity') {
            await Member.findOneAndUpdate(
              { discordId: targetUser.id },
              { $set: { violatorWarningSentAt: new Date() } }
            );
            await updateRoomEmoji(interaction.guild, targetUser.id, STATUS.WARNED);
          } else {
            await updateRoomEmoji(interaction.guild, targetUser.id);
          }

          createdList.push({ targetUser, type: warning.typeName, num: numArabic });
        } catch (err) {
          console.error(`[تحذير] فشل تحذير ${targetMember.id}:`, err);
          failedList.push(targetMember.user);
        }
      }

      // إرسال القرار
      if (createdList.length > 0) {
        await this.sendDecision(interaction, config, createdList, reason, type);
      }

      // تحديث مركز الإحصائيات
      scheduleStatsUpdate(interaction.client).catch(e => console.error('فشل تحديث الإحصائيات:', e));

      // رسالة النتيجة
      const resultLines = [];
      if (createdList.length > 0) {
        const createdText = createdList.map(c =>
          `✅ <@${c.targetUser.id}> — ${c.type}${c.num ? ` (${c.num})` : ''}`
        ).join('\n');
        resultLines.push(`**تم بنجاح (${createdList.length}):**\n${createdText}`);
      }
      if (failedList.length > 0) {
        const failedText = failedList.map(u => `❌ <@${u.id}>`).join('\n');
        resultLines.push(`**فشل (${failedList.length}):**\n${failedText}`);
      }

      const resultEmbed = createdList.length > 0
        ? embedSuccess('✅ تم إصدار التحذيرات', resultLines.join('\n\n'))
        : embedError('❌ فشل إصدار التحذيرات', resultLines.join('\n\n'));

      await interaction.editReply({ embeds: [resultEmbed], components: [] });

    } catch (error) {
      console.error('❌ خطأ في أمر التحذير:', error);
      const errorMsg = { content: '❌ حدث خطأ أثناء إصدار التحذير!', components: [] };
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ ...errorMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.editReply(errorMsg).catch(() => {});
      }
    }
  },

  async sendDecision(interaction, config, createdList, reason, type) {
    const decisionChannelId = config.warnings?.channels?.warningDecision?.id || getInteractionConfig().channels.decisions;
    const warningGif = config.warnings?.channels?.warningGif?.id || 'https://media.discordapp.net/attachments/1391704768660901919/1453017758328557629/934_x_175_.gif';
    const basicRoleId = config.roles?.basic?.id || '1388879971677634631';
    const channel = interaction.guild.channels.cache.get(decisionChannelId);
    if (!channel) return;

    const isOral = type === 'oral';
    const typeName = isOral ? 'تحذير شفوي' : (type === 'inactivity' ? 'عدم تفاعل' : 'عقوبة إدارية');

    const targetsText = createdList.map(c => `- ${c.targetUser}`).join('\n');
    const warningsText = createdList.map(c => {
      if (isOral) return `> • **تحذير شفوي**`;
      return `> • **تحذير (${c.num})**`;
    }).join('\n');

    await channel.send({ content: warningGif });
    const decision = `
▬▬▬ ﷽ ▬▬▬
<:Family:1516647836744417320> **قرار إداري صادر من قيادة العائلة** 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 

**لكلاً من :**  
${targetsText}

**السبب :**  || ${reason} ||

${warningsText}

> || نوع التحذير: ${typeName} ||

${isOral ? '' : '-# ملاحظة : عند بلوغ 3 تحذيرات سيتم اتخاذ إجراء الفصل التلقائي.'}
**تــوقــيــع مسؤول القرار ✍:** ${interaction.user}

||<@&${basicRoleId}>||
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`.trim();
    await channel.send({ content: decision });
  }
};