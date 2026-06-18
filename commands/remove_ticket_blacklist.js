import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import TicketBlacklist from '../models/TicketBlacklist.js';
import { success as embedSuccess } from '../utils/embedStyles.js';
import { logBlacklistRemove } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
    data: new SlashCommandBuilder()
        .setName('ازالة_بلاكليست_تذاكر')
        .setDescription('إزالة منع التذاكر عن عضو')
        .addUserOption(option =>
            option.setName('العضو')
                .setDescription('العضو')
                .setRequired(true)),

    async execute(interaction) {
        const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
        const user = interaction.options.getUser('العضو');

        const deleted = await TicketBlacklist.findOneAndDelete({ userId: user.id });

        if (!deleted) {
            return interaction.reply({ content: '❌ هذا العضو ليس ممنوعاً من التذاكر.', flags: MessageFlags.Ephemeral });
        }

        const embed = embedSuccess('✅ إزالة حظر تذاكر', `تم إزالة الحظر عن العضو ${user}. يمكنه الآن فتح تذاكر جديدة.`);

        await interaction.reply({ embeds: [embed] });

        // إزالة رتبة بلاك ليست التذاكر إذا كانت موجودة
        if (config.roles?.ticketBlacklist) {
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member) {
                await member.roles.remove(config.roles.ticketBlacklist).catch(e => console.error('[RemoveTicketBL] role remove error:', e));
            }
        }

        try {
            await user.send(`✅ **تم رفع الحظر عنك في نظام التذاكر!** يمكنك الآن فتح تذاكر جديدة.`);
        } catch (e) { }

        await logBlacklistRemove(interaction.guild, {
            target: `<@${user.id}>`,
            mod: `<@${interaction.user.id}>`,
            reason: 'إزالة حظر تذاكر',
        });
    }
};
