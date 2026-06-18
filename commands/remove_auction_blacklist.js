import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import AuctionBlacklist from '../models/AuctionBL.js';
import { success as embedSuccess } from '../utils/embedStyles.js';
import { logBlacklistRemove } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default {
    data: new SlashCommandBuilder()
        .setName('ازالة_بلاكليست_مزاد')
        .setDescription('إزالة منع المزاد عن عضو')
        .addUserOption(option =>
            option.setName('الشخص')
                .setDescription('العضو')
                .setRequired(true)),

    async execute(interaction) {
        const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
        const blacklistRoleId = config.roles?.auctionBlacklist?.id;

        if (!blacklistRoleId) {
            return interaction.reply({ content: '❌ رتبة بلاك ليست المزاد غير مضبوطة في الإعدادات.', flags: MessageFlags.Ephemeral });
        }

        const user = interaction.options.getUser('الشخص');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) {
            return interaction.reply({ content: '❌ العضو غير موجود في السيرفر.', flags: MessageFlags.Ephemeral });
        }

        if (!member.roles.cache.has(blacklistRoleId)) {
            // Check DB just in case, but keep logic simple
            const inDb = await AuctionBlacklist.findOne({ userId: user.id });
            if (!inDb) return interaction.reply({ content: '❌ العضو لا يملك رتبة بلاك ليست المزاد ولا يوجد في قاعدة البيانات.', flags: MessageFlags.Ephemeral });
        }

        try {
            await member.roles.remove(blacklistRoleId);
            await AuctionBlacklist.deleteOne({ userId: user.id });

            const embed = embedSuccess('✅ إزالة حظر مزاد', `تم إزالة حظر المزادات عن العضو ${user}.`);

            await interaction.reply({ embeds: [embed] });

            try {
                await user.send(`✅ **تم رفع حظر المزادات عنك!**`);
            } catch (e) { }

            await logBlacklistRemove(interaction.guild, {
                target: user,
                mod: interaction.user,
                reason: 'تمت إزالة حظر المزادات'
            });

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '❌ حدث خطأ أثناء إزالة الرتبة.', flags: MessageFlags.Ephemeral });
        }
    }
};
