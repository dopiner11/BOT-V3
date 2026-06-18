import Blacklist from '../models/Blacklist.js';
import TicketBlacklist from '../models/TicketBlacklist.js';
import AuctionBlacklist from '../models/AuctionBL.js';
import Grace24h from '../models/Grace24h.js';
import Member from '../models/Member.js';
import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';
import Warning from '../models/Warning.js';
import { updateMemberRoomEmoji } from './roomStatusUpdater.js';
import { createGracePeriod } from './interactionMonitor.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
    try {
        return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    } catch (e) { return {}; }
}

export async function cleanupExpiredBlacklists(client) {
    const config = loadConfig();
    const guild = client.guilds.cache.get(config.bot?.guildId);
    const now = new Date();
    let cleaned = 0;

    // 0. Clean up expired Grace24h
    try {
        const expiredGrace = await Grace24h.find({ expiresAt: { $lte: now } });
        for (const entry of expiredGrace) {
            await Grace24h.deleteOne({ _id: entry._id });
            cleaned++;
        }
    } catch (e) {
        console.error('Cleanup Grace24h error:', e);
    }

    // 1. General Blacklist
    try {
        const allBlacklisted = await Blacklist.find({ isActive: true, isPermanent: false });
        for (const entry of allBlacklisted) {
            if (entry.expiresAt && new Date(entry.expiresAt) <= now) {
                entry.isActive = false;
                entry.removedBy = 'system';
                entry.removalReason = 'انتهاء المدة تلقائياً';
                entry.removedAt = now;
                await entry.save();

                if (guild) {
                    const member = guild.members.cache.get(entry.userId);
                    if (member) {
                        if (config.roles?.blacklist?.id) await member.roles.remove(config.roles.blacklist.id).catch(e => console.error('[Cleanup]', e?.message));
                        if (config.roles?.basic?.id) await member.roles.add(config.roles.basic.id).catch(e => console.error('[Cleanup]', e?.message));
                    }
                }

                const memberRec = await Member.findOne({ discordId: entry.userId });
                if (memberRec) {
                    memberRec.isActive = true;
                    await memberRec.save();
                }

                try {
                    const user = await client.users.fetch(entry.userId);
                    if (user) await user.send('✅ **تم إزالتك من البلاك ليست تلقائياً لانتهاء المدة.**');
                } catch (e) { }

                cleaned++;
            }
        }
    } catch (e) {
        console.error('Cleanup General Blacklist error:', e);
    }

    // 2. Ticket Blacklist (delete expired entries)
    try {
        const allTicketBL = await TicketBlacklist.find({});
        for (const entry of allTicketBL) {
            if (entry.expiresAt && new Date(entry.expiresAt) <= now) {
                await TicketBlacklist.deleteOne({ _id: entry._id });
                cleaned++;
            }
        }
    } catch (e) {
        console.error('Cleanup Ticket Blacklist error:', e);
    }

    // 3. Auction Blacklist (delete expired + remove role)
    try {
        const allAuctionBL = await AuctionBlacklist.find({});
        for (const entry of allAuctionBL) {
            if (entry.expiresAt && !entry.isPermanent && new Date(entry.expiresAt) <= now) {
                if (guild) {
                    const member = guild.members.cache.get(entry.userId);
                    if (member && config.roles?.auctionBlacklist?.id) {
                        await member.roles.remove(config.roles.auctionBlacklist.id).catch(e => console.error('[Cleanup]', e?.message));
                    }
                }
                await AuctionBlacklist.deleteOne({ _id: entry._id });
                cleaned++;

                try {
                    const user = await client.users.fetch(entry.userId);
                    if (user) await user.send('✅ **تم رفع حظر المزادات عنك تلقائياً لانتهاء المدة.**');
                } catch (e) { }
            }
        }
    } catch (e) {
        console.error('Cleanup Auction Blacklist error:', e);
    }

    // 4. Excuse (expired) -> إنشاء فترة سماح 24 ساعة
    try {
        const excuses = await Excuse.find({ isActive: true, endDate: { $lte: now } });
        for (const excuse of excuses) {
            excuse.isActive = false;
            await excuse.save();

            // إنشاء فترة سماح 24 ساعة (إلا إذا كان "زيادة لفل")
            if (excuse.type !== 'زيادة لفل') {
                await createGracePeriod(excuse.memberId, 'excuse_ended', guild, client, { type: excuse.type }).catch(e => console.error('[Cleanup]', e?.message));
            }

            if (guild) {
                if (excuse.type === 'زيادة لفل' || excuse.type === 'تغير اسم') {
                    const member = guild.members.cache.get(excuse.memberId);
                    const roleId = config.general?.excuseRoles?.[excuse.type];
                    if (member && roleId && member.roles.cache.has(roleId)) {
                        await member.roles.remove(roleId, 'انتهاء عذر تلقائي').catch(e => console.error('[Cleanup]', e?.message));
                    }
                }
                await updateMemberRoomEmoji(guild, excuse.memberId);
            }
            cleaned++;
        }
    } catch (e) {
        console.error('Cleanup Excuse error:', e);
    }

    // 5. Vacation (expired) -> إنشاء فترة سماح 24 ساعة
    try {
        const expiredVacations = await Vacation.find({ status: 'active', endDate: { $lte: now } });
        for (const vac of expiredVacations) {
            try {
                vac.status = 'expired';
                await vac.save();

                // إنشاء فترة سماح 24 ساعة
                await createGracePeriod(vac.memberId, 'vacation_ended', guild, client, null).catch(e => console.error('[Cleanup]', e?.message));

                if (guild) {
                    const member = guild.members.cache.get(vac.memberId);
                    if (member) {
                        if (config.roles?.vacation?.id) await member.roles.remove(config.roles.vacation.id).catch(e => console.error('[Cleanup]', e?.message));
                        if (vac.previousRoleIds?.length > 0) await member.roles.add(vac.previousRoleIds).catch(e => console.error('[Cleanup]', e?.message));
                    }
                    await updateMemberRoomEmoji(guild, vac.memberId);
                }
                cleaned++;
            } catch (e) {
                console.error(`Cleanup vacation error for ${vac.memberId}:`, e);
            }
        }
    } catch (e) {
        console.error('Cleanup Vacation error:', e);
    }

    // 6. Inactivity warnings older than 7 days -> auto-remove
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const oldInactivityWarnings = await Warning.find({
            warningType: 'inactivity',
            removed: false,
            status: 'active',
            createdAt: { $lte: sevenDaysAgo }
        });
        for (const warn of oldInactivityWarnings) {
            warn.removed = true;
            warn.status = 'expired';
            warn.removedBy = 'system';
            warn.removalReason = 'انتهاء صلاحية التحذير تلقائياً (7 أيام)';
            warn.removedAt = now;
            await warn.save();
            cleaned++;
        }
    } catch (e) {
        console.error('Cleanup Inactivity Warnings error:', e);
    }

    if (cleaned > 0) {
        console.log(`🧹 Cleaned up ${cleaned} expired entries.`);
    }
}

let cleanupInterval;

export function startCleanupScheduler(client) {
    cleanupExpiredBlacklists(client);
    if (cleanupInterval) clearInterval(cleanupInterval);
    cleanupInterval = setInterval(() => cleanupExpiredBlacklists(client), 5 * 60 * 1000);
    console.log('🧹 Expired blacklist cleanup scheduler started (every 5 min).');
}
