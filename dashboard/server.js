import express from 'express';
import session from 'express-session';
import expressLayouts from 'express-ejs-layouts';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { loadDashboardConfig } from './services/dashboardConfig.js';
import { initBotController } from './services/botController.js';

import authRoutes from './routes/auth.js';
import botRoutes from './routes/bot.js';
import configRoutes from './routes/config.js';
import memberRoutes from './routes/members.js';
import ticketRoutes from './routes/tickets.js';
import blackmarketRoutes from './routes/blackmarket.js';
import statsRoutes from './routes/stats.js';
import mainRoutes from './routes/main.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = loadDashboardConfig();
const app = express();

app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(join(__dirname, 'public')));

app.use(session({
  secret: config.server.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Make config & helper available in all views
app.use((req, res, next) => {
  res.locals.dashConfig = config;
  res.locals.user = req.session?.user || null;
  res.locals.discordCdn = (avatar, id) =>
    avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png` : '';
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/', mainRoutes);
app.use('/', statsRoutes);
app.use('/', authRoutes);
app.use('/', botRoutes);
app.use('/', configRoutes);
app.use('/', memberRoutes);
app.use('/', ticketRoutes);
app.use('/', blackmarketRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).send('الصفحة غير موجودة');
});

initBotController();

const host = config.server.host;
const port = config.server.port;
app.listen(port, host, () => {
  console.log(`==========================================`);
  console.log(`  🎛️  لوحة تحكم X.IRAQ FAMILY شغالة`);
  console.log(`  العنوان: http://${host}:${port}`);
  console.log(`  تسجيل الدخول: http://${host}:${port}/login`);
  console.log(`==========================================`);
});

export default app;
