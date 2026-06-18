// التحذيرات.js
import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import Warning from '../models/Warning.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { info as embedInfo, custom as embedCustom } from '../utils/embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = JSON.parse(
  readFileSync(join(__dirname, '../config.json'), 'utf8')
);

export default {
  data: new SlashCommandBuilder()
    .setName('التحذيرات')
    .setDescription('عرض سجل التحذيرات التفصيلي للعضو')
    .addUserOption(option =>
      option.setName('الشخص')
        .setDescription('العضو المراد عرض تحذيراته')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('الشخص');
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    try {
      // الحصول على إحصائيات التحذيرات
      const [activeCount, totalCount, activeWarnings] = await Promise.all([
        Warning.countDocuments({
          memberId: targetUser.id,
          removed: false
        }),
        Warning.countDocuments({ memberId: targetUser.id }),
        Warning.find({
          memberId: targetUser.id,
          removed: false
        }, { createdAt: -1 }, 5)
      ]);

      const allWarnings = await Warning.find({ memberId: targetUser.id }, { createdAt: -1 }, 10);

      // تحديد الدور التحذيري الحالي من السيرفر
      let currentWarningRole = "لا يوجد";
      if (targetMember) {
        const warningRoles = config.warnings?.roles || {};
        for (const [num, roleId] of Object.entries(warningRoles)) {
          if (roleId && targetMember.roles.cache.has(roleId)) {
            currentWarningRole = `<@&${roleId}>`;
            break;
          }
        }
      }

      const warnColor = activeCount >= 3 ? 0xFF0000 : activeCount > 0 ? 0xFF9900 : 0x00FF00;
      const mainEmbed = embedCustom(warnColor, `📋 سجل التحذيرات الإداري - ${targetUser.tag}`,
        `**تحليل نشاط العضو: ${targetUser}**\nالمستوى الحالي قد يستدعي اتخاذ إجراء قانوني حسب قوانين العائلة.`)
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: '📊 إحصائيات عامة', value: `• التحذيرات النشطة: \`${activeCount}\`\n• الإجمالي الكلي: \`${totalCount}\`\n• التحذيرات الملغاة: \`${totalCount - activeCount}\``, inline: true },
          { name: '🛡️ الحالة القانونية', value: `• الرتبة التحذيرية: ${currentWarningRole}\n• المستوى: ${this.getWarningLevel(activeCount)}`, inline: true }
        )
        .setFooter({ text: `طلب بواسطة: ${interaction.user.tag} • نظام الإدارة`, iconURL: interaction.user.displayAvatarURL() });

      if (activeWarnings.length > 0) {
        const warningList = activeWarnings.map((w, i) => {
          const date = w.createdAt.toLocaleDateString('ar-SA');
          return `**${i + 1}.** ${w.reason}\n   👤 بواسطة: \`${w.givenByName}\` | 📅 ${date}`;
        }).join('\n\n');

        mainEmbed.addFields({
          name: '⚠️ آخر التحذيرات النشطة',
          value: warningList.length > 1024 ? warningList.substring(0, 1020) + '...' : warningList,
          inline: false
        });
      }

      const buttons = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`view_all_warnings_${targetUser.id}`)
            .setLabel('📜 السجل الكامل')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(allWarnings.length === 0),
          new ButtonBuilder()
            .setCustomId(`warning_stats_${targetUser.id}`)
            .setLabel('📊 تحليل بياني')
            .setStyle(ButtonStyle.Secondary)
        );

      const response = await interaction.editReply({
        embeds: [mainEmbed],
        components: [buttons]
      });

      const collector = response.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 120000
      });

      collector.on('collect', async i => {
        try {
          if (i.customId.startsWith('view_all_warnings_')) {
            await this.showAllWarnings(i, targetUser, allWarnings);
          } else if (i.customId.startsWith('warning_stats_')) {
            await this.showDetailedStats(i, targetUser, activeCount, totalCount);
          }
        } catch (err) {
          console.error('Warnings Collector error:', err);
        }
      });

      collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => { });
      });

    } catch (error) {
      console.error('Error in warnings view command:', error);
      await interaction.editReply({ content: '❌ حدث خطأ غير متوقع أثناء المعالجة.' });
    }
  },

  getWarningLevel(count) {
    if (count === 0) return '🟢 **سليم**';
    if (count === 1) return '🟡 **منذر (1)**';
    if (count === 2) return '🟠 **تحت الملاحظة (2)**';
    if (count >= 3) return '🔴 **مستحق للفصل (3+)**';
    return '⚪ **غير معروف**';
  },

  async showAllWarnings(interaction, targetUser, warnings) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { });

    const embed = embedInfo(`📜 السجل الكامل - ${targetUser.tag}`)
      .setThumbnail(targetUser.displayAvatarURL());

    warnings.forEach((w, index) => {
      const status = w.removed ? '⚪ [ملغي]' : '🟡 [نشط]';
      const type = w.typeName || 'عقوبة';
      embed.addFields({
        name: `${status} ع- #${index + 1} (${type})`,
        value: `> **السبب:** ${w.reason}\n> **بواسطة:** ${w.givenByName}\n> **التاريخ:** ${w.createdAt.toLocaleDateString('ar-SA')}`,
        inline: false
      });
    });

    await interaction.editReply({ embeds: [embed] }).catch(() => { });
  },

  async showDetailedStats(interaction, targetUser, activeCount, totalCount) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { });

    const statsEmbed = embedCustom(0x9B59B6, `📊 تحليل المخالفات - ${targetUser.tag}`,
      'هذا التحليل مبني على عدد التحذيرات النشطة مقارنة بحدود الفصل التلقائي في العائلة.')
      .addFields(
        { name: '🔥 التكرار', value: `\`${activeCount}\` نشط`, inline: true },
        { name: '📉 نسبة الالتزام', value: `${totalCount === 0 ? '100' : Math.max(0, 100 - (activeCount * 33)).toFixed(0)}%`, inline: true },
        { name: '📁 الأرشيف', value: `\`${totalCount}\` بلاغات`, inline: true }
      );

    await interaction.editReply({ embeds: [statsEmbed] }).catch(() => { });
  }
};