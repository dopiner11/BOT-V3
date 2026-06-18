import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { committees as permCommittees } from './committeePermissions.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, neutral as embedNeutral } from './embedStyles.js';
import { dmUser, sendToChannel } from './notificationSystem.js';
import { logWarning, logFire, logBlacklist, logBlacklistRemove, logPoints } from './logSystem.js';
import { getInteractionConfig } from './interactionMonitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, '../config.json');
const COMMITTEES_DATA_PATH = join(__dirname, '../.data/Committees.json');
const MODAL_PREFIX = 'cmd_modal_';

const COMMITTEE_EMOJIS = {
  punishment: '🛡️',
  interaction: '📋',
  promotion: '🎖️',
  family_presidency: '👑',
  blackMarket: '🏴‍☠️',
};

const COMMITTEE_NAMES = {
  punishment: 'لجنة العقوبات',
  interaction: 'لجنة التفاعل',
  promotion: 'لجنة الترقيات',
  family_presidency: 'رئاسة العائلة',
  blackMarket: 'لجنة البلاك ماركت',
};

function loadConfig() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    // دمج بيانات .data/Committees.json مثل committeeHandler
    if (existsSync(COMMITTEES_DATA_PATH)) {
      const committeeList = JSON.parse(readFileSync(COMMITTEES_DATA_PATH, 'utf8'));
      if (committeeList && Object.keys(committeeList).length > 0) {
        config.committees = config.committees || {};
        const merged = {};
        for (const key of Object.keys(config.committees.list || {})) {
          merged[key] = { ...config.committees.list[key] };
        }
        for (const [key, data] of Object.entries(committeeList)) {
          if (merged[key]) { Object.assign(merged[key], data); }
          else { merged[key] = data; }
        }
        config.committees.list = merged;
      }
    }
    return config;
  } catch { return { committees: { list: {} } }; }
}

function resolveUserId(input) {
  if (!input) return null;
  const cleaned = input.replace(/[<@!>]/g, '').trim();
  return /^\d{17,20}$/.test(cleaned) ? cleaned : null;
}

