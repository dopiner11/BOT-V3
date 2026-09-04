import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import Application from '../models/Application.js';
import Blacklist from '../models/Blacklist.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logHiring } from './logSystem.js';
import { custom as embedCustom } from './embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
    try {
        return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    } catch (error) {
        return { application: { questions: [] }, channels: {}, roles: {}, permissions: {} };
    }
}

export async function handleButtonInteraction(interaction) {
    const { customId } = interaction;
    try {
        // Ticket Panel Selection
        if (customId === 'ticket_select' && interaction.isStringSelectMenu?.()) {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }

            const selectedValue = interaction.values[0];

            // Check if user already has an open ticket
            const { default: Ticket } = await import('../models/Ticket.js');
            const existingTicket = await Ticket.findOne({ userId: interaction.user.id, status: { $in: ['open', 'claimed'] } });

            if (existingTicket) {
                const isValidChannel = interaction.guild.channels.cache.has(existingTicket.channelId);
                if (isValidChannel) {
                    return await interaction.editReply(`❌ **لديك تذكرة مفتوحة بالفعل:** <#${existingTicket.channelId}>`);
                }

                // If channel invalid, we auto-close it in DB
                existingTicket.status = 'closed';
                existingTicket.closeReason = 'تم الحذف يدوياً (القناة غير موجودة)';
                await existingTicket.save();
            }

            const { createTicket } = await import('./ticketManager.js');
            try {
                const result = await createTicket(interaction.guild, interaction.user.id, selectedValue);
                // createTicket sends the welcome message, we just confirm here.
                await interaction.editReply(`✅ **تم إنشاء تذكرتك بنجاح:** <#${result.channelId}>`);
            } catch (error) {
                console.error(error);
                await interaction.editReply('❌ حدث خطأ أثناء إنشاء التذكرة. حاول مرة أخرى لاحقاً.');
            }
            return;
        }

        // Application Start
        if (customId === 'start_application' || customId === 'apply_button') {
            return await handleApplicationStart(interaction);
        }

        // Application Selection (Menu)
        if (customId === 'application_select' && interaction.isStringSelectMenu?.()) {
            const selected = interaction.values[0];
            if (selected === 'apply_family') {
                return await handleApplicationStart(interaction);
            } else if (selected === 'apply_blackmarket') {
                return await handleBlackMarketApplicationStart(interaction);
            }
        }

        // Ticket Management
        if (customId.startsWith('claim_ticket_')) {
            const { claimTicket } = await import('./ticketManager.js');
            return await claimTicket(interaction, customId.split('_').pop());
        }
        if (customId.startsWith('unclaim_ticket_')) {
            const { unclaimTicket } = await import('./ticketManager.js');
            return await unclaimTicket(interaction, customId.split('_').pop());
        }
        if (customId.startsWith('close_ticket_')) {
            const { closeTicket } = await import('./ticketManager.js');
            return await closeTicket(interaction, customId.split('_').pop());
        }
        if (customId.startsWith('add_user_ticket_')) {
            const { addUserToTicket } = await import('./ticketManager.js');
            return await addUserToTicket(interaction, customId.split('_').pop());
        }
        if (customId.startsWith('finish_application_')) {
            const { finishApplication } = await import('./ticketManager.js');
            return await finishApplication(interaction, customId.split('_').pop());
        }
        if (customId.startsWith('rename_ticket_app_')) {
            const { handleRenameTicketApp } = await import('./ticketManager.js');
            return await handleRenameTicketApp(interaction, customId.split('_').pop());
        }
        if (customId.startsWith('notify_ticket_')) {
            const { handleNotifyTicketOwner } = await import('./ticketManager.js');
            return await handleNotifyTicketOwner(interaction, customId.split('_').pop());
        }

        // Application Review Actions
        if (customId.startsWith('accept_application_')) {
            return await handleApplicationAccept(interaction);
        }
        if (customId.startsWith('reject_application_')) {
            return await handleApplicationReject(interaction);
        }

        if (customId.startsWith('accept_bm_app_')) {
            return await handleBlackMarketApplicationAccept(interaction);
        }
        if (customId.startsWith('reject_bm_app_')) {
            return await handleApplicationReject(interaction);
        }

        if (customId.startsWith('end_bm_app_')) {
            const { handleEndBMApp } = await import('./ticketManager.js');
            return await handleEndBMApp(interaction, customId.split('_').pop());
        }

        if (customId.startsWith('bm_stats_page_')) {
            const { handleBMStatsPagination } = await import('../commands/bmStats.js');
            return await handleBMStatsPagination(interaction, customId.replace('bm_stats_page_', ''));
        }

        // Manual Promotion Actions (New System)
        if (customId.startsWith('force_prom_') || customId.startsWith('reject_prom_')) {
            const { handlePromotionButton } = await import('../commands/promotion.js');
            return await handlePromotionButton(interaction);
        }

        // Nomination System
        if (customId.startsWith('nom_acc_') || customId.startsWith('nom_rej_')) {
            const { handleNominationButton } = await import('../commands/nomination.js');
            return await handleNominationButton(interaction);
        }

        // Market System
        if (customId === 'bm_post_product_select' && interaction.isStringSelectMenu?.()) {
            const { handlePostProductSelect } = await import('./marketHandler.js');
            return await handlePostProductSelect(interaction);
        }
        if (customId.startsWith('buy_product_')) {
            const { handleBuyProduct } = await import('./marketHandler.js');
            return await handleBuyProduct(interaction);
        }
        if (customId.startsWith('edit_qty_btn_')) {
            const { handleEditProductQty } = await import('./marketHandler.js');
            return await handleEditProductQty(interaction);
        }
        if (customId.startsWith('delete_product_btn_')) {
            const { handleDeleteProduct } = await import('./marketHandler.js');
            return await handleDeleteProduct(interaction);
        }

        // Sales Lifecycle
        if (customId.startsWith('end_sale_')) {
            const { handleEndSale } = await import('./marketHandler.js');
            return await handleEndSale(interaction);
        }
        if (customId.startsWith('approve_sale_')) {
            const { handleApproveSale } = await import('./marketHandler.js');
            return await handleApproveSale(interaction);
        }
        if (customId.startsWith('reject_sale_')) {
            const { handleRejectSale } = await import('./marketHandler.js');
            return await handleRejectSale(interaction);
        }
        if (customId.startsWith('rate_seller_')) {
            const { handleRateSeller } = await import('./marketHandler.js');
            return await handleRateSeller(interaction);
        }
        if (customId.startsWith('claim_request_')) {
            const { handleClaimRequest } = await import('./marketHandler.js');
            return await handleClaimRequest(interaction);
        }

        // Ticket Rating
        if (customId.startsWith('rate_ticket_')) {
            const { handleTicketRating } = await import('./ticketManager.js');
            return await handleTicketRating(interaction);
        }

        // Report Seller
        if (customId.startsWith('complaint_seller_')) {
            const { handleReportSeller } = await import('./marketHandler.js');
            return await handleReportSeller(interaction);
        }

        // Panel Main Buttons
        if (customId === 'bm_request_product_btn') {
            const { showOrderRequestModal } = await import('./marketHandler.js');
            return await showOrderRequestModal(interaction);
        }
        if (customId === 'bm_seller_dashboard_btn') {
            const { showSellerDashboard } = await import('./marketHandler.js');
            return await showSellerDashboard(interaction);
        }

        // Pass-through for command-local collectors (awaitMessageComponent / MessageComponentCollector)
        if (customId.startsWith('confirm_fire_') || customId.startsWith('cancel_fire_')) return;
        if (customId.startsWith('confirm_bl_') || customId.startsWith('cancel_bl_')) return;
        if (customId === 'mp_prev' || customId === 'mp_next') return;
        if (customId === 'warning_type_select' || customId === 'warning_confirm') return;
        if (customId.startsWith('view_all_warnings_') || customId.startsWith('warning_stats_')) return;

        // أزرار التصويت
        if (customId.startsWith('vote_yes_')) {
            const { handleVoteYes } = await import('./voteManager.js');
            return await handleVoteYes(interaction);
        }
        if (customId.startsWith('vote_no_')) {
            const { handleVoteNo } = await import('./voteManager.js');
            return await handleVoteNo(interaction);
        }
        if (customId.startsWith('vote_voters_')) {
            const { handleVoteVoters } = await import('./voteManager.js');
            return await handleVoteVoters(interaction);
        }
        if (customId.startsWith('vote_reasons_')) {
            const { handleVoteReasons } = await import('./voteManager.js');
            return await handleVoteReasons(interaction);
        }

        // Refresh Panel
        if (customId === 'refresh_ticket_panel') {
            await interaction.deferUpdate();
            const { StringSelectMenuBuilder } = await import('discord.js');

            const oldMenu = interaction.message.components[0]?.components[0];
            if (!oldMenu) return;

            // جلب نفس الـ embed من الرسالة الأصلية
            const existingEmbed = interaction.message.embeds?.[0];
            const embed = existingEmbed ? EmbedBuilder.from(existingEmbed) : null;

            const options = oldMenu.options.map(opt => ({
                label: opt.label,
                value: opt.value,
                description: opt.description,
                emoji: opt.emoji
            }));

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('ticket_select')
                .setPlaceholder('اختر نوع التذكرة...')
                .addOptions(options);

            const row1 = new ActionRowBuilder().addComponents(selectMenu);
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('refresh_ticket_panel')
                    .setLabel('تحديث الازرار')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔄')
            );

            await interaction.message.edit({ embeds: embed ? [embed] : [], components: [row1, row2] });
            await interaction.followUp({ content: '✅ تم تحديث القائمة بنجاح!', flags: MessageFlags.Ephemeral });
            return;
        }

        // Fallback - acknowledge with defer to avoid 3s expiry
        if (!interaction.deferred && !interaction.replied) {
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                await interaction.editReply({ content: '❌ الزر غير معروف أو منتهي الصلاحية.' });
            } catch (fallbackErr) {
                if (fallbackErr.code !== 10062) console.error('Fallback reply error:', fallbackErr);
            }
        }
    } catch (error) {
        if (error.code !== 10062) console.error('Error in handleButtonInteraction:', error);
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                await interaction.editReply({ content: '❌ حدث خطأ أثناء معالجة الطلب.' });
            }
        } catch (e) {
            if (e.code !== 10062 && e.code !== 40060) console.error('Error reply failed:', e);
        }
    }
}

function getRemainingCooldown(userId, maxDays = 3) {
    return Application.findOne({ userId, status: 'pending' }).then(app => {
        if (!app) return 0;
        const elapsed = Date.now() - new Date(app.createdAt).getTime();
        const maxMs = maxDays * 86400000;
        const remaining = maxMs - elapsed;
        return remaining > 0 ? remaining : 0;
    });
}

async function handleApplicationStart(interaction) {
    const config = loadConfig();
    const black = await Blacklist.findOne({ userId: interaction.user.id, isActive: true });
    if (black) {
        return interaction.reply({
            content: `❌ **أنت في القائمة السوداء ولا يمكنك التقديم!**\n**السبب:** ${black.reason}\n**المدة:** ${black.isPermanent ? 'دائمة' : `${black.duration} يوم`}`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Anti-spam: check pending applications
    const cooldown = await getRemainingCooldown(interaction.user.id);
    if (cooldown > 0) {
        const hours = Math.ceil(cooldown / 3600000);
        return interaction.reply({
            content: `❌ **لديك تقديم قيد المراجعة بالفعل!**\nتقديمك الحالي ما زال قيد المراجعة.\n✅ إذا لم يتم الرد عليك خلال 3 أيام، يمكنك التقديم مجدداً.\n⏳ الوقت المتبقي: ${hours} ساعة`,
            flags: MessageFlags.Ephemeral
        });
    }

    const questions = config.application?.questions || [];
    if (!questions.length) return interaction.reply({ content: '❌ نظام التقديم مغلق حالياً أو الأسئلة غير مضبوطة.', flags: MessageFlags.Ephemeral });

    const modal = new ModalBuilder().setCustomId('application_modal').setTitle('التقديم للعائلة');
    questions.slice(0, 5).forEach((q, i) => {
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId(`question_${i}`).setLabel(q.substring(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1000)
        ));
    });

    // DEBUG: Log breakdown
    console.log(`Debug Modal Application: Questions Len=${questions.length}, Rows=${modal.components.length}`);
    modal.components.forEach((row, idx) => {
        console.log(`Row ${idx}: ${row.components.length} components`);
    });

    await interaction.showModal(modal).catch(() => {});
}

async function handleApplicationAccept(interaction) {
    await interaction.deferUpdate();
    const applicationId = interaction.customId.split('_').pop();
    const app = await Application.findById(applicationId);

    if (!app) return interaction.followUp({ content: '❌ تعذر العثور على التقديم.', flags: MessageFlags.Ephemeral });
    if (app.status !== 'pending') return interaction.followUp({ content: '❌ تم اتخاذ قرار مسبقاً بشأن هذا التقديم.', flags: MessageFlags.Ephemeral });

    try {
        const { createTicket } = await import('./ticketManager.js');
        const ticket = await createTicket(interaction.guild, app.userId, 'application');

        app.status = 'accepted';
        app.reviewedBy = interaction.user.id;
        app.reviewedAt = new Date();
        app.ticketChannelId = ticket.channelId;
        await app.save();

        try {
            const { autoStartWorkflow } = await import('./applicationWorkflow.js');
            await autoStartWorkflow(interaction.guild, interaction.client, ticket.ticketNumber);
        } catch (wfErr) { console.error('❌ خطأ في بدء workflow التلقائي:', wfErr.message); }

        const statusText = `✅ **تم القبول وإنشاء التذكرة**\n` +
            `**👤 المستخدم:** <@${app.userId}>\n` +
            `**👮‍♂️ قبل بواسطة:** <@${interaction.user.id}>\n` +
            `**🎫 التذكرة:** <#${ticket.channelId}> (#${ticket.ticketNumber || 'بدون رقم'})\n` +
            `**⏰ الوقت:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
            `📌 **ملاحظة:** يرجى الانتقال إلى التذكرة لمتابعة إجراءات القبول النهائية ومنح الأدوار.`;

        try {
            const embedReply = EmbedBuilder.from(interaction.message.embeds[0]).setColor('#00FF00')
                .addFields({ name: '✅ الحالة - تم القبول', value: statusText });
            await interaction.editReply({ embeds: [embedReply], components: [] });
        } catch {}

        const user = await interaction.client.users.fetch(app.userId).catch(() => null);
        if (user) {
            await user.send(`✅ **تم قبول تقديمك!**\nيرجى متابعة الإجراءات في الروم التالي: <#${ticket.channelId}>`).catch(() => { });
        }

        await logHiring(interaction.guild, {
            applicant: `<@${app.userId}>`,
            reviewer: `<@${interaction.user.id}>`,
            position: 'تقديم',
            details: `التيكت: <#${ticket.channelId}>`,
        });

    } catch (e) {
        console.error(e);
        await interaction.followUp({ content: `❌ حدث خطأ في إنشاء التيكت: ${e.message}`, flags: MessageFlags.Ephemeral });
    }
}

async function handleApplicationReject(interaction) {
    const applicationId = interaction.customId.split('_').pop();
    const modal = new ModalBuilder().setCustomId(`reject_reason_${applicationId}`).setTitle('سبب الرفض');
    modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('rejection_reason').setLabel('اكتب سبب الرفض بالتفصيل').setStyle(TextInputStyle.Paragraph).setRequired(true)
    ));
    await interaction.showModal(modal).catch(() => {});
}

async function handleBlackMarketApplicationStart(interaction) {
    const config = loadConfig();
    const black = await Blacklist.findOne({ userId: interaction.user.id, isActive: true });
    if (black) {
        return interaction.reply({
            content: `❌ **أنت في القائمة السوداء ولا يمكنك التقديم!**\n**السبب:** ${black.reason}\n**المدة:** ${black.isPermanent ? 'دائمة' : `${black.duration} يوم`}`,
            flags: MessageFlags.Ephemeral
        });
    }

    // Anti-spam: check pending BM applications
    const cooldown = await getRemainingCooldown(interaction.user.id);
    if (cooldown > 0) {
        const hours = Math.ceil(cooldown / 3600000);
        return interaction.reply({
            content: `❌ **لديك تقديم بلاك ماركت قيد المراجعة بالفعل!**\nإذا لم يتم الرد عليك خلال 3 أيام، يمكنك التقديم مجدداً.\n⏳ الوقت المتبقي: ${hours} ساعة`,
            flags: MessageFlags.Ephemeral
        });
    }

    const questions = config.blackMarket?.application?.questions || [];
    if (!questions.length) return interaction.reply({ content: '❌ نظام التقديم للبلاك ماركت مغلق حالياً.', flags: MessageFlags.Ephemeral });

    const modal = new ModalBuilder().setCustomId('bm_application_modal').setTitle(config.blackMarket?.application?.title || 'تقديم بلاك ماركت');
    questions.slice(0, 5).forEach((q, i) => {
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId(`bm_q_${i}`)
                .setLabel(q.substring(0, 45))
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(1000)
        ));
    });

    await interaction.showModal(modal).catch(() => {});
}

async function handleBlackMarketApplicationAccept(interaction) {
    await interaction.deferUpdate();
    const applicationId = interaction.customId.split('_').pop();
    const app = await Application.findById(applicationId);

    if (!app) return interaction.followUp({ content: '❌ تعذر العثور على التقديم.', flags: MessageFlags.Ephemeral });
    if (app.status !== 'pending') return interaction.followUp({ content: '❌ تم اتخاذ قرار مسبقاً بشأن هذا التقديم.', flags: MessageFlags.Ephemeral });

    try {
        const { createTicket } = await import('./ticketManager.js');
        const ticket = await createTicket(interaction.guild, app.userId, 'black_market_application');

        app.status = 'accepted';
        app.reviewedBy = interaction.user.id;
        app.reviewedAt = new Date();
        app.ticketChannelId = ticket.channelId;
        await app.save();

        const statusText = `✅ **تم القبول وإنشاء التذكرة**\n` +
            `**👤 المستخدم:** <@${app.userId}>\n` +
            `**👮‍♂️ قبل بواسطة:** <@${interaction.user.id}>\n` +
            `**🎫 التذكرة:** <#${ticket.channelId}> (#${ticket.ticketNumber || 'بدون رقم'})\n` +
            `📌 **ملاحظة:** يرجى الانتقال إلى التذكرة لإنهاء إجراءات التعيين.`;

        const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor('#00FF00')
            .addFields({ name: '✅ الحالة - تم القبول', value: statusText });
        await interaction.editReply({ embeds: [embed], components: [] });

        const user = await interaction.client.users.fetch(app.userId).catch(() => null);
        if (user) {
            await user.send(`✅ **تم قبول تقديمك للبلاك ماركت!**\nيرجى متابعة الإجراءات في الروم التالي: <#${ticket.channelId}>`).catch(() => { });
        }
    } catch (e) {
        console.error(e);
        await interaction.followUp({ content: `❌ حدث خطأ في إنشاء التيكت: ${e.message}`, flags: MessageFlags.Ephemeral });
    }
}
