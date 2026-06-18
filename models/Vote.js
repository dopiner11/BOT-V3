import { createModel } from '../data/db.js';

const Vote = createModel('Vote');

Vote.col.preSave(async function () {
  try {
    this.lastActivity = new Date();
  } catch (err) {
    console.error('Vote pre-save error:', err);
  }
});

export default Vote;
