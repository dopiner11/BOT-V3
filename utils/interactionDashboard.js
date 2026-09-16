import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, UserSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType, MessageFlags,
} from 'discord.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PermissionsBitField } from 'discord.js';
import { loadConfig, clearConfigCache } from './configLoader.js';
import PersistentMessage from '../models/PersistentMessage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, '../config.json');

const PANEL_KEY = 'interactionDashboard';
const PAGE_SIZE = 12;

const PANEL_CHANNEL_TYPES = [
  ChannelType.GuildText, ChannelType.GuildAnnouncement,
  ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildCategory,
];

function F(slug, label, path, type) {
  return { slug, label, path, type };
}

const REPORT_TYPES = [
  { key: 'daily_interaction', emoji: '📊', label: 'تفاعل يومي' },
  { key: 'kill_citizen', emoji: '💀', label: 'قتل مواطن' },
  { key: 'kill_police', emoji: '👮', label: 'قتل شرطي' },
  { key: 'store_robbery', emoji: '🏪', label: 'سرقة متجر' },
  { key: 'big_robbery', emoji: '🎪', label: 'سرقة كبيرة' },
  { key: 'event_participation', emoji: '🚫', label: 'تهريب ممنوعات' },
  { key: 'scenario_participation', emoji: '👨‍👩‍👧‍👦', label: 'مشاركة سيناريو' },
  { key: 'farm_participation', emoji: '🌾', label: 'مشاركة مزرعة' },
  { key: 'vehicle_location', emoji: '🚗', label: 'مركبة / موقع' },
  { key: 'rescue_family_member', emoji: '🦸', label: 'انقاذ عائلة' },
];

const RANK_NAMES = ['عضو جديد', 'مستوى 1', 'مستوى 2', 'مستوى 3', 'مستوى 4', 'مستوى 5'];

