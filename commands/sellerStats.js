import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import Order from '../models/Order.js';
import { custom as embedCustom } from '../utils/embedStyles.js';

export default {
    data: new SlashCommandBuilder()
        .setName('seller-stats')
        .setDescription('عرض إحصائيات البائع')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('المستخدم الذي تريد عرض إحصائياته (اختياري)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;

        // Check if target is same as user, or if user has admin perms to view others
        if (targetUser.id !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply('❌ لا يمكنك عرض إحصائيات بائعين آخرين.');
        }

        // Fetch Stats
        // Status should be 'accepted' for completed sales
        const completedOrders = await Order.find({ sellerId: targetUser.id, status: 'accepted' });

        const totalSales = completedOrders.length;

        // Calculate Total Earnings (Assuming quantity 1 for now, or use pricePerUnit * quantity if schema had quantity per order fixed)
        // In handleEndSaleSubmit I set quantity: 1. And Listing has pricePerUnit.
        // Order schema has pricePerUnit.
        const totalEarnings = completedOrders.reduce((acc, order) => acc + (order.pricePerUnit || 0), 0);

        // Calculate Average Rating
        // Filter orders with rating
        const ratedOrders = completedOrders.filter(o => o.rating && o.rating > 0);
        const totalRating = ratedOrders.reduce((acc, order) => acc + order.rating, 0);
        const avgRating = ratedOrders.length > 0 ? (totalRating / ratedOrders.length).toFixed(1) : '0.0';

        // Get Pending Orders
        const pendingCount = await Order.countDocuments({ sellerId: targetUser.id, status: 'pending' });

        const embed = embedCustom(0x00FFFF, `📊 إحصائيات البائع: ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: '💰 إجمالي الأرباح', value: `${totalEarnings.toLocaleString()} $`, inline: true },
                { name: '📦 المبيعات الناجحة', value: `${totalSales}`, inline: true },
                { name: '⭐ التقييم العام', value: `${avgRating} / 5.0 (${ratedOrders.length} تقييم)`, inline: true },
                { name: '⏳ طلبات قيد الانتظار', value: `${pendingCount}`, inline: true }
            );

        // Add recent reviews if any
        if (ratedOrders.length > 0) {
            // Sort by date desc
            const recentReviews = ratedOrders.sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
            const reviewText = recentReviews.map(o => `> **${o.rating} ⭐** - ${o.review || 'بدون تعليق'} (<t:${Math.floor(o.createdAt.getTime() / 1000)}:R>)`).join('\n');
            embed.addFields({ name: '💬 آخر التقييمات', value: reviewText });
        }

        await interaction.editReply({ embeds: [embed] });
    }
};
