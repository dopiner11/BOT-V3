import { Router } from 'express';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { loadDashboardConfig, saveDashboardConfig } from '../services/dashboardConfig.js';
import { readMainConfig } from '../services/dbReader.js';

const router = Router();

// Page - channels & roles (read from dashboard config + main config role ids)
router.get('/channels', requireAuth, requirePerm('channels.view'), (req, res) => {
  const mainConfig = readMainConfig();
  const channels = extractChannels(mainConfig);
  res.render('pages/channels', {
    title: 'الرومات والقنوات',
    active: 'channels',
    channels,
    canEdit: req.session.user.permissions.includes('*') || req.session.user.permissions.includes('channels.edit')
  });
});

router.get('/roles', requireAuth, requirePerm('roles.view'), (req, res) => {
  const mainConfig = readMainConfig();
  const roles = extractRoles(mainConfig);
  res.render('pages/roles', {
    title: 'الرولات',
    active: 'roles',
    roles,
    canEdit: req.session.user.permissions.includes('*') || req.session.user.permissions.includes('roles.edit')
  });
});

// Page - settings (dashboard config: server, permissions, ui)
router.get('/settings', requireAuth, requirePerm('settings.view'), (req, res) => {
  const dashboardConfig = loadDashboardConfig();
  res.render('pages/settings', {
    title: 'إعدادات الموقع',
    active: 'settings',
    dashboardConfig,
    configJson: JSON.stringify(dashboardConfig, null, 2),
    canEdit: req.session.user.permissions.includes('*') || req.session.user.permissions.includes('settings.edit')
  });
});

// API - settings update
router.post('/api/settings', requireAuth, requirePerm('settings.edit'), (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({ error: 'بيانات غير صالحة' });
    }
    saveDashboardConfig(newConfig);
    res.json({ success: true, message: 'تم حفظ إعدادات الموقع' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API - settings get
router.get('/api/settings', requireAuth, requirePerm('settings.view'), (req, res) => {
  res.json(loadDashboardConfig());
});

// API - channels raw
router.get('/api/channels', requireAuth, requirePerm('channels.view'), (req, res) => {
  res.json(extractChannels(readMainConfig()));
});

// API - roles raw
router.get('/api/roles', requireAuth, requirePerm('roles.view'), (req, res) => {
  res.json(extractRoles(readMainConfig()));
});

function extractChannels(config) {
  const out = [];
  function walk(obj, path = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj)) {
      const cur = path ? `${path}.${key}` : key;
      if (val && typeof val === 'object' && (val.id || val.channelId)) {
        const id = val.id || val.channelId;
        if (typeof id === 'string' && id.length > 10) {
          const label = val._label || key;
          out.push({ key: cur, label, id });
        }
      } else if (typeof val === 'object') {
        walk(val, cur);
      }
    }
  }
  walk(config);
  return out;
}

function extractRoles(config) {
  const out = [];
  function walk(obj, path = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj)) {
      const cur = path ? `${path}.${key}` : key;
      if (val && typeof val === 'object' && (val.id || val.roleId)) {
        const id = val.id || val.roleId;
        if (typeof id === 'string' && id.length > 10) {
          const label = val._label || key;
          out.push({ key: cur, label, id });
        }
      } else if (typeof val === 'object') {
        walk(val, cur);
      }
    }
  }
  walk(config);
  return out;
}

export default router;
