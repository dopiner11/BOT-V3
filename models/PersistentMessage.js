import { createModel } from '../data/db.js';

const PersistentMessage = createModel('persistentmessages');

PersistentMessage.col.preSave(function () {
  this.updatedAt = new Date();
});

export default PersistentMessage;
