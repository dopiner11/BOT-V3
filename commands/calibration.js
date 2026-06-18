import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { custom as embedCustom } from '../utils/embedStyles.js';
import { buildFamilyAuditReport, auditInteractionThresholds } from '../utils/interactionMonitor.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
}

function isPresidency(member) {
  const cfg = loadConfig();
  if (cfg.committees?.founders?.includes(member.id)) return true;
  if (cfg.committees?.authorizedUsers?.includes(member.id)) return true;
  const allowedRoles = [];
  if (cfg.roles?.admin?.id) allowedRoles.push(cfg.roles.admin.id);
  if (cfg.roles?.generalManager?.id) allowedRoles.push(cfg.roles.generalManager.id);
  const presidencyRoles = cfg.committees?.list?.family_presidency?.roles;
  if (presidencyRoles) {
    for (const key of Object.keys(presidencyRoles)) {
      const ids = presidencyRoles[key];
      if (Array.isArray(ids)) allowedRoles.push(...ids);
    }
  }
  return member.roles.cache.some(r => allowedRoles.includes(r.id));
}

function buildButtonRow(activeView) {
  const btn = (id, label, active) =>
    new ButtonBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(active ? ButtonStyle.Secondary : ButtonStyle.Primary);
  return new ActionRowBuilder().addComponents(
    btn('cal_summary', '📊 الملخص', activeView === 'cal_summary'),
    btn('cal_members', '👥 تحليل الأعضاء', activeView === 'cal_members'),
    btn('cal_ranks', '📋 تحليل الرتب', activeView === 'cal_ranks'),
  );
}

function buildSummaryEmbed(audit, ia) {
  const total = audit.totalMembers;
  const rankCount = audit.rankAudit.length;

  let desc = `👥 **${total} عضو نشط** | **${rankCount} رتب ترقية**\n\n`;

  desc += `📋 **توزيع الرتب:**\n`;
  for (const r of audit.rankAudit) {
    const pct = total > 0 ? Math.round(r.memberCount / total * 100) : 0;
    desc += `  ${r.memberCount > 0 ? '👤' : '⬜'} **${r.name}**: ${r.memberCount} (${pct}%)\n`;
  }

  desc += `\n⚙️ **تصنيف التفاعل (24 ساعة):**\n`;
  desc += `  🟢 متفاعل: ${ia.counts.active}\n`;
  desc += `  🟡 خامل: ${ia.counts.inactive}\n`;
  desc += `  🔴 مخالف: ${ia.counts.violator}\n`;
  if (ia.counts.protected > 0) desc += `  🛡️ بعذر: ${ia.counts.protected}\n`;
  if (ia.counts.grace > 0) desc += `  🕐 سماح: ${ia.counts.grace}\n`;

  if (audit.usedAliases && audit.usedAliases.length > 0) {
    desc += `\n*رتبة \`${audit.usedAliases[0].from}\` دُمجت مع \`${audit.usedAliases[0].to}\`*`;
  }

  return embedCustom(0x2B2D31, '📊 تقرير المعايرة', desc.trim())
    .setFooter({ text: 'اختر زر من الأسفل للتفاصيل' });
}

function buildMemberViewEmbed(ia) {
  const { current, suggested, counts, averages, basedOnMembers, note } = ia;
  const { violator: p15, active: p60 } = suggested;
  const classified = counts.violator + counts.inactive + counts.active;

  let desc = '**قواعد التصنيف:**\n';
  desc += `  🔴 مخالف: أقل من ${current.violator} نقطة\n`;
  desc += `  🟡 خامل: من ${current.violator} إلى ${current.active - 1} نقطة\n`;
  desc += `  🟢 متفاعل: ${current.active} نقطة فأكثر\n\n`;

  desc += `**التوزيع (${counts.total} عضو):**\n`;
  desc += `  🟢 متفاعل: ${counts.active}`;
  if (counts.active > 0) desc += ` (معدل ${averages.active}ن)`;
  desc += '\n';
  desc += `  🟡 خامل: ${counts.inactive}`;
  if (counts.inactive > 0) desc += ` (معدل ${averages.inactive}ن)`;
  desc += '\n';
  desc += `  🔴 مخالف: ${counts.violator}`;
  if (counts.violator > 0) desc += ` (معدل ${averages.violator}ن)`;
  desc += '\n';
  if (counts.protected > 0) desc += `  🛡️ بعذر: ${counts.protected}\n`;
  if (counts.grace > 0) desc += `  🕐 سماح: ${counts.grace}\n`;

  if (classified > 0) {
    const vPct = Math.round(counts.violator / classified * 100);
    if (vPct > 40) desc += `\n🔍 المخالفون ${vPct}% من الأعضاء — نسبة مرتفعة`;
    else if (vPct < 15) desc += `\n✅ المخالفون ${vPct}% فقط — نسبة منخفضة`;
  }

  const suggRange = p15 < p60
    ? `\n  🟡 خامل: ${p15}~${p60 - 1}ن`
    : '';
  desc += `\n\n**💡 نقترح:**\n  🔴 مخالف: أقل من ${p15}ن${suggRange}\n  🟢 متفاعل: ${p60}ن فأكثر`;
  desc += `\n*(حسب ${basedOnMembers} عضو)*`;
  if (note) desc += `\n${note}`;

  return embedCustom(0x1A1A2E, '👥 تحليل تفاعل الأعضاء', desc.trim());
}

function buildRankViewEmbed(audit) {
  let desc = '';

  for (const r of audit.rankAudit) {
    if (r.memberCount === 0) {
      desc += `\n⬜ **${r.name}** — ⚠️ لا يوجد أعضاء\n`;
      continue;
    }

    const ptsList = r.memberData.map(m => `${m.points}ن`).join(' ');
    const truncated = r.memberData.length > 7
      ? ptsList.split(' ').slice(0, 7).join(' ') + ` +${r.memberData.length - 7}...`
      : ptsList;

    desc += `\n📍 **${r.name}** (${r.memberCount} عضو)\n`;
    desc += `  النقاط: ${truncated}\n`;
    desc += `  المعدل: ${r.avgPoints} | الأعلى: ${r.maxPoints} | الأقل: ${r.minPoints}\n`;

    if (r.requiredPoints > 0) {
      desc += `  ← يحتاج ${r.requiredPoints}ن`;
      if (r.suggestionLabel) desc += ` — ${r.suggestionLabel}`;
      desc += '\n';
    } else {
      desc += '  ← رتبة نهائية\n';
    }
  }

  return embedCustom(0x1A1A2E, '📋 تحليل الرتب', desc.trim());
}

export async function handleCalView(interaction) {
  if (!isPresidency(interaction.member)) {
    return interaction.reply({ content: '❌ فقط الرئاسة يمكنها استخدام هذا الزر.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  const [audit, ia] = await Promise.all([
    buildFamilyAuditReport(),
    auditInteractionThresholds(),
  ]);

  const view = interaction.customId;
  const builders = {
    cal_summary: () => buildSummaryEmbed(audit, ia),
    cal_members: () => buildMemberViewEmbed(ia),
    cal_ranks: () => buildRankViewEmbed(audit),
  };

  const embed = builders[view]?.() || builders.cal_summary();
  await interaction.editReply({ embeds: [embed], components: [buildButtonRow(view)] });
}

export default {
  data: new SlashCommandBuilder()
    .setName('معايرة')
    .setDescription('عرض تقرير المعايرة (الرتب + التفاعل)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!isPresidency(interaction.member)) {
      return interaction.editReply({ content: '❌ فقط الرئاسة يمكنها استخدام هذا الأمر.' });
    }

    const [audit, ia] = await Promise.all([
      buildFamilyAuditReport(),
      auditInteractionThresholds(),
    ]);

    const embed = buildSummaryEmbed(audit, ia);
    await interaction.editReply({ embeds: [embed], components: [buildButtonRow('cal_summary')] });
  }
};