const SECTIONS = [
  {
    id: 'limits', emoji: '🎯', label: 'حدود التصنيف', desc: 'حدود المخالف والخامل والمتفاعل وأيام السماح ونوافذ المراجعة والستريك.',
    fields: [
      F('im_violator', '🔴 حد المخالف — أقل من هالرقم = مخالف', 'interactionMonitor.violatorThreshold.value', 'number'),
      F('im_inactive', '🟡 حد الخامل — أقل منه وأكثر من المخالف = خامل', 'interactionMonitor.inactiveThreshold.value', 'number'),
      F('im_active', '🟢 حد المتفاعل — هالرقم أو أكثر = متفاعل', 'interactionMonitor.activeThreshold.value', 'number'),
      F('im_grace', '🆕 أيام السماح للعضو الجديد', 'interactionMonitor.graceDays.value', 'number'),
      F('im_window', '⏱️ نافذة المراجعة (ساعات)', 'interactionMonitor.reviewWindowHours.value', 'number'),
      F('im_analysis', '📈 أيام التحليل للتقرير', 'interactionMonitor.analysisDays.value', 'number'),
      F('im_minactive', '📅 أقل أيام نشاط للظهور بالتقارير', 'interactionMonitor.minActiveDays.value', 'number'),
      F('im_maxwarn', '⚠️ أقصى إنذارات قبل الفصل', 'interactionMonitor.maxWarnings.value', 'number'),
      F('im_streak', '🔥 مكافآت الستريك (كل سطر: أيام=مضاعف)', 'interactionMonitor.streakMilestones.value', 'streaks'),
    ],
  },
  {
    id: 'reportpoints', emoji: '💰', label: 'نقاط كل تقرير', desc: 'كم نقطة يعطي المبلغ عنه والمشاركون لكل نوع تقرير.',
    fields: [
      ...REPORT_TYPES.flatMap((r, idx) => [
        F(`rp_${idx}_r`, `${r.emoji} ${r.label} — المبلغ عنه`, `points.reportPoints.${r.key}.reporter`, 'number'),
        F(`rp_${idx}_p`, `${r.emoji} ${r.label} — المشاركون`, `points.reportPoints.${r.key}.participants`, 'number'),
      ]),
    ],
  },
  {
    id: 'attendance', emoji: '⏱️', label: 'نظام الاحتلال', desc: 'نقاط الاحتلال وفتراته وقنواته ورومات الصوت المسموحة.',
    fields: [
      F('att_pts', '⭐ نقاط كل فترة', 'attendance.pointsPerInterval', 'number'),
      F('att_interval', '⏲️ طول الفترة (دقائق)', 'attendance.intervalMinutes', 'number'),
      F('att_min', '🔻 أقل مدة جلسة (دقائق)', 'attendance.minSessionMinutes', 'number'),
      F('att_max', '🔺 أقصى مدة جلسة (دقائق)', 'attendance.maxSessionMinutes', 'number'),
      F('att_grace', '⏳ مهلة الصوت قبل البدء (دقائق)', 'attendance.voiceGracePeriodMinutes', 'number'),
      F('att_cooldown', '😴 هدوء الخمول (ساعات)', 'attendance.inactivityCooldownHours', 'number'),
      F('att_voice', '🎙️ رومات الصوت المسموحة', 'attendance.voiceChannelIds', 'channels'),
      F('att_warn', '🔊 روم تحذير الصوت', 'attendance.voiceWarningChannelId', 'channel'),
      F('att_panel', '🖥️ روم لوحة الحضور', 'attendance.panelChannelId', 'channel'),
      F('att_feed', '📡 روم تغذية الحضور', 'attendance.feedChannelId', 'channel'),
      F('att_admin', '📋 روم سجل الإدارة', 'attendance.adminLogChannelId', 'channel'),
      F('att_dash', '📊 روم لوحة الإحصائيات', 'attendance.dashboardChannelId', 'channel'),
      F('att_inact', '🟡 روم سجل الخمول', 'attendance.inactivityLogChannelId', 'channel'),
    ],
  },
  {
    id: 'promotion', emoji: '🏆', label: 'نقاط وأيام الترقيات', desc: 'كم نقطة وكم يوم مطلوب لكل رتبة للترقية.',
    fields: [
      ...RANK_NAMES.flatMap((name, i) => [
        F(`pm_${i}_pts`, `🏅 ${name} — النقاط المطلوبة`, `promotion.ranks.${i}.requiredPoints`, 'number'),
        F(`pm_${i}_days`, `🗓️ ${name} — الأيام المطلوبة`, `promotion.ranks.${i}.requiredDays`, 'number'),
      ]),
    ],
  },
  {
    id: 'channels', emoji: '📡', label: 'قنوات النظام', desc: 'قنوات سجل التفاعل والتنبيهات والإعلانات وقنوات التقارير.',
    fields: [
      F('im_log', '📦 قناة سجل العقوبات', 'interactionMonitor.channels.log.value', 'channel'),
      F('im_alert', '🔔 قناة التنبيهات', 'interactionMonitor.channels.alert.value', 'channel'),
      F('im_ann', '📣 قناة الإعلانات (للفصل)', 'interactionMonitor.channels.announcements.value', 'channel'),
      F('im_dec', '📜 قناة قرارات العقوبات', 'interactionMonitor.channels.decisions.value', 'channel'),
      F('pt_reports', '📋 قناة إرسال التقارير اليومية', 'points.channels.reports.id', 'channel'),
      F('pt_log', '🪵 قناة سجل التقارير', 'points.channels.reportLog.id', 'channel'),
      F('pt_admin', '👑 قناة تقارير الإدارة', 'points.channels.adminReports.id', 'channel'),
      F('pt_staff', '🛡️ قناة مراجعة الموظفين', 'points.channels.staffReview.id', 'channel'),
    ],
  },
  {
    id: 'emojis', emoji: '🎨', label: 'الإيموجيهات', desc: 'إيموجي كل تصنيف يظهر بجانب اسم العضو.',
    fields: [
      F('em_active', '🟢 إيموجي متفاعل', 'interactionMonitor.emoji.active.value', 'text'),
      F('em_inactive', '🟡 إيموجي خامل', 'interactionMonitor.emoji.inactive.value', 'text'),
      F('em_violator', '🔴 إيموجي مخالف', 'interactionMonitor.emoji.violator.value', 'text'),
      F('em_warned', '🟤 إيموجي مُنذَر', 'interactionMonitor.emoji.warned.value', 'text'),
      F('em_protected', '⚫ إيموجي بعذر', 'interactionMonitor.emoji.protected.value', 'text'),
      F('em_grace', '🆕 إيموجي سماح (جديد)', 'interactionMonitor.emoji.grace.value', 'text'),
    ],
  },
  {
    id: 'notifications', emoji: '🔕', label: 'الإشعارات', desc: 'تهدئة الإشعارات ومفاتيح الرسائل الخاصة.',
    fields: [
      F('nt_min', '⏰ أقل مدة بين إشعارين (ساعات)', 'interactionMonitor.notifications.minIntervalHours.value', 'number'),
      F('nt_cooldown', '❄️ تهدئة التحذير المتكرر (دقائق)', 'interactionMonitor.notifications.worseningCooldownMinutes.value', 'number'),
      F('nt_dm_viol', '📨 إشعار خاص للمخالف', 'interactionMonitor.notifications.dmOnViolation.value', 'flag'),
      F('nt_dm_inact', '📨 إشعار خاص للخامل', 'interactionMonitor.notifications.dmOnInactive.value', 'flag'),
    ],
  },
  {
    id: 'dailyguide', emoji: '📅', label: 'الإشعارات اليومية', desc: 'ضبط أوقات الرسائل اليومية والهدف وأزرار الإرسال اليدوي.',
    fields: [
      F('dg_enabled', '🟢 تفعيل النظام', 'dailyGuide.enabled', 'flag'),
      F('dg_morning_h', '🌅 ساعة الصباح (بغداد)', 'dailyGuide.morningHour', 'number'),
      F('dg_morning_m', '🌅 دقيقة الصباح', 'dailyGuide.morningMinute', 'number'),
      F('dg_eod_h', '🌙 ساعة نهاية اليوم', 'dailyGuide.endOfDayHour', 'number'),
      F('dg_eod_m', '🌙 دقيقة نهاية اليوم', 'dailyGuide.endOfDayMinute', 'number'),
      F('dg_goal', '🎯 الهدف اليومي (null=تلقائي)', 'dailyGuide.goalPoints', 'number'),
      F('dg_help', '💬 روم المساعدة', 'dailyGuide.helpChannelId', 'channel'),
    ],
  },
  {
    id: 'members', emoji: '👥', label: 'إدارة أعضاء التفاعل', desc: 'اختر عضو لمنحه سماح أو نقاط أو إعادة تصنيف.',
    fields: [],
  },
];

const FIELD_BY_SLUG = new Map();
for (const section of SECTIONS) {
  for (const field of section.fields) FIELD_BY_SLUG.set(field.slug, field);
}

/* ===================================================================
   حالة إدارة الأعضاء — تتبع العضو المختار لكل لوحة
   =================================================================== */