const COMMANDS_MAP = {
  interaction: [
    { action: 'زيادة_نقاط', module: 'addPoints.js', label: 'زيادة نقاط', emoji: '➕', elevated: false,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'النقاط', label: 'عدد النقاط', type: 'integer', placeholder: 'مثال: 5', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب الزيادة', required: true, style: 'short' },
      ] },
    { action: 'اجازة', module: 'Vacation.js', label: 'إجازة', emoji: '🏖️', elevated: false,
      params: [
        { name: 'الشخص', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'الايام', label: 'عدد الأيام', type: 'integer', placeholder: 'مثال: 7', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب الإجازة', required: true, style: 'short' },
      ] },
    { action: 'كسر-اجازة', module: 'BreakVacation.js', label: 'كسر إجازة', emoji: '🔓', elevated: false,
      params: [
        { name: 'الشخص', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب كسر الإجازة', required: true, style: 'short' },
      ] },
    { action: 'كسر_عذر', module: 'breakExcuse.js', label: 'كسر عذر', emoji: '📄', elevated: false,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب إلغاء العذر', required: true, style: 'short' },
      ] },
    { action: 'اعذار', module: 'Excuse.js', label: 'أعذار', emoji: '📝', elevated: false,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'النوع', label: 'نوع العذر', type: 'string', placeholder: 'زيادة لفل / تغير اسم / منع اجرام / اسباب اخرى', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب العذر', required: true, style: 'short' },
        { name: 'المدة', label: 'المدة (أيام)', type: 'integer', placeholder: 'مثال: 7', required: true },
      ] },
    { action: 'تنويه', module: 'announcement.js', label: 'تنويه', emoji: '📢', elevated: false,
      params: [
        { name: 'العنوان', label: 'العنوان', type: 'string', placeholder: 'عنوان التنويه', required: true },
        { name: 'النص', label: 'النص', type: 'string', placeholder: 'نص التنويه', required: true, style: 'long' },
        { name: 'الصورة', label: 'رابط الصورة (اختياري)', type: 'string', placeholder: 'https://...', required: false },
      ] },
    { action: 'نظام-التقارير', module: 'reportSystem.js', label: 'نظام التقارير', emoji: '📋', elevated: false, noParams: true },
    { action: 'تقارير', module: 'reports.js', label: 'تحديث التقارير', emoji: '📊', elevated: false, noParams: true },
    { action: 'التقديم', module: 'application.js', label: 'تقديم', emoji: '📨', elevated: false, noParams: true },
    { action: 'حضور', module: 'attendance.js', label: 'حضور', emoji: '🎮', elevated: false, noParams: true },
    { action: 'مراجعة_التفاعل', module: null, label: 'مراجعة التفاعل', emoji: '🔍', elevated: false, noParams: true, internal: true },
  ],

  punishment: [
    { action: 'بلاك_ليست', module: 'blacklist.js', label: 'بلاك ليست', emoji: '🚫', elevated: true, complex: true,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب الإضافة', required: true, style: 'short' },
        { name: 'المدة', label: 'المدة (أيام)', type: 'integer', placeholder: '0 = دائم', required: true },
        { name: 'التصنيف', label: 'التصنيف (اختياري)', type: 'string', placeholder: 'مخالفة قوانين / احتيال / سلوك غير لائق', required: false },
      ] },
    { action: 'ازالة_بلاك_ليست', module: 'removeBlacklist.js', label: 'إزالة بلاك', emoji: '✅', elevated: true,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب الإزالة', required: true, style: 'short' },
      ] },
    { action: 'تحذير', module: 'Warning.js', label: 'تحذير', emoji: '⚠️', elevated: true, complex: true,
      params: [
        { name: 'الشخص', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'النوع', label: 'النوع', type: 'string', placeholder: 'شفوي / عدم تفاعل / سلوك', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب التحذير', required: true, style: 'short' },
      ] },
    { action: 'ازالة-تحذير', module: 'warning_removed.js', label: 'إزالة تحذير', emoji: '✅', elevated: false, complex: true,
      params: [
        { name: 'الشخص', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب الإزالة', required: true, style: 'short' },
      ] },
    { action: 'فصل', module: 'fire.js', label: 'فصل', emoji: '⛔', elevated: true, complex: true,
      params: [
        { name: 'المعرفات', label: 'المعرفات', type: 'string', placeholder: 'ID العضو أو منشن (افصل بين كل عضو بسطر)', required: true, style: 'long' },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب الفصل', required: true, style: 'short' },
      ] },
    { action: 'تصفير_نقاط', module: 'Zero.js', label: 'تصفير نقاط', emoji: '🔢', elevated: true,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
      ] },
    { action: 'تصفير_النقاط_للجميع', module: 'Zeros.js', label: 'تصفير الكل', emoji: '📉', elevated: true, noParams: true },
    { action: 'تنقيص_نقاط', module: 'removePoints.js', label: 'تنقيص نقاط', emoji: '➖', elevated: true,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'النقاط', label: 'عدد النقاط', type: 'integer', placeholder: 'مثال: 3', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب التنقيص', required: true, style: 'short' },
      ] },
    { action: 'توظيف_يدوي', module: 'manualHire.js', label: 'توظيف يدوي', emoji: '👤', elevated: true,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'الاسم', label: 'الاسم بالشخصية', type: 'string', placeholder: 'مثال: Xx_Player_xX', required: true },
        { name: 'الايدي', label: 'ID اللعبة', type: 'string', placeholder: 'مثال: 123456789', required: true },
        { name: 'الفل', label: 'الليفل', type: 'integer', placeholder: 'مثال: 30', required: true },
        { name: 'الرقم_الوظيفي', label: 'الرقم الوظيفي', type: 'integer', placeholder: '1-20', required: true },
      ] },
    { action: 'بلاكليست_تذاكر', module: 'ticket_blacklist.js', label: 'بلاك تذاكر', emoji: '🔒', elevated: false,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
      ] },
    { action: 'ازالة_بلاكليست_تذاكر', module: 'remove_ticket_blacklist.js', label: 'إزالة بلاك تذاكر', emoji: '🔓', elevated: false,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
      ] },
    { action: 'انشاء_مزاد', module: 'auction_create.js', label: 'إنشاء مزاد', emoji: '🏛️', elevated: true,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'السبب', label: 'الوصف', type: 'string', placeholder: 'وصف المزاد', required: true, style: 'short' },
        { name: 'المدة', label: 'المدة (بالساعات)', type: 'integer', placeholder: 'مثال: 24', required: true },
      ] },
    { action: 'بلاكليست_مزاد', module: 'auction_blacklist.js', label: 'بلاك مزاد', emoji: '🚫', elevated: false,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب المنع', required: true, style: 'short' },
      ] },
    { action: 'ازالة_بلاكليست_مزاد', module: 'remove_auction_blacklist.js', label: 'إزالة بلاك مزاد', emoji: '✅', elevated: false,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب الإزالة', required: true, style: 'short' },
      ] },
    { action: 'مسابقة', module: 'competition.js', label: 'مسابقات', emoji: '🏆', elevated: false, params: [] },
  ],

  promotion: [
    { action: 'ترقية-استثنائية', module: 'easyprom.js', label: 'ترقية استثنائية', emoji: '⭐', elevated: true,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'الرتبة', label: 'رقم الرتبة', type: 'integer', placeholder: 'مثال: 3', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب الترقية', required: true, style: 'short' },
      ] },
    { action: 'ترقيات', module: 'promotion.js', label: 'ترقيات', emoji: '📈', elevated: false,
      params: [
        { name: 'عضو', label: 'العضو (اختياري)', type: 'user', placeholder: 'ID العضو أو منشن - اترك فارغاً لفحص الكل', required: false },
      ] },
    { action: 'ترشيح', module: 'nomination.js', label: 'ترشيح', emoji: '🗳️', elevated: false,
      params: [
        { name: 'عضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
      ] },
  ],

  family_presidency: [
    { action: 'لوحة_اللجان', module: 'committee_panel.js', label: 'لوحة اللجان', emoji: '📋', elevated: true, noParams: true },
    { action: 'broadcast', module: 'broadcast.js', label: 'برودكاست', emoji: '📡', elevated: false,
      params: [
        { name: 'المستهدفين', label: 'المستهدفين', type: 'string', placeholder: 'الكل / رتبة @role / ايدي العضو', required: true },
        { name: 'الرسالة', label: 'الرسالة', type: 'string', placeholder: 'نص البرودكاست', required: true, style: 'long' },
      ] },
    { action: 'تحذير', module: 'Warning.js', label: 'تحذير', emoji: '⚠️', elevated: false,
      params: [
        { name: 'الشخص', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'النوع', label: 'النوع', type: 'string', placeholder: 'شفوي / عدم تفاعل / سلوك', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب التحذير', required: true, style: 'short' },
      ] },
    { action: 'زيادة_نقاط', module: 'addPoints.js', label: 'زيادة نقاط', emoji: '➕', elevated: false,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'النقاط', label: 'عدد النقاط', type: 'integer', placeholder: 'مثال: 5', required: true },
        { name: 'السبب', label: 'السبب', type: 'string', placeholder: 'سبب الزيادة', required: true, style: 'short' },
      ] },
    { action: 'نظام-التقارير', module: 'reportSystem.js', label: 'نظام التقارير', emoji: '📋', elevated: false, noParams: true },
    { action: 'تقارير', module: 'reports.js', label: 'تحديث التقارير', emoji: '📊', elevated: false, noParams: true },
    { action: 'حضور', module: 'attendance.js', label: 'حضور', emoji: '🎮', elevated: false, noParams: true },
    { action: 'تنويه', module: 'announcement.js', label: 'تنويه', emoji: '📢', elevated: false,
      params: [
        { name: 'العنوان', label: 'العنوان', type: 'string', placeholder: 'عنوان التنويه', required: true },
        { name: 'النص', label: 'النص', type: 'string', placeholder: 'نص التنويه', required: true, style: 'long' },
        { name: 'الصورة', label: 'رابط الصورة (اختياري)', type: 'string', placeholder: 'https://...', required: false },
      ] },
  ],

  blackMarket: [
    { action: 'توظيف-بائع', module: 'bmHire.js', label: 'توظيف بائع', emoji: '👤', elevated: false,
      params: [
        { name: 'العضو', label: 'العضو', type: 'user', placeholder: 'ID العضو أو منشن', required: true },
        { name: 'الاسم', label: 'الاسم', type: 'string', placeholder: 'اسم البائع', required: true },
      ] },
    { action: 'manage-sellers', module: 'manageSellers.js', label: 'إدارة البائعين', emoji: '👥', elevated: false, noParams: true },
    { action: 'bm-requests', module: 'bmRequests.js', label: 'طلبات', emoji: '📦', elevated: false, noParams: true },
    { action: 'bm-seller', module: 'bmSeller.js', label: 'بائع', emoji: '🏪', elevated: false, noParams: true },
    { action: 'احصائيات-بلاك-ماركت', module: 'bmStats.js', label: 'إحصائيات', emoji: '📊', elevated: false, noParams: true },
  ],
};

