import { Router } from 'express';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { readCollection } from '../services/dbReader.js';

const router = Router();

// Page - tickets
router.get('/tickets', requireAuth, requirePerm('tickets.view'), (req, res) => {
  const tickets = readCollection('Ticket');
  const open = tickets.filter(t => !t.closedAt && t.status !== 'closed').length;
  const closed = tickets.length - open;
  res.render('pages/tickets', {
    title: 'نظام التذاكر',
    active: 'tickets',
    tickets,
    stats: { total: tickets.length, open, closed },
    canEdit: req.session.user.permissions.includes('*') || req.session.user.permissions.includes('tickets.edit')
  });
});

// API - tickets list
router.get('/api/tickets', requireAuth, requirePerm('tickets.view'), (req, res) => {
  const tickets = readCollection('Ticket').map(t => ({
    ...t,
    typeLabel: t.type,
    userLabel: t.userName || t.userId || t.user || t.opener || ''
  }));
  res.json(tickets);
});

export default router;
