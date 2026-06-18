
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { custom as embedCustom } from '../utils/embedStyles.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

import BlackMarketSeller from '../models/BlackMarketSeller.js';
import Blacklist from '../models/Blacklist.js';

export default {
    data: new SlashCommandBuilder()
        .setName('توظيف-بائع')
        .setDescription('توظيف بائع في البلاك ماركت يدوياً')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('العضو المراد توظيفه')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('role')
                .setDescription('الرتبة')
                .setRequired(true)
                .addChoices(
                    { name: 'بائع (Member)', value: 'member' },
                    { name: 'مسؤول (Manager)', value: 'manager' }
                )),

    async execute(interaction) {
        // Permissions Check (Discord Committee Only)
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

        await interaction.deferReply();

        const user = interaction.options.getUser('user');
        const roleType = interaction.options.getString('role');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) return interaction.editReply('❌ العضو غير موجود في السيرفر.');

        const black = await Blacklist.findOne({ userId: user.id, isActive: true });
        if (black) return interaction.editReply({ content: `❌ هذا العضو في البلاك ليست ولا يمكن توظيفه!\n**السبب:** ${black.reason}` });

        // Get Role ID - try roles map first, then fall back to ranks array
        const targetRoleIds = config.blackMarket?.roles?.[roleType] || [];
        let roleId = targetRoleIds[0];
        if (!roleId && roleType === 'member' && config.blackMarket?.ranks?.length > 0) {
            roleId = config.blackMarket.ranks[0].roleId;
        }

        if (!roleId) return interaction.editReply('❌ لم يتم العثور على أيدي الرتبة في الإعدادات.');

        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) return interaction.editReply('❌ الرتبة غير موجودة في السيرفر.');

        try {
            await member.roles.add(role);

            // Add to Database
            await BlackMarketSeller.findOneAndUpdate(
                { userId: user.id },
                {
                    userId: user.id,
                    hiredAt: new Date(),
                    hiredBy: interaction.user.id,
                    method: 'manual',
                    isActive: true
                },
                { upsert: true, new: true }
            );

            // Log
            const logChannelId = config.blackMarket?.channels?.logs?.id || config.logChannels?.hiring?.id;
            const logChannel = interaction.guild.channels.cache.get(logChannelId);

            const embed = embedCustom(0x2E8B57, '🤝 توظيف جديد (بلاك ماركت)',
                `تم توظيف <@${user.id}> في البلاك ماركت.`)
                .addFields(
                    { name: '👤 العضو', value: `<@${user.id}> (${user.tag})`, inline: true },
                    { name: '👮‍♂️ بواسطة', value: `<@${interaction.user.id}>`, inline: true },
                    { name: '🏷️ الرتبة', value: `<@&${roleId}>`, inline: true },
                    { name: '📅 التاريخ', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
                );

            if (logChannel) await logChannel.send({ embeds: [embed] });

            await interaction.editReply(`✅ **تم توظيف <@${user.id}> بنجاح وإعطاؤه رتبة ${role.name}.**`);

            // Notify User
            await user.send(`🎉 **مبارك!** تم تعيينك كـ **${roleType === 'member' ? 'بائع' : 'مسؤول'}** في البلاك ماركت!`).catch(() => { });

        } catch (error) {
            console.error(error);
            await interaction.editReply('❌ حدث خطأ أثناء إعطاء الرتبة.');
        }
    }
};
