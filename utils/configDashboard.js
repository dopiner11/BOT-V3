import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType, MessageFlags, PermissionsBitField,
} from 'discord.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, clearConfigCache } from './configLoader.js';
import PersistentMessage from '../models/PersistentMessage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, '../config.json');

const PANEL_KEY = 'configDashboard';
const PAGE_SIZE = 12;

const PANEL_CHANNEL_TYPES = [
  ChannelType.GuildText, ChannelType.GuildAnnouncement,
  ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildCategory,
];

function F(slug, label, path, type) {
  return { slug, label, path, type };
}

const SECTIONS = [
  {
    id: 'bot', emoji: '🤖', label: 'البوت العام', desc: 'إعدادات حالة البوت والرومات والقنوات العامة والنسخ الاحتياطي للملفات.',
    fields: [
      F('cd_act_type', '📺 نوع الحالة (PLAYING/STREAMING/WATCHING/LISTENING)', 'general.activity.type', 'text'),
      F('cd_act_name', '✏️ نص الحالة', 'general.activity.name', 'text'),
      F('cd_act_url', '🔗 رابط الحالة (بث فقط)', 'general.activity.url', 'text'),
      F('cd_voice', '🎙️ الروم الصوتي للبوت', 'general.voiceChannelId.id', 'channel'),
      F('cd_player', '▶️ روم المشغل', 'general.playerChannelId', 'channel'),
      F('cd_status_ch', '🩺 قناة حالة البوت', 'general.statusChannel.channelId.id', 'channel'),
      F('cd_status_msg', '💬 نص رسالة الحالة', 'general.statusChannel.message', 'text'),
      F('cd_rules_inactive', '🛋️ أيام السماح للخمول', 'general.rules.inactiveDays', 'number'),
      F('cd_tr_save', '💾 حفظ نسخ التذاكر بقاعدة البيانات', 'general.transcript.saveToDatabase', 'flag'),
      F('cd_tr_html', '📄 توليد نسخ HTML', 'general.transcript.generateHTML', 'flag'),
      F('cd_tr_txt', '📝 توليد نسخ TXT', 'general.transcript.generateTXT', 'flag'),
      F('cd_tr_del', '🗑️ حذف النسخ تلقائياً بعد أيام', 'general.transcript.autoDeleteAfterDays', 'number'),
    ],
  },
  {
    id: 'channels', emoji: '📡', label: 'قنوات عامة', desc: 'قنوات الإعلانات والقوانين والسجلات والكاتيجوريهات.',
    fields: [
      F('cd_ann', '📣 قناة الإعلانات', 'general.channels.announcements.id', 'channel'),
      F('cd_rules', '📜 قناة القوانين', 'general.channels.rulesChannel.id', 'channel'),
      F('cd_log', '🪵 قناة السجلات العامة', 'general.channels.logChannel.id', 'channel'),
      F('cd_cat_tickets', '🎫 كاتيجوري التذاكر', 'general.categories.tickets.id', 'channel'),
      F('cd_cat_rooms', '🏠 كاتيجوري غرف الأعضاء', 'general.categories.memberRooms.id', 'channel'),
    ],
  },
  {
    id: 'logs', emoji: '🧾', label: 'قنوات السجلات', desc: 'السجل المخصص لكل حدث (نقاط، فصل، ترقية، إنذار، مزاد...).',
    fields: [
      F('cd_lg_points', '💰 سجل النقاط', 'logChannels.points.id', 'channel'),
      F('cd_lg_fire', '🔥 سجل الفصل', 'logChannels.fire.id', 'channel'),
      F('cd_lg_hiring', '🤝 سجل التعيين', 'logChannels.hiring.id', 'channel'),
      F('cd_lg_blacklist', '⛔ سجل البلاك ليست', 'logChannels.blacklist.id', 'channel'),
      F('cd_lg_vacation', '🏖️ سجل الإجازات', 'logChannels.vacation.id', 'channel'),
      F('cd_lg_promotion', '🏆 سجل الترقيات', 'logChannels.promotion.id', 'channel'),
      F('cd_lg_warning', '⚠️ سجل التحذيرات', 'logChannels.warning.id', 'channel'),
      F('cd_lg_auction', '💎 سجل المزادات', 'logChannels.auction.id', 'channel'),
      F('cd_lg_challenges', '🎯 سجل التحديات', 'logChannels.challenges.id', 'channel'),
      F('cd_lg_scenarios', '🎭 سجل السيناريوهات', 'logChannels.scenarios.id', 'channel'),
      F('cd_lg_competitions', '🏅 سجل المسابقات', 'logChannels.competitions.id', 'channel'),
      F('cd_lg_calibration', '📊 سجل المعايرة', 'logChannels.calibration.id', 'channel'),
    ],
  },
  {
    id: 'roles', emoji: '🎖️', label: 'الرتب الأساسية', desc: 'رتب السيرفر الأساسية ورتب الوظائف.',
    fields: [
      F('cd_rl_basic', '👤 رتبة العضو الأساسية', 'roles.basic.id', 'role'),
      F('cd_rl_admin', '👑 رتبة الإدارة العليا', 'roles.admin.id', 'role'),
      F('cd_rl_gm', '🌟 رتبة المدير العام', 'roles.generalManager.id', 'role'),
      F('cd_rl_bl', '⛔ رتبة البلاك ليست', 'roles.blacklist.id', 'role'),
      F('cd_rl_vac', '🏖️ رتبة الإجازة', 'roles.vacation.id', 'role'),
      F('cd_rl_auction', '🚫 رتبة منع المزاد', 'roles.auctionBlacklist.id', 'role'),
      F('cd_rl_job1', '🟡 رتبة الوظيفة 1', 'roles.jobRoles.1.id', 'role'),
      F('cd_rl_job2', '🟠 رتبة الوظيفة 2', 'roles.jobRoles.2.id', 'role'),
      F('cd_rl_job3', '🔶 رتبة الوظيفة 3', 'roles.jobRoles.3.id', 'role'),
      F('cd_rl_job4', '🔴 رتبة الوظيفة 4', 'roles.jobRoles.4.id', 'role'),
      F('cd_rl_job5', '🟣 رتبة الوظيفة 5', 'roles.jobRoles.5.id', 'role'),
      F('cd_rl_job6', '⚫ رتبة الوظيفة 6', 'roles.jobRoles.6.id', 'role'),
    ],
  },
  {
    id: 'committees', emoji: '👥', label: 'اللجان', desc: 'المؤسسون والمصرح لهم وقنوات اللجان.',
    fields: [
      F('cd_cm_founders', '👑 المؤسسون (يختارون من القائمة)', 'committees.founders', 'users'),
      F('cd_cm_auth', '🔑 المصرح لهم', 'committees.authorizedUsers', 'users'),
      F('cd_cm_panel', '🖥️ قناة لوحات اللجان', 'committees.panelChannelId.id', 'channel'),
      F('cd_cm_audit', '🗒️ قناة سجل تغييرات اللجان', 'committees.auditLogChannelId.id', 'channel'),
    ],
  },
  {
    id: 'application', emoji: '🌹', label: 'نموذج التقديم', desc: 'عنوان ووصف نموذج التقديم والتأمين وقنواته.',
    fields: [
      F('cd_ap_title', '✏️ عنوان النموذج', 'application.title', 'text'),
      F('cd_ap_desc', '📄 وصف النموذج', 'application.description', 'text'),
      F('cd_ap_deposit', '💰 مبلغ التأمين', 'application.depositAmount', 'number'),
      F('cd_ap_minlvl', '🎮 أقل لفل مطلوب', 'application.minimumLevel', 'number'),
      F('cd_ap_ch_app', '📥 قناة طلبات التقديم', 'application.channels.applications.id', 'channel'),
      F('cd_ap_ch_admin', '🗣️ قناة مناقشة الطلبات', 'application.channels.adminApplications.id', 'channel'),
    ],
  },
  {
    id: 'blackmarket', emoji: '🩸', label: 'البلاك ماركت', desc: 'نموذج الباعة وقنوات البيع والطلبات والسجلات.',
    fields: [
      F('cd_bm_title', '✏️ عنوان نموذج البائع', 'blackMarket.application.title', 'text'),
      F('cd_bm_desc', '📄 وصف نموذج البائع', 'blackMarket.application.description', 'text'),
      F('cd_bm_legal', '🏛️ قناة البيع القانوني', 'blackMarket.channels.legal.id', 'channel'),
      F('cd_bm_illegal', '🕶️ قناة البيع غير القانوني', 'blackMarket.channels.illegal.id', 'channel'),
      F('cd_bm_requests', '📥 قناة الطلبات', 'blackMarket.channels.requests.id', 'channel'),
      F('cd_bm_approvals', '✅ قناة الموافقات', 'blackMarket.channels.approvals.id', 'channel'),
      F('cd_bm_logs', '🧾 سجل البلاك ماركت', 'blackMarket.channels.logs.id', 'channel'),
      F('cd_bm_ratings', '⭐ قناة التقييمات', 'blackMarket.channels.ratings.id', 'channel'),
    ],
  },
  {
    id: 'tickets', emoji: '🎫', label: 'نظام التذاكر', desc: 'لوحة التذاكر وعنوانها ووصفها وقناة نسخها.',
    fields: [
      F('cd_tk_ch', '🖥️ قناة لوحة التذاكر', 'ticketSystem.panelChannelId.id', 'channel'),
      F('cd_tk_title', '✏️ عنوان اللوحة', 'ticketSystem.panelTitle', 'text'),
      F('cd_tk_desc', '📄 وصف اللوحة', 'ticketSystem.panelDescription', 'text'),
      F('cd_tk_trans', '🗃️ قناة نسخ التذاكر', 'ticketSystem.channels.transcripts.id', 'channel'),
    ],
  },
  {
    id: 'auctions', emoji: '💰', label: 'المزادات', desc: 'كاتيجوري المزادات وأرشيفها ورتبة الإدارة.',
    fields: [
      F('cd_au_cat', '🏷️ كاتيجوري المزادات', 'auctions.categoryId', 'channel'),
      F('cd_au_archive', '📦 قناة أرشيف المزادات', 'auctions.archiveChannelId.id', 'channel'),
      F('cd_au_admin', '👑 رتبة إدارة المزادات', 'auctions.adminRoleId', 'role'),
      F('cd_au_name', '✏️ اسم تذكرة الفائز', 'auctions.ticketName', 'text'),
    ],
  },
  {
    id: 'warnings', emoji: '⚠️', label: 'نظام الإنذارات', desc: 'أقصى إنذارات وتكاليفها ورتبها وقنوات قراراتها.',
    fields: [
      F('cd_wn_max', '🔢 أقصى إنذارات قبل الفصل', 'warnings.maxWarnings', 'number'),
      F('cd_wn_cost1', '💸 تكلفة الإنذار الأول', 'warnings.costs.first', 'number'),
      F('cd_wn_cost2', '💸 تكلفة الإنذار الثاني', 'warnings.costs.second', 'number'),
      F('cd_wn_r1', '🟥 رتبة التحذير الأولى', 'warnings.roles.1.id', 'role'),
      F('cd_wn_r2', '🟧 رتبة التحذير الثانية', 'warnings.roles.2.id', 'role'),
      F('cd_wn_r3', '🟪 رتبة التحذير الثالثة', 'warnings.roles.3.id', 'role'),
      F('cd_wn_ch_dec', '📜 قناة قرارات التحذير', 'warnings.channels.warningDecision.id', 'channel'),
      F('cd_wn_ch_gif', '🎬 قناة GIF التحذير', 'warnings.channels.warningGif.id', 'channel'),
    ],
  },
  {
    id: 'scenarios', emoji: '🎭', label: 'السيناريوهات', desc: 'قنوات السيناريوهات ونوافذ التعديل والتصويت والنقاط.',
    fields: [
      F('cd_sc_ann', '📢 قناة إعلانات السيناريوهات', 'scenarios.announcementChannelId', 'channel'),
      F('cd_sc_excuse', '📝 كاتيجوري الأعذار', 'scenarios.excuseCategoryId', 'channel'),
      F('cd_sc_log', '🧾 سجل السيناريوهات', 'scenarios.logChannelId', 'channel'),
      F('cd_sc_archive', '📦 أرشيف السيناريوهات', 'scenarios.archiveChannelId', 'channel'),
      F('cd_sc_remind', '⏰ وقت التذكير (دقائق)', 'scenarios.reminderMinutes', 'number'),
      F('cd_sc_edit', '✏️ نافذة التعديل (دقائق)', 'scenarios.editWindowMinutes', 'number'),
      F('cd_sc_vote', '🗳️ مدة التصويت (دقائق)', 'scenarios.voteDurationMinutes', 'number'),
      F('cd_sc_pts', '⭐ نقاط الحضور', 'scenarios.points.attendance', 'number'),
    ],
  },
  {
    id: 'challenge', emoji: '🎯', label: 'التحديات اليومية', desc: 'تفعيل التحديات وأوقاتها وقناتها.',
    fields: [
      F('cd_ch_enabled', '🟢 تفعيل التحديات', 'dailyChallenge.enabled', 'flag'),
      F('cd_ch_assign', '📤 وقت الإرسال (HH:MM)', 'dailyChallenge.assignTime', 'text'),
      F('cd_ch_remind', '🔔 وقت التذكير (HH:MM)', 'dailyChallenge.reminderTime', 'text'),
      F('cd_ch_expire', '⌛ وقت الانتهاء (HH:MM)', 'dailyChallenge.expireTime', 'text'),
      F('cd_ch_log', '🧾 سجل التحديات', 'dailyChallenge.logChannelId', 'channel'),
    ],
  },
  {
    id: 'welcome', emoji: '👋', label: 'دليل الترحيب', desc: 'إعدادات دليل الترحيب التفاعلي للأعضاء الجدد.',
    fields: [
      F('cd_wl_auto', '📨 إرسال تلقائي للجدد', 'welcomeGuide.autoSend', 'flag'),
      F('cd_wl_color', '🎨 لون الدليل (Hex)', 'welcomeGuide.color', 'text'),
      F('cd_wl_deploy', '🚀 تفعيل الدليل', 'welcomeGuide.deployed', 'flag'),
    ],
  },
  {
    id: 'competitions', emoji: '🏆', label: 'المسابقات', desc: 'قنوات المسابقات ورتب إدارتها.',
    fields: [
      F('cd_cp_ann', '📢 قناة إعلانات المسابقات', 'competitions.announcementChannelId', 'channel'),
      F('cd_cp_update', '🔄 قناة التحديثات', 'competitions.updateChannelId', 'channel'),
      F('cd_cp_ch', '🏟️ قناة المسابقة', 'competitions.competitionChannelId', 'channel'),
      F('cd_cp_log', '🧾 سجل المسابقات', 'competitions.logChannelId', 'channel'),
      F('cd_cp_pres', '👑 رتبة رئاسة المسابقات', 'competitions.presidencyRoleId', 'role'),
      F('cd_cp_comm', '🛡️ رتبة لجنة المسابقات', 'competitions.committeeRoleId', 'role'),
    ],
  },
  {
    id: 'broadcast', emoji: '📣', label: 'البرودكاست', desc: 'إعدادات إرسال الرسائل الجماعية.',
    fields: [
      F('cd_bc_enabled', '🟢 تفعيل البرودكاست', 'broadcast.enabled', 'flag'),
      F('cd_bc_delay', '⏳ التأخير بين الرسائل (مللي ثانية)', 'broadcast.dmDelay', 'number'),
      F('cd_bc_retries', '🔁 أقصى محاولات إعادة الإرسال', 'broadcast.maxRetries', 'number'),
      F('cd_bc_log', '🧾 سجل البرودكاست', 'broadcast.logChannelId', 'channel'),
    ],
  },
  {
    id: 'excuseRoles', emoji: '🛡️', label: 'رتب الأعذار', desc: 'الرتب التي تُمنح للعضو حسب نوع العذر.',
    fields: [
      F('cd_ex_lvl', '🔥 رتبة عذر زيادة لفل', 'general.excuseRoles.زيادة لفل.id', 'role'),
      F('cd_ex_name', '✏️ رتبة عذر تغيير اسم', 'general.excuseRoles.تغير اسم.id', 'role'),
    ],
  },
];

