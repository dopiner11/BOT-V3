import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import TicketBlacklist from '../models/TicketBlacklist.js';
import { error as embedError } from '../utils/embedStyles.js';
import { logBlacklist } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
    data: new SlashCommandBuilder()
        .setName('بلاكليست_تذاكر')
        .setDescription('منع عضو من فتح التذاكر')
        .addUserOption(option =>
            option.setName('العضو')
                .setDescription('العضو المراد منعه')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('السبب')
                .setDescription('سبب المنع')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('المدة')
                .setDescription('المدة (مثال: 1d, 1h, 30m)')
                .setRequired(true)),

    async execute(interaction) {
        const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
        const user = interaction.options.getUser('العضو');
        const reason = interaction.options.getString('السبب');
        const durationStr = interaction.options.getString('المدة');

        // Parse duration
        let durationMs = 0;
        const match = durationStr.match(/^(\d+)([dhms])$/);
        if (match) {
            const val = parseInt(match[1]);
            const unit = match[2];
            if (unit === 'd') durationMs = val * 24 * 60 * 60 * 1000;
            else if (unit === 'h') durationMs = val * 60 * 60 * 1000;
            else if (unit === 'm') durationMs = val * 60 * 1000;
            else if (unit === 's') durationMs = val * 1000;
        } else {
            return interaction.reply({ content: '❌ صيغة الوقت غير صحيحة. استخدم d للأيام، h للساعات، m للدقائق. مثال: 1d', flags: MessageFlags.Ephemeral });
        }

        const expiresAt = new Date(Date.now() + durationMs);

        await TicketBlacklist.findOneAndUpdate(
            { userId: user.id },
            {
                userId: user.id,
                reason,
                adminId: interaction.user.id,
                expiresAt,
                createdAt: new Date()
            },
            { upsert: true, new: true }
        );

        const embed = embedError('🚫 حظر تذاكر', `تم منع العضو ${user} من فتح التذاكر.`)
            .addFields(
                { name: '📝 Reason', value: reason, inline: true },
                { name: '⏰ Duration', value: durationStr, inline: true },
                { name: '📅 Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true }
            );

        await interaction.reply({ embeds: [embed] });

        // إضافة رتبة بلاك ليست التذاكر إذا كانت موجودة في الإعدادات
        if (config.roles?.ticketBlacklist) {
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (member) {
                await member.roles.add(config.roles.ticketBlacklist).catch(e => console.error('[TicketBL] role add error:', e));
            }
        }

        try {
            await user.send(`🚫 **تم منعك من استخدام نظام التذاكر!**\n**السبب:** ${reason}\n**المدة:** ${durationStr}`);
        } catch (e) {
            // ignore
        }

        await logBlacklist(interaction.guild, {
            target: `<@${user.id}>`,
            mod: `<@${interaction.user.id}>`,
            reason: reason,
            duration: durationStr,
        });
    }
};
