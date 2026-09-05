import axios from 'axios';
import { loadDashboardConfig } from '../services/dashboardConfig.js';

const API = 'https://discord.com/api/v10';

export function buildOAuthUrl() {
  const c = loadDashboardConfig();
  const params = new URLSearchParams({
    client_id: c.discord.clientId,
    redirect_uri: c.discord.redirectUri,
    response_type: 'code',
    scope: c.discord.scopes.join(' ')
  });
  return `${API}/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCode(code) {
  const c = loadDashboardConfig();
  const params = new URLSearchParams({
    client_id: c.discord.clientId,
    client_secret: c.discord.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.discord.redirectUri
  });
  const res = await axios.post(`${API}/oauth2/token`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return res.data;
}

export async function fetchUser(accessToken) {
  const res = await axios.get(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return res.data;
}

export async function fetchGuildMember(accessToken, guildId) {
  try {
    const res = await axios.get(`${API}/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return res.data;
  } catch {
    return null;
  }
}

// Build a role-based permission set for the user from dashboard config
export function computePermissions(memberRoles, dashboardConfig) {
  if (!memberRoles || !Array.isArray(memberRoles)) return [];
  const granted = new Set();
  const roleRules = dashboardConfig.permissions?.roles || [];
  if (memberRoles.includes(dashboardConfig.discord?.guildId)) {
    // owner or something; roles are handled below
  }
  for (const rule of roleRules) {
    if (memberRoles.includes(rule.roleId)) {
      for (const p of rule.permissions || []) {
        granted.add(p);
        // if allow-all, also grant everything
        if (p === '*') {
          const all = dashboardConfig.permissionList?.items || {};
          Object.keys(all).forEach(k => granted.add(k));
        }
      }
    }
  }
  return Array.from(granted);
}

// Middleware: require being logged in
export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect('/login');
}

// Middleware: require a permission
export function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    if (req.session.user.permissions.includes('*') || req.session.user.permissions.includes(perm)) {
      return next();
    }
    // No permission -> show denied page
    return res.status(403).render('pages/denied', {
      title: 'ما عندك صلاحية',
      message: loadDashboardConfig().permissions?.defaultDeniedMessage || 'ما عندك صلاحية للوصول إلى هذه الصفحة.'
    });
  };
}

export function hasPermission(user, perm) {
  if (!user) return false;
  return user.permissions.includes('*') || user.permissions.includes(perm);
}