const FIELD_BY_SLUG = new Map();
for (const section of SECTIONS) {
  for (const field of section.fields) FIELD_BY_SLUG.set(field.slug, field);
}

function hasPanelAccess(member, config) {
  if (!member) return false;
  const userId = member.id;
  if ((config.committees?.founders || []).includes(userId)) return true;
  if ((config.committees?.authorizedUsers || []).includes(userId)) return true;
  if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
  return false;
}

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
  if (field.type === 'role') {
    if (!v) return '`—`';
    return `<@&${v}>`;
  }
  if (field.type === 'roles') {
    if (!Array.isArray(v) || v.length === 0) return '`—`';
    return v.map((id) => `<@&${id}>`).join(' ').slice(0, 1000) || '`—`';
  }
  if (field.type === 'users') {
    if (!Array.isArray(v) || v.length === 0) return '`—`';
    return v.map((id) => `<@${id}>`).join(' ').slice(0, 1000) || '`—`';
  }
  if (field.type === 'flag') {
    return v ? '✅ مفعل' : '❌ معطل';
  }
  if (v == null || v === '') return '`—`';
  return String(v).slice(0, 1000);
}

function paginate(list, size) {
  const pages = [];
  for (let i = 0; i < list.length; i += size) pages.push(list.slice(i, i + size));
  return pages.length ? pages : [[]];
}

