
import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits, MessageFlags, ButtonBuilder, ButtonStyle } from 'discord.js';
import { custom as embedCustom } from '../utils/embedStyles.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
    try {
        return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    } catch (error) {
        return null;
    }
}

function saveConfig(config) {
    try {
        writeFileSync(join(__dirname, '../config.json'), JSON.stringify(config, null, 2), 'utf8');
    } catch (error) {
        console.error('Failed to save config:', error);
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('ticket_panel')
        .setDescription('ارسال بنل التذاكر (Send Ticket Panel)')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('القناة التي سيتم إرسال البنل إليها')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const config = loadConfig();
        if (!config || !config.ticketSystem) {
            return interaction.reply({ content: '❌ إعدادات نظام التذاكر مفقودة في config.json', flags: MessageFlags.Ephemeral });
        }

        const { panelTitle, panelDescription, panelImage, types, panelChannelId: { id: panelChannelId } = {}, panelMessageId } = config.ticketSystem;

        const embed = embedCustom(0x2B2D31, panelTitle || 'نظام التذاكر', panelDescription || 'الرجاء اختيار القسم المناسب لطلبك');

        if (panelImage) {
            embed.setImage(panelImage);
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket_select')
            .setPlaceholder('اختر نوع التذكرة...')
            .addOptions(
                types.map(type =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(type.label)
                        .setValue(type.value)
                        .setDescription(type.description)
                        .setEmoji(type.emoji || '🎫')
                )
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        // Priority: Selected Channel > Config Channel > Current Channel
        const selectedChannel = interaction.options.getChannel('channel');
        let targetChannel = selectedChannel;

        if (!targetChannel && panelChannelId) {
            const ch = interaction.guild.channels.cache.get(panelChannelId);
            if (ch) targetChannel = ch;
        }

        if (!targetChannel) targetChannel = interaction.channel;

        // Clean up ALL old panels in the target channel
        if (targetChannel) {
            try {
                // Fetch recent messages to find duplicates
                const messages = await targetChannel.messages.fetch({ limit: 50 });
                const oldPanels = messages.filter(m =>
                    m.author.id === interaction.client.user.id &&
                    m.embeds.length > 0 &&
                    (m.embeds[0].title === (panelTitle || 'نظام التذاكر') || m.embeds[0].title === 'نظام التذاكر')
                );

                if (oldPanels.size > 0) {
                    // Try bulk delete first
                    await targetChannel.bulkDelete(oldPanels).catch(async () => {
                        // Fallback: delete one by one if older than 14 days
                        for (const msg of oldPanels.values()) {
                            await msg.delete().catch(() => { });
                        }
                    });
                }
            } catch (e) {
                console.log('Error cleaning up old panels:', e);
            }
        }

        const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('refresh_ticket_panel')
                .setLabel('تحديث الازرار')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🔄')
        );

        const sentMsg = await targetChannel.send({ embeds: [embed], components: [row, buttonRow] });

        // Save new info
        config.ticketSystem.panelMessageId = sentMsg.id;
        config.ticketSystem.panelChannelId.id = targetChannel.id;
        saveConfig(config);

        if (targetChannel.id !== interaction.channel.id) {
            await interaction.reply({ content: `✅ تم تحديث البنل في <#${targetChannel.id}>`, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.reply({ content: '✅ تم تحديث البنل بنجاح', flags: MessageFlags.Ephemeral });
        }
    }
};