const selectedMemberIds = new Map();

function getPanelKey(interaction) {
  return `${interaction.guild?.id || 'dm'}:${interaction.channel?.id || 'dm'}`;
}

function getSelectedMember(interaction) {
  return selectedMemberIds.get(getPanelKey(interaction)) || null;
}

function clearSelectedMember(interaction) {
  selectedMemberIds.delete(getPanelKey(interaction));
}

function buildMemberDefaultEmbed() {
  return new EmbedBuilder()
    .setTitle('👥 إدارة أعضاء التفاعل')
    .setDescription('اختر عضو من القائمة أدناه عشان:\n• تمنحه فترة سماح\n• تضيفه نقاط\n• تشوف تقدمه\n• تعيد تصنيفته')
    .setColor(0x5865F2)
    .setFooter({ text: 'لوحة التفاعل — إدارة الأعضاء' })
    .setTimestamp();
}

function buildMemberSelectRow() {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId('int_member_select')
      .setPlaceholder('👥 اختر عضو')
      .setMaxValues(1),
  );
}

function buildMemberActionRows({ disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('int_member_grace').setEmoji('🕐').setLabel('منح سماح 24 ساعة').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('int_member_addpoints').setEmoji('➕').setLabel('إضافة نقاط').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId('int_member_progress').setEmoji('📈').setLabel('عرض التقدم').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId('int_member_reclassify').setEmoji('🔄').setLabel('إعادة تصنيف').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

async function buildMemberInfoEmbed(discordId, guild) {
  const Member = (await import('../models/Member.js')).default;
  const Warning = (await import('../models/Warning.js')).default;
  const { calculateRankProgress, quickClassify, getInteractionConfig } = await import('./interactionSystem.js');
  const { info: embedInfo } = await import('./embedStyles.js');
  const { loadConfig } = await import('./configLoader.js');
  const config = loadConfig();

  const member = await Member.findOne({ discordId });
  if (!member) {
    return embedInfo('❌ غير موجود', `العضو <@${discordId}> غير مسجل في النظام.`);
  }

  const rp = await calculateRankProgress(discordId);
  const result = await quickClassify(discordId);
  const warnings = await Warning.find({ memberId: discordId, warningType: 'inactivity', status: 'active', removed: false });
  const maxWarnings = getInteractionConfig().maxWarnings;

  const statusLabels = {
    active_high: '🟢 متفاعل', inactive: '🟡 خامل', violator: '🔴 مخالف',
    protected: '⚫ محمي (بعذر)', grace: '🆕 سماح', unknown: '❓ غير معروف',
  };
  const statusLabel = statusLabels[result.status] || result.status;

  const dg = config.dailyGuide || {};
  const gpRaw = dg.goalPoints?.value ?? dg.goalPoints;
  const goalPoints = Number.isFinite(gpRaw) ? gpRaw : getInteractionConfig().activeThreshold;
  const todayPoints = result.points ?? 0;

  const lines = [
    `**الحالة:** ${statusLabel} ${result.emoji || ''}`,
    `**النقاط اليوم:** ${todayPoints} / ${goalPoints}`,
    `**الرتبة الحالية:** ${rp?.currentRank || member.currentRank || '—'}`,
    rp?.nextRank ? `**الرتبة القادمة:** ${rp.nextRank} — باقيلك ${rp.pointsNeeded} نقطة / ${rp.estimatedDaysForDays} يوم` : '**🚀 وصل لأعلى رتبة!**',
    rp?.streakCount > 0 ? `**🔥 Streak:** ${rp.streakCount} يوم${rp.multiplier > 1 ? ` (×${rp.multiplier})` : ''}` : '',
    `**⚠️ إنذارات:** ${warnings.length} / ${maxWarnings}`,
    member.roomChannelId ? `**📍 الروم:** <#${member.roomChannelId}>` : '**📍 الروم:** لا يوجد',
  ].filter(Boolean);

  return new EmbedBuilder()
    .setTitle(`👤 ${member.gameName || discordId}`)
    .setDescription(lines.join('\n'))
    .setColor(result.status === 'active_high' ? 0x2ECC71 : result.status === 'violator' ? 0xE74C3C : 0xF1C40F)
    .setFooter({ text: 'لوحة التفاعل — إدارة الأعضاء' })
    .setTimestamp();
}

/* ===================================================================
   صلاحية الفتح: رئاسة العائلة + لجنة التفاعل + المؤسسون + المصرح + Administrator
   =================================================================== */
function hasPanelAccess(member, config) {
  if (!member) return false;
  const userId = member.id;
  if ((config.committees?.founders || []).includes(userId)) return true;
  if ((config.committees?.authorizedUsers || []).includes(userId)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;

  const roleSets = [
    config.committees?.list?.family_presidency?.roles,
    config.committees?.list?.interaction?.roles,
  ];
  for (const roles of roleSets) {
    if (!roles) continue;
    for (const list of [roles.manager, roles.deputy, roles.member]) {
      if (!Array.isArray(list)) continue;
      for (const rid of list) {
        if (rid === userId || member.roles?.cache?.has(rid)) return true;
      }
    }
  }
  return false;
}

/* ===================================================================
   قراءة/كتابة config مع مسح الكاش
   =================================================================== */
function readConfigRaw() {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

function writeConfigRaw(config) {
  const toSave = JSON.parse(JSON.stringify(config));
  if (toSave.committees) delete toSave.committees.list;
  writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf8');
  clearConfigCache();
}

function getByPath(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null || typeof current[part] !== 'object') current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/* ===================================================================
   تنسيق القيم
   =================================================================== */
function formatValue(config, field) {
  const v = getByPath(config, field.path);
  if (field.type === 'channel') {
    if (!v) return '`—`';
    return `<#${v}>`;
  }
  if (field.type === 'channels') {
    if (!Array.isArray(v) || v.length === 0) return '`—`';
    return v.map((id) => `<#${id}>`).join(' ').slice(0, 1000) || '`—`';
  }
  if (field.type === 'flag') {
    return v ? '✅ مفعل' : '❌ معطل';
  }
  if (field.type === 'streaks') {
    if (!Array.isArray(v) || v.length === 0) return '`—`';
    return v.map((m) => `${m.days} أيام = ×${m.multiplier}`).join('\n').slice(0, 1000);
  }
  if (v == null || v === '') return '`—`';
  return String(v).slice(0, 1000);
}

function paginate(list, size) {
  const pages = [];
  for (let i = 0; i < list.length; i += size) pages.push(list.slice(i, i + size));
  return pages.length ? pages : [[]];
}

/* ===================================================================
   بناء اللوحات
   =================================================================== */
function buildNavRow() {
  const options = [
    { label: '🏠 الرئيسية', value: 'home', description: 'نظرة عامة على نظام التفاعل' },
    ...SECTIONS.map((s) => ({
      label: `${s.emoji} ${s.label}`.slice(0, 100),
      value: s.id,
      description: s.desc.slice(0, 100),
    })),
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('int_nav')
      .setPlaceholder('📂 اختر القسم')
      .setMaxValues(1)
      .addOptions(options),
  );
}

function sectionMeta(sectionId) {
  const s = SECTIONS.find((x) => x.id === sectionId);
  return s || { emoji: '📊', label: 'نظام التفاعل', desc: '' };
}

function buildHomeEmbed(config) {
  const im = config.interactionMonitor || {};
  const v = (obj, fallback) => (obj && 'value' in obj ? obj.value : (obj ?? fallback));
  const attendance = config.attendance || {};
  const fields = [
    {
      name: '🎯 حدود التصنيف',
      value: [
        `🔴 المخالف < **${v(im.violatorThreshold, '—')}**`,
        `🟡 الخامل < **${v(im.inactiveThreshold, '—')}**`,
        `🟢 المتفاعل ≥ **${v(im.activeThreshold, '—')}**`,
        `🆕 أيام السماح: **${v(im.graceDays, '—')}** · ⚠️ أقصى إنذارات: **${v(im.maxWarnings, '—')}**`,
      ].join('\n'),
      inline: false,
    },
    {
      name: '💰 أبرز نقاط التقارير',
      value: REPORT_TYPES.slice(0, 5).map((r) => {
        const pts = getByPath(config, `points.reportPoints.${r.key}`);
        return `${r.emoji} ${r.label}: المبلغ ${pts?.reporter ?? '—'} / المشارك ${pts?.participants ?? '—'}`;
      }).join('\n'),
      inline: false,
    },
    {
      name: '⏱️ نظام الاحتلال',
      value: [
        `⭐ **${attendance.pointsPerInterval ?? '—'}** نقطة كل **${attendance.intervalMinutes ?? '—'}** دقيقة`,
        `🔻 أقل جلسة: **${attendance.minSessionMinutes ?? '—'}** · 🔺 أقصى جلسة: **${attendance.maxSessionMinutes ?? '—'}**`,
      ].join('\n'),
      inline: false,
    },
    {
      name: '🏆 الترقيات (أعلى رتبة)',
      value: `مستوى 5: **${getByPath(config, 'promotion.ranks.5.requiredPoints') ?? '—'}** نقطة / **${getByPath(config, 'promotion.ranks.5.requiredDays') ?? '—'}** يوم`,
      inline: false,
    },
  ];
  return new EmbedBuilder()
    .setTitle('📊 لوحة التفاعل')
    .setDescription([
      'لوحة مخصصة للتحكم في **كل ما يخص نظام التفاعل والنقاط والاحتلال** دون فتح الملفات.',
      'اختر القسم من القائمة بالأسفل ثم عدّل أي حقل.',
    ].join('\n'))
    .setColor(0xF1C40F)
    .addFields(fields)
    .setFooter({ text: `آخر تحديث: ${new Date().toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' })}` })
    .setTimestamp();
}

function buildSectionEmbed(config, sectionId, pageIndex) {
  const meta = sectionMeta(sectionId);
  const fieldsList = meta.fields || [];
  const pages = paginate(fieldsList, PAGE_SIZE);
  const page = pages[pageIndex] || pages[0];
  const grid = page.map((f) => ({
    name: `✏️ ${f.label}`,
    value: formatValue(config, f) || '`—`',
    inline: false,
  }));
  if (grid.length === 0) grid.push({ name: 'لا توجد حقول', value: 'هذا القسم فارغ.', inline: false });
  const pagesNote = pages.length > 1 ? `الصفحة **${pageIndex + 1}/${pages.length}** — ` : '';
  return new EmbedBuilder()
    .setTitle(`${meta.emoji} ${meta.label}`)
    .setDescription(`${meta.desc}\n${pagesNote}اختر حقلًا من قائمة «✏️ تعديل حقل» ثم عدّله.`)
    .setColor(0xF1C40F)
    .addFields(grid)
    .setFooter({ text: `آخر تحديث: ${new Date().toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' })}` })
    .setTimestamp();
}

function buildEditEmbed(field, config) {
  const desc = `**${field.label}**\nالقيمة الحالية:\n${formatValue(config, field) || '`—`'}\n\nاختر القيمة الجديدة أو افتح النموذج.`;
  return new EmbedBuilder()
    .setTitle('✏️ تعديل الحقل')
    .setDescription(desc)
    .setColor(0xF1C40F)
    .setFooter({ text: 'لوحة التفاعل' })
    .setTimestamp();
}

function fieldPickRow(fields, pageIndex, sectionId) {
  const page = paginate(fields, PAGE_SIZE)[pageIndex] || fields.slice(0, PAGE_SIZE);
  const options = page.map((f) => ({ label: f.label.slice(0, 100), value: f.slug }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`int_edits_${sectionId}`)
      .setPlaceholder(`✏️ تعديل حقل (${page.length})`)
      .setMaxValues(1)
      .addOptions(options),
  );
}

function editorRow(field, sectionId) {
  if (!field) return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('int_home').setLabel('🏠 رجوع للرئيسية').setStyle(ButtonStyle.Secondary),
  );
  if (field.type === 'channel' || field.type === 'channels') {
    const multi = field.type === 'channels';
    const sel = new ChannelSelectMenuBuilder()
      .setCustomId(`int_editch_${sectionId}_${field.slug}`)
      .setPlaceholder(multi ? 'اختر الرومات (يمكن اختيار أكثر من واحد)' : 'اختر الروم')
      .setMaxValues(multi ? 25 : 1)
      .setChannelTypes(PANEL_CHANNEL_TYPES);
    return new ActionRowBuilder().addComponents(sel);
  }
  if (field.type === 'flag') {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`int_toggle_${sectionId}_${field.slug}`).setLabel('🔁 عكس القيمة').setStyle(ButtonStyle.Primary),
    );
  }
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`int_modal_${sectionId}_${field.slug}`).setLabel('✏️ فتح النموذج').setStyle(ButtonStyle.Primary),
  );
}

