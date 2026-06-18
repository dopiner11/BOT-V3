import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import Order from '../models/Order.js';
import PersistentMessage from '../models/PersistentMessage.js';
import BlackMarketSeller from '../models/BlackMarketSeller.js';
import Application from '../models/Application.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
import { custom as embedCustom } from '../utils/embedStyles.js';

/* Helpers */
async function getTopSellers(days = 1) {
    const date = new Date();
    date.setDate(date.getDate() - days);

    // Initial Aggregate for Accepted Sales
    const sales = await Order.aggregate([
        {
            $match: {
                status: 'accepted',
                sellerId: { $ne: null },
                updatedAt: { $gte: date }
            }
        },
        {
            $group: {
                _id: '$sellerId',
                count: { $sum: 1 },
                totalRevenue: { $sum: '$pricePerUnit' }
            }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
    ]);
    return sales;
}

async function getAllSellerStats(sellerIds) {
    // We want Total Sales, Total Ratings, Avg Rating for EACH seller
    const stats = await Order.aggregate([
        {
            $match: {
                status: 'accepted',
                sellerId: { $in: sellerIds }
            }
        },
        {
            $group: {
                _id: '$sellerId',
                salesCount: { $sum: 1 },
                ratedCount: { $sum: { $cond: [{ $ifNull: ['$rating', false] }, 1, 0] } },
                totalRating: { $sum: { $ifNull: ['$rating', 0] } },
                lastSale: { $max: '$updatedAt' }
            }
        }
    ]);

    // Map to object for easy lookup
    const map = {};
    stats.forEach(s => {
        map[s._id] = {
            salesString: `${s.salesCount}`,
            ratingAvg: s.ratedCount > 0 ? (s.totalRating / s.ratedCount).toFixed(1) : 'N/A',
            ratingCount: s.ratedCount,
            lastSale: s.lastSale
        };
    });
    return map;
}

async function getViolators() {
    // Sellers with REJECTED orders
    const rejected = await Order.aggregate([
        { $match: { status: 'rejected', sellerId: { $ne: null } } },
        { $group: { _id: '$sellerId', rejectedCount: { $sum: 1 } } },
        { $match: { rejectedCount: { $gte: 1 } } }, // Show anyone with at least 1 rejection?
        { $sort: { rejectedCount: -1 } },
        { $limit: 10 }
    ]);
    return rejected;
}

export async function generateBMReport(guild, page = 0) {
    // 1. Identify Hired Sellers (DB-based: Manual List + Applications)
    const hiredDocs = await BlackMarketSeller.find({ isActive: true });
    const hiredIds = hiredDocs.map(d => d.userId);

    const appSellers = await Application.distinct('userId', { type: 'black_market', status: 'accepted' });

    const validSellerIds = [...new Set([...hiredIds, ...appSellers])];

    let sellers = new Map();
    // Fetch members from valid IDs (Batch Fetch to avoid Rate Limits)
    if (validSellerIds.length > 0) {
        try {
            // Check cache first for all? No, fetch gives us fresh state and cache check is internal usually or we can rely on fetch.
            // But fetch({ user: ids }) is efficient.
            const fetchedMembers = await guild.members.fetch({ user: validSellerIds });
            fetchedMembers.forEach(m => sellers.set(m.id, m));
        } catch (e) {
            console.error('BM Stats: Error fetching members:', e);
            // Fallback: try cache for any missed?
            validSellerIds.forEach(uid => {
                const m = guild.members.cache.get(uid);
                if (m && !sellers.has(uid)) sellers.set(uid, m);
            });
        }
    }

    // const sellerIds = Array.from(sellers.keys()); // We use seller keys logically.
    // Ensure we iterate correctly later.


    const sellerIds = Array.from(sellers.keys());

    // 2. Fetch Stats
    const stats = await Order.aggregate([
        {
            $match: {
                status: 'accepted',
                sellerId: { $in: sellerIds }
            }
        },
        {
            $group: {
                _id: '$sellerId',
                salesCount: { $sum: 1 },
                totalRating: { $sum: { $ifNull: ['$rating', 0] } },
                ratingCount: { $sum: { $cond: [{ $ifNull: ['$rating', false] }, 1, 0] } },
                lastSale: { $max: '$updatedAt' }
            }
        }
    ]);

    const statsMap = {};
    stats.forEach(s => {
        statsMap[s._id] = s;
    });

    // 3. Prepare Items
    const items = [];

    for (const [id, member] of sellers) {
        const s = statsMap[id] || { salesCount: 0, totalRating: 0, ratingCount: 0, lastSale: null };
        const avgRating = s.ratingCount > 0 ? (s.totalRating / s.ratingCount).toFixed(1) : '—';

        items.push(`**<@${id}>**\n` +
            `🛒 عمليات البيع: **${s.salesCount}**\n` +
            `⭐ التقييم: **${avgRating}** (${s.ratingCount} تقييم)\n` +
            `🕒 آخر نشاط: ${s.lastSale ? `<t:${Math.floor(new Date(s.lastSale).getTime() / 1000)}:R>` : 'لا يوجد'}`);
    }

    // Pagination Logic
    const itemsPerPage = 8; // Slightly fewer to avoid length issues
    const totalPages = Math.ceil(items.length / itemsPerPage) || 1;

    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const start = page * itemsPerPage;
    const end = start + itemsPerPage;
    const pageItems = items.slice(start, end);

    const embed = embedCustom('#2F3136', '📊 لوحة تفاعل البائعين', `**إجمالي البائعين:** ${sellers.size}\n**🕒 آخر تحديث:** <t:${Math.floor(Date.now() / 1000)}:R>`)
        .setFooter({ text: `يتم التحديث تلقائياً كل 10 دقائق` });

    const fullText = pageItems.join('\n\n-------------------\n\n');
    embed.setDescription(`${embed.data.description}\n\n${fullText || 'لا يوجد بائعين حالياً.'}`);

    // Create Buttons
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`bm_stats_page_${page - 1}`)
            .setEmoji('⬅️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),

        new ButtonBuilder()
            .setCustomId('bm_stats_display_only')
            .setLabel(`${page + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),

        new ButtonBuilder()
            .setCustomId(`bm_stats_page_${page + 1}`)
            .setEmoji('➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
    );

    return { embed, components: [row] };
}

export async function updateBMDashboard(client, forceReset = false) {
    const channelId = config.blackMarket?.channels?.admin?.id || config.points?.channels?.adminReports?.id;
    if (!channelId) return;

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const { embed, components } = await generateBMReport(channel.guild, 0);

        let pMsg = await PersistentMessage.findOne({ key: 'bm_stats_dashboard' });
        let message;

        if (forceReset) {
            // Aggressive Cleanup: Delete from DB and Channel
            if (pMsg) {
                try {
                    const old = await channel.messages.fetch(pMsg.messageId).catch(() => null);
                    if (old) await old.delete();
                } catch (e) { }
                await PersistentMessage.deleteOne({ key: 'bm_stats_dashboard' });
                pMsg = null;
            }

            // Also scan for ANY existing dashboard messages to clean up ghosts
            try {
                const recent = await channel.messages.fetch({ limit: 20 });
                for (const [id, msg] of recent) {
                    if (msg.author.id === client.user.id && (msg.embeds[0]?.title === '📊 لوحة تفاعل البائعين' || msg.embeds[0]?.title === '📊 إحصائيات البلاك ماركت')) {
                        await msg.delete().catch(() => { });
                    }
                }
            } catch (e) { }
        }

        if (pMsg) {
            message = await channel.messages.fetch(pMsg.messageId).catch(() => null);
        }

        if (message) {
            await message.edit({ embeds: [embed], components: components });
        } else {
            message = await channel.send({ embeds: [embed], components: components });
            await PersistentMessage.findOneAndUpdate(
                { key: 'bm_stats_dashboard' },
                { key: 'bm_stats_dashboard', guildId: channel.guild.id, channelId: channel.id, messageId: message.id },
                { upsert: true, new: true }
            );
        }

        // Cleanup: Fetch last 50 messages and delete duplicates from this bot
        try {
            const recentMessages = await channel.messages.fetch({ limit: 50 });
            for (const [id, msg] of recentMessages) {
                if (msg.author.id === client.user.id && id !== message.id && msg.embeds.length > 0) {
                    // Check title to be sure
                    if (msg.embeds[0].title === '📊 لوحة تفاعل البائعين' || msg.embeds[0].title?.includes('Black Market Report')) {
                        await msg.delete().catch(() => { });
                    }
                }
            }
        } catch (cleanupErr) {
            console.error('Cleanup Error:', cleanupErr);
        }

        console.log('✅ BM Dashboard Updated');
    } catch (e) {
        console.error('BM Dashboard Update Error:', e);
    }
}

let dashboardInterval;

export async function startBMStatsSystem(client) {
    // Initial run with Force Reset = true to ensure message exists/updates
    await updateBMDashboard(client, true);

    if (dashboardInterval) clearInterval(dashboardInterval);

    // Schedule every 10 minutes
    dashboardInterval = setInterval(() => {
        updateBMDashboard(client, false);
    }, 10 * 60 * 1000);
}

export async function handleBMStatsPagination(interaction, pageStr) {
    // Permission Check: Discord Committee Only
    const discordCommitteeRoles = [
        ...(config.committees?.list?.discord?.roles?.manager || []),
        ...(config.committees?.list?.discord?.roles?.deputy || []),
        ...(config.committees?.list?.discord?.roles?.member || [])
    ];

    const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
        interaction.member.roles.cache.some(r => discordCommitteeRoles.includes(r.id));

    if (!hasPermission) {
        return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الزر (بائعين/لجنة فقط).', flags: MessageFlags.Ephemeral });
    }

    const page = parseInt(pageStr);
    // Since this is a public dashboard, 'update' changes it for everyone.
    // If we want it ephemeral, we can't edit the original message easily without confusing others.
    // Usually dashboards update the main message.

    // Fetch data for requested page
    const { embed, components } = await generateBMReport(interaction.guild, page);

    // Update the message
    await interaction.update({ embeds: [embed], components: components });
}

export default {
    data: new SlashCommandBuilder()
        .setName('احصائيات-بلاك-ماركت')
        .setDescription('تحديث لوحة إحصائيات البلاك ماركت'),

    async execute(interaction) {
        // Permissions Check (Discord Committee Only)
        const discordCommitteeRoles = [
            ...(config.committees?.list?.discord?.roles?.manager || []),
            ...(config.committees?.list?.discord?.roles?.deputy || []),
            ...(config.committees?.list?.discord?.roles?.member || [])
        ];

        const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.roles.cache.some(r => discordCommitteeRoles.includes(r.id));

        if (!hasPermission) return interaction.reply({ content: '❌ ليس لديك صلاحية.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await updateBMDashboard(interaction.client, true);
        await interaction.editReply('✅ تم تحديث الإحصائيات.');
    }
};
