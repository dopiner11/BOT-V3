import { Router } from 'express';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { listCollections, countCollection, readCollection } from '../services/dbReader.js';
import { getBotStatus } from '../services/botController.js';

const router = Router();

function buildStats() {
  const collections = listCollections();
  const counts = {};
  for (const c of collections) {
    counts[c] = countCollection(c);
  }

  const members = readCollection('Member');
  const active = members.filter(m => m.isActive).length;
  const totalPoints = members.reduce((s, m) => s + (m.points || 0), 0);
  const warnings = readCollection('Warning');
  const tickets = readCollection('Ticket');
  const reports = readCollection('Report');

  const stats = {
    collectionsCount: collections.length,
    collections: counts,
    members: {
      total: members.length,
      active,
      inactive: members.length - active,
      totalPoints
    },
    warnings: warnings.length,
    tickets: {
      total: tickets.length,
      open: tickets.filter(t => !t.closedAt && t.status !== 'closed').length
    },
    reports: reports.length,
    bot: getBotStatus()
  };

  return stats;
}

// Page - dashboard (home)
router.get('/', requireAuth, requirePerm('stats.view'), (req, res) => {
  const stats = buildStats();
  res.render('pages/dashboard', {
    title: 'لوحة التحكم الرئيسية',
    active: 'dashboard',
    stats,
    user: req.session.user
  });
});

// API - stats
router.get('/api/stats', requireAuth, requirePerm('stats.view'), (req, res) => {
  res.json(buildStats());
});

export default router;
