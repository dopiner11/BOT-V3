import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits } from 'discord.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, neutral as embedNeutral, gold as embedGold, custom as embedCustom } from './embedStyles.js';
import { dmUser } from './notificationSystem.js';
import Listing from '../models/Listing.js';
import Order from '../models/Order.js';
import Ticket from '../models/Ticket.js';
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

export async function showOrderRequestModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('order_request_modal')
        .setTitle('طلب منتج');

    const productInput = new TextInputBuilder()
        .setCustomId('product_name')
        .setLabel('اسم المنتج المطلوب')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const detailsInput = new TextInputBuilder()
        .setCustomId('details')
        .setLabel('تفاصيل إضافية (الكمية، السعر المقترح)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    modal.addComponents(
        new ActionRowBuilder().addComponents(productInput),
        new ActionRowBuilder().addComponents(detailsInput)
    );

    await interaction.showModal(modal).catch(() => {});
}

export async function showSellerDashboard(interaction) {
    const config = loadConfig();
    // Check Permissions (Seller)
    const ranks = config.blackMarket?.ranks || [];
    const rankRoleIds = ranks.map(r => r.roleId).filter(id => id);

    const sellerRoleIds = [
        ...(config.committees?.list?.blackMarket?.roles?.member || []),
        ...(config.blackMarket?.roles?.member || []),
        ...rankRoleIds
    ];

    const isSeller = interaction.member.roles.cache.some(r => sellerRoleIds.includes(r.id)) ||
        interaction.member.roles.cache.some(r => (config.committees?.list?.blackMarket?.roles?.manager || []).includes(r.id)) ||
        interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isSeller) {
        return interaction.reply({ content: '❌ هذه اللوحة خاصة بالبائعين فقط.', flags: MessageFlags.Ephemeral });
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('bm_post_product_select')
        .setPlaceholder('اختر نوع المنتج...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('منتج قانوني')
                .setDescription('عرض منتج قانوني للبيع')
                .setValue('post_legal')
                .setEmoji('📦'),
            new StringSelectMenuOptionBuilder()
                .setLabel('منتج غير قانوني')
                .setDescription('عرض منتج غير قانوني (ممنوعات) للبيع')
                .setValue('post_illegal')
                .setEmoji('🔫')
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.reply({ content: '👋 مرحباً بك في لوحة البائعين. اختر نوع المنتج الذي تريد عرضه:', components: [row], flags: MessageFlags.Ephemeral });
}

export async function handlePostProductSelect(interaction) {
    const type = interaction.values[0] === 'post_legal' ? 'legal' : 'illegal';

    const modal = new ModalBuilder()
        .setCustomId(`post_product_modal_${type}`)
        .setTitle(type === 'legal' ? 'عرض منتج قانوني' : 'عرض منتج غير قانوني');

    const nameInput = new TextInputBuilder().setCustomId('product_name').setLabel('اسم المنتج').setStyle(TextInputStyle.Short).setRequired(true);
    const quantityInput = new TextInputBuilder().setCustomId('quantity').setLabel('الكمية').setStyle(TextInputStyle.Short).setRequired(true);
    const priceInput = new TextInputBuilder().setCustomId('price').setLabel('السعر (للقطعة)').setStyle(TextInputStyle.Short).setRequired(true);
    const imageInput = new TextInputBuilder().setCustomId('image').setLabel('رابط الصورة (اختياري)').setStyle(TextInputStyle.Short).setRequired(false);

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(quantityInput),
        new ActionRowBuilder().addComponents(priceInput),
        new ActionRowBuilder().addComponents(imageInput)
    );

    await interaction.showModal(modal).catch(() => {});
}

