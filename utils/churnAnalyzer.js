import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Member from '../models/Member.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 60000;

function loadConfig() {
  const now = Date.now();
  if (_configCache && now - _configCacheTime < CONFIG_CACHE_TTL) return _configCache;
  try {
    _configCache = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    _configCacheTime = now;
  } catch {
    _configCache = _configCache || {};
  }
  return _configCache;
}

/* ===================================================================
   تحليل الفاقد (Churn) حسب الرتبة
   =================================================================== */
export async function analyzeChurn(daysBack = 60) {
  const config = loadConfig();
  const ranks = config.promotion?.ranks || [];
  const rankNames = ranks.map(r => r.name);

  const cutoff = new Date(Date.now() - daysBack * 86400000);
  const allMembers = await Member.find({});

  // Departed members = isActive = false, and was created before cutoff
  // (we consider them "departed" if they're inactive and left within our window)
  const departed = allMembers.filter(m => {
    if (m.isActive) return false;
    const fired = m.firedAt ? new Date(m.firedAt) : null;
    return fired && fired >= cutoff;
  });

  const totalDeparted = departed.length;

  // Count by rank
  const byRank = new Map();
  for (const name of rankNames) {
    byRank.set(name, 0);
  }
  byRank.set('غير معروف', 0);

  for (const m of departed) {
    const rank = m.lastActiveRank || m.currentRank || 'غير معروف';
    let found = false;
    for (const name of rankNames) {
      if (rank === name) {
        byRank.set(name, (byRank.get(name) || 0) + 1);
        found = true;
        break;
      }
    }
    if (!found) {
      byRank.set('غير معروف', (byRank.get('غير معروف') || 0) + 1);
    }
  }

  // Build result
  const rankResults = [];
  for (const name of rankNames) {
    const count = byRank.get(name) || 0;
    if (count === 0) continue;
    const pct = totalDeparted > 0 ? Math.round(count / totalDeparted * 100) : 0;
    const severity = pct >= 30 ? 'high' : (pct >= 15 ? 'medium' : 'low');
    rankResults.push({ name, count, percentage: pct, severity });
  }

  // Unknown rank
  const unknownCount = byRank.get('غير معروف') || 0;
  if (unknownCount > 0) {
    const pct = Math.round(unknownCount / totalDeparted * 100);
    rankResults.push({ name: 'غير معروف', count: unknownCount, percentage: pct, severity: pct >= 30 ? 'high' : 'medium' });
  }

  // Generate recommendations
  const recommendations = [];
  for (const r of rankResults) {
    if (r.severity === 'high') {
      recommendations.push(`🔴 ${r.percentage}% من المغادرين من رتبة "${r.name}" — ينصح بزيادة مكافآت هذه الرتبة أو تعديل متطلباتها`);
    } else if (r.severity === 'medium') {
      recommendations.push(`🟡 ${r.percentage}% من المغادرين من رتبة "${r.name}" — يحتاج مراقبة`);
    }
  }

  if (recommendations.length === 0 && totalDeparted > 0) {
    recommendations.push('🟢 الفاقد موزع بشكل متوازن على الرتب — لا توجد مشكلة واضحة');
  }
  if (totalDeparted === 0) {
    recommendations.push('🟢 لا يوجد مغادرين في الفترة المحددة');
  }

  return {
    totalDeparted,
    daysAnalyzed: daysBack,
    byRank: rankResults,
    recommendations,
  };
}

/* ===================================================================
   تحليل Breakpoints — الرتب اللي يعلق فيها الأعضاء
   =================================================================== */
export async function analyzeBreakpoints() {
  const config = loadConfig();
  const ranks = config.promotion?.ranks || [];
  const activeMembers = await Member.find({ isActive: true });

  // Group members by their current rank
  const rankMemberCount = new Map();
  for (const rank of ranks) {
    rankMemberCount.set(rank.name, 0);
  }

  for (const m of activeMembers) {
    const curr = rankMemberCount.get(m.currentRank);
    if (curr !== undefined) {
      rankMemberCount.set(m.currentRank, curr + 1);
    }
  }

  const result = [];
  let maxCount = 0;
  let maxRank = '';

  for (const rank of ranks) {
    const count = rankMemberCount.get(rank.name) || 0;
    result.push({ name: rank.name, memberCount: count });
    if (count > maxCount) {
      maxCount = count;
      maxRank = rank.name;
    }
  }

  const totalActive = activeMembers.length;
  const pctAtMax = totalActive > 0 ? Math.round(maxCount / totalActive * 100) : 0;

  let recommendation = '';
  if (pctAtMax > 35) {
    recommendation = `⚠️ ${pctAtMax}% من الأعضاء في رتبة "${maxRank}" — مؤشر احتباس، قد يحتاج تعديل متطلبات الترقية`;
  } else if (pctAtMax > 25) {
    recommendation = `👀 ${pctAtMax}% من الأعضاء في رتبة "${maxRank}" — يحتاج مراقبة`;
  } else {
    recommendation = '✅ توزيع الأعضاء على الرتب متوازن';
  }

  return {
    ranks: result,
    maxRank,
    maxCount,
    totalActive,
    pctAtMax,
    recommendation,
  };
}
