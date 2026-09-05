import { Router } from 'express';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { readCollection, readFile } from '../services/dbReader.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BM_DIR = join(__dirname, '../../data/blackmarket');

const router = Router();

// Page - black market
router.get('/blackmarket', requireAuth, requirePerm('blackmarket.view'), (req, res) => {
  const sellers = readCollection('BlackMarketSeller');
  const orders = readFile(join(BM_DIR, 'orders.json')) || [];
  const products = readFile(join(BM_DIR, 'products.json')) || [];
  res.render('pages/blackmarket', {
    title: 'البلاك ماركت',
    active: 'blackmarket',
    sellers,
    orders,
    products,
    stats: { sellers: sellers.length, orders: orders.length, products: products.length },
    canEdit: req.session.user.permissions.includes('*') || req.session.user.permissions.includes('blackmarket.edit')
  });
});

// API - sellers
router.get('/api/blackmarket/sellers', requireAuth, requirePerm('blackmarket.view'), (req, res) => {
  res.json(readCollection('BlackMarketSeller'));
});

// API - orders
router.get('/api/blackmarket/orders', requireAuth, requirePerm('blackmarket.view'), (req, res) => {
  res.json(readFile(join(BM_DIR, 'orders.json')) || []);
});

export default router;
