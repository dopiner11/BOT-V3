
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import Application from '../models/Application.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { warning as embedWarning, error as embedError, info as embedInfo } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function loadConfig() {
    try {
        return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    } catch (e) { return {}; }
}

console.log('✅ Modal Handler Module Loaded (V3)');

export async function handleModalSubmit(interaction) {
    const { customId } = interaction;

    try {
        // 1. New Application Submission
        if (customId === 'application_modal') {
            await handleApplicationSubmit(interaction);
            return;
        }

        if (customId === 'bm_application_modal') {
            await handleBlackMarketApplicationSubmit(interaction);
            return;
        }

        // 2. Reject Application
        if (customId.startsWith('reject_reason_')) {
            await handleRejectReasonSubmit(interaction);
            return;
        }

        // 3. Ticket Modals (Finish, Close, Add User, Rename)
        if (customId.startsWith('finish_application_modal_')) {
            const ticketNumber = customId.split('_').pop(); // Actually checks if ticketManager has specific handler
            // But ticketManager.js logic for finishApplication usually ends with showing a modal.
            // When that modal is submitted, we need to process it.
            // The modal ID in `ticketManager.js` `finishApplication` is `finish_application_modal_${ticketNumber}`.

            const userId = interaction.fields.getTextInputValue('discord_id');
            const charName = interaction.fields.getTextInputValue('character_name');
            const gameId = interaction.fields.getTextInputValue('game_id');
            const level = interaction.fields.getTextInputValue('level');
            const jobNum = interaction.fields.getTextInputValue('job_number');

            const { processFinishApplication } = await import('./ticketManager.js');
            await interaction.deferReply();
            await processFinishApplication(interaction, ticketNumber, userId, charName, gameId, level, jobNum);
            return;
        }

        if (customId.startsWith('finish_bm_app_modal_')) {
            const ticketNumber = customId.split('_').pop();
            const rankIndex = interaction.fields.getTextInputValue('rank_index');
            const discordId = interaction.fields.getTextInputValue('discord_id');

            const { processEndBMApp } = await import('./ticketManager.js');
            // processEndBMApp handles deferReply
            await processEndBMApp(interaction, ticketNumber, discordId, rankIndex);
            return;
        }

        if (customId.startsWith('post_product_modal_')) {
            const { handlePostProductModal } = await import('./marketHandler.js');
            await handlePostProductModal(interaction);
            return;
        }

        if (customId.startsWith('end_sale_modal_')) {
            const { handleEndSaleSubmit } = await import('./marketHandler.js');
            await handleEndSaleSubmit(interaction);
            return;
        }
        if (customId.startsWith('reject_sale_reason_')) {
            const { handleRejectSaleSubmit } = await import('./marketHandler.js');
            await handleRejectSaleSubmit(interaction);
            return;
        }
        if (customId.startsWith('rate_seller_modal_')) {
            const { handleRateSellerSubmit } = await import('./marketHandler.js');
            await handleRateSellerSubmit(interaction);
            return;
        }

        if (customId === 'order_request_modal') {
            const { handleOrderRequestModal } = await import('./marketHandler.js');
            await handleOrderRequestModal(interaction);
            return;
        }

        if (customId.startsWith('buy_confirm_modal_')) {
            const { handleBuyProductSubmit } = await import('./marketHandler.js');
            await handleBuyProductSubmit(interaction);
            return;
        }

        if (customId.startsWith('edit_qty_modal_')) {
            const { handleEditProductQtySubmit } = await import('./marketHandler.js');
            await handleEditProductQtySubmit(interaction);
            return;
        }

        // Ticket Rating Modal
        if (customId.startsWith('rate_ticket_modal_')) {
            const { handleTicketRatingSubmit } = await import('./ticketManager.js');
            await handleTicketRatingSubmit(interaction);
            return;
        }

        // Report Seller Modal
        if (customId.startsWith('complaint_seller_modal_')) {
            const { handleReportSellerSubmit } = await import('./marketHandler.js');
            await handleReportSellerSubmit(interaction);
            return;
        }

        if (customId.startsWith('close_reason_modal_')) {
            const ticketNumber = customId.split('_').pop();
            const reason = interaction.fields.getTextInputValue('close_reason');

            const { closeTicketWithReason } = await import('./ticketManager.js');
            await closeTicketWithReason(interaction, ticketNumber, reason);
            return;
        }

        if (customId.startsWith('add_user_modal_')) {
            const ticketNumber = customId.split('_').pop();
            // Input ID from ticketManager.js:628 is 'user_id'
            const targetId = interaction.fields.getTextInputValue('user_id');
            const { processAddUser } = await import('./ticketManager.js');
            // Check if function exists, then call it. Note processAddUser takes (interaction, ticketNumber, userId)
            if (processAddUser) {
                // processAddUser handles deferReply internally or we should do it?
                // Looking at ticketManager.js:642, it starts with console.log, then some logic.
                // It does NOT defer. It uses `editReply`. So we MUST defer here first.
                await interaction.deferReply();
                await processAddUser(interaction, ticketNumber, targetId);
            }
            return;
        }

        if (customId.startsWith('rename_ticket_modal_app_')) {
            const ticketNumber = customId.split('_').pop();
            const newName = interaction.fields.getTextInputValue('new_name');
            const { handleRenameTicketModal } = await import('./ticketManager.js');
            if (handleRenameTicketModal) await handleRenameTicketModal(interaction, ticketNumber, newName);
            return;
        }

        // مودال محتوى التصويت
        if (customId.startsWith('vote_content_modal_')) {
            const { publishVote } = await import('./voteManager.js');
            return await publishVote(interaction);
        }

        // مودال رفض التصويت (سبب اختياري)
        if (customId.startsWith('vote_no_modal_')) {
            const { handleVoteNoModal } = await import('./voteManager.js');
            return await handleVoteNoModal(interaction);
        }

    } catch (error) {
        console.error('Modal Handler Error:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral });
        }
    }
}

