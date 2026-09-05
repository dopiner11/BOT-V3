import { Router } from 'express';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { readMainConfig, readFile } from '../services/dbReader.js';
import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MAIN_CONFIG = join(__dirname, '../../config.json');

const router = Router();

// Page - config viewer/editor
router.get('/config', requireAuth, requirePerm('config.view'), (req, res) => {
  const config = readMainConfig();
  res.render('pages/config', {
    title: 'ملف الإعدادات',
    active: 'config',
    configJson: JSON.stringify(config, null, 2),
    canEdit: req.session.user.permissions.includes('*') || req.session.user.permissions.includes('config.edit')
  });
});

// API - get raw config
router.get('/api/config', requireAuth, requirePerm('config.view'), (req, res) => {
  res.json(readMainConfig());
});

// API - update config
router.post('/api/config', requireAuth, requirePerm('config.edit'), (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({ error: 'بيانات غير صالحة' });
    }
    writeFileSync(MAIN_CONFIG, JSON.stringify(newConfig, null, 2), 'utf8');
    res.json({ success: true, message: 'تم حفظ ملف الإعدادات' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
