import { Router } from 'express';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { readCollection } from '../services/dbReader.js';

const router = Router();

// Page - members
router.get('/members', requireAuth, requirePerm('members.view'), (req, res) => {
  const members = readCollection('Member');
  const total = members.length;
  const active = members.filter(m => m.isActive).length;
  const totalPoints = members.reduce((s, m) => s + (m.points || 0), 0);
  res.render('pages/members', {
    title: 'إدارة الأعضاء',
    active: 'members',
    members,
    stats: { total, active, totalPoints },
    canEdit: req.session.user.permissions.includes('*') || req.session.user.permissions.includes('members.edit')
  });
});

// API - members list
router.get('/api/members', requireAuth, requirePerm('members.view'), (req, res) => {
  res.json(readCollection('Member'));
});

// API - member detail
router.get('/api/members/:id', requireAuth, requirePerm('members.view'), (req, res) => {
  const members = readCollection('Member');
  const member = members.find(m => m.discordId === req.params.id || m._id === req.params.id);
  if (!member) return res.status(404).json({ error: 'العضو غير موجود' });
  res.json(member);
});

export default router;
