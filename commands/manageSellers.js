import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import Warning from '../models/Warning.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function loadConfig() {
    try {
        return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    } catch (e) { return {}; }
}

import Order from '../models/Order.js';
import { warning as embedWarning, error as embedError } from '../utils/embedStyles.js';

export default {
    data: new SlashCommandBuilder()
        .setName('manage-sellers')
        .setDescription('إدارة بائعي البلاك ماركت')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('عرض لوحة تفاعل البائعين')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('warn')
                .setDescription('تحذير بائع')
                .addUserOption(option => option.setName('user').setDescription('البائع').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('سبب التحذير').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('fire')
                .setDescription('فصل بائع')
                .addUserOption(option => option.setName('user').setDescription('البائع').setRequired(true))
                .addStringOption(option => option.setName('reason').setDescription('سبب الفصل').setRequired(true))
        ),

    async execute(interaction) {
        const config = loadConfig();
        // Permission Check
        // Permission: Discord Committee Only
        const discordCommitteeRoles = [
            ...(config.committees?.list?.discord?.roles?.manager || []),
            ...(config.committees?.list?.discord?.roles?.deputy || []),
            ...(config.committees?.list?.discord?.roles?.member || [])
        ];

        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.roles.cache.some(r => discordCommitteeRoles.includes(r.id));

        if (!hasPermission) {
            return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر.', flags: MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'list') {
            await interaction.deferReply();
            try {
                const { generateBMReport } = await import('./bmStats.js');
                const { embed, components } = await generateBMReport(interaction.guild, 0);
                await interaction.editReply({ embeds: [embed], components: components });
            } catch (error) {
                console.error('Error generating BM List:', error);
                await interaction.editReply({ content: '❌ حدث خطأ أثناء جلب القائمة.' });
            }
        } else if (subcommand === 'warn') {
            await interaction.deferReply();
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');

            const warning = new Warning({
                memberId: user.id,
                memberName: user.username,
                reason: reason,
                warningType: 'punishment',
                typeName: 'تحذير بلاك ماركت',
                givenBy: interaction.user.id,
                givenByName: interaction.user.username,
                status: 'active'
            });

            await warning.save();

            // Log
            const logChannelId = config.blackMarket?.channels?.logs?.id;
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                const embed = embedWarning('⚠️ تحذير بائع', null, [
                    { name: 'البائع', value: `<@${user.id}>` },
                    { name: 'السبب', value: reason },
                    { name: 'بواسطة', value: `<@${interaction.user.id}>` }
                ]);
                await logChannel.send({ embeds: [embed] });
            }

            await interaction.editReply(`✅ **تم تحذير البائع <@${user.id}> بنجاح.**\nالسبب: ${reason}`);
            try { await user.send(`⚠️ **لقد تلقيت تحذيراً في البلاك ماركت!**\nالسبب: ${reason}`); } catch (e) { }

        } else if (subcommand === 'fire') {
            await interaction.deferReply();
            const user = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);

            if (member) {
                // Remove Roles
                // Define seller roles to remove
                const sellerRoleIds = [
                    ...(config.committees?.list?.blackMarket?.roles?.member || []),
                    ...(config.blackMarket?.roles?.member || [])
                ];

                // Remove Committee Roles
                if (sellerRoleIds.length > 0) {
                    await member.roles.remove(sellerRoleIds).catch(console.error);
                }
                // Remove Rank Roles?
                const ranks = config.blackMarket?.ranks || [];
                for (const rank of ranks) {
                    if (rank.roleId) await member.roles.remove(rank.roleId).catch(console.error);
                }
            }

            // Log Fire
            const warning = new Warning({
                memberId: user.id,
                memberName: user.username,
                reason: reason,
                warningType: 'punishment',
                typeName: 'فصل من البلاك ماركت',
                givenBy: interaction.user.id,
                givenByName: interaction.user.username,
                status: 'fired'
            });
            await warning.save();

            const logChannelId = config.blackMarket?.channels?.logs?.id;
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                const embed = embedError('🚫 فصل بائع', null, [
                    { name: 'البائع', value: `<@${user.id}>` },
                    { name: 'السبب', value: reason },
                    { name: 'بواسطة', value: `<@${interaction.user.id}>` }
                ]);
                await logChannel.send({ embeds: [embed] });
            }

            await interaction.editReply(`✅ **تم فصل البائع <@${user.id}> من البلاك ماركت بنجاح.**\nالسبب: ${reason}`);
            try { await user.send(`🚫 **تم فصلك من البلاك ماركت!**\nالسبب: ${reason}`); } catch (e) { }
        }
    }
};