/* ===================================================================
   بناء الحمولة الكاملة للمرسلة
   =================================================================== */
async function buildPagePayload(config, view, interaction) {
  const { page, sectionId, edit, pageIndex = 0 } = view;
  const rows = [];

  if (page === 'home') {
    rows.push(buildNavRow());
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('int_refresh').setLabel('🔄 تحديث').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('int_delete_panel').setLabel('🗑️ حذف اللوحة').setStyle(ButtonStyle.Danger),
    ));
    return { embed: buildHomeEmbed(config), rows };
  }

  const meta = sectionMeta(sectionId);
  const fieldsList = meta.fields || [];
  rows.push(buildNavRow());

  // ===== قسم إدارة الأعضاء: يعرض اختيار عضو + معلومات + أزرار =====
  if (page === 'section' && sectionId === 'members') {
    const selectedId = getSelectedMember(interaction);
    const memberEmbed = selectedId ? await buildMemberInfoEmbed(selectedId, interaction.guild) : buildMemberDefaultEmbed();
    rows.push(buildMemberSelectRow());
    rows.push(buildMemberActionRows({ disabled: !selectedId }));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('int_home').setLabel('🏠').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('int_refresh').setLabel('🔄 تحديث').setStyle(ButtonStyle.Secondary),
    ));
    return { embed: memberEmbed, rows };
  }

  if (page === 'edit') {
    const field = FIELD_BY_SLUG.get(edit);
    rows.push(editorRow(field, sectionId));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`int_cancel_${sectionId}`).setLabel('↩️ رجوع').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('int_home').setLabel('🏠').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('int_refresh').setLabel('🔄 تحديث').setStyle(ButtonStyle.Secondary),
    ));
    return { embed: buildEditEmbed(field, config), rows };
  }

  rows.push(fieldPickRow(fieldsList, pageIndex, sectionId));
  const pages = paginate(fieldsList, PAGE_SIZE);
  const navButtons = new ActionRowBuilder();
  if (pages.length > 1) {
    navButtons.addComponents(
      new ButtonBuilder().setCustomId(`int_prev_${sectionId}_${pageIndex}`).setLabel('◀ سابق').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 0),
      new ButtonBuilder().setCustomId(`int_next_${sectionId}_${pageIndex}`).setLabel('التالي ▶').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex >= pages.length - 1),
    );
  }
  navButtons.addComponents(
    new ButtonBuilder().setCustomId('int_home').setLabel('🏠').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('int_refresh').setLabel('🔄 تحديث').setStyle(ButtonStyle.Secondary),
  );
  rows.push(navButtons);

  // ===== أزرار الإرسال اليدوي لنظام الإشعارات اليومية =====
  if (sectionId === 'dailyguide') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('int_dg_send_morning').setEmoji('🌅').setLabel('إرسال الصباح الآن').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('int_dg_check_goals').setEmoji('🔍').setLabel('فحص الإنجاز الآن').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('int_dg_send_eod').setEmoji('⚠️').setLabel('إرسال نهاية اليوم الآن').setStyle(ButtonStyle.Danger),
    ));
  }

  return { embed: buildSectionEmbed(config, sectionId, pageIndex), rows };
}

