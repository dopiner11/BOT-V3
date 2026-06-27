import { createModel } from '../data/db.js';

const Strike = createModel('Strike');

Strike.col.preSave(function () {
  if (!this.createdAt) this.createdAt = new Date();
  this.updatedAt = new Date();
});

Strike.getOrCreate = async function (memberId, actionType, guildId, expiryMs = 86400000) {
  const existing = await Strike.findOne({ memberId, actionType, guildId, expired: { $ne: true } });
  if (existing) return existing;
  const now = Date.now();
  return Strike.create({
    memberId,
    actionType,
    guildId,
    strikeCount: 0,
    firstStrikeAt: now,
    lastStrikeAt: now,
    expiryAt: now + expiryMs,
    expired: false,
  });
};

Strike.increment = async function (memberId, actionType, guildId, expiryMs = 86400000) {
  const strike = await Strike.getOrCreate(memberId, actionType, guildId, expiryMs);
  strike.strikeCount = (strike.strikeCount || 0) + 1;
  strike.lastStrikeAt = Date.now();
  strike.updatedAt = new Date();
  if (!strike.firstStrikeAt) strike.firstStrikeAt = Date.now();
  if (!strike.expiryAt) strike.expiryAt = Date.now() + expiryMs;
  await strike.save();
  return strike;
};

Strike.getStrikeCount = async function (memberId, actionType, guildId) {
  const strike = await Strike.findOne({ memberId, actionType, guildId, expired: { $ne: true } });
  return strike ? strike.strikeCount : 0;
};

Strike.expireOld = async function () {
  const now = Date.now();
  return Strike.updateMany(
    { expiryAt: { $lte: now }, expired: { $ne: true } },
    { $set: { expired: true, updatedAt: new Date() } }
  );
};

Strike.resetStrikes = async function (memberId, actionType, guildId) {
  return Strike.updateMany(
    { memberId, actionType, guildId, expired: { $ne: true } },
    { $set: { expired: true, updatedAt: new Date() } }
  );
};

Strike.getAllForMember = async function (memberId, guildId) {
  return Strike.find({ memberId, guildId, expired: { $ne: true } });
};

export default Strike;