function buildNavRow() {
  const options = [
    { label: '🏠 الرئيسية', value: 'home', description: 'نظرة عامة على إعدادات البوت' },
    ...SECTIONS.map((s) => ({
      label: `${s.emoji} ${s.label}`.slice(0, 100),
      value: s.id,
      description: s.desc.slice(0, 100),
    })),
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cfg_nav')
      .setPlaceholder('📂 اختر القسم')
      .setMaxValues(1)
      .addOptions(options),
  );
}

function sectionMeta(sectionId) {
  const s = SECTIONS.find((x) => x.id === sectionId);
  return s || { emoji: '🤖', label: 'إدارة البوت', desc: '' };
}

function buildHomeEmbed(config) {
  const v = (obj, fallback) => (obj && typeof obj === 'object' && 'value' in obj ? obj.value : (obj ?? fallback));
  const fields = [
    {
      name: '👑 اللجان',
      value: `المؤسسون: **${(config.committees?.founders || []).length}** · المصرح لهم: **${(config.committees?.authorizedUsers || []).length}**`,
      inline: false,
    },
    {
      name: '🎖️ الرتب',
      value: `الإدارة: <@&${config.roles?.admin?.id || '—'}> · العضو الأساسي: <@&${config.roles?.basic?.id || '—'}>`,
      inline: false,
    },
    {
      name: '📡 القنوات',
      value: `الإعلانات: ${config.general?.channels?.announcements?.id ? `<#${config.general.channels.announcements.id}>` : '`—`'} · السجلات: ${config.general?.channels?.logChannel?.id ? `<#${config.general.channels.logChannel.id}>` : '`—`'}`,
      inline: false,
    },
    {
      name: '🌹 التقديم',
      value: `التأمين: **${v(config.application?.depositAmount, '—')}** · أقل لفل: **${v(config.application?.minimumLevel, '—')}**`,
      inline: false,
    },
    {
      name: '⚠️ الإنذارات',
      value: `أقصى إنذارات: **${v(config.warnings?.maxWarnings, '—')}** · التكلفة: ${v(config.warnings?.costs?.first, '—')} / ${v(config.warnings?.costs?.second, '—')}`,
      inline: false,
    },
  ];
  return new EmbedBuilder()
    .setTitle('⚙️ لوحة إدارة البوت')
    .setDescription(
      'لوحة للتحكم في **إعدادات البوت الرئيسية** دون فتح الملفات.\n' +
      'اختر القسم من القائمة بالأسفل ثم عدّل أي حقل.'
    )
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
    .setFooter({ text: 'لوحة إدارة البوت' })
    .setTimestamp();
}

