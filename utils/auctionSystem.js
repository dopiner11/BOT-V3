import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, MessageFlags, ChannelType, PermissionFlagsBits, StringSelectMenuBuilder, EmbedBuilder } from 'discord.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Auction from '../models/Auction.js';
import Ticket from '../models/Ticket.js';
import AuctionBlacklist from '../models/AuctionBL.js';
import { createTicketButtons } from './ticketManager.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, neutral as embedNeutral, gold as embedGold, custom as embedCustom } from './embedStyles.js';
import { dmUser } from './notificationSystem.js';
import { logPoints, logAuction } from './logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let CONFIG;
function loadConfig() {
    try { CONFIG = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8')); } catch (err) { CONFIG = { auctions: {} }; }
    return CONFIG;
}
loadConfig();

async function isBlacklisted(userId) {
    const dbBlacklist = await AuctionBlacklist.findOne({ userId });
    if (dbBlacklist) {
        // Check if expired
        if (dbBlacklist.expiresAt && new Date(dbBlacklist.expiresAt) <= new Date()) {
            await AuctionBlacklist.deleteOne({ _id: dbBlacklist._id });
            return { blacklisted: false };
        }
        return { blacklisted: true, reason: dbBlacklist.reason };
    }
    return { blacklisted: false };
}

// Cache active auctions: messageId -> MongooseDocument
// We attach _countdownInterval to the document instance in memory.
const activeAuctions = new Map();

// Helper to get auction from Map or fallback to DB
async function getAuction(messageId) {
    if (activeAuctions.has(messageId)) return activeAuctions.get(messageId);

    try {
        const auc = await Auction.findOne({ messageId, isActive: true });
        if (auc) {
            activeAuctions.set(messageId, auc);
            // Don't start interval here to avoid multiple timers if called frequently, 
            // the main loading loop handles timers, or we can lazy start it if needed.
            return auc;
        }
    } catch (e) {
        console.error('Error fetching auction from DB fallback:', e);
    }
    return null;
}

// Helpers
function getTimeRemaining(endTime) {
    return Math.max(0, new Date(endTime).getTime() - Date.now());
}

function formatTimeRemaining(endTime) {
    const rem = getTimeRemaining(endTime);
    if (rem <= 0) return 'انتهى الوقت';
    const s = Math.floor(rem / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}س ${m}د ${sec}ث`;
}

function startDetailedCountdown(client, auc) {
    // Clear existing if any
    if (auc._countdownInterval) clearInterval(auc._countdownInterval);

    auc._countdownInterval = setInterval(async () => {
        const remaining = getTimeRemaining(auc.endTime);
        if (remaining <= 0) {
            clearInterval(auc._countdownInterval);
            // Verify if still active before ending
            if (activeAuctions.has(auc.messageId)) {
                await endAuction(client, auc.messageId, '⏰ انتهاء الوقت');
            }
            return;
        }

        // Update embed every 15s
        try {
            const ch = await client.channels.fetch(auc.channelId).catch(() => null);
            if (!ch) return;
            const msg = await ch.messages.fetch(auc.messageId).catch(() => null);
            if (msg) {
                const emb = EmbedBuilder.from(msg.embeds[0]);
                // Find time field (usually has emoji or specific name)
                const timeField = emb.data.fields.find(f => f.name.includes('وقت') || f.name.includes('TIME') || f.name.includes('⏰') || f.name.includes('تنازلي'));

                if (timeField) {
                    const newVal = formatTimeRemaining(auc.endTime);
                    if (timeField.value !== newVal) {
                        timeField.value = newVal;
                        await msg.edit({ embeds: [emb] }).catch(() => { });
                    }
                }
            }
        } catch (e) {
            // minor error ignore
        }
    }, 15000);
}

// Exports
export async function loadActiveAuctions(client) {
    try {
        const auctions = await Auction.find({ isActive: true });
        for (const auc of auctions) {
            if (getTimeRemaining(auc.endTime) <= 0) {
                await endAuction(client, auc.messageId, 'انتهاء الوقت (تلقائي)');
            } else {
                activeAuctions.set(auc.messageId, auc);
                startDetailedCountdown(client, auc);
            }
        }
        console.log(`💰 Loaded ${activeAuctions.size} active auctions.`);
    } catch (error) {
        console.error('❌ Failed to load active auctions:', error);
    }
}

export async function createAuction(interaction, details) {
    try {
        const auction = new Auction({
            ...details,
            currentPrice: details.startPrice,
            isActive: true,
            // Ensure ownerId is set
            ownerId: details.ownerId || details.creatorId
        });

        await auction.save();
        activeAuctions.set(auction.messageId, auction);
        startDetailedCountdown(interaction.client, auction);
        return auction;
    } catch (error) {
        console.error('Auction Creation DB Error:', error);
        throw error;
    }
}

export async function logAuctionAction(guild, actionName, details) {
    await logPoints(guild, {
        target: { id: details.user?.id || 'unknown' },
        mod: { id: 'system' },
        points: 0,
        before: 0,
        after: 0,
        reason: `مزاد: ${actionName} - ${details.productName || 'غير محدد'}${details.amount ? ` - ${details.amount}$` : ''}`,
    });
}

export async function endAuction(client, messageId, reason) {
    try {
        const auc = await Auction.findOne({ messageId });
        if (!auc || !auc.isActive) return;

        // Validation Fix: Ensure ownerId
        if (!auc.ownerId) auc.ownerId = auc.creatorId || 'Unknown';

        auc.isActive = false;
        await auc.save();

        // Clear interval from cache
        const cached = activeAuctions.get(messageId);
        if (cached && cached._countdownInterval) clearInterval(cached._countdownInterval);
        activeAuctions.delete(messageId);

        const channel = await client.channels.fetch(auc.channelId).catch(() => null);
        if (!channel) return;

        // Create Ticket if there is a winner
        if (auc.highestBidder && auc.highestBidder.userId) {
            try {
                await createAuctionTicket(channel.guild, auc, reason);
            } catch (err) {
                console.error('Failed to create auction ticket:', err);
                // Continue to end auction in channel
            }
        }


        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) {
            const oldEmbed = EmbedBuilder.from(msg.embeds[0]);
            oldEmbed.setColor(0xFF0000);
            oldEmbed.setTitle(`🔴 مزاد منتهي - ${auc.productName}`);

            const components = msg.components.map(row => {
                const newRow = new ActionRowBuilder();
                row.components.forEach(comp => {
                    const builder = ButtonBuilder.from(comp);
                    builder.setDisabled(true);
                    newRow.addComponents(builder);
                });
                return newRow;
            });

            await msg.edit({ embeds: [oldEmbed], components }).catch(() => { });
        }

        if (auc.highestBidder && auc.highestBidder.userId) {
            await channel.send({
                content: `🎉 **مبروك!** فاز بالمزاد <@${auc.highestBidder.userId}> بسعر **${auc.currentPrice}**\nالسبب: ${reason}`
            });

            await logAuction(channel.guild, {
                event: 'انتهاء مزاد - فوز',
                productName: auc.productName,
                price: auc.currentPrice,
                winner: `<@${auc.highestBidder.userId}>`,
            });

        } else {
            await channel.send(`📭 انتهى المزاد على **${auc.productName}** بدون أي مزايدات.\nالسبب: ${reason}`);
            await logAuction(channel.guild, {
                event: 'انتهاء مزاد - بدون فائز',
                productName: auc.productName,
                details: reason,
            });
        }
    } catch (error) {
        console.error(`❌ Error ending auction ${messageId}:`, error);
        // Do not rethrow to avoid crashing timers
    }
}

async function createAuctionTicket(guild, auc, reason) {
    const winnerId = auc.highestBidder.userId;
    const ownerId = auc.ownerId;

    // 1. Get next Ticket Number
    const lastTickets = await Ticket.find({}, { ticketNumber: -1 }, 1);
    const lastTicket = lastTickets[0] || null;
    const ticketNumber = lastTicket ? lastTicket.ticketNumber + 1 : 100;

    // 2. Determine Category
    // Try to get category from config for 'auction_request', fallback to general ticket category
    const ticketConfig = CONFIG.ticketSystem?.types?.find(t => t.value === 'auction_request');
    const categoryId = ticketConfig?.categoryId || CONFIG.auctions?.categoryId || CONFIG.general?.categories?.tickets?.id;

    // 3. Create Channel
    const ticketName = `🎫-تذكرة-${ticketNumber}`;
    const ticketChannel = await guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: [
            {
                id: guild.id,
                deny: [PermissionFlagsBits.ViewChannel],
            },
            {
                id: winnerId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
            },
            {
                id: ownerId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
            },
            // Admin Role
            ...(CONFIG.auctions?.adminRoleId ? [{
                id: CONFIG.auctions.adminRoleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }] : [])
        ]
    });

    // 4. Save to DB (So standard buttons work)
    const ticket = new Ticket({
        ticketNumber,
        channelId: ticketChannel.id,
        userId: winnerId, // Main owner of the ticket
        type: 'auction_request',
        status: 'open',
        createdAt: new Date()
    });
    await ticket.save();

    // 5. Send Embed with Standard Buttons
    const embed = embedSuccess(
        `🎫 تذكرة مزاد رقم #${ticketNumber}`,
        `مرحباً <@${winnerId}> و <@${ownerId}>\n\n**لقد انتهى المزاد بنجاح!**\n\n💰 **السعر النهائي:** ${auc.currentPrice}$\n📦 **المنتج:** ${auc.productName}\n\nيرجى الاتفاق هنا على التسليم.`,
        [
            { name: '👤 الفائز', value: `<@${winnerId}>`, inline: true },
            { name: '👤 صاحب المنتج', value: `<@${ownerId}>`, inline: true },
            { name: '🔰 الحالة', value: '🟢 **مفتوحة**', inline: true }
        ]
    ).setFooter({ text: `تذكرة #${ticketNumber} • ${guild.name}` });

    // Get standard buttons from ticketManager
    const buttons = createTicketButtons(ticketNumber, 'auction_request');

    await ticketChannel.send({
        content: `<@${winnerId}> <@${ownerId}>`,
        embeds: [embed],
        components: buttons
    });

    return ticketChannel;
}

