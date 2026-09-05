import { Router } from 'express';
import { requireAuth, requirePerm, hasPermission } from '../middleware/auth.js';
import { getBotStatus, getLog, startBot, stopBot, restartBot, isBotRunning, writeLogFile } from '../services/botController.js';

const router = Router();

// Page - bot control
router.get('/bot', requireAuth, requirePerm('bot.view'), (req, res) => {
  const status = getBotStatus();
  const log = getLog(300);
  res.render('pages/bot', {
    title: 'التحكم بالبوت',
    active: 'bot',
    status,
    log,
    running: status.state === 'running',
    can: hasPermission(req.session.user, 'bot.restart')
  });
});

// API - status
router.get('/api/bot/status', requireAuth, requirePerm('bot.view'), (req, res) => {
  res.json(getBotStatus());
});

// API - log
router.get('/api/bot/log', requireAuth, requirePerm('bot.log'), (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 200;
  res.json({ log: getLog(limit) });
});

// API - start
router.post('/api/bot/start', requireAuth, requirePerm('bot.start'), (req, res) => {
  const result = startBot();
  res.json(result);
});

// API - stop
router.post('/api/bot/stop', requireAuth, requirePerm('bot.stop'), (req, res) => {
  const result = stopBot();
  res.json(result);
});

// API - restart
router.post('/api/bot/restart', requireAuth, requirePerm('bot.restart'), (req, res) => {
  const result = restartBot();
  res.json({ ...result, status: getBotStatus() });
});

// API - download log
router.get('/api/bot/log/download', requireAuth, requirePerm('bot.log'), (req, res) => {
  const filePath = writeLogFile();
  if (!filePath) return res.status(500).json({ error: 'تعذر حفظ اللوج' });
  res.download(filePath);
});

export default router;