async function buildPayload(config, view, interaction) {
  try {
    const { embed, rows } = await buildPagePayload(config, view, interaction);
    return { embeds: [embed], components: rows };
  } catch (err) {
    console.error('InteractionDashboard buildPayload:', err);
    return { embeds: [new EmbedBuilder().setTitle('📊 لوحة التفاعل').setDescription('حدث خطأ أثناء بناء اللوحة.').setColor(0xE74C3C)], components: [] };
  }
}

function isTransientError(err) {
  return err?.code === 10008 || err?.code === 10062 || err?.code === 40060 || err?.code === 50001
    || err?.code === 'UND_ERR_SOCKET' || err?.code === 'ECONNRESET' || err?.code === 'EPIPE' || err?.code === 'ETIMEDOUT'
    || /unknown interaction/i.test(err?.message || '');
}

function logSentError(ctx, err) {
  if (!err || isTransientError(err)) return;
  console.error(`❌ ${ctx}:`, err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(0, 4).join('\n'));
}

async function showPage(interaction, view) {
  const payload = await buildPayload(loadConfig(), view, interaction);
  try {
    if (interaction.isMessageComponent?.()) {
      await interaction.update(payload).catch(() => interaction.editReply(payload).catch(() => {}));
    } else if (interaction.replied || interaction.deferred) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    logSentError('InteractionDashboard send', err);
  }
}