export async function handlePostProductModal(interaction) {
    const config = loadConfig();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // التحقق من أن المستخدم لا يزال بائعاً
    const rankRoleIds = (config.blackMarket?.ranks || []).map(r => r.roleId).filter(id => id);
    const sellerRoleIds = [
        ...(config.committees?.list?.blackMarket?.roles?.member || []),
        ...(config.blackMarket?.roles?.member || []),
        ...rankRoleIds
    ];
    const isStillSeller = interaction.member.roles.cache.some(r => sellerRoleIds.includes(r.id)) ||
        interaction.member.roles.cache.some(r => (config.committees?.list?.blackMarket?.roles?.manager || []).includes(r.id)) ||
        interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isStillSeller) {
        return interaction.editReply('❌ صلاحية البائع منتهية. لا يمكنك عرض منتجات جديدة.');
    }

    const type = interaction.customId.split('_').pop();
    const name = interaction.fields.getTextInputValue('product_name');
    const quantity = parseInt(interaction.fields.getTextInputValue('quantity'));
    const price = parseInt(interaction.fields.getTextInputValue('price'));
    const image = interaction.fields.getTextInputValue('image');

    if (isNaN(quantity) || quantity < 1) return interaction.editReply('❌ الكمية يجب أن تكون رقم صحيح أكبر من 0');
    if (isNaN(price) || price < 0) return interaction.editReply('❌ السعر يجب أن يكون رقم صحيح');

    const channelId = config.blackMarket?.channels?.[type]?.id;
    if (!channelId) return interaction.editReply(`❌ لم يتم تحديد قناة لبيع المنتجات من نوع ${type}`);

    const channel = interaction.guild.channels.cache.get(channelId);
    if (!channel) return interaction.editReply('❌ القناة غير موجودة');

    // Validation: Check if image is URL
    const isUrl = (string) => {
        try { return Boolean(new URL(string)); } catch (e) { return false; }
    };

    const fields = [];
    if (image && !isUrl(image)) {
        fields.push({ name: '📝 ملاحظة / رابط صورة', value: image });
    }
    const embed = (type === 'legal' ? embedSuccess : embedError)(
        name,
        `\n**👤 البائع:** <@${interaction.user.id}>\n**📦 الكمية:** ${quantity}\n**💰 السعر:** ${price.toLocaleString()} $\n**⚖️ النوع:** ${type === 'legal' ? 'قانوني' : 'غير قانوني'}`,
        fields
    );

    if (image && isUrl(image)) {
        embed.setThumbnail(image);
    } else {
        embed.setThumbnail(interaction.user.displayAvatarURL());
    }

    const listing = new Listing({
        sellerId: interaction.user.id,
        productName: name,
        quantity: quantity,
        pricePerUnit: price,
        type: type,
        imageUrl: image,
        listingId: `L-${Date.now()}`,
        messageId: 'temp',
        channelId: channelId
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`buy_product_${listing._id}`)
            .setLabel('شراء')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🛒'),
        new ButtonBuilder()
            .setCustomId(`edit_qty_btn_${listing._id}`)
            .setLabel('تعديل')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✏️'),
        new ButtonBuilder()
            .setCustomId(`delete_product_btn_${listing._id}`)
            .setLabel('حذف')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️')
    );

    const msg = await channel.send({ embeds: [embed], components: [row] });

    listing.messageId = msg.id;
    listing.listingId = listing._id.toString();
    await listing.save();

    await interaction.editReply(`✅ **تم عرض المنتج بنجاح!**\nالرابط: ${msg.url}`);
}

// 1. Show Modal for Quantity
export async function handleBuyProduct(interaction) {
    const listingId = interaction.customId.split('_').pop();
    const listing = await Listing.findById(listingId);

    if (!listing) return interaction.reply({ content: '❌ المنتج غير متوفر/محذوف.', flags: MessageFlags.Ephemeral });

    // Prevent Seller from buying own product
    if (listing.sellerId === interaction.user.id) {
        return interaction.reply({ content: '❌ لا يمكنك شراء منتجك الخاص!', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
        .setCustomId(`buy_confirm_modal_${listingId}`)
        .setTitle(`شراء: ${listing.productName}`);

    const qInput = new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel(`الكمية المطلوبة (المتوفر: ${listing.quantity})`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('1')
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(qInput));
    await interaction.showModal(modal).catch(() => {});
}

// 2. Process Buy Submit (Actual Logic)
export async function handleBuyProductSubmit(interaction) {
    const config = loadConfig();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const listingId = interaction.customId.split('_').pop();
    const reqQty = parseInt(interaction.fields.getTextInputValue('quantity'));

    if (isNaN(reqQty) || reqQty < 1) return interaction.editReply('❌ الكمية يجب أن تكون رقم صحيح 1 أو أكثر.');

    // Fetch Listing again to be safe
    const listing = await Listing.findById(listingId);
    if (!listing) return interaction.editReply('❌ المنتج غير متوفر.');

    if (listing.quantity < reqQty) {
        return interaction.editReply(`❌ الكمية غير كافية! المتوفر فقط: **${listing.quantity}**`);
    }

    // Decrement Stock
    listing.quantity -= reqQty;

    // Check if Sold Out
    const isSoldOut = listing.quantity <= 0;
    if (isSoldOut) {
        listing.isActive = false;
        listing.quantity = 0; // Ensure no negative
    }

    await listing.save();

    // Update Message
    try {
        const channel = interaction.guild.channels.cache.get(listing.channelId);
        if (channel) {
            const msg = await channel.messages.fetch(listing.messageId).catch(() => null);
            if (msg) {
                const oldEmbed = msg.embeds[0];
                let newEmbed = EmbedBuilder.from(oldEmbed);
                let newComponents = [];

                if (isSoldOut) {
                    newEmbed.setColor('#808080'); // Gray
                    newEmbed.setDescription(oldEmbed.description.replace(/\*\*📦 الكمية:\*\* \d+/, `**📦 الكمية:** 0`));
                    newEmbed.addFields({ name: '⚠️ الحالة', value: '🔴 نفذت الكمية' });

                    // All Disabled
                    newComponents = [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('disabled_1').setLabel('نفذت الكمية').setStyle(ButtonStyle.Secondary).setDisabled(true)
                    )];
                } else {
                    // Update Qty Text Only
                    newEmbed.setDescription(oldEmbed.description.replace(/\*\*📦 الكمية:\*\* \d+/, `**📦 الكمية:** ${listing.quantity}`));
                    newComponents = msg.components; // Keep existing buttons
                }

                await msg.edit({ embeds: [newEmbed], components: newComponents });
            }
        }
    } catch (e) {
        console.error('Error updating listing message:', e);
    }

    // Ticket Logic (Always create new ticket)
    try {
        const { createTicket } = await import('./ticketManager.js');
        const ticket = await createTicket(interaction.guild, interaction.user.id, 'black_market_sale');
        if (!ticket) {
            return interaction.editReply('❌ حدث خطأ في إنشاء التذكرة.');
        }
        const ticketChannelId = ticket.channelId;
        const ticketNumber = ticket.ticketNumber;

        const ticketChannel = interaction.guild.channels.cache.get(ticketChannelId);
        if (ticketChannel) {
            // Add Seller permissions
            const seller = await interaction.guild.members.fetch(listing.sellerId).catch(() => null);
            if (seller) await ticketChannel.permissionOverwrites.create(seller, {
                ViewChannel: true,
                SendMessages: true,
                AttachFiles: true,
                EmbedLinks: true
            });

            // Initial Message in Ticket
            const saleEmbed = embedGold(
                '💰 عملية شراء جديدة',
                `\n**👤 المشتري:** <@${interaction.user.id}>\n**📦 المنتج:** ${listing.productName}\n**🔢 الكمية:** ${reqQty}\n**💰 السعر الإجمالي:** ${(listing.pricePerUnit * reqQty).toLocaleString()} $\n**⚠️ ملاحظة للبائع:** عند إتمام العملية، اضغط على زر "إنهاء البيع" لتوثيقها.`
            );

            const saleRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`end_sale_${ticketNumber}_${listing._id}_${reqQty}`).setLabel('✅ إنهاء البيع').setStyle(ButtonStyle.Success)
            );

            const reportRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`complaint_seller_${listing._id}_${listing.sellerId}`).setLabel('📋 الإبلاغ عن مشكلة').setStyle(ButtonStyle.Danger).setEmoji('🚨')
            );

            await ticketChannel.send({ content: `<@${listing.sellerId}> <@${interaction.user.id}>`, embeds: [saleEmbed], components: [saleRow] });
            await ticketChannel.send({ components: [reportRow] });

            await interaction.editReply(`✅ **تم حجز المنتج (${reqQty} قطعة)!** يرجى المتابعة في التذكرة: <#${ticketChannelId}>`);
        } else {
            await interaction.editReply('❌ حدث خطأ في الوصول للتذكرة.');
        }

    } catch (e) {
        console.error(e);
        // Rollback stock on error? complicated for partial failures.
        await interaction.editReply('❌ حدث خطأ أثناء معالجة التذكرة.');
    }
}