function findCommand(committeeKey, action) {
  return (COMMANDS_MAP[committeeKey] || []).find(c => c.action === action) || null;
}

function getModalCustomId(committeeKey, action) {
  return `${MODAL_PREFIX}${committeeKey}_${action}`;
}

/* ===================================================================
   عرض لوحة الأوامر (قائمة منسدلة)
   =================================================================== */
export async function handleShowPanel(interaction) {
  const config = loadConfig();
  const member = interaction.member;
  const userId = member.id;
  const committeeList = config.committees?.list || {};

  // تحديد اللجنة بناءً على رتب العضو (بدلاً من القناة)
  const founders = config.committees?.founders || [];
  const authorized = config.committees?.authorizedUsers || [];
  const isSuperUser = founders.includes(userId) || authorized.includes(userId);

  let committeeKey = null;

  // إذا كان مؤسساً أو مصرحاً له → يرى لجنته الأولى أو رئاسة العائلة
  if (isSuperUser) {
    committeeKey = 'family_presidency';
  } else {
    // ابحث في كل لجنة عن رتبة العضو
    for (const [key, committee] of Object.entries(committeeList)) {
      const roles = committee.roles || {};
      const allRoleIds = [
        ...(roles.manager || []),
        ...(roles.deputy || []),
        ...(roles.member || [])
      ];
      const isMember = allRoleIds.some(id => id === userId || member.roles?.cache?.has(id));
      if (isMember) {
        // أعطِ الأولوية لـ family_presidency إن كان فيها
        if (key === 'family_presidency') { committeeKey = key; break; }
        if (!committeeKey) committeeKey = key;
      }
    }
  }

  if (!committeeKey) {
    return interaction.reply({ content: '❌ لا تنتمي إلى أي لجنة. تواصل مع الإدارة لإضافتك.', flags: MessageFlags.Ephemeral });
  }

  const commands = COMMANDS_MAP[committeeKey];
  if (!commands || commands.length === 0) {
    return interaction.reply({ content: '❌ لا توجد أوامر متاحة لهذه اللجنة.', flags: MessageFlags.Ephemeral });
  }

  const embed = buildCommandEmbed(committeeKey, interaction.guild);
  const selectRow = buildCommandSelect(committeeKey);

  const components = [selectRow];
  if (committeeKey === 'family_presidency' || isSuperUser) {
    const otherCommittees = Object.keys(COMMANDS_MAP).filter(k => k !== 'family_presidency');
    if (otherCommittees.length > 0) {
      const committeeSelect = new StringSelectMenuBuilder()
        .setCustomId('cmd_switch_committee')
        .setPlaceholder('🗂️ أوامر لجنة أخرى')
        .addOptions(otherCommittees.map(k => ({
          label: COMMITTEE_NAMES[k] || k,
          value: k,
          emoji: COMMITTEE_EMOJIS[k],
        })));
      components.push(new ActionRowBuilder().addComponents(committeeSelect));
    }
  }

  await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

/* ===================================================================
   معالج اختيار أمر من القائمة
   =================================================================== */
export async function handlePanelSelect(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith('cmd_psel_')) return;

  const [, , committeeKey] = customId.split('_', 3);
  const action = interaction.values[0];

  const cmd = findCommand(committeeKey, action);
  if (!cmd) {
    return interaction.reply({ content: '❌ الأمر غير معروف.', flags: MessageFlags.Ephemeral });
  }

  if (cmd.noParams) {
    const reason = 'تأكيد تنفيذ الأمر';
    const modal = new ModalBuilder()
      .setCustomId(getModalCustomId(committeeKey, action))
      .setTitle(`${cmd.emoji} ${cmd.label}`);
    const input = new TextInputBuilder()
      .setCustomId('confirm_reason')
      .setLabel('سبب التأكيد (اختياري)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder('اكتب سبب التأكيد أو اتركه فارغاً');
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return await interaction.showModal(modal);
  }

  const modal = new ModalBuilder()
    .setCustomId(getModalCustomId(committeeKey, action))
    .setTitle(`${cmd.emoji} ${cmd.label}`);

  for (const param of (cmd.params || [])) {
    const input = new TextInputBuilder()
      .setCustomId(param.name)
      .setLabel(param.label)
      .setStyle(param.style === 'long' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(param.required !== false)
      .setPlaceholder(param.placeholder || '');
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  await interaction.showModal(modal);
}

/* ===================================================================
   معالج تبديل اللجنة (للرئاسة فقط)
   =================================================================== */
export async function handleSwitchCommittee(interaction) {
  if (interaction.customId !== 'cmd_switch_committee') return;
  const committeeKey = interaction.values[0];
  const commands = COMMANDS_MAP[committeeKey];
  if (!commands || commands.length === 0) {
    return interaction.reply({ content: '❌ لا توجد أوامر متاحة.', flags: MessageFlags.Ephemeral });
  }

  const embed = buildCommandEmbed(committeeKey, interaction.guild);
  const selectRow = buildCommandSelect(committeeKey);

  const components = [selectRow];
  const otherCommittees = Object.keys(COMMANDS_MAP).filter(k => k !== committeeKey);
  if (otherCommittees.length > 0) {
    const committeeSelect = new StringSelectMenuBuilder()
      .setCustomId('cmd_switch_committee')
      .setPlaceholder('🗂️ أوامر لجنة أخرى')
      .addOptions(otherCommittees.map(k => ({
        label: COMMITTEE_NAMES[k] || k,
        value: k,
        emoji: COMMITTEE_EMOJIS[k],
      })));
    components.push(new ActionRowBuilder().addComponents(committeeSelect));
  }

  await interaction.update({ embeds: [embed], components });
}

function buildCommandEmbed(committeeKey, guild) {
  const name = COMMITTEE_NAMES[committeeKey] || permCommittees[committeeKey]?.name || committeeKey;
  const emoji = COMMITTEE_EMOJIS[committeeKey] || '⚡';
  const commands = COMMANDS_MAP[committeeKey] || [];

  const descLines = commands.map(c => {
    const params = c.params ? c.params.map(p => p.label).join('، ') : 'بدون إعدادات';
    return `${c.emoji} **${c.label}** — ${params}`;
  });

  return embedNeutral(`${emoji} أوامر ${name}`, `اختر الأمر من القائمة المنسدلة أدناه\n\n${descLines.join('\n')}`)
    .setThumbnail(guild?.iconURL() || null);
}

function buildCommandSelect(committeeKey) {
  const commands = COMMANDS_MAP[committeeKey] || [];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`cmd_psel_${committeeKey}`)
      .setPlaceholder('📋 اختر الأمر الذي تريد تنفيذه')
      .addOptions(commands.map(c => ({
        label: `${c.emoji} ${c.label}`,
        description: c.params ? c.params.map(p => p.label).join('، ') : 'بدون إعدادات',
        value: c.action,
      })))
  );
}

/* ===================================================================
   معالج المودالات (تنفيذ الأوامر)
   =================================================================== */
export async function handlePanelModal(interaction) {
  const customId = interaction.customId;
  if (!customId.startsWith(MODAL_PREFIX)) return;

  const parts = customId.replace(MODAL_PREFIX, '').split('_');
  const committeeKey = parts[0];
  const action = parts.slice(1).join('_');

  const cmd = findCommand(committeeKey, action);
  if (!cmd) {
    return interaction.reply({ content: '❌ الأمر غير معروف.', flags: MessageFlags.Ephemeral });
  }

  if (cmd.complex) {
    if (action === 'تحذير') return await handleWarningModal(interaction);
    if (action === 'فصل') return await handleFireModal(interaction);
    if (action === 'بلاك_ليست') return await handleBlacklistModal(interaction);
    if (action === 'ازالة-تحذير') return await handleRemoveWarningModal(interaction);
  }

  if (cmd.internal) {
    if (action === 'مراجعة_التفاعل') return await handleForceInteractionReview(interaction);
    return;
  }

  if (cmd.noParams) {
    try {
      const mod = await import(`../commands/${cmd.module}`);
      const cmdModule = mod.default || mod;
      await cmdModule.execute(interaction);
    } catch (err) {
      console.error(`❌ Error executing no-param command ${cmd.module}:`, err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.editReply('❌ حدث خطأ.').catch(() => {});
      }
    }
    return;
  }

  await executeSimpleCommand(interaction, cmd);
}

async function executeSimpleCommand(interaction, cmd) {
  const targetUserCache = {};

  const mockInteraction = new Proxy(interaction, {
    get(target, prop, receiver) {
      if (prop === 'options') {
        return {
          getUser: async (name) => {
            if (targetUserCache[name]) return targetUserCache[name];
            const raw = target.fields.getTextInputValue(name);
            if (!raw) return null;
            const id = resolveUserId(raw);
            if (!id) return null;
            let user = target.client.users.cache.get(id);
            if (!user) {
              try { user = await target.client.users.fetch(id); } catch { user = null; }
            }
            targetUserCache[name] = user;
            return user || null;
          },
          getString: (name) => target.fields.getTextInputValue(name) || '',
          getInteger: (name) => {
            const val = parseInt(target.fields.getTextInputValue(name));
            return isNaN(val) ? 0 : val;
          },
          getBoolean: () => false,
          get: (name) => ({ value: target.fields.getTextInputValue(name) || '' }),
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  try {
    const mod = await import(`../commands/${cmd.module}`);
    const cmdModule = mod.default || mod;
    await cmdModule.execute(mockInteraction);
  } catch (err) {
    console.error(`❌ Error executing ${cmd.module}:`, err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ حدث خطأ أثناء تنفيذ الأمر.', flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.editReply('❌ حدث خطأ أثناء تنفيذ الأمر.').catch(() => {});
    }
  }
}

/* ===================================================================
   حالة الإجراءات المعلقة (لـ فصل و بلاك_ليست)
   =================================================================== */
const pendingActions = new Map();

export async function handleConfirmButton(interaction) {
  const customId = interaction.customId;
  const userId = interaction.user.id;
  const pending = pendingActions.get(userId);
  if (!pending) {
    return interaction.reply({ content: '❌ انتهت صلاحية الإجراء أو لا يوجد إجراء معلق.', flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('cmd_confirm_fire_') || customId.startsWith('cmd_cancel_fire_')) {
    if (customId.startsWith('cmd_cancel_fire_')) {
      pendingActions.delete(userId);
      return interaction.update({ content: '✅ تم إلغاء العملية.', components: [] });
    }
    if (pending.type !== 'fire') return;
    pendingActions.delete(userId);
    await interaction.deferUpdate();
    await executeFire(interaction, pending.userIds, pending.reason);
    return;
  }

  if (customId.startsWith('cmd_confirm_bl_') || customId.startsWith('cmd_cancel_bl_')) {
    if (customId.startsWith('cmd_cancel_bl_')) {
      pendingActions.delete(userId);
      return interaction.update({ content: '✅ تم إلغاء العملية.', components: [] });
    }
    if (pending.type !== 'blacklist') return;
    pendingActions.delete(userId);
    await interaction.deferUpdate();
    await executeBlacklist(interaction, pending);
    return;
  }
}

/* ===================================================================
   المودال الخاص بـ تحذير
   =================================================================== */
async function handleWarningModal(interaction) {
  const config = loadConfig();
  const targetUserId = resolveUserId(interaction.fields.getTextInputValue('الشخص'));
  const warningType = interaction.fields.getTextInputValue('النوع')?.trim();
  const reason = interaction.fields.getTextInputValue('السبب');

  if (!targetUserId) {
    return interaction.reply({ content: '❌ معرف العضو غير صحيح.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let targetUser = interaction.client.users.cache.get(targetUserId);
  if (!targetUser) {
    try { targetUser = await interaction.client.users.fetch(targetUserId); } catch { targetUser = null; }
  }
  if (!targetUser) {
    return interaction.editReply('❌ العضو غير موجود.');
  }

  const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
  if (!targetMember) {
    return interaction.editReply('❌ العضو غير موجود في السيرفر.');
  }

  const typeMap = {
    'شفوي': { type: 'oral', typeName: 'شفوي' },
    'عدم تفاعل': { type: 'inactivity', typeName: 'نقص تفاعل' },
    'سلوك': { type: 'punishment', typeName: 'عقوبة إدارية' },
  };

  const matchedType = typeMap[warningType];
  if (!matchedType) {
    return interaction.editReply('❌ نوع التحذير غير صحيح. الأنواع: شفوي, عدم تفاعل, سلوك');
  }

  const Warning = (await import('../models/Warning.js')).default;
  const { updateRoomEmoji, STATUS } = await import('./interactionMonitor.js');
  const { updateReportsDashboard } = await import('../commands/reports.js');

  const warning = new Warning({
    memberId: targetUserId,
    memberName: targetUser.tag,
    reason,
    warningType: matchedType.type,
    typeName: matchedType.typeName,
    removed: false,
    status: 'active',
    givenBy: interaction.user.id,
    givenByName: interaction.user.tag,
  });
  await warning.save();

  const decisionChannelId = config.warnings?.channels?.warningDecision?.id || getInteractionConfig().channels.decisions;
  const warningGif = config.warnings?.channels?.warningGif?.id || 'https://media.discordapp.net/attachments/1391704768660901919/1453017758328557629/934_x_175_.gif';
  const basicRoleId = config.roles?.basic?.id || '1388879971677634631';
  const announcementChannel = interaction.guild.channels.cache.get(decisionChannelId);

  if (matchedType.type === 'oral') {
    if (announcementChannel) {
      await announcementChannel.send({ content: warningGif }).catch(() => {});
      const oralDecision = `
▬▬▬ ﷽ ▬▬▬
<:Family:1516647836744417320> **قرار إداري صادر من قيادة العائلة** 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 

**لكلاً من :**  
- ${targetUser}

**السبب :**  || ${reason} ||

> • **بإعطاء تحذير شفوي**
> || نوع التحذير: ${matchedType.typeName} ||

**تــوقــيــع مسؤول القرار ✍:** ${interaction.user}

||<@&${basicRoleId}>||
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`.trim();
      await announcementChannel.send({ content: oralDecision }).catch(() => {});
    }

    const dmEmbed = embedWarning('⚠️ تنبيه شفوي',
      `لقد تلقيت تنبيهاً شفوياً في عائلة X.IRAQ.\n\n**السبب:** \`${reason}\`\n**المسؤول:** ${interaction.user.tag}`);
    await dmUser(targetUser, dmEmbed);

    await logWarning(interaction.guild, {
      target: targetUser, mod: interaction.user, reason: `شفوي — ${reason}`, warningCount: 0, totalWarnings: 0,
    });

    await interaction.editReply({ content: `✅ تم إعطاء تحذير شفوي لـ ${targetUser} بنجاح.` });
    return;
  }

  const activeCount = await Warning.countDocuments({ memberId: targetUserId, removed: false });
  const warningNum = activeCount;
  const numArabic = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس'][activeCount - 1] || `${warningNum}`;

  if (matchedType.type === 'inactivity') {
    const Member = (await import('../models/Member.js')).default;
    const memberDoc = await Member.findOne({ discordId: targetUserId });
    if (memberDoc) {
      memberDoc.lastActivity = new Date();
      await memberDoc.save();
    }
  }

  const warningRoleId = config.warnings?.roles?.[warningNum.toString()];
  if (warningRoleId) {
    await targetMember.roles.add(warningRoleId).catch(e => console.error('Failed to add warning role:', e));
  }

  if (announcementChannel) {
    await announcementChannel.send({ content: warningGif }).catch(() => {});
    const decision = `
▬▬▬ ﷽ ▬▬▬
<:Family:1516647836744417320> **قرار إداري صادر من قيادة العائلة** 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 

**لكلاً من :**  
- ${targetUser}

**السبب :**  || ${reason} ||

> • **بإعطاء تحذير (${numArabic})**
> || نوع التحذير: ${matchedType.typeName} ||

-# ملاحظة : عند بلوغ 3 تحذيرات سيتم اتخاذ إجراء الفصل التلقائي.
**تــوقــيــع مسؤول القرار ✍:** ${interaction.user}

||<@&${basicRoleId}>||
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`.trim();
    await announcementChannel.send({ content: decision }).catch(() => {});
  }

  const dmEmbed = embedError(`⚠️ تحذير رسمي (${numArabic})`,
    `لقد تم إصدار تحذير بحقك في عائلة X.IRAQ.\n\n**السبب:** \`${reason}\`\n**النوع:** ${matchedType.typeName}\n**المسؤول:** ${interaction.user.tag}\n**عدد تحذيراتك الحالية:** ${warningNum}`);
  await dmUser(targetUser, dmEmbed);

  await logWarning(interaction.guild, {
    target: targetUser, mod: interaction.user, reason, warningCount: warningNum, totalWarnings: 3,
  });

  if (matchedType.type === 'inactivity') {
    const Member = (await import('../models/Member.js')).default;
    await Member.findOneAndUpdate(
      { discordId: targetUserId },
      { $set: { violatorWarningSentAt: new Date() } }
    );
    await updateRoomEmoji(interaction.guild, targetUserId, STATUS.WARNED);
  } else {
    await updateRoomEmoji(interaction.guild, targetUserId);
  }

  await updateReportsDashboard(interaction.client, false).catch(e => console.error('فشل تحديث التقرير:', e));

  await interaction.editReply({ content: `✅ تم إصدار التحذير رقم **${warningNum}** لـ ${targetUser} بنجاح.` });
}

/* ===================================================================
   المودال الخاص بـ ازالة-تحذير
   =================================================================== */
async function handleRemoveWarningModal(interaction) {
  const targetUserId = resolveUserId(interaction.fields.getTextInputValue('الشخص'));
  const reason = interaction.fields.getTextInputValue('السبب');

  if (!targetUserId) {
    return interaction.reply({ content: '❌ معرف العضو غير صحيح.', flags: MessageFlags.Ephemeral });
  }

  let targetUser = interaction.client.users.cache.get(targetUserId);
  if (!targetUser) {
    try { targetUser = await interaction.client.users.fetch(targetUserId); } catch { targetUser = null; }
  }
  if (!targetUser) {
    return interaction.reply({ content: '❌ العضو غير موجود.', flags: MessageFlags.Ephemeral });
  }

  const Warning = (await import('../models/Warning.js')).default;
  const warnings = await Warning.find({ memberId: targetUserId, removed: false });
  if (!warnings.length) {
    return interaction.reply({ content: `❌ ${targetUser} ليس لديه تحذيرات نشطة.`, flags: MessageFlags.Ephemeral });
  }

  if (warnings.length === 1) {
    await executeRemoveWarning(interaction, targetUserId, targetUser, warnings[0], reason);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(`⚠️ العضو لديه **${warnings.length}** تحذيرات نشطة. استخدم الأمر </ازالة-تحذير:1399739446142115867> لإزالة تحذير محدد.`);
}

async function executeRemoveWarning(interaction, targetUserId, targetUser, warn, reason) {
  const config = loadConfig();

  warn.removed = true;
  warn.removedBy = interaction.user.id;
  warn.removedAt = new Date();
  warn.removalReason = reason;
  await warn.save();

  const gm = await interaction.guild.members.fetch(targetUserId).catch(() => null);
  if (gm) {
    const roles = Object.values(config.warnings?.roles || {}).filter(id => id);
    for (const r of roles) await gm.roles.remove(r).catch(() => {});
    const count = await (await import('../models/Warning.js')).default.countDocuments({ memberId: targetUserId, removed: false });
    const nextRole = config.warnings?.roles?.[count.toString()];
    if (nextRole) await gm.roles.add(nextRole).catch(() => {});
  }

  await dmUser(targetUser, embedSuccess('✅ تم إلغاء تحذيرك',
    `لقد تم إزالة تحذير من سجلك بواسطة **${interaction.user.tag}**.\n\n**السبب:** ${reason}`));

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: `✅ تم إزالة التحذير لـ ${targetUser} بنجاح.`, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.editReply({ content: `✅ تم إزالة التحذير لـ ${targetUser} بنجاح.`, components: [] });
  }
}

/* ===================================================================
   المودال الخاص بـ فصل
   =================================================================== */
async function handleFireModal(interaction) {
  const membersInput = interaction.fields.getTextInputValue('المعرفات');
  const reason = interaction.fields.getTextInputValue('السبب');

  function extractUserIds(input) {
    if (!input || typeof input !== 'string') return [];
    const ids = new Set();
    const mentionPattern = /<@!?(\d{17,20})>/g;
    let match;
    while ((match = mentionPattern.exec(input)) !== null) ids.add(match[1]);
    const allNumbers = input.match(/\d+/g) || [];
    for (const n of allNumbers) if (n.length >= 17 && n.length <= 20) ids.add(n);
    return Array.from(ids).filter(id => /^\d{17,20}$/.test(id));
  }

  const userIds = extractUserIds(membersInput);
  if (!userIds || userIds.length === 0) {
    return interaction.reply({ content: '❌ لم يتم العثور على أي أعضاء صحيحين.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const confirmEmbed = embedWarning('⚠️ تأكيد فصل الأعضاء',
    `هل أنت متأكد من فصل **${userIds.length}** عضو/أعضاء؟\n\n**السبب:** ${reason}`);

  const confirmId = `cmd_confirm_fire_${interaction.user.id}`;
  const cancelId = `cmd_cancel_fire_${interaction.user.id}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel('✅ تأكيد الفصل').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel('❌ إلغاء').setStyle(ButtonStyle.Secondary),
  );

  pendingActions.set(interaction.user.id, { type: 'fire', userIds, reason });
  setTimeout(() => pendingActions.delete(interaction.user.id), 60000);

  await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
}

async function executeFire(interaction, userIds, reason) {
  const Member = (await import('../models/Member.js')).default;
  const Warning = (await import('../models/Warning.js')).default;
  const config = loadConfig();

  const results = { success: [], failed: [], notFound: [] };
  const warningsStats = [];

  for (const userId of userIds) {
    try {
      const memberRecord = await Member.findOne({ discordId: userId });
      if (!memberRecord) { results.notFound.push(userId); continue; }
      if (!memberRecord.isActive) { results.failed.push({ id: userId, error: 'العضو مفصول سابقاً' }); continue; }

      const discordMember = await interaction.guild.members.fetch(userId).catch(() => null);
      const user = await interaction.client.users.fetch(userId).catch(() => null);

      const activeWarnings = await Warning.find({ memberId: userId, removed: false, status: 'active' });
      let warningCount = 0;
      if (activeWarnings.length > 0) {
        const updateResult = await Warning.updateMany(
          { memberId: userId, removed: false, status: 'active' },
          { $set: { removed: true, status: 'fired', removedBy: interaction.user.id, removedByName: interaction.user.tag, removedAt: new Date(), removalReason: `تم الفصل من العائلة - ${reason}`, firedAt: new Date(), firedBy: interaction.user.id, firedByName: interaction.user.tag } }
        );
        warningCount = updateResult.modifiedCount || activeWarnings.length;
      }
      warningsStats.push({ userId, count: warningCount });

      if (discordMember) {
        const rolesToRemove = [];
        if (config.roles?.basic?.id) rolesToRemove.push(config.roles.basic.id);
        if (memberRecord?.jobNumber && config.roles?.jobRoles?.[memberRecord.jobNumber]?.id) rolesToRemove.push(config.roles.jobRoles[memberRecord.jobNumber].id);
        if (memberRecord?.currentRank && Array.isArray(config.promotion?.ranks)) {
          const rankConfig = config.promotion.ranks.find(r => r.name === memberRecord.currentRank);
          if (rankConfig?.roleId) rolesToRemove.push(rankConfig.roleId);
        }
        const uniqueRoleIds = [...new Set(rolesToRemove.filter(Boolean))];
        const existing = uniqueRoleIds.filter(rid => discordMember.roles.cache.has(rid));
        if (existing.length > 0) await discordMember.roles.remove(existing).catch(() => {});

        const channelId = memberRecord?.roomChannelId;
        if (channelId) {
          const roomChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
          if (roomChannel && roomChannel.deletable) await roomChannel.delete().catch(() => {});
        }
      }

      if (user) {
        const fireFields = warningCount > 0 ? [{ name: '📝 ملاحظة', value: `تم إزالة ${warningCount} تحذير(ات) من سجلك بسبب الفصل.` }] : [];
        await dmUser(user, embedError('🚫 تم فصلك من العائلة',
          `لقد تم اتخاذ قرار بفصلك من عائلة X.IRAQ.\n\n**السبب:** ${reason}`, fireFields));
      }

      const Attendance = (await import('../models/Attendance.js')).default;
      const AttendanceLog = (await import('../models/AttendanceLog.js')).default;
      const Vacation = (await import('../models/Vacation.js')).default;
      const Excuse = (await import('../models/Excuse.js')).default;
      const Ticket = (await import('../models/Ticket.js')).default;

      await Promise.all([
        Attendance.deleteMany({ userId }),
        AttendanceLog.deleteMany({ userId }),
        Vacation.deleteMany({ memberId: userId }),
        Excuse.deleteMany({ memberId: userId }),
        Ticket.deleteMany({ userId }),
        Ticket.deleteMany({ creatorId: userId }),
      ]);

      const memberBefore = await Member.findOne({ discordId: userId });
      const oldPoints = memberBefore?.points || 0;
      const oldRank = memberBefore?.currentRank || 'غير معروف';

      await Member.findOneAndUpdate(
        { discordId: userId },
        { $set: { lastActiveRank: oldRank, isActive: false, points: 0, currentRank: 'مفصول', firedAt: new Date(), firedBy: interaction.user.id, lastInactiveNoticeAt: null, violatorWarningSentAt: null, _lastInteractionStatus: null } }
      );
      results.success.push({ id: userId, mention: `<@${userId}>`, username: user ? user.username : 'Unknown', oldPoints, oldRank, warningsCount: warningCount });
    } catch (e) {
      results.failed.push({ id: userId, error: e.message });
    }
  }

  if (results.success.length > 0) {
    const annChannel = interaction.guild.channels.cache.get(config.general?.channels?.announcements?.id || '1391985954075443282');
    if (annChannel) {
      await annChannel.send({ content: 'https://media.discordapp.net/attachments/1391704768660901919/1453017755392671899/934_x_175_.gif' }).catch(() => {});
      const totalWarningsRemoved = warningsStats.reduce((sum, stat) => sum + stat.count, 0);
      const decision = `
****قرار صادر من قيادة 𓆩 <:Family:1516647836744417320> 𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪****

**بعد الاطلاع على ملف العضو وإيقافه عن العمل قررنا الآتي:**

**فصل للمدعو/ين:**
${results.success.map(m => `- ${m.mention}`).join('\n')}

**السبب:** ${reason}
${totalWarningsRemoved > 0 ? `\n**تم إزالة ${totalWarningsRemoved} تحذير(ات) من سجلات الأعضاء بسبب الفصل.**` : ''}

**امضاء محرر القرار:** ${interaction.user}
**امضاء لجنة العقوبات:** <@&1398212916389478442>

**▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`.trim();
      await annChannel.send({ content: decision }).catch(() => {});
    }
  }

  const isError = results.success.length > 0;
  const resFields = [
    { name: '👤 المسؤول', value: interaction.user.tag, inline: true },
    { name: '📝 السبب', value: reason, inline: true },
    { name: '\u200b', value: '\u200b', inline: true },
  ];
  if (results.success.length) {
    const details = results.success.map((s, i) =>
      `**${i + 1}.** ${s.mention}\n┗ الرتبة: ${s.oldRank} | النقاط المحذوفة: ${s.oldPoints} | التحذيرات الملغاة: ${s.warningsCount}`
    ).join('\n');
    const totalPointsRemoved = results.success.reduce((sum, s) => sum + (s.oldPoints || 0), 0);
    const totalWarningsRemoved2 = warningsStats.reduce((sum, s) => sum + s.count, 0);
    resFields.push(
      { name: `✅ المفصولون (${results.success.length})`, value: details, inline: false },
      { name: '📊 ملخص الخسائر', value: `**إجمالي النقاط المحذوفة:** ${totalPointsRemoved}\n**إجمالي التحذيرات الملغاة:** ${totalWarningsRemoved2}`, inline: false }
    );
  }
  if (results.notFound.length) resFields.push({ name: '❓ غير موجودين', value: results.notFound.map(id => `<@${id}>`).join('\n'), inline: false });
  if (results.failed.length) resFields.push({ name: '❌ فشل', value: results.failed.map(f => `<@${f.id}>: ${f.message}`).join('\n'), inline: false });
  const resEmbed = isError ? embedError('🔥 تقرير فصل أعضاء', null, resFields) : embedWarning('🔥 تقرير فصل أعضاء', null, resFields);

  for (const s of results.success) {
    await logFire(interaction.guild, {
      target: { id: s.id }, mod: interaction.user, reason, totalWarnings: s.warningsCount,
      membershipDuration: `${s.oldRank}`,
    });
  }

  await interaction.editReply({ embeds: [resEmbed] });
}

/* ===================================================================
   المودال الخاص بـ بلاك_ليست
   =================================================================== */
async function handleBlacklistModal(interaction) {
  const config = loadConfig();
  const targetUserId = resolveUserId(interaction.fields.getTextInputValue('العضو'));
  const reason = interaction.fields.getTextInputValue('السبب');
  const duration = parseInt(interaction.fields.getTextInputValue('المدة')) || 0;
  const category = interaction.fields.getTextInputValue('التصنيف') || 'أخرى';

  if (!targetUserId) {
    return interaction.reply({ content: '❌ معرف العضو غير صحيح.', flags: MessageFlags.Ephemeral });
  }

  let targetUser = interaction.client.users.cache.get(targetUserId);
  if (!targetUser) {
    try { targetUser = await interaction.client.users.fetch(targetUserId); } catch { targetUser = null; }
  }
  if (!targetUser) {
    return interaction.reply({ content: '❌ العضو غير موجود.', flags: MessageFlags.Ephemeral });
  }

  const Blacklist = (await import('../models/Blacklist.js')).default;
  const existing = await Blacklist.findOne({ userId: targetUserId, isActive: true });
  if (existing) {
    return interaction.reply({ content: '❌ العضو مضاف بالفعل للبلاك ليست.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const confirmEmbed = embedWarning('⚠️ تأكيد إضافة البلاك ليست',
    `هل أنت متأكد من إضافة ${targetUser} إلى البلاك ليست؟\n\n**السبب:** ${reason}\n**المدة:** ${duration === 0 ? 'دائمة' : `${duration} يوم`}\n**التصنيف:** ${category}`);

  const confirmId = `cmd_confirm_bl_${interaction.user.id}`;
  const cancelId = `cmd_cancel_bl_${interaction.user.id}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel('✅ تأكيد').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel('❌ إلغاء').setStyle(ButtonStyle.Secondary),
  );

  pendingActions.set(interaction.user.id, { type: 'blacklist', targetUserId, reason, duration, category, targetUserTag: targetUser.tag });
  setTimeout(() => pendingActions.delete(interaction.user.id), 60000);

  await interaction.editReply({ embeds: [confirmEmbed], components: [row] });
}

async function executeBlacklist(interaction, pending) {
  const { targetUserId, reason, duration, category, targetUserTag } = pending;
  const config = loadConfig();

  let expiresAt = duration > 0 ? new Date(Date.now() + duration * 86400000) : null;

  const Blacklist = (await import('../models/Blacklist.js')).default;
  await Blacklist.create({
    userId: targetUserId, username: targetUserTag, reason, category, duration,
    addedBy: interaction.user.id, addedByName: interaction.user.username, expiresAt,
    isPermanent: duration === 0, isActive: true,
  });

  const Member = (await import('../models/Member.js')).default;
  const member = await Member.findOne({ discordId: targetUserId });
  if (member) {
    member.isActive = false; member.leftDate = new Date(); member.leftReason = `بلاك ليست: ${reason}`;
    await member.save();
  }

  const memberGuild = interaction.guild.members.cache.get(targetUserId);
  if (memberGuild) {
    if (config.roles?.blacklist?.id) await memberGuild.roles.add(config.roles.blacklist.id).catch(() => {});
    if (config.roles?.basic?.id) await memberGuild.roles.remove(config.roles.basic.id).catch(() => {});
  }

  const targetUser = interaction.client.users.cache.get(targetUserId);
  if (targetUser) {
    await dmUser(targetUser, embedError('🚫 تم إضافتك للبلاك ليست',
      `السبب: ${reason}\nالمدة: ${duration === 0 ? 'دائمة' : `${duration} يوم`}`));
  }

  await logBlacklist(interaction.guild, {
    target: targetUser || { id: targetUserId }, mod: interaction.user, reason, duration: duration === 0 ? 'دائمة' : `${duration} يوم`,
  });

  await interaction.editReply({ content: `✅ تم إضافة ${targetUserTag} للبلاك ليست بنجاح.`, components: [] });
}

async function handleForceInteractionReview(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  try {
    const { runManualReview } = await import('./interactionManager.js');
    await interaction.editReply({ content: '⏳ جاري مراجعة التفاعل لجميع الأعضاء وتحديث الإيموجيات...' }).catch(() => {});
    const result = await runManualReview(interaction.guild, interaction.client);
    const counts = result.statusCounts || {};
    const embed = embedInfo('📊 نتائج مراجعة التفاعل',
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🟢 **متفاعلين عالي:** ${counts.active_high || 0} عضو\n` +
      `🟡 **خاملين:** ${counts.inactive || 0} أعضاء\n` +
      `🔴 **مخالفين:** ${counts.violator || 0} عضو ← يُرسل للإدارة\n` +
      `🟤 **مخالفين محذرين:** ${counts.warned || 0} عضو ← جاهز للفصل\n` +
      `⚫ **محميون:** ${counts.protected || 0} أعضاء\n` +
      `🆕 **فترة سماح:** ${counts.grace || 0} عضو\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ تم فحص **${result.processed || 0}** عضو نشط.\n` +
      `🏠 تم تحديث إيموجيات **${result.roomUpdates || 0}** روم.`
    );
    await interaction.editReply({ content: '✅ تم الانتهاء!', embeds: [embed] }).catch(() => {});
  } catch (error) {
    console.error('❌ مراجعة التفاعل:', error);
    await interaction.editReply({ content: `❌ حدث خطأ: ${error.message}` }).catch(() => {});
  }
}
