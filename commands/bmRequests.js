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
        .setName('bm-requests')
        .setDescription('إرسال لوحة طلبات البلاك ماركت'),

    async execute(interaction) {
        // Permissions Check
        // Permissions Check (Discord Committee Only)
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

        const embed = embedCustom('#FFA500', '📦 طلبات السوق السوداء', '**هل تحتاج لمنتج غير متوفر؟**\nاضغط على الزر أدناه لتقديم طلب خاص وسيتم تلبيته من قبل البائعين.')
            .setFooter({ text: 'نظام طلبات البلاك ماركت', iconURL: interaction.guild.iconURL() });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('bm_request_product_btn')
                .setLabel('طلب منتج')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📦')
        );

        await interaction.reply({ content: '✅ تم إرسال لوحة الطلبات.', flags: MessageFlags.Ephemeral });
        await interaction.channel.send({ embeds: [embed], components: [row] });
    }
};