// 3. Edit Quantity Handlers
export async function handleEditProductQty(interaction) {
    const listingId = interaction.customId.split('_').pop();
    const listing = await Listing.findById(listingId);

    if (!listing) return interaction.reply({ content: '❌ المنتج غير موجود.', flags: MessageFlags.Ephemeral });
    if (listing.sellerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ فقط البائع يمكنه تعديل المنتج.', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
        .setCustomId(`edit_qty_modal_${listingId}`)
        .setTitle('تعديل الكمية');

    const qtyInput = new TextInputBuilder()
        .setCustomId('new_quantity')
        .setLabel('الكمية الجديدة')
        .setValue(listing.quantity.toString())
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(qtyInput));
    await interaction.showModal(modal).catch(() => {});
}

export async function handleEditProductQtySubmit(interaction) {
    await interaction.deferUpdate();
    const listingId = interaction.customId.split('_').pop();
    const newQty = parseInt(interaction.fields.getTextInputValue('new_quantity'));

    if (isNaN(newQty) || newQty < 0) return interaction.followUp({ content: '❌ الكمية غير صحيحة.', flags: MessageFlags.Ephemeral });

    const listing = await Listing.findById(listingId);
    if (!listing) return;

    listing.quantity = newQty;
    if (newQty > 0) {
        listing.isActive = true;
    } else {
        listing.isActive = false;
    }
    await listing.save();

    // Update Message
    const msg = interaction.message; // Modal submit on button usually doesn't have message if from button? Waait.
    // Modal submit interaction doesn't have .message property directly if it was triggered from a button unless we look it up.
    // Actually we can just fetch via channel/listing.messageId

    const channel = interaction.guild.channels.cache.get(listing.channelId);
    if (channel) {
        const message = await channel.messages.fetch(listing.messageId).catch(() => null);
        if (message) {
            const oldEmbed = message.embeds[0];
            let newEmbed = EmbedBuilder.from(oldEmbed);

            // Regex replace Quantity
            const newDesc = oldEmbed.description.replace(/\*\*📦 الكمية:\*\* \d+/, `**📦 الكمية:** ${newQty}`);
            newEmbed.setDescription(newDesc);

            // If reactivated, remove "Sold Out" field if exists
            if (newQty > 0) {
                newEmbed.setColor(listing.type === 'legal' ? '#00FF00' : '#FF0000'); // Restore color
                const fields = oldEmbed.fields.filter(f => f.name !== '⚠️ الحالة');
                newEmbed.setFields(fields);

                // Enable buttons if they were disabled
                // We need to reconstruct the original buttons row
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`buy_product_${listing._id}`).setLabel('شراء').setStyle(ButtonStyle.Success).setEmoji('🛒'),
                    new ButtonBuilder().setCustomId(`edit_qty_btn_${listing._id}`).setLabel('تعديل').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
                    new ButtonBuilder().setCustomId(`delete_product_btn_${listing._id}`).setLabel('حذف').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
                );
                await message.edit({ embeds: [newEmbed], components: [row] });
            } else {
                // Zero logic
                newEmbed.setColor('#808080');
                // ... handled mostly by buy logic but good to have here too
                await message.edit({ embeds: [newEmbed] }); // Keep buttons? If 0, maybe keep edit button enabled? 
                // User asked "close buttons and say sold out".
                // But sellers need a way to restock.
                // So we should keep Edit/Delete enabled for seller?
                // But "Disabled Row" replaces everything.
                // Correct approach: Show "Sold Out" but maybe keep Edit button active? 
                // For now, simplest is keep allowing edit via command or re-posting.
                // But let's assume if they edit via modal, they fix it.
            }
        }
    }

    await interaction.followUp({ content: '✅ تم تحديث الكمية.', flags: MessageFlags.Ephemeral });
}

