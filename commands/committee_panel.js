import { SlashCommandBuilder, PermissionsBitField, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { refreshAllCommitteePanels } from '../utils/committeeHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, '../config.json');

export default {
    data: new SlashCommandBuilder()
        .setName('لوحة_اللجان')
        .setDescription('نشر لوحات تحكم اللجان وتحديثها (للإدارة العليا فقط)'),

    async execute(interaction) {
        // Dynamic config load for permission check
        let CONFIG;
        try {
            CONFIG = JSON.parse(readFileSync(configPath, 'utf8'));
        } catch (err) {
            return interaction.reply({ content: '❌ فشل تحميل الإعدادات.', flags: MessageFlags.Ephemeral });
        }

        // Auth check
        if (!CONFIG.committees?.authorizedUsers?.includes(interaction.user.id) &&
            !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            await refreshAllCommitteePanels(interaction.client);
            await interaction.editReply({ content: '✅ تم تحديث ونشر جميع لوحات اللجان بنجاح.' });
        } catch (error) {
            console.error('Error manual refresh panels:', error);
            await interaction.editReply({ content: '❌ حدث خطأ أثناء تحديث اللوحات.' });
        }
    }
};