async function handleApplicationSubmit(interaction) {
    const config = loadConfig();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Collect answers
    const answers = [];
    const questions = config.application?.questions || [];

    // Assuming 5 questions max as per buttonHandler
    for (let i = 0; i < 5; i++) {
        try {
            const ans = interaction.fields.getTextInputValue(`question_${i}`);
            if (ans) {
                answers.push({
                    question: questions[i] || `Question ${i + 1}`,
                    answer: ans
                });
            }
        } catch (e) { }
    }

    const app = new Application({
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        answers: answers,
        status: 'pending',
        createdAt: new Date()
    });

    await app.save();

    // Send to Review Channel
    const reviewChannelId = config.application?.channels?.adminApplications?.id || config.application?.channels?.applications?.id;
    const reviewChannel = interaction.guild.channels.cache.get(reviewChannelId);

    if (reviewChannel) {
        const embedFields = [
            { name: '👤 المتقدم', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
            { name: '🆔 ID', value: interaction.user.id, inline: true },
            { name: '⏰ وقت التقديم', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
            ...answers.map((ans, i) => ({ name: `❓ ${ans.question}`, value: `> ${ans.answer}`, inline: false })),
        ];
        const embed = embedWarning('📝 تقديم جديد للعائلة', null, embedFields);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`accept_application_${app._id}`).setLabel('✅ قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_application_${app._id}`).setLabel('❌ رفض').setStyle(ButtonStyle.Danger)
        );

        const msg = await reviewChannel.send({ embeds: [embed], components: [row] });
        app.messageId = msg.id;
        app.channelId = reviewChannel.id; // Store review channel ID
        await app.save();
    }

    await interaction.editReply('✅ **تم إرسال تقديمك بنجاح!** سيتم مراجعته قريباً.');
}

async function handleRejectReasonSubmit(interaction) {
    await interaction.deferUpdate();
    const applicationId = interaction.customId.replace('reject_reason_', '');
    const reason = interaction.fields.getTextInputValue('rejection_reason');

    const app = await Application.findById(applicationId);
    if (!app) return interaction.followUp({ content: '❌ التقديم غير موجود.', flags: MessageFlags.Ephemeral });

    app.status = 'rejected';
    app.reviewedBy = interaction.user.id;
    app.reviewedAt = new Date();
    app.rejectionReason = reason;
    await app.save();

    // Update Staff Message
    if (app.channelId && app.messageId) {
        try {
            const channel = await interaction.guild.channels.fetch(app.channelId);
            if (channel && channel.isTextBased()) {
                const msg = await channel.messages.fetch(app.messageId).catch(() => null);
                if (msg) {
                    const embed = EmbedBuilder.from(msg.embeds[0]).setColor('#FF0000')
                        .addFields({ name: '❌ الحالة - تم الرفض', value: `بواسطة: <@${interaction.user.id}>\nالسبب: ${reason}` });
                    await msg.edit({ embeds: [embed], components: [] });
                }
            }
        } catch (e) {
            console.error('Failed to update rejection message:', e);
        }
    }

    const rejectedUser = await interaction.client.users.fetch(app.userId).catch(() => null);
    if (rejectedUser) {
        await dmUser(rejectedUser, embedError('❌ تم رفض تقديمك',
            `للاسف تم رفض تقديمك للعائلة.\n\n**السبب:**\n${reason}`));
    }

    await interaction.followUp({ content: '✅ تم رفض التقديم بنجاح.', flags: MessageFlags.Ephemeral });
}

async function handleBlackMarketApplicationSubmit(interaction) {
    const config = loadConfig();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Collect answers
    const answers = [];
    const questions = config.blackMarket?.application?.questions || [];

    for (let i = 0; i < 5; i++) {
        try {
            const ans = interaction.fields.getTextInputValue(`bm_q_${i}`);
            if (ans) {
                answers.push({
                    question: questions[i] || `Question ${i + 1}`,
                    answer: ans
                });
            }
        } catch (e) { }
    }

    const app = new Application({
        userId: interaction.user.id,
        userTag: interaction.user.tag,
        type: 'black_market',
        answers: answers,
        status: 'pending',
        createdAt: new Date()
    });

    await app.save();

    // Send to Review Channel
    const reviewChannelId = config.application?.channels?.adminApplications?.id || config.application?.channels?.applications?.id;
    const reviewChannel = interaction.guild.channels.cache.get(reviewChannelId);
    if (reviewChannel) {
        const embedFields = [
            { name: '👤 المتقدم', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
            { name: '🆔 ID', value: interaction.user.id, inline: true },
            { name: '⏰ وقت التقديم', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
            ...answers.map((ans, i) => ({ name: `❓ ${ans.question}`, value: `> ${ans.answer}`, inline: false })),
        ];
        const embed = embedInfo('🩸 تقديم جديد للبلاك ماركت', null, embedFields);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`accept_bm_app_${app._id}`).setLabel('✅ قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_bm_app_${app._id}`).setLabel('❌ رفض').setStyle(ButtonStyle.Danger)
        );

        const msg = await reviewChannel.send({ embeds: [embed], components: [row] });
        app.messageId = msg.id;
        app.channelId = reviewChannel.id;
        await app.save();
    } else {
        console.warn('BM Approval channel not configured or found.');
    }

    await interaction.editReply('✅ **تم إرسال تقديمك للبلاك ماركت بنجاح!**');
}
