import { createModel } from '../data/db.js';
import { checkOvertake } from '../utils/rankTracker.js';

const Member = createModel('Member');

Member.col.preSave(async function () {
  try {
    this.lastActivity = new Date();
    const oldDoc = Member.col._docs.get(this._id);
    if (oldDoc && oldDoc.points !== this.points) {
      const allMembers = Array.from(Member.col._docs.values());
      const oldRank = allMembers.filter(m => m.isActive && (m.points || 0) > (oldDoc.points || 0)).length + 1;
      const newRank = allMembers.filter(m => m.isActive && (m.points || 0) > (this.points || 0)).length + 1;
      await checkOvertake(this.discordId, oldRank, newRank);
    }
  } catch (err) {
    console.error('member pre-save error:', err);
  }
});

export default Member;