function fieldPickRow(fields, pageIndex, sectionId) {
  const page = paginate(fields, PAGE_SIZE)[pageIndex] || fields.slice(0, PAGE_SIZE);
  const options = page.map((f) => ({ label: f.label.slice(0, 100), value: f.slug }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`cfg_edits_${sectionId}`)
      .setPlaceholder(`✏️ تعديل حقل (${page.length})`)
      .setMaxValues(1)
      .addOptions(options),
  );
}

function editorRow(field, sectionId) {
  if (!field) return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg_home').setLabel('🏠 رجوع للرئيسية').setStyle(ButtonStyle.Secondary),
  );
  if (field.type === 'channel' || field.type === 'channels') {
    const multi = field.type === 'channels';
    const sel = new ChannelSelectMenuBuilder()
      .setCustomId(`cfg_editch_${sectionId}_${field.slug}`)
      .setPlaceholder(multi ? 'اختر الرومات (يمكن اختيار أكثر من واحد)' : 'اختر الروم')
      .setMaxValues(multi ? 25 : 1)
      .setChannelTypes(PANEL_CHANNEL_TYPES);
    return new ActionRowBuilder().addComponents(sel);
  }
  if (field.type === 'role' || field.type === 'roles') {
    const multi = field.type === 'roles';
    const sel = new RoleSelectMenuBuilder()
      .setCustomId(`cfg_editr_${sectionId}_${field.slug}`)
      .setPlaceholder(multi ? 'اختر الرتب (يمكن اختيار أكثر من واحد)' : 'اختر الرتبة')
      .setMaxValues(multi ? 25 : 1);
    return new ActionRowBuilder().addComponents(sel);
  }
  if (field.type === 'users') {
    const sel = new UserSelectMenuBuilder()
      .setCustomId(`cfg_editu_${sectionId}_${field.slug}`)
      .setPlaceholder('اختر الأعضاء')
      .setMaxValues(25);
    return new ActionRowBuilder().addComponents(sel);
  }
  if (field.type === 'flag') {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cfg_toggle_${sectionId}_${field.slug}`).setLabel('🔁 عكس القيمة').setStyle(ButtonStyle.Primary),
    );
  }
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cfg_modal_${sectionId}_${field.slug}`).setLabel('✏️ فتح النموذج').setStyle(ButtonStyle.Primary),
  );
}