function currentView(sectionId) {
  return { page: 'section', sectionId, pageIndex: 0 };
}

/* ===================================================================
   حفظ القيمة من المودال
   =================================================================== */
async function saveFieldValue(slug, value) {
  const field = FIELD_BY_SLUG.get(slug);
  if (!field) return;
  let parsed = value;
  if (slug === 'dg_goal') {
    const text = String(value).trim().toLowerCase();
    if (text === '' || text === 'null' || text === 'auto' || text === 'تلقائي') {
      parsed = null;
    } else {
      const num = Number(text.replace(/[^\d.-]/g, ''));
      if (Number.isNaN(num)) return;
      parsed = num;
    }
  } else if (field.type === 'number') {
    const num = Number(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isNaN(num)) return;
    parsed = num;
  } else if (field.type === 'streaks') {
    const lines = String(value).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsedStreaks = [];
    for (const line of lines) {
      const m = line.match(/^(\d+)\s*(?:=|:|=)\s*(\d+(?:\.\d+)?)/);
      if (!m) continue;
      const days = Number(m[1]);
      const multiplier = Number(m[2]);
      if (!Number.isNaN(days) && !Number.isNaN(multiplier)) parsedStreaks.push({ days, multiplier });
    }
    if (parsedStreaks.length === 0) return;
    parsed = parsedStreaks;
  } else if (field.type === 'flag') {
    parsed = value === true || value === 'true';
  }
  const raw = readConfigRaw();
  setByPath(raw, field.path, parsed);
  writeConfigRaw(raw);
}

async function logIntChange(guild, field, userId) {
  const config = loadConfig();
  const auditChannelId = config.committees?.auditLogChannelId?.id;
  if (!auditChannelId) return;
  const channel = await guild.channels.fetch(auditChannelId).catch(() => null);
  if (!channel) return;
  const { gold } = await import('./embedStyles.js');
  const section = SECTIONS.find((s) => s.fields.some((f) => f.slug === field.slug));
  await channel.send({
    embeds: [
      gold('📊 تغيير إعداد تفاعل', `تم تغيير **${field.label}** (${section?.emoji || ''} ${section?.label || ''})\nبواسطة: <@${userId}>`),
    ],
  }).catch(() => {});
}

