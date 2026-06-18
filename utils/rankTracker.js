import Vacation from '../models/Vacation.js';
import Excuse from '../models/Excuse.js';

let _guild = null;
const overtakeCooldowns = new Map();
const COOLDOWN_MS = 10 * 60 * 1000;

export function setOvertakeGuild(guild) {
  _guild = guild;
}

export async function checkOvertake(userId, oldRank, newRank) {
  if (oldRank === newRank || !_guild) return;

  const lastSent = overtakeCooldowns.get(userId);
  if (lastSent && (Date.now() - lastSent) < COOLDOWN_MS) return;

  try {
    const now = new Date();
    const [hasVacation, hasProtectedExcuse] = await Promise.all([
      Vacation.findOne({ memberId: userId, status: 'active', endDate: { $gte: now } }),
      Excuse.findOne({ memberId: userId, isActive: { $ne: false }, type: { $ne: 'تغير اسم' }, endDate: { $gte: now } })
    ]);
    if (hasVacation || hasProtectedExcuse) {
      console.log(`[OVERTAKE] ${userId}: skipped (vacation/excuse)`);
      return;
    }

    const user = await _guild.client.users.fetch(userId).catch(() => null);
    if (!user) return;

    overtakeCooldowns.set(userId, Date.now());

    if (newRank < oldRank) {
      await user.send(`🎉 **مبروك!** ارتفعت مرتبتك في العائلة من #${oldRank} إلى #${newRank}! استمر في التفاعل 💪`);
      console.log(`[OVERTAKE] ${userId}: #${oldRank} → #${newRank} (UP)`);
    } else {
      await user.send(`😅 **تم تجاوزك!** نزلت مرتبتك في العائلة من #${oldRank} إلى #${newRank}. حاول ترجع بقوة 💪`);
      console.log(`[OVERTAKE] ${userId}: #${oldRank} → #${newRank} (DOWN)`);
    }
  } catch (err) {
    console.error(`[OVERTAKE] Error checking overtake for ${userId}:`, err.message);
  }
}