// 4. Delete Product
export async function handleDeleteProduct(interaction) {
    const listingId = interaction.customId.split('_').pop();
    const listing = await Listing.findById(listingId);

    if (!listing) return interaction.reply({ content: '❌ المنتج غير موجود.', flags: MessageFlags.Ephemeral });

    // Auth Check
    if (listing.sellerId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ فقط البائع يمكنه حذف المنتج.', flags: MessageFlags.Ephemeral });
    }

    // Delete
    await Listing.deleteOne({ _id: listingId });
    await interaction.message.delete().catch(() => { });
    await interaction.reply({ content: '🗑️ تم حذف المنتج.', flags: MessageFlags.Ephemeral });
}

// Helper to validate URL
const isUrl = (string) => {
    try { return Boolean(new URL(string)); } catch (e) { return false; }
};

export async function handleEndSale(interaction) {
    const parts = interaction.customId.split('_');
    const ticketNumber = parts[2];
    const listingIdOrRequest = parts[3]; // 'request' or listingId

    // 4th part might be orderId if 3rd is request
    const isRequest = listingIdOrRequest === 'request';
    const orderId = isRequest ? parts[4] : null;
    // Last part is quantity for direct sales (not requests)
    const saleQty = !isRequest ? parseInt(parts[parts.length - 1]) : 1;

    if (!isRequest) {
        const listing = await Listing.findById(listingIdOrRequest);
        if (!listing) {
            return interaction.reply({ content: '❌ المنتج غير موجود (ربما تم حذفه).', flags: MessageFlags.Ephemeral });
        }
        if (listing.sellerId !== interaction.user.id) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ فقط البائع يمكنه إنهاء العملية.', flags: MessageFlags.Ephemeral });
            }
        }
    }

    // Start Step-by-Step Flow
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
    const messagesToDelete = [];
    const initialMsg = await interaction.editReply({ content: '🚀 **بدء عملية توثيق البيع**\n\n**الخطوة 1/3:** يرجى كتابة **عنوان العملية** (مثال: بيع 500 قطعة سلاح).', components: [] });
    messagesToDelete.push(initialMsg);

    const filter = m => m.author.id === interaction.user.id && !m.author.bot;
    const collector = interaction.channel.createMessageCollector({ filter, time: 300000 }); // 5 mins

    let step = 1;
    let saleData = {
        title: null,
        buyerId: null,
        proof: null
    };

    collector.on('collect', async (m) => {
        messagesToDelete.push(m);
        if (m.content.toLowerCase() === 'cancel' || m.content === 'الغاء') {
            collector.stop('cancelled');
            const cancelMsg = await m.reply('❌ تم إلغاء العملية.');
            messagesToDelete.push(cancelMsg);
            return;
        }

        try {
            if (step === 1) {
                // Step 1: Title
                saleData.title = m.content;
                step = 2;
                const r1 = await m.reply('✅ تم حفظ العنوان.\n\n**الخطوة 2/3:** يرجى **منشن المشتري** أو كتابة الآيدي الخاص به.');
                messagesToDelete.push(r1);
            } else if (step === 2) {
                // Step 2: Buyer
                const receivedId = m.mentions.users.first()?.id || m.content.trim();

                // Simple validation for ID format
                if (!/^\d{17,20}$/.test(receivedId)) {
                    const err = await m.reply('❌ آيدي غير صحيح أو لم يتم العثور على منشن. حاول مرة أخرى.');
                    messagesToDelete.push(err);
                    return;
                }

                saleData.buyerId = receivedId;
                step = 3;
                const r2 = await m.reply('✅ تم تحديد المشتري.\n\n**الخطوة 3/3:** يرجى إرسال **صورة الدليل** (إثبات التسليم).\nيمكنك رفع صورة مباشرة أو إرسال رابط.');
                messagesToDelete.push(r2);
            } else if (step === 3) {
                // Step 3: Proof
                let proofUrl = null;

                if (m.attachments.size > 0) {
                    proofUrl = m.attachments.first().url;
                } else if (isUrl(m.content)) {
                    proofUrl = m.content;
                }

                if (!proofUrl) {
                    const err = await m.reply('❌ يرجى إرسال صورة أو رابط صحيح للدليل.');
                    messagesToDelete.push(err);
                    return;
                }

                saleData.proof = proofUrl;
                collector.stop('completed');
            }
        } catch (e) {
            console.error(e);
            m.reply('❌ حدث خطأ، يرجى المحاولة مرة أخرى.');
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'completed') {
            await submitSaleReport(interaction, saleData, listingIdOrRequest, orderId, isRequest, saleQty);
        } else if (reason === 'time') {
            await interaction.followUp('❌ انتهى الوقت المخصص للعملية.');
        }

        // Cleanup Messages (Bot + User)
        try {
            if (interaction.channel && messagesToDelete.length > 0) {
                await interaction.channel.bulkDelete(messagesToDelete).catch(() => { });
            }
        } catch (e) { }
    });
}