function fieldModal(field, config, sectionId) {
  const value = getByPath(config, field.path);
  let current = '';
  if (field.type === 'streaks' && Array.isArray(value)) {
    current = value.map((m) => `${m.days}=${m.multiplier}`).join('\n');
  } else if (value != null) {
    current = String(value);
  }
  const input = new TextInputBuilder()
    .setCustomId('int_mi')
    .setLabel(field.label.slice(0, 45))
    .setStyle(field.type === 'streaks' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(false)
    .setValue(current.slice(0, 4000));
  return new ModalBuilder()
    .setCustomId(`int_modal_${sectionId}_${field.slug}`)
    .setTitle(field.label.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

/* ===================================================================
   النقاط العامة
   =================================================================== */
export async function openInteractionDashboard(interaction) {
  const config = loadConfig();
  if (!interaction.member || !interaction.guild) {
    return interaction.reply({ content: '❌ اللوحة تعمل داخل السيرفر فقط.', flags: MessageFlags.Ephemeral });
  }
  if (!hasPanelAccess(interaction.member, config)) {
    return interaction.reply({ content: '❌ فقط رئاسة العائلة ولجنة التفاعل تملك صلاحية هذه اللوحة.', flags: MessageFlags.Ephemeral });
  }
  const payload = await buildPayload(config, { page: 'home' }, interaction);
  try {
    await interaction.reply(payload);
  } catch (err) {
    logSentError('openInteractionDashboard', err);
    try {
      await interaction.followUp({ content: `❌ حدث خطأ أثناء إرسال اللوحة: ${err.message}`, flags: MessageFlags.Ephemeral });
    } catch {}
  }
}

export async function handleInteractionDashboardButton(interaction) {
  const config = loadConfig();
  if (!hasPanelAccess(interaction.member, config)) {
    return interaction.reply({ content: '❌ لا تملك صلاحية تعديل لوحة التفاعل.', flags: MessageFlags.Ephemeral });
  }
  const customId = interaction.customId;
  try {
    if (customId === 'int_refresh') {
      const payload = await buildPayload(loadConfig(), { page: 'home' }, interaction);
      return interaction.update(payload).catch(() => {});
    }
    if (customId === 'int_home') return showPage(interaction, { page: 'home' });
    if (customId.startsWith('int_cancel_')) {
      const sectionId = customId.replace('int_cancel_', '');
      return showPage(interaction, currentView(sectionId));
    }
    if (customId.startsWith('int_prev_') || customId.startsWith('int_next_')) {
      const rest = customId.replace(/^int_(prev|next)_/, '');
      const idx = rest.lastIndexOf('_');
      const sectionId = rest.slice(0, idx);
      const pageIndex = Number(rest.slice(idx + 1) || 0);
      const delta = customId.startsWith('int_prev_') ? -1 : 1;
      if (!sectionId) return;
      return showPage(interaction, { page: 'section', sectionId, pageIndex: Math.max(0, pageIndex + delta) });
    }
    if (customId.startsWith('int_toggle_')) {
      const rest = customId.replace('int_toggle_', '');
      const idx = rest.indexOf('_');
      const sectionId = rest.slice(0, idx);
      const slug = rest.slice(idx + 1);
      const field = FIELD_BY_SLUG.get(slug);
      if (!field) return;
      const current = getByPath(loadConfig(), field.path);
      await saveFieldValue(slug, !current);
      await logIntChange(interaction.guild, field, interaction.user.id).catch(() => {});
      return showPage(interaction, currentView(sectionId));
    }
    if (customId.startsWith('int_modal_')) {
      const rest = customId.replace('int_modal_', '');
      const idx = rest.indexOf('_');
      const sectionId = rest.slice(0, idx);
      const slug = rest.slice(idx + 1);
      const field = FIELD_BY_SLUG.get(slug);
      if (!field) return;
      return interaction.showModal(fieldModal(field, loadConfig(), sectionId));
    }
    // ===== أزرار الإشعارات اليومية اليدوية =====
    if (customId === 'int_dg_send_morning') {
      await interaction.deferReply({ ephemeral: true });
      const { sendMorningNotification } = await import('./dailyGuideSystem.js');
      await sendMorningNotification(interaction.client, interaction.guild);
      return interaction.editReply({ content: '🌅 تم إرسال خطة اليوم لجميع الأعضاء.' });
    }
    if (customId === 'int_dg_check_goals') {
      await interaction.deferReply({ ephemeral: true });
      const { checkDailyGoalReached } = await import('./dailyGuideSystem.js');
      await checkDailyGoalReached(interaction.client, interaction.guild);
      return interaction.editReply({ content: '🔍 تم فحص الإنجاز.' });
    }
    if (customId === 'int_dg_send_eod') {
      await interaction.deferReply({ ephemeral: true });
      const { sendEndOfDayWarning } = await import('./dailyGuideSystem.js');
      await sendEndOfDayWarning(interaction.client, interaction.guild);
      return interaction.editReply({ content: '⚠️ تم إرسال تنبيه نهاية اليوم.' });
    }

    // ===== أزرار إدارة الأعضاء =====
    if (customId === 'int_member_grace') {
      await interaction.deferReply({ ephemeral: true });
      const discordId = getSelectedMember(interaction);
      if (!discordId) return interaction.editReply({ content: '❌ اختر عضو أولاً.' });
      const { createGracePeriod } = await import('./interactionSystem.js');
      await createGracePeriod(discordId, 'admin_panel', interaction.guild, interaction.client, { by: interaction.user.id });
      return interaction.editReply({ content: `✅ تم منح <@${discordId}> فترة سماح 24 ساعة.` });
    }
    if (customId === 'int_member_addpoints') {
      const discordId = getSelectedMember(interaction);
      if (!discordId) return interaction.reply({ content: '❌ اختر عضو أولاً.', flags: MessageFlags.Ephemeral });
      const modal = new ModalBuilder()
        .setCustomId('int_member_addpoints_modal')
        .setTitle('➕ إضافة نقاط')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('amount')
              .setLabel('عدد النقاط')
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('السبب')
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );
      return interaction.showModal(modal);
    }
    if (customId === 'int_member_progress') {
      await interaction.deferReply({ ephemeral: true });
      const discordId = getSelectedMember(interaction);
      if (!discordId) return interaction.editReply({ content: '❌ اختر عضو أولاً.' });
      const { calculateRankProgress } = await import('./interactionSystem.js');
      const { info: embedInfo } = await import('./embedStyles.js');
      const rp = await calculateRankProgress(discordId);
      if (!rp) return interaction.editReply({ content: '❌ هذا العضو غير مسجل.' });
      const lines = [
        `🎖️ الرتبة: **${rp.currentRank}**`,
        rp.nextRank ? `🎯 القادمة: **${rp.nextRank}**` : '🚀 وصل لأعلى رتبة!',
        rp.nextRank ? `🏆 باقيلك **${rp.pointsNeeded}** نقطة من **${rp.requiredPoints}**` : '',
        rp.nextRank ? `📅 باقيلك **${rp.estimatedDaysForDays}** يوم من **${rp.requiredDays}**` : '',
        rp.streakCount > 0 ? `🔥 Streak: **${rp.streakCount}** يوم` : '',
      ].filter(Boolean).join('\n');
      return interaction.editReply({ embeds: [embedInfo('📈 تقدم الترقية', lines)] });
    }
    if (customId === 'int_member_reclassify') {
      await interaction.deferReply({ ephemeral: true });
      const discordId = getSelectedMember(interaction);
      if (!discordId) return interaction.editReply({ content: '❌ اختر عضو أولاً.' });
      const { quickClassify, updateRoomEmoji } = await import('./interactionSystem.js');
      const result = await quickClassify(discordId);
      if (result.member?.roomChannelId) {
        await updateRoomEmoji(interaction.guild, discordId, result.emoji).catch(() => {});
      }
      const statusLabels = { active_high: '🟢 متفاعل', inactive: '🟡 خامل', violator: '🔴 مخالف', protected: '⚫ محمي', grace: '🆕 سماح' };
      return interaction.editReply({ content: `🔄 تم إعادة تصنيف <@${discordId}>: ${statusLabels[result.status] || result.status}` });
    }

    if (customId === 'int_delete_panel') {
      const pMsg = await PersistentMessage.findOne({ key: PANEL_KEY, guildId: interaction.guild.id }).catch(() => null);
      if (pMsg) {
        const channel = await interaction.guild.channels.fetch(pMsg.channelId).catch(() => null);
        if (channel) await channel.messages.delete(pMsg.messageId).catch(() => {});
        await PersistentMessage.deleteOne({ key: PANEL_KEY, guildId: interaction.guild.id }).catch(() => {});
      }
      return interaction.reply({ content: '🗑️ تم حذف اللوحة.', flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    logSentError('InteractionDashboard button', err);
  }
}

export async function handleInteractionDashboardSelect(interaction) {
  const config = loadConfig();
  if (!hasPanelAccess(interaction.member, config)) {
    return interaction.reply({ content: '❌ لا تملك صلاحية تعديل لوحة التفاعل.', flags: MessageFlags.Ephemeral });
  }
  const customId = interaction.customId;
  try {
    if (customId === 'int_nav') {
      const target = interaction.values?.[0];
      if (target === 'home') return showPage(interaction, { page: 'home' });
      return showPage(interaction, currentView(target));
    }
    if (customId.startsWith('int_edits_')) {
      const sectionId = customId.replace('int_edits_', '');
      const slug = interaction.values?.[0];
      const field = FIELD_BY_SLUG.get(slug);
      if (!field) return;
      if (field.type === 'flag') {
        const current = getByPath(loadConfig(), field.path);
        await saveFieldValue(slug, !current);
        await logIntChange(interaction.guild, field, interaction.user.id).catch(() => {});
        return showPage(interaction, currentView(sectionId));
      }
      return showPage(interaction, { page: 'edit', sectionId, edit: slug });
    }
    if (customId === 'int_member_select') {
      const discordId = interaction.values?.[0];
      if (!discordId) return;
      selectedMemberIds.set(getPanelKey(interaction), discordId);
      return showPage(interaction, { page: 'section', sectionId: 'members', pageIndex: 0 });
    }
    if (customId.startsWith('int_editch_')) {
      const rest = customId.replace('int_editch_', '');
      const idx = rest.indexOf('_');
      const sectionId = rest.slice(0, idx);
      const slug = rest.slice(idx + 1);
      const field = FIELD_BY_SLUG.get(slug);
      const values = interaction.values || [];
      const value = field?.type === 'channels' ? values : (values[0] || '');
      await saveFieldValue(slug, value);
      await logIntChange(interaction.guild, field, interaction.user.id).catch(() => {});
      return showPage(interaction, currentView(sectionId));
    }
  } catch (err) {
    logSentError('InteractionDashboard select', err);
  }
}

export async function handleInteractionDashboardModal(interaction) {
  const customId = interaction.customId;
  if (customId === 'int_member_addpoints_modal') {
    const config = loadConfig();
    if (!hasPanelAccess(interaction.member, config)) {
      return interaction.reply({ content: '❌ لا تملك صلاحية تعديل لوحة التفاعل.', flags: MessageFlags.Ephemeral });
    }
    try {
      await interaction.deferReply({ ephemeral: true });
      const discordId = getSelectedMember(interaction);
      if (!discordId) return interaction.editReply({ content: '❌ اختر عضو أولاً.' });
      const amount = parseInt(interaction.fields.getTextInputValue('amount'), 10);
      if (isNaN(amount) || amount <= 0) return interaction.editReply({ content: '❌ أدخل رقم صحيح.' });
      const reason = interaction.fields.getTextInputValue('reason') || 'إضافة يدوية من لوحة التفاعل';
      const pointsManager = (await import('./pointsManager.js')).default;
      const result = await pointsManager.updateUserPoints(discordId, amount, reason);
      if (result?.success) return interaction.editReply({ content: `✅ تمت إضافة **${amount}** نقطة لـ <@${discordId}>.\nالسبب: ${reason}` });
      return interaction.editReply({ content: '❌ العضو غير مسجل في نظام النقاط.' });
    } catch (err) {
      logSentError('InteractionDashboard addpoints modal', err);
      return interaction.editReply({ content: `❌ حدث خطأ: ${err.message}` }).catch(() => {});
    }
  }
  if (!customId.startsWith('int_modal_')) return;
  const config = loadConfig();
  if (!hasPanelAccess(interaction.member, config)) {
    return interaction.reply({ content: '❌ لا تملك صلاحية تعديل لوحة التفاعل.', flags: MessageFlags.Ephemeral });
  }
  try {
    const rest = customId.replace('int_modal_', '');
    const idx = rest.indexOf('_');
    const sectionId = rest.slice(0, idx);
    const slug = rest.slice(idx + 1);
    const field = FIELD_BY_SLUG.get(slug);
    if (!field) return;
    const value = interaction.fields.getTextInputValue('int_mi');
    await saveFieldValue(slug, value);
    await logIntChange(interaction.guild, field, interaction.user.id).catch(() => {});
    return showPage(interaction, currentView(sectionId));
  } catch (err) {
    logSentError('InteractionDashboard modal', err);
  }
}