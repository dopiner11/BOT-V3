import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createAuction, logAuctionAction } from '../utils/auctionSystem.js';
import { gold as embedGold } from '../utils/embedStyles.js';

export default {
    data: new SlashCommandBuilder()
        .setName('انشاء_مزاد')
        .setDescription('إنشاء مزاد جديد')
        .addStringOption(option =>
            option.setName('اسم')
                .setDescription('اسم المنتج')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('سعر')
                .setDescription('السعر البدائي')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('مدة')
                .setDescription('المدة بالدقائق')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('صورة')
                .setDescription('رابط الصورة (اختياري)'))
        .addStringOption(option =>
            option.setName('وصف')
                .setDescription('وصف المنتج (اختياري)'))
        .addUserOption(option =>
            option.setName('صاحب_المنتج')
                .setDescription('صاحب المنتج المعروض (اختياري)')),

    async execute(interaction) {
        const productName = interaction.options.getString('اسم');
        const startPrice = interaction.options.getNumber('سعر');
        const duration = interaction.options.getInteger('مدة');
        const imageUrl = interaction.options.getString('صورة');
        const description = interaction.options.getString('وصف') || 'لا يوجد وصف';
        const productOwner = interaction.options.getUser('صاحب_المنتج') || interaction.user;
        const endTime = new Date(Date.now() + (duration * 60000)); // Use Date object for Mongoose

        const embed = embedGold(`🎯 مزاد: ${productName}`, description, [
            { name: '💰 السعر البدائي', value: `${startPrice}$`, inline: true },
            { name: '⏰ وقت الانتهاء', value: `<t:${Math.floor(endTime.getTime() / 1000)}:R>`, inline: true },
            { name: '🏆 السعر الحالي', value: `${startPrice}$`, inline: true },
            { name: '👤 صاحب المنتج', value: productOwner.toString(), inline: true },
            { name: '📊 عدد المزايدات', value: '0', inline: true },
            { name: '⏱️ العد التنازلي', value: 'جاري البدء...', inline: true }
        ])
            .setTimestamp(endTime);

        if (imageUrl) embed.setImage(imageUrl);

        const row1 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('bid').setLabel('💰 مزايدة').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('manage_bids').setLabel('⚙️ إدارة المزايدات').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('leaders').setLabel('🏆 متصدرين').setStyle(ButtonStyle.Success)
            );

        const row2 = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder().setCustomId('details').setLabel('📊 التفاصيل').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('end').setLabel('🛑 إنهاء').setStyle(ButtonStyle.Danger)
            );

        // Add second row for management buttons (Optional, kept simpler like original but adding rename/add_person if needed)
        // Original didn't have management buttons, but utils/auctionSystem handles them.
        // Let's stick to core buttons.

        await interaction.reply({ content: '✅ جاري إنشاء المزاد...', flags: MessageFlags.Ephemeral });
        const message = await interaction.channel.send({ content: '<@&1390575018777251900>', embeds: [embed], components: [row1, row2] });

        // Use the centralized creation logic
        await createAuction(interaction, {
            messageId: message.id,
            channelId: interaction.channel.id,
            productName,
            startPrice,
            imageUrl,
            description,
            endTime,
            creatorId: interaction.user.id,
            ownerId: productOwner.id,
            guildId: interaction.guild.id
        });

        // Log Creation
        await logAuctionAction(interaction.guild, 'Auction Created', {
            productName: productName,
            user: interaction.user,
            amount: startPrice
        });
    }
};
