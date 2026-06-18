import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import AuctionBlacklist from '../models/AuctionBL.js';
import { error as embedError } from '../utils/embedStyles.js';
import { logBlacklist } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
    data: new SlashCommandBuilder()
        .setName('بلاكليست_مزاد')
        .setDescription('إضافة عضو للقائمة السوداء للمزادات')
        .addUserOption(option =>
            option.setName('الشخص')
                .setDescription('الشخص المراد منعه')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('السبب')
                .setDescription('سبب المنع')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('المدة')
                .setDescription('مدة المنع (مثال: 1d, 1h, 30m, permanent)')
                .setRequired(true)),

    async execute(interaction) {
        const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

        const targetUser = interaction.options.getUser('الشخص');
        const reason = interaction.options.getString('السبب');
        const durationStr = interaction.options.getString('المدة');
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.reply({ content: '❌ لم يتم العثور على العضو في السيرفر.', flags: MessageFlags.Ephemeral });
        }

        const blacklistRoleId = config.roles?.auctionBlacklist?.id;
        if (!blacklistRoleId) {
            return interaction.reply({ content: '❌ لم يتم تعيين رتبة البلاكليست في الإعدادات!', flags: MessageFlags.Ephemeral });
        }

        // Parse duration
        let expiresAt = null;
        let displayDuration = durationStr;
        if (durationStr.toLowerCase() !== 'permanent') {
            const match = durationStr.match(/^(\d+)([dhms])$/);
            if (match) {
                const val = parseInt(match[1]);
                const unit = match[2];
                let ms = 0;
                if (unit === 'd') ms = val * 24 * 60 * 60 * 1000;
                else if (unit === 'h') ms = val * 60 * 60 * 1000;
                else if (unit === 'm') ms = val * 60 * 1000;
                else if (unit === 's') ms = val * 1000;
                expiresAt = new Date(Date.now() + ms);
                const units = { d: 'يوم', h: 'ساعة', m: 'دقيقة', s: 'ثانية' };
                displayDuration = `${val} ${units[unit] || unit}`;
            } else {
                return interaction.reply({ content: '❌ صيغة الوقت غير صحيحة. استخدم: 1d, 1h, 30m, permanent', flags: MessageFlags.Ephemeral });
            }
        }

        try {
            await targetMember.roles.add(blacklistRoleId);

            await AuctionBlacklist.findOneAndUpdate(
                { userId: targetUser.id },
                {
                    userId: targetUser.id,
                    adminId: interaction.user.id,
                    reason: reason,
                    expiresAt: expiresAt,
                    isPermanent: expiresAt === null,
                    date: new Date()
                },
                { upsert: true, new: true }
            );

            const embed = embedError('🚫 قرار منع من المزادات', null, [
                { name: '👤 العضو', value: targetUser.toString(), inline: true },
                { name: '🛡️ المسؤول', value: interaction.user.toString(), inline: true },
                { name: '⏰ المدة', value: displayDuration, inline: true },
                { name: '📝 السبب', value: reason, inline: false }
            ]);

            if (expiresAt) {
                embed.addFields({ name: '📅 ينتهي', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`, inline: true });
            }

            await interaction.reply({ embeds: [embed] });

            await targetUser.send({
                content: `⚠️ تم منعك من المشاركة في المزادات.\n**السبب:** ${reason}\n**المدة:** ${displayDuration}${expiresAt ? `\n**ينتهي:** <t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : ''}`
            }).catch(() => { });

            await logBlacklist(interaction.guild, {
                target: targetUser,
                mod: interaction.user,
                reason: reason,
                duration: displayDuration
            });

        } catch (error) {
            console.error('Error in auction_blacklist:', error);
            await interaction.reply({ content: '❌ حدث خطأ أثناء إضافة الرتبة (تأكد من ترتيب رتبة البوت).', flags: MessageFlags.Ephemeral });
        }
    }
};