// Logic separated for cleaner code
async function submitSaleReport(interaction, data, listingIdOrRequest, orderId, isRequest, qty = 1) {
    const config = loadConfig();
    let listing = null;
    let orderExists = null;

    if (!isRequest) {
        listing = await Listing.findById(listingIdOrRequest);
    } else {
        orderExists = await Order.findById(orderId);
    }

    let order;

    if (listing) {
        order = new Order({
            orderId: `O-${Date.now()}`,
            buyerId: data.buyerId,
            sellerId: interaction.user.id,
            listingId: listingIdOrRequest,
            productName: listing.productName,
            quantity: qty,
            pricePerUnit: listing.pricePerUnit,
            type: listing.type === 'legal' ? 'allowed' : 'forbidden',
            saleTitle: data.title,
            proofImage: data.proof,
            status: 'pending',
            channelId: interaction.channelId,
            ticketChannelId: interaction.channelId,
            messageId: 'temp'
        });
        await order.save();
    } else if (orderExists) {
        order = orderExists;
        order.saleTitle = data.title;
        order.proofImage = data.proof;
        order.status = 'pending';
        order.buyerId = data.buyerId;
        await order.save();
    } else {
        return interaction.followUp('❌ حدث خطأ: المنتج أو الطلب الأصلي غير موجود.');
    }

    // Send to Admin (Approvals Channel)
    const adminChannelId = config.blackMarket?.channels?.approvals?.id || config.blackMarket?.channels?.admin?.id;
    const adminChannel = interaction.guild.channels.cache.get(adminChannelId);

    if (adminChannel) {
        // Prepare attachment to ensure persistence
        const { AttachmentBuilder } = await import('discord.js'); // Ensure import
        const attachment = new AttachmentBuilder(data.proof).setName('proof.png');

        const embed = embedWarning(
            '🛒 طلب توثيق عملية بيع',
            `**نوع العملية:** ${listing ? 'شراء من المتجر' : 'تلبية طلب خاص'}`,
            [
                { name: '📄 العنوان', value: data.title },
                { name: '👤 البائع', value: `<@${interaction.user.id}>`, inline: true },
                { name: '👤 المشتري', value: `<@${data.buyerId}>`, inline: true },
                { name: '📦 المنتج', value: listing ? listing.productName : (orderExists ? orderExists.productName : 'غير معروف'), inline: true },
                { name: '💰 السعر', value: `${listing ? listing.pricePerUnit : 0}`, inline: true },
                { name: '🖼️ الدليل', value: 'مرفق بالرسالة' }
            ]
        ).setImage('attachment://proof.png');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`approve_sale_${order._id}`).setLabel('✅ قبول').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`reject_sale_${order._id}`).setLabel('❌ رفض').setStyle(ButtonStyle.Danger)
        );

        const msg = await adminChannel.send({ embeds: [embed], components: [row], files: [attachment] });

        // Update Order with Permanent URL from Admin Channel
        const permanentUrl = msg.attachments.first()?.url;
        order.proofImage = permanentUrl || data.proof;
        order.messageId = msg.id;
        order.channelId = adminChannel.id;
        await order.save();

        await interaction.channel.send({ content: '✅ **تم إرسال الطلب للإدارة للمراجعة بنجاح!**', embeds: [embed] });

        // Prompt Buyer to Rate (Immediate)
        if (data.buyerId) {
            const ratingEmbed = embedGold(
                '⭐ تقييم البائع',
                `مرحباً <@${data.buyerId}>،\nشكراً لتعاملك معنا. يرجى تقييم البائع <@${interaction.user.id}> لتسجيل تجربتك.\nاضغط على الزر أدناه للتقييم.`
            );

            const rateRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`rate_seller_${order._id}`)
                    .setLabel('⭐ تقييم البائع')
                    .setStyle(ButtonStyle.Primary)
            );

            await interaction.channel.send({ content: `<@${data.buyerId}>`, embeds: [ratingEmbed], components: [rateRow] });
        }

    } else {
        await interaction.channel.send('❌ لم يتم العثور على قناة الإدارة.');
    }
}

// Replaces the old handleEndSaleSubmit since we use collector
export async function handleEndSaleSubmit(interaction) {
    // Deprecated / Unused now, but kept to avoid import errors if referenced elsewhere
    await interaction.reply({ content: 'Deprecated function.', flags: MessageFlags.Ephemeral });
}