async function buildPagePayload(config, view, interaction) {
  const { page, sectionId, edit, pageIndex = 0 } = view;
  const rows = [];

  if (page === 'home') {
    rows.push(buildNavRow());
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfg_refresh').setLabel('🔄 تحديث').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cfg_delete_panel').setLabel('🗑️ حذف اللوحة').setStyle(ButtonStyle.Danger),
    ));
    return { embed: buildHomeEmbed(config), rows };
  }

  const meta = sectionMeta(sectionId);
  const fieldsList = meta.fields || [];
  rows.push(buildNavRow());

  if (page === 'edit') {
    const field = FIELD_BY_SLUG.get(edit);
    rows.push(editorRow(field, sectionId));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cfg_cancel_${sectionId}`).setLabel('↩️ رجوع').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cfg_home').setLabel('🏠').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cfg_refresh').setLabel('🔄 تحديث').setStyle(ButtonStyle.Secondary),
    ));
    return { embed: buildEditEmbed(field, config), rows };
  }

  rows.push(fieldPickRow(fieldsList, pageIndex, sectionId));
  const pages = paginate(fieldsList, PAGE_SIZE);
  const navButtons = new ActionRowBuilder();
  if (pages.length > 1) {
    navButtons.addComponents(
      new ButtonBuilder().setCustomId(`cfg_prev_${sectionId}_${pageIndex}`).setLabel('◀ سابق').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex === 0),
      new ButtonBuilder().setCustomId(`cfg_next_${sectionId}_${pageIndex}`).setLabel('التالي ▶').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex >= pages.length - 1),
    );
  }
  navButtons.addComponents(
    new ButtonBuilder().setCustomId('cfg_home').setLabel('🏠').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cfg_refresh').setLabel('🔄 تحديث').setStyle(ButtonStyle.Secondary),
  );
  rows.push(navButtons);

  return { embed: buildSectionEmbed(config, sectionId, pageIndex), rows };
}

async function buildPayload(config, view, interaction) {
  try {
    const { embed, rows } = await buildPagePayload(config, view, interaction);
    return { embeds: [embed], components: rows };
  } catch (err) {
    console.error('ConfigDashboard buildPayload:', err);
    return { embeds: [new EmbedBuilder().setTitle('⚙️ لوحة إدارة البوت').setDescription('حدث خطأ أثناء بناء اللوحة.').setColor(0xE74C3C)], components: [] };
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
    logSentError('ConfigDashboard send', err);
  }
}

function currentView(sectionId) {
  return { page: 'section', sectionId, pageIndex: 0 };
}

async function saveFieldValue(slug, value) {
  const field = FIELD_BY_SLUG.get(slug);
  if (!field) return;
  let parsed = value;
  if (field.type === 'number') {
    const num = Number(String(value).replace(/[^\d.-]/g, ''));
    if (Number.isNaN(num)) return;
    parsed = num;
  } else if (field.type === 'flag') {
    parsed = value === true || value === 'true';
  } else if (field.type === 'channels' || field.type === 'roles' || field.type === 'users') {
    parsed = Array.isArray(value) ? value : (value ? String(value).split(/[\s,،]+/).filter(Boolean) : []);
  } else if (field.type === 'channel' || field.type === 'role' || field.type === 'text') {
    parsed = Array.isArray(value) ? (value[0] || '') : String(value ?? '');
  }
  const raw = readConfigRaw();
  setByPath(raw, field.path, parsed);
  writeConfigRaw(raw);
}

async function logCfgChange(guild, field, userId) {
  const config = loadConfig();
  const auditChannelId = config.committees?.auditLogChannelId?.id;
  if (!auditChannelId) return;
  const channel = await guild.channels.fetch(auditChannelId).catch(() => null);
  if (!channel) return;
  const { gold } = await import('./embedStyles.js');
  const section = SECTIONS.find((s) => s.fields.some((f) => f.slug === field.slug));
  await channel.send({
    embeds: [
      gold('⚙️ تغيير إعدادات البوت', `تم تغيير **${field.label}** (${section?.emoji || ''} ${section?.label || ''})\nبواسطة: <@${userId}>`),
    ],
  }).catch(() => {});
}

function fieldModal(field, config, sectionId) {
  const value = getByPath(config, field.path);
  let current = '';
  if (value != null) current = String(value);
  const input = new TextInputBuilder()
    .setCustomId('cfg_mi')
    .setLabel(field.label.slice(0, 45))
    .setStyle(field.type === 'text' && (current.length > 60 || (value && String(value).includes('\n'))) ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(false)
    .setValue(current.slice(0, 4000));
  return new ModalBuilder()
    .setCustomId(`cfg_modal_${sectionId}_${field.slug}`)
    .setTitle(field.label.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export async function openConfigDashboard(interaction) {
  const config = loadConfig();
  if (!interaction.member || !interaction.guild) {
    return interaction.reply({ content: '❌ اللوحة تعمل داخل السيرفر فقط.', flags: MessageFlags.Ephemeral });
  }
  if (!hasPanelAccess(interaction.member, config)) {
    return interaction.reply({ content: '❌ فقط المؤسسون والمصرح لهم يملكون صلاحية هذه اللوحة.', flags: MessageFlags.Ephemeral });
  }
  const payload = await buildPayload(config, { page: 'home' }, interaction);
  try {
    await interaction.reply(payload);
  } catch (err) {
    logSentError('openConfigDashboard', err);
    try {
      await interaction.followUp({ content: `❌ حدث خطأ أثناء إرسال اللوحة: ${err.message}`, flags: MessageFlags.Ephemeral });
    } catch {}
  }
}

export async function handleConfigDashboardButton(interaction) {
  const config = loadConfig();
  if (!hasPanelAccess(interaction.member, config)) {
    return interaction.reply({ content: '❌ لا تملك صلاحية تعديل إعدادات البوت.', flags: MessageFlags.Ephemeral });
  }
  const customId = interaction.customId;
  try {
    if (customId === 'cfg_refresh') {
      const payload = await buildPayload(loadConfig(), { page: 'home' }, interaction);
      return interaction.update(payload).catch(() => {});
    }
    if (customId === 'cfg_home') return showPage(interaction, { page: 'home' });
    if (customId.startsWith('cfg_cancel_')) {
      const sectionId = customId.replace('cfg_cancel_', '');
      return showPage(interaction, currentView(sectionId));
    }
    if (customId.startsWith('cfg_prev_') || customId.startsWith('cfg_next_')) {
      const rest = customId.replace(/^cfg_(prev|next)_/, '');
      const idx = rest.lastIndexOf('_');
      const sectionId = rest.slice(0, idx);
      const pageIndex = Number(rest.slice(idx + 1) || 0);
      const delta = customId.startsWith('cfg_prev_') ? -1 : 1;
      if (!sectionId) return;
      return showPage(interaction, { page: 'section', sectionId, pageIndex: Math.max(0, pageIndex + delta) });
    }
    if (customId.startsWith('cfg_toggle_')) {
      const rest = customId.replace('cfg_toggle_', '');
      const idx = rest.indexOf('_');
      const sectionId = rest.slice(0, idx);
      const slug = rest.slice(idx + 1);
      const field = FIELD_BY_SLUG.get(slug);
      if (!field) return;
      const current = getByPath(loadConfig(), field.path);
      await saveFieldValue(slug, !current);
      await logCfgChange(interaction.guild, field, interaction.user.id).catch(() => {});
      return showPage(interaction, currentView(sectionId));
    }
    if (customId.startsWith('cfg_modal_')) {
      const rest = customId.replace('cfg_modal_', '');
      const idx = rest.indexOf('_');
      const sectionId = rest.slice(0, idx);
      const slug = rest.slice(idx + 1);
      const field = FIELD_BY_SLUG.get(slug);
      if (!field) return;
      return interaction.showModal(fieldModal(field, loadConfig(), sectionId));
    }
    if (customId === 'cfg_delete_panel') {
      const pMsg = await PersistentMessage.findOne({ key: PANEL_KEY, guildId: interaction.guild.id }).catch(() => null);
      if (pMsg) {
        const channel = await interaction.guild.channels.fetch(pMsg.channelId).catch(() => null);
        if (channel) await channel.messages.delete(pMsg.messageId).catch(() => {});
        await PersistentMessage.deleteOne({ key: PANEL_KEY, guildId: interaction.guild.id }).catch(() => {});
      }
      return interaction.reply({ content: '🗑️ تم حذف اللوحة.', flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    logSentError('ConfigDashboard button', err);
  }
}

export async function handleConfigDashboardSelect(interaction) {
  const config = loadConfig();
  if (!hasPanelAccess(interaction.member, config)) {
    return interaction.reply({ content: '❌ لا تملك صلاحية تعديل إعدادات البوت.', flags: MessageFlags.Ephemeral });
  }
  const customId = interaction.customId;
  try {
    if (customId === 'cfg_nav') {
      const target = interaction.values?.[0];
      if (target === 'home') return showPage(interaction, { page: 'home' });
      return showPage(interaction, currentView(target));
    }
    if (customId.startsWith('cfg_edits_')) {
      const sectionId = customId.replace('cfg_edits_', '');
      const slug = interaction.values?.[0];
      const field = FIELD_BY_SLUG.get(slug);
      if (!field) return;
      if (field.type === 'flag') {
        const current = getByPath(loadConfig(), field.path);
        await saveFieldValue(slug, !current);
        await logCfgChange(interaction.guild, field, interaction.user.id).catch(() => {});
        return showPage(interaction, currentView(sectionId));
      }
      return showPage(interaction, { page: 'edit', sectionId, edit: slug });
    }
    if (customId.startsWith('cfg_editch_') || customId.startsWith('cfg_editr_') || customId.startsWith('cfg_editu_')) {
      const prefix = customId.startsWith('cfg_editch_') ? 'cfg_editch_' : customId.startsWith('cfg_editr_') ? 'cfg_editr_' : 'cfg_editu_';
      const rest = customId.replace(prefix, '');
      const idx = rest.indexOf('_');
      const sectionId = rest.slice(0, idx);
      const slug = rest.slice(idx + 1);
      const field = FIELD_BY_SLUG.get(slug);
      const values = interaction.values || [];
      const value = field?.type === 'channels' || field?.type === 'roles' || field?.type === 'users' ? values : (values[0] || '');
      await saveFieldValue(slug, value);
      await logCfgChange(interaction.guild, field, interaction.user.id).catch(() => {});
      return showPage(interaction, currentView(sectionId));
    }
  } catch (err) {
    logSentError('ConfigDashboard select', err);
  }
}

export async function handleConfigDashboardModal(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith('cfg_modal_')) return;
  const config = loadConfig();
  if (!hasPanelAccess(interaction.member, config)) {
    return interaction.reply({ content: '❌ لا تملك صلاحية تعديل إعدادات البوت.', flags: MessageFlags.Ephemeral });
  }
  try {
    const rest = customId.replace('cfg_modal_', '');
    const idx = rest.indexOf('_');
    const sectionId = rest.slice(0, idx);
    const slug = rest.slice(idx + 1);
    const field = FIELD_BY_SLUG.get(slug);
    if (!field) return;
    const value = interaction.fields.getTextInputValue('cfg_mi');
    await saveFieldValue(slug, value);
    await logCfgChange(interaction.guild, field, interaction.user.id).catch(() => {});
    return showPage(interaction, currentView(sectionId));
  } catch (err) {
    logSentError('ConfigDashboard modal', err);
  }
}