import { createModel } from '../data/db.js';

const Warning = createModel('Warning');

Warning.col.preSave(function () {
  if (this.removed && this.status === 'active') {
    this.status = 'cancelled';
  }
});

Warning.getActiveWarnings = async function (memberId) {
  const docs = await Warning.find({ memberId, removed: false, status: 'active' });
  return docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

Warning.getWarningStats = async function (memberId) {
  const [activeCount, totalCount, recent] = await Promise.all([
    Warning.countDocuments({ memberId, removed: false, status: 'active' }),
    Warning.countDocuments({ memberId }),
    (async () => {
      const docs = await Warning.find({ memberId, removed: false, status: 'active' });
      return docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
    })()
  ]);
  return [activeCount, totalCount, recent];
};

Warning.removeAllActiveWarnings = async function (memberId, reason, byUserId, byUserName) {
  const update = {
    $set: {
      removed: true,
      status: 'fired',
      removedBy: byUserId,
      removedByName: byUserName,
      removedAt: new Date(),
      removalReason: reason || 'تم الفصل من العائلة',
      firedAt: new Date(),
      firedBy: byUserId,
      firedByName: byUserName
    }
  };
  return Warning.updateMany({ memberId, removed: false, status: 'active' }, update);
};

Warning.getAllWarnings = async function (memberId, limit = 20) {
  const docs = await Warning.find({ memberId });
  return docs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
};

export default Warning;