export async function handleApproveSale(interaction) {
    const config = loadConfig();
    try {
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    } catch (err) {
        if (err.code !== 40060 && err.code !== 10062) console.error('Defer Error:', err);
    }
    const orderId = interaction.customId.split('_').pop();
    const order = await Order.findById(orderId);
    if (!order) return interaction.followUp({ content: '❌ الطلب غير موجود', flags: MessageFlags.Ephemeral });

    order.status = 'accepted';
    order.acceptedBy = interaction.user.id;
    await order.save();

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor('#00FF00')
        .addFields({ name: '✅ الحالة', value: `تم القبول بواسطة <@${interaction.user.id}>` });

    await interaction.editReply({ embeds: [embed], components: [] });

    const buyer = await interaction.guild.members.fetch(order.buyerId).catch(() => null);

    // Log Sale
    try {
        const logEmbed = embedSuccess(
            '💰 عملية بيع جديدة',
            `\n**📄 العنوان:** ${order.saleTitle}\n**👤 البائع:** <@${order.sellerId}>\n**👤 المشتري:** <@${order.buyerId}>\n**📦 المنتج:** ${order.productName}\n**💰 القيمة:** ${order.pricePerUnit ? order.pricePerUnit.toLocaleString() : 'غير محدد'} $`
        ).setImage(order.proofImage);

        const logChannelId = config.blackMarket?.channels?.logs?.id;
        const logChannel = interaction.guild.channels.cache.get(logChannelId);
        if (logChannel) {
            await logChannel.send({ embeds: [logEmbed] });
        }

        // Duplicate to Sellers Reports (إذا كانت القناة موجودة في الإعدادات)
        const reportChannelId = config.blackMarket?.channels?.sellersReports?.id;
        if (reportChannelId) {
            const reportChannel = interaction.guild.channels.cache.get(reportChannelId);
            if (reportChannel) {
                const reportEmbed = EmbedBuilder.from(logEmbed);
                if (order.proofImage) reportEmbed.setImage(order.proofImage);
                await reportChannel.send({ embeds: [reportEmbed] });
            }
        }

    } catch (e) { console.error('Log error', e); }

    // Rate Button
    if (buyer) {
        const rateEmbed = embedGold(
            '⭐ تقييم البائع',
            `مرحباً ${buyer.user.username}،\nلقد تم تأكيد شرائك لمنتج **${order.productName}** من البائع <@${order.sellerId}>.\nيرجى تقييم تجربتك.`
        );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rate_seller_${order._id}`).setLabel('⭐ تقييم البائع').setStyle(ButtonStyle.Primary)
        );

        const dmSent = await dmUser(buyer, rateEmbed);
        if (!dmSent) {
            const ticketChannel = interaction.guild.channels.cache.get(order.ticketChannelId);
            if (ticketChannel) {
                await ticketChannel.send({ content: `<@${order.buyerId}>`, embeds: [rateEmbed], components: [row] });
            }
        }
    }
}

export async function handleRejectSale(interaction) {
    const orderId = interaction.customId.split('_').pop();
    const modal = new ModalBuilder().setCustomId(`reject_sale_reason_${orderId}`).setTitle('سبب الرفض');
    modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('السبب').setStyle(TextInputStyle.Paragraph).setRequired(true)
    ));
    await interaction.showModal(modal).catch(() => {});
}

// Logic for submitting rejection reason would be in handleRejectSaleSubmit locally or reuse generics?
// I'll implement handleRejectSaleSubmit here and hook it up.
export async function handleRejectSaleSubmit(interaction) {
    await interaction.deferUpdate();
    const orderId = interaction.customId.split('_').pop();
    const reason = interaction.fields.getTextInputValue('reason');

    const order = await Order.findById(orderId);
    if (!order) return interaction.followUp({ content: '❌ الطلب غير موجود', flags: MessageFlags.Ephemeral });

    order.status = 'rejected';
    order.rejectedBy = interaction.user.id;
    order.rejectionReason = reason;
    await order.save();

    // Restore Stock?
    // Maybe not automatically, depends if item was actually given. Admin rejects documentation, likely transaction failed or fake.

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor('#FF0000')
        .addFields({ name: '❌ الحالة - تم الرفض', value: `السبب: ${reason}\nبواسطة: <@${interaction.user.id}>` });

    await interaction.editReply({ embeds: [embed], components: [] });

    // Notify Seller
    try {
        const seller = await interaction.client.users.fetch(order.sellerId);
        if (seller) await seller.send(`❌ **تم رفض توثيق عملية البيع!**\n**المنتج:** ${order.productName}\n**السبب:** ${reason}`);
    } catch (e) { }
}

export async function handleRateSeller(interaction) {
    const orderId = interaction.customId.split('_').pop();
    const order = await Order.findById(orderId);

    if (!order) return interaction.reply({ content: '❌ الطلب غير موجود.', flags: MessageFlags.Ephemeral });
    if (order.buyerId !== interaction.user.id) {
        return interaction.reply({ content: '❌ فقط المشتري يمكنه تقييم البائع.', flags: MessageFlags.Ephemeral });
    }
    if (order.rating) {
        return interaction.reply({ content: '❌ لقد قمت بتقييم هذا البائع مسبقاً.', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder().setCustomId(`rate_seller_modal_${orderId}`).setTitle('تقييم البائع');

    const starsInput = new TextInputBuilder().setCustomId('stars').setLabel('التقييم (1-5)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1);
    const reviewInput = new TextInputBuilder().setCustomId('review').setLabel('ملاحظاتك').setStyle(TextInputStyle.Paragraph).setRequired(false);

    modal.addComponents(new ActionRowBuilder().addComponents(starsInput), new ActionRowBuilder().addComponents(reviewInput));
    await interaction.showModal(modal).catch(() => {});
}

export async function handleRateSellerSubmit(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const orderId = interaction.customId.split('_').pop();
    const stars = parseInt(interaction.fields.getTextInputValue('stars'));
    const review = interaction.fields.getTextInputValue('review');

    if (isNaN(stars) || stars < 1 || stars > 5) return interaction.editReply('❌ التقييم يجب أن يكون من 1 إلى 5.');

    const order = await Order.findById(orderId);
    if (order) {
        order.rating = stars;
        order.review = review;
        await order.save();

        // Log Rating to Ratings Channel
        try {
            const config = loadConfig();
            const ratingChannelId = config.blackMarket?.channels?.ratings?.id;
            const ratingChannel = interaction.guild.channels.cache.get(ratingChannelId);
            if (ratingChannel) {
                const embed = embedGold(
                    '⭐ تقييم جديد',
                    `\n**👤 البائع:** <@${order.sellerId}>\n**👤 المقيم:** <@${order.buyerId}>\n**⭐ التقييم:** ${'⭐'.repeat(stars)}\n**📝 الملاحظات:** ${review || 'لا يوجد'}`
                );
                await ratingChannel.send({ embeds: [embed] });
            }
        } catch (e) { }
    }

    await interaction.editReply('✅ **شكراً لتقييمك!**');
}

export async function handleOrderRequestModal(interaction) {
    const config = loadConfig();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const product = interaction.fields.getTextInputValue('product_name');
    const details = interaction.fields.getTextInputValue('details');

    // Create Request Order
    const order = new Order({
        orderId: `R-${Date.now()}`,
        buyerId: interaction.user.id,
        sellerId: null,
        productName: product,
        quantity: 1,
        pricePerUnit: 0,
        type: 'allowed',
        saleTitle: `طلب: ${product}`,
        status: 'request_pending',
        channelId: 'temp',
        messageId: 'temp'
    });

    // Post to Request Channel
    const requestChannelId = config.blackMarket?.channels?.requests?.id;
    const requestChannel = interaction.guild.channels.cache.get(requestChannelId);

    // Get Seller Role for Mention
    const sellerRoleIds = [
        ...(config.committees?.list?.blackMarket?.roles?.member || []),
        ...(config.blackMarket?.roles?.member || [])
    ];
    let mentionText = '';
    sellerRoleIds.forEach(id => mentionText += `<@&${id}> `);

    if (requestChannel) {
        const embed = embedWarning(
            '📦 طلب منتج جديد',
            `\n**👤 الطالب:** <@${interaction.user.id}>\n**📦 المنتج:** ${product}\n**📝 التفاصيل:**\n${details}`
        );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`claim_request_${order._id}`).setLabel('✅ تلبية الطلب').setStyle(ButtonStyle.Success)
        );

        const msg = await requestChannel.send({ content: mentionText.trim() || null, embeds: [embed], components: [row] });
        order.messageId = msg.id;
        order.channelId = requestChannel.id;
        await order.save();

        await interaction.editReply('✅ **تم نشر طلبك بنجاح!** سيتم إنشاء تذكرة عندما يوافق أحد البائعين على تلبيته.');
    } else {
        await interaction.editReply('❌ لم يتم العثور على قناة الطلبات.');
    }
}

export async function handleClaimRequest(interaction) {
    const config = loadConfig();
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const orderId = interaction.customId.split('_').pop();

    // Check if user is Seller
    const sellerRoleIds = [
        ...(config.committees?.list?.blackMarket?.roles?.member || []),
        ...(config.blackMarket?.roles?.member || [])
    ];

    const hasRole = sellerRoleIds.some(id => interaction.member.roles.cache.has(id)) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasRole) return interaction.editReply('❌ فقط البائعين المعتمدين يمكنهم تلبية الطلبات.');

    const order = await Order.findById(orderId);
    if (!order) return interaction.editReply('❌ الطلب غير موجود.');
    if (order.status !== 'request_pending') return interaction.editReply('❌ تم تلبية هذا الطلب مسبقاً.');

    if (order.buyerId === interaction.user.id) return interaction.editReply('❌ لا يمكنك تلبية طلبك بنفسك.');

    order.sellerId = interaction.user.id;
    order.status = 'processing'; // Or 'pending' (standard Pending Sale)
    await order.save();

    // Create Ticket
    try {
        const { createTicket } = await import('./ticketManager.js');
        const ticket = await createTicket(interaction.guild, order.buyerId, 'black_market_sale');
        if (!ticket) {
            await interaction.editReply('❌ حدث خطأ في إنشاء التذكرة.');
            order.status = 'request_pending';
            order.sellerId = null;
            await order.save();
            return;
        }

        // Add Seller (Interaction User)
        const ticketChannel = interaction.guild.channels.cache.get(ticket.channelId);
        if (ticketChannel) {
            await ticketChannel.permissionOverwrites.create(interaction.user, { ViewChannel: true, SendMessages: true });

            const saleRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`end_sale_${ticket.ticketNumber}_request_${order._id}`).setLabel('✅ إنهاء البيع').setStyle(ButtonStyle.Success)
            );

            const reportRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`complaint_seller_request_${order._id}`).setLabel('📋 الإبلاغ عن مشكلة').setStyle(ButtonStyle.Danger).setEmoji('🚨')
            );

            await ticketChannel.send({
                content: `<@${order.buyerId}> <@${interaction.user.id}>`, embeds: [
                    embedSuccess(
                        '🤝 تلبية طلب',
                        `قام البائع <@${interaction.user.id}> بالموافقة على تلبية طلبك **${order.productName}**.\nيرجى الاتفاق على التفاصيل هنا.\n\nعند الانتهاء، يضغط البائع على "إنهاء البيع" لتوثيق العملية.`
                    )
                ],
                components: [saleRow]
            });
            await ticketChannel.send({ components: [reportRow] });

            // Update Order Ticket Channel
            order.ticketChannelId = ticket.channelId;
            await order.save();

            // Update Request Message in Channel
            try {
                const requestChannel = interaction.guild.channels.cache.get(order.channelId);
                if (requestChannel) {
                    const msg = await requestChannel.messages.fetch(order.messageId).catch(() => null);
                    if (msg) {
                        const embed = EmbedBuilder.from(msg.embeds[0])
                            .setColor('#00FF00')
                            .addFields({ name: '✅ الحالة', value: `تم التلبية بواسطة <@${interaction.user.id}>` });
                        await msg.edit({ embeds: [embed], components: [] });
                    }
                }
            } catch (e) { }

            await interaction.editReply(`✅ **تم إنشاء التذكرة بنجاح:** <#${ticket.channelId}>`);
        }
    } catch (e) {
        console.error(e);
        await interaction.editReply('❌ حدث خطأ في إنشاء التذكرة.');
        order.status = 'request_pending';
        order.sellerId = null;
        await order.save();
    }
}

export async function handleReportSeller(interaction) {
    const customId = interaction.customId;
    const parts = customId.split('_');

    // complaint_seller_<listingId>_<sellerId>  OR  complaint_seller_request_<orderId>
    const isRequest = parts[2] === 'request';
    let targetId;

    if (isRequest) {
        const orderId = parts[3];
        const order = await Order.findById(orderId);
        targetId = order?.sellerId || 'unknown';
    } else {
        targetId = parts[3]; // sellerId
    }

    // لا نستخدم defer هنا لأن showModal يحتاج interaction غير مؤكدة
    const modal = new ModalBuilder()
        .setCustomId(`complaint_seller_modal_${targetId}_${isRequest ? 'request' : 'listing'}_${interaction.channelId}`)
        .setTitle('📋 الإبلاغ عن مشكلة');

    const typeInput = new TextInputBuilder()
        .setCustomId('report_type')
        .setLabel('نوع المشكلة (احتيال/تأخير/منتج مخالف/غيره)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const descInput = new TextInputBuilder()
        .setCustomId('report_desc')
        .setLabel('شرح المشكلة بالتفصيل')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(10);

    modal.addComponents(
        new ActionRowBuilder().addComponents(typeInput),
        new ActionRowBuilder().addComponents(descInput)
    );

    await interaction.showModal(modal).catch(() => {});
}

export async function handleReportSellerSubmit(interaction) {
    const config = loadConfig();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const parts = interaction.customId.split('_');
    // complaint_seller_modal_<targetId>_<type>_<channelId>
    const targetId = parts[3];
    const channelId = parts[5];

    const reportTypeText = interaction.fields.getTextInputValue('report_type');
    const reportDesc = interaction.fields.getTextInputValue('report_desc');

    const reportChannelId = config.blackMarket?.channels?.admin?.id || config.points?.channels?.adminReports?.id;
    const reportChannel = reportChannelId ? interaction.guild.channels.cache.get(reportChannelId) : null;

    const embed = embedError(
        '🚨 بلاغ جديد',
        null,
        [
            { name: '👤 المبلغ', value: `<@${interaction.user.id}>`, inline: true },
            { name: '👤 المشتكى عليه', value: `<@${targetId}>`, inline: true },
            { name: '📋 نوع البلاغ', value: reportTypeText, inline: false },
            { name: '📝 التفاصيل', value: reportDesc, inline: false },
            { name: '🎫 التذكرة', value: `<#${channelId}>`, inline: false }
        ]
    );

    if (reportChannel) {
        await reportChannel.send({ embeds: [embed] });
        await interaction.editReply('✅ **تم إرسال البلاغ إلى الإدارة بنجاح!** سيتم مراجعة البلاغ في أقرب وقت.');
    } else {
        await interaction.editReply('✅ **تم تسجيل البلاغ.**');
    }

    try {
        const ticketChannel = interaction.guild.channels.cache.get(channelId);
        if (ticketChannel) {
            await ticketChannel.send({ embeds: [embed.setDescription('📌 تم تقديم بلاغ من قبل <@' + interaction.user.id + '>.')] });
        }
    } catch (e) { }
}
