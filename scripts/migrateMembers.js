import Member from '../models/Member.js';

async function migrate() {
  const all = await Member.find({});
  let updated = 0;

  for (const m of all) {
    let changed = false;

    if (m.daysInCurrentRank === undefined || m.daysInCurrentRank === null) {
      const startDate = m.lastPromotionDate || m.joinDate;
      if (startDate) {
        const diffMs = Date.now() - new Date(startDate).getTime();
        m.daysInCurrentRank = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      } else {
        m.daysInCurrentRank = 0;
      }
      changed = true;
    }

    if (!m.promotionHistory) {
      m.promotionHistory = [];
      changed = true;
    }

    if (changed) {
      await m.save();
      updated++;
    }
  }

  console.log(`✅ Migration complete: ${all.length} members checked, ${updated} updated.`);
}

migrate().catch(console.error);
