import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
import { custom as embedCustom } from '../utils/embedStyles.js';

export default {
    data: new SlashCommandBuilder()
        .setName('bm-seller')
        .setDescription('إرسال لوحة بائعي البلاك ماركت'),

    async execute(interaction) {
        const discordCommitteeRoles = [
            ...(config.committees?.list?.discord?.roles?.manager || []),
            ...(config.committees?.list?.discord?.roles?.deputy || []),
            ...(config.committees?.list?.discord?.roles?.member || [])
        ];

        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.roles.cache.some(r => discordCommitteeRoles.includes(r.id));

        if (!hasPermission) {
            return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
        }

        const embed = embedCustom('#800000', '🩸 لوحة البائعين', '**مرحباً أيها البائع**\nاضغط أدناه لفتح لوحة التحكم الخاصة بك لعرض المنتجات.')
            .setFooter({ text: 'نظام البائعين', iconURL: interaction.guild.iconURL() });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('bm_seller_dashboard_btn')
                .setLabel('لوحة التحكم')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🩸')
        );

        await interaction.reply({ content: '✅ تم إرسال لوحة البائعين.', flags: MessageFlags.Ephemeral });
        await interaction.channel.send({ embeds: [embed], components: [row] });
    }
};