export async function handleAuctionInteraction(interaction) {
    const { customId } = interaction;
    loadConfig();

    try {
        if (interaction.isStringSelectMenu() && customId === 'remove_bid_menu') {
            await handleRemoveBid(interaction);
            return;
        }

        if (interaction.isButton()) {
            if (customId === 'bid') await handleBidButton(interaction);
            else if (customId === 'leaders') await handleLeadersButton(interaction);
            else if (customId === 'details') await handleDetailsButton(interaction);
            else if (customId === 'end') await handleEndButton(interaction);
            else if (customId.startsWith('confirm_end_')) await handleConfirmEnd(interaction);
            else if (customId === 'cancel_end') await handleCancelEnd(interaction);
            else if (customId === 'manage_bids') await handleManageBidsButton(interaction);
            else if (customId.startsWith('remove_bid_')) await handleRemoveBid(interaction);
        }
        else if (interaction.isModalSubmit()) {
            if (customId === 'bidModal') await handleBidModal(interaction);
        }
    } catch (err) {
        console.error('Auction Interaction Error:', err);
        if (!interaction.replied && !interaction.deferred)
            await interaction.reply({ content: '❌ حدث خطأ داخلي.', flags: MessageFlags.Ephemeral }).catch(() => { });
    }
}

async function handleBidButton(interaction) {
    const auc = await getAuction(interaction.message.id);
    if (!auc || !auc.isActive) return interaction.reply({ content: '❌ هذا المزاد منتهي.', flags: MessageFlags.Ephemeral });

    // Auction Blacklist Check فقط
    const dbCheck = await isBlacklisted(interaction.user.id);
    if (dbCheck.blacklisted) {
        return interaction.reply({ content: `🚫 أنت ممنوع من المزادات.\nالسبب: ${dbCheck.reason}`, flags: MessageFlags.Ephemeral });
    }

    const blacklistRole = CONFIG.roles?.auctionBlacklist?.id;
    if (blacklistRole && interaction.member.roles.cache.has(blacklistRole)) {
        return interaction.reply({ content: '🚫 أنت ممنوع من المشاركة في المزادات.', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder().setCustomId('bidModal').setTitle('💰 المزايدة');
    modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('amount').setLabel(`السعر الحالي: ${auc.currentPrice}`).setStyle(TextInputStyle.Short).setRequired(true)
    ));
    await interaction.showModal(modal).catch(() => {});
}

async function handleBidModal(interaction) {
    await interaction.deferUpdate();
    const auc = await getAuction(interaction.message.id);

    if (!auc || !auc.isActive) return interaction.followUp({ content: '❌ انتهى المزاد!', flags: MessageFlags.Ephemeral });

    const amt = parseFloat(interaction.fields.getTextInputValue('amount'));
    if (isNaN(amt) || amt <= auc.currentPrice) {
        return interaction.followUp({ content: `❌ يجب أن يكون المبلغ أكبر من ${auc.currentPrice}`, flags: MessageFlags.Ephemeral });
    }

    // Update
    auc.bids.unshift({ userId: interaction.user.id, userName: interaction.user.username, amount: amt, time: new Date() });
    auc.currentPrice = amt;
    auc.highestBidder = { userId: interaction.user.id, userName: interaction.user.username, amount: amt };

    // Fallback ownerId just in case
    if (!auc.ownerId) auc.ownerId = auc.creatorId || 'Unknown';

    await auc.save(); // Check validation

    // Update Embed
    const emb = EmbedBuilder.from(interaction.message.embeds[0]);

    const priceField = emb.data.fields.find(f => f.name.includes('السعر') || f.name.includes('Price') || f.name.includes('Current'));
    if (priceField) priceField.value = `${amt}$`;

    const bidsField = emb.data.fields.find(f => f.name.includes('عدد') || f.name.includes('Count'));
    if (bidsField) bidsField.value = `${auc.bids.length}`;

    await interaction.message.edit({ embeds: [emb] });

    // Log
    await logAuctionAction(interaction.guild, 'New Bid', {
        productName: auc.productName,
        user: interaction.user,
        amount: amt
    });

    await interaction.followUp({ content: `✅ تمت المزايدة بـ ${amt}$`, flags: MessageFlags.Ephemeral });
}

async function handleLeadersButton(interaction) {
    const auc = await getAuction(interaction.message.id);
    if (!auc) return interaction.reply({ content: '❌ غير متوفر.', flags: MessageFlags.Ephemeral });

    const top = auc.bids.slice(0, 5);
    const emb = embedSuccess('🏆 المتصدرين');

    if (top.length === 0) emb.setDescription('لا يوجد مزايدات.');
    else top.forEach((b, i) => emb.addFields({ name: `#${i + 1} ${b.userName}`, value: `${b.amount}$` }));

    await interaction.reply({ embeds: [emb], flags: MessageFlags.Ephemeral });
}

async function handleDetailsButton(interaction) {
    const auc = await getAuction(interaction.message.id);
    if (!auc) return interaction.reply({ content: '❌ غير متوفر.', flags: MessageFlags.Ephemeral });

    const remainingStr = formatTimeRemaining(auc.endTime);

    const emb = embedSuccess(`📊 تفاصيل: ${auc.productName}`).addFields(
        { name: '💰 السعر', value: `${auc.currentPrice}$`, inline: true },
        { name: '⏰ متبقي', value: remainingStr, inline: true },
        { name: '🔢 عدد المزايدات', value: `${auc.bids.length}`, inline: true },
        { name: '👤 صاحب المزاد', value: `<@${auc.ownerId}>`, inline: true }
    );

    await interaction.reply({ embeds: [emb], flags: MessageFlags.Ephemeral });
}

async function handleEndButton(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
        return interaction.reply({ content: '❌ للأدمن فقط.', flags: MessageFlags.Ephemeral });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_end_${interaction.message.id}`).setLabel('تأكيد الإنهاء').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel_end').setLabel('إلغاء').setStyle(ButtonStyle.Secondary)
    );
    await interaction.reply({ content: '⚠️ هل أنت متأكد؟', components: [row], flags: MessageFlags.Ephemeral });
}

async function handleConfirmEnd(interaction) {
    await interaction.deferUpdate();
    const id = interaction.customId.replace('confirm_end_', '');
    await endAuction(interaction.client, id, 'إنهاء يدوي من الإدارة');
    await interaction.editReply({ content: '✅ تم الإنهاء.', components: [] });
}

async function handleCancelEnd(interaction) {
    await interaction.update({ content: '❌ ملغى.', components: [] });
}

async function handleAdminMention(interaction) {
    // Deprecated or removed feature
    await interaction.reply({ content: '❌ تم إيقاف هذا الزر.', flags: MessageFlags.Ephemeral });
}

async function handleRetractBid(interaction) {
    // Deprecated - Use Manage Bids
    await interaction.reply({ content: '❌ تم استبدال هذا الزر بلوحة التحكم بالمزايدات.', flags: MessageFlags.Ephemeral });
}
async function handleManageBidsButton(interaction) {
    const auc = await getAuction(interaction.message.id);
    if (!auc) return interaction.reply({ content: '❌ غير متوفر.', flags: MessageFlags.Ephemeral });

    // Permissions: Admin, Committees, Owner
    // Assuming committees passed checkCommitteePermission logic elsewhere, but here we can check basic roles
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    // You can add more specific committee checks here if needed
    const isOwner = interaction.user.id === auc.ownerId || interaction.user.id === auc.creatorId;

    if (!isAdmin && !isOwner) {
        // Add committee check helper if imported, otherwise loose check
        // For now, strict on admin/owner
        return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });
    }

    if (auc.bids.length === 0) {
        return interaction.reply({ content: '📭 لا يوجد مزايدات لإدارتها.', flags: MessageFlags.Ephemeral });
    }

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('remove_bid_menu')
            .setPlaceholder('اختر مزايدة لحذفها (تحذير: لا يمكن التراجع)')
            .addOptions(
                auc.bids.slice(0, 25).map((bid, i) => ({
                    label: `${bid.amount}$ - ${bid.userName}`,
                    description: `بواسطة ${bid.userId} (منذ ${formatTimeAgo(bid.time)})`,
                    value: `remove_bid_${i}_${interaction.message.id}`
                }))
            )
    );

    await interaction.editReply({ content: '🛠️ **إدارة المزايدات (حذف مزايدة)**:', components: [row] });
}

async function handleRemoveBid(interaction) {
    if (interaction.isStringSelectMenu()) {
        await interaction.deferUpdate();
        const value = interaction.values[0];
        const parts = value.split('_');
        const index = parseInt(parts[2]);
        const messageId = parts.slice(3).join('_'); // In case ID has underscores, though usually not

        const auc = await getAuction(messageId);
        if (!auc) return interaction.editReply('❌ المزاد غير موجود.');

        if (index < 0 || index >= auc.bids.length) return interaction.editReply('❌ المزايدة غير موجودة.');

        const removedBid = auc.bids[index];
        auc.bids.splice(index, 1);

        // Recalculate highest
        if (auc.bids.length > 0) {
            // Sort to find new highest just in case order messed up, but usually [0] is highest
            // Bids are unshifted, so [0] is newest/highest.
            // If we removed a middle one, the highest is still [0].
            // If we removed [0], the new [0] is highest.
            const newHighest = auc.bids[0];
            auc.currentPrice = newHighest.amount;
            auc.highestBidder = {
                userId: newHighest.userId,
                userName: newHighest.userName,
                amount: newHighest.amount
            };
        } else {
            auc.currentPrice = auc.startPrice;
            auc.highestBidder = { userId: null, userName: null, amount: null };
        }

        await auc.save();

        // Update Main Embed
        const channel = await interaction.guild.channels.fetch(auc.channelId).catch(() => null);
        if (channel) {
            const msg = await channel.messages.fetch(auc.messageId).catch(() => null);
            if (msg) {
                const emb = EmbedBuilder.from(msg.embeds[0]);
                const priceField = emb.data.fields.find(f => f.name.includes('السعر') || f.name.includes('Price') || f.name.includes('Current'));
                if (priceField) priceField.value = `${auc.currentPrice}$`;

                const bidsField = emb.data.fields.find(f => f.name.includes('عدد') || f.name.includes('Count'));
                if (bidsField) bidsField.value = `${auc.bids.length}`;

                await msg.edit({ embeds: [emb] });
            }
        }

        await interaction.editReply({ content: `✅ تم حذف مزايدة **${removedBid.amount}$** من **${removedBid.userName}**.`, components: [] });
    }
}

function formatTimeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'الآن';
    if (minutes < 60) return `${minutes}د`;
    const hours = Math.floor(minutes / 60);
    return `${hours}س`;
}
