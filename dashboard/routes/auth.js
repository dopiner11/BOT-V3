import { Router } from 'express';
import { buildOAuthUrl, exchangeCode, fetchUser, fetchGuildMember, computePermissions } from '../middleware/auth.js';
import { loadDashboardConfig } from '../services/dashboardConfig.js';

const router = Router();

router.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.render('pages/login', {
    title: 'تسجيل الدخول',
    oauthUrl: buildOAuthUrl()
  });
});

router.get('/oauth/discord', (req, res) => {
  res.redirect(buildOAuthUrl());
});

router.get('/oauth/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('لا يوجد كود تفويض');

  try {
    const token = await exchangeCode(code);
    const user = await fetchUser(token.access_token);
    const config = loadDashboardConfig();
    const member = await fetchGuildMember(token.access_token, config.discord.guildId);

    let memberRoles = [];
    if (member && Array.isArray(member.roles)) {
      memberRoles = member.roles;
    }

    const permissions = computePermissions(memberRoles, config);

    req.session.user = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator || '',
      avatar: user.avatar,
      global_name: user.global_name,
      memberRoles,
      permissions,
      accessToken: token.access_token
    };

    // Determine if role matched
    const roleRules = config.permissions?.roles || [];
    const matched = roleRules.some(r => memberRoles.includes(r.roleId));
    if (!matched) {
      return res.status(403).render('pages/denied', {
        title: 'ما عندك صلاحية',
        message: config.permissions?.defaultDeniedMessage || 'ما عندك صلاحية للدخول إلى لوحة التحكم.'
      });
    }

    return res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err?.response?.data || err.message);
    return res.status(500).send(`فشل تسجيل الدخول: ${err.message}`);
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

export default router;
