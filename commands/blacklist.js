import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import Blacklist from '../models/Blacklist.js';
import Member from '../models/Member.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { warning as embedWarning, error as embedError } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logBlacklist } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
  data: new SlashCommandBuilder()
    .setName('بلاك_ليست')
    .setDescription('إضافة عضو إلى البلاك ليست')
    .addUserOption(option => option.setName('العضو').setDescription('العضو المراد إضافته').setRequired(true))
    .addStringOption(option => option.setName('السبب').setDescription('سبب الإضافة').setRequired(true))
    .addIntegerOption(option => option.setName('المدة').setDescription('المدة بالأيام (0 = دائم)').setRequired(true).setMinValue(0))
    .addStringOption(option => option.setName('التصنيف').setDescription('تصنيف المخالفة').setRequired(false).addChoices(
      { name: 'مخالفة قوانين', value: 'مخالفة قوانين' },
      { name: 'احتيال', value: 'احتيال' },
      { name: 'سلوك غير لائق', value: 'سلوك غير لائق' }
    )),

  async execute(interaction) {
    const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const targetUser = interaction.options.getUser('العضو');
      const reason = interaction.options.getString('السبب');
      const duration = interaction.options.getInteger('المدة');
      const category = interaction.options.getString('التصنيف') || 'أخرى';

      const existing = await Blacklist.findOne({ userId: targetUser.id, isActive: true });
      if (existing) {
        return interaction.editReply('❌ العضو مضاف بالفعل للبلاك ليست.');
      }

      const confirmEmbed = embedWarning('⚠️ تأكيد إضافة البلاك ليست',
        `هل أنت متأكد من إضافة ${targetUser} إلى البلاك ليست؟\n\n**السبب:** ${reason}\n**المدة:** ${duration === 0 ? 'دائمة' : `${duration} يوم`}\n**التصنيف:** ${category}`);

      const confirmId = `confirm_bl_${interaction.user.id}`;
      const cancelId = `cancel_bl_${interaction.user.id}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel('✅ تأكيد').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cancelId).setLabel('❌ إلغاء').setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

      const collected = await interaction.channel.awaitMessageComponent({
        filter: i => [confirmId, cancelId].includes(i.customId) && i.user.id === interaction.user.id,
        time: 30000
      }).catch(() => null);

      if (!collected || collected.customId === cancelId) {
        return interaction.editReply({ content: '✅ تم إلغاء العملية.', components: [] });
      }

      await collected.deferUpdate();

      let expiresAt = duration > 0 ? new Date(Date.now() + duration * 86400000) : null;

      await Blacklist.create({
        userId: targetUser.id, username: targetUser.tag, reason, category, duration,
        addedBy: interaction.user.id, addedByName: interaction.user.tag, expiresAt,
        isPermanent: duration === 0, isActive: true
      });

      const member = await Member.findOne({ discordId: targetUser.id });
      if (member) {
        member.isActive = false; member.leftDate = new Date(); member.leftReason = `بلاك ليست: ${reason}`;
        await member.save();
      }

      const memberGuild = interaction.guild.members.cache.get(targetUser.id);
      if (memberGuild) {
        if (config.roles.blacklist?.id) await memberGuild.roles.add(config.roles.blacklist.id).catch(() => { });
        if (config.roles.basic?.id) await memberGuild.roles.remove(config.roles.basic.id).catch(() => { });
      }

      await dmUser(targetUser, embedError('🚫 تم إضافتك للبلاك ليست',
        `السبب: ${reason}\nالمدة: ${duration === 0 ? 'دائمة' : `${duration} يوم`}`));

      await logBlacklist(interaction.guild, {
        target: targetUser, mod: interaction.user, reason,
        duration: duration === 0 ? 'دائمة' : `${duration} يوم`,
      });

      await interaction.editReply({ content: `✅ تم إضافة ${targetUser.tag} للبلاك ليست بنجاح.`, components: [] });
    } catch (error) {
      console.error(`❌ Error in blacklist command:`, error);
      await interaction.editReply({ content: '❌ حدث خطأ أثناء تنفيذ الأمر.', components: [] }).catch(() => {});
    }
  }
};
