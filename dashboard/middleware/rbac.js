import { loadDashboardConfig } from '../services/dashboardConfig.js';
import { computePermissions } from './auth.js';

// Recompute the permission set for the logged-in user (used after role changes)
export function refreshUserPermissions(req) {
  if (!req.session?.user) return null;
  const memberRoles = req.session.user.memberRoles || [];
  const perms = computePermissions(memberRoles, loadDashboardConfig());
  req.session.user.permissions = perms;
  req.session.user.roleName = resolveRoleName(memberRoles);
  return req.session.user;
}

function resolveRoleName(memberRoles) {
  const roles = loadDashboardConfig().permissions?.roles || [];
  for (const r of roles) {
    if (memberRoles && memberRoles.includes(r.roleId)) return r.name;
  }
  return 'عضو بدون صلاحيات';
}

// Page-level guard that redirects to denied page or sends 403
export function requirePagePermission(pageKey) {
  return (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    const perms = req.session.user.permissions || [];
    if (perms.includes('*') || perms.includes(pageKey)) return next();
    return res.status(403).render('pages/denied', {
      title: 'ما عندك صلاحية',
      message: loadDashboardConfig().permissions?.defaultDeniedMessage || 'ما عندك صلاحية للوصول إلى هذه الصفحة.'
    });
  };
}

// Check in view rendering
export function can(user, perm) {
  if (!user) return false;
  return user.permissions.includes('*') || user.permissions.includes(perm);
}
