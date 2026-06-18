import { createModel } from '../data/db.js';

const Attendance = createModel('Attendance');

Attendance.col.preSave(async function () {
  this.updatedAt = new Date();
});

export default Attendance;
