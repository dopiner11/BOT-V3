import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } from 'discord.js';
import Warning from '../models/Warning.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { success as embedSuccess } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logWarning } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
  data: new SlashCommandBuilder()
    .setName('ازالة-تحذير')
    .setDescription('إزالة تحذير لعضو')
    .addUserOption(o => o.setName('الشخص').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('السبب').setDescription('سبب الإزالة').setRequired(true)),

  async execute(interaction) {
    try {
      const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options.getUser('الشخص');
      const reason = interaction.options.getString('السبب');
      const warnings = await Warning.find({ memberId: targetUser.id, removed: false });

      if (!warnings.length) return interaction.editReply(`❌ لا يوجد تحذيرات نشطة لـ ${targetUser}.`);

      const select = new StringSelectMenuBuilder().setCustomId('rem_warn_sel').setPlaceholder('اختر التحذير')
        .addOptions(warnings.map((w, i) => ({ label: `تحذير #${i + 1}`, description: w.reason.substring(0, 50), value: w._id.toString() })));

      await interaction.editReply({ content: `🔎 اختر تحذيراً لإزالته لـ ${targetUser}:`, components: [new ActionRowBuilder().addComponents(select)] });

      const selInteraction = await interaction.channel.awaitMessageComponent({
        filter: i => i.user.id === interaction.user.id && i.customId === 'rem_warn_sel',
        time: 30000
      }).catch(() => null);

      if (!selInteraction) {
        return interaction.editReply({ content: '❌ انتهى الوقت. لم يتم إزالة التحذير.', components: [] });
      }

      await selInteraction.deferUpdate();
      const warn = await Warning.findById(selInteraction.values[0]);
      if (!warn) return interaction.editReply('❌ فشل العثور على التحذير.');

      warn.removed = true; warn.removedBy = interaction.user.id; warn.removedAt = new Date(); warn.removalReason = reason;
      await warn.save();

      const gm = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (gm) {
        const roles = Object.values(config.warnings?.roles || {}).filter(id => id);
        for (const r of roles) await gm.roles.remove(r).catch(() => {});
        const count = await Warning.countDocuments({ memberId: targetUser.id, removed: false });
        const nextRole = config.warnings?.roles?.[count.toString()];
        if (nextRole) await gm.roles.add(nextRole).catch(() => {});
      }

      await dmUser(targetUser, embedSuccess('✅ تم إلغاء تحذيرك',
        `لقد تم إزالة تحذير من سجلك بواسطة **${interaction.user.tag}**.\n\n**السبب:** ${reason}`));

      await logWarning(interaction.guild, {
        target: targetUser, mod: interaction.user, reason: `إزالة تحذير: ${reason}`,
        warningCount: 0, totalWarnings: 0,
      });

      await interaction.editReply({ content: `✅ تم إزالة التحذير لـ ${targetUser} بنجاح.`, components: [] });

    } catch (error) {
      console.error('❌ خطأ في أمر ازالة-تحذير:', error);
      const errorMsg = { content: '❌ حدث خطأ أثناء إزالة التحذير!', components: [] };
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ ...errorMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.editReply(errorMsg).catch(() => {});
      }
    }
  }
};
