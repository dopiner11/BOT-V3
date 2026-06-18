// utils/reportHandler.js
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  MessageFlags,
  Events,
  PermissionFlagsBits,
  EmbedBuilder
} from 'discord.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, neutral as embedNeutral, custom as embedCustom } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logPoints } from '../utils/logSystem.js';
import { readFileSync, createWriteStream, unlinkSync, statSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import https from 'https';
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPORT_TEMP_DIR = join(__dirname, '../.data/report-temp');
if (!existsSync(REPORT_TEMP_DIR)) mkdirSync(REPORT_TEMP_DIR, { recursive: true });

// Lazy-loaded imports (cached after first call)
let _reportsCommand = null;
let _MemberModel = null;
let _ReportModel = null;
let _DoublePointsModel = null;
let _PointLogModel = null;
async function getReportsCmd() {
  if (!_reportsCommand) _reportsCommand = await import('../commands/reports.js');
  return _reportsCommand;
}
async function getMemberModel() {
  if (!_MemberModel) _MemberModel = (await import('../models/Member.js')).default;
  return _MemberModel;
}
async function getReportModel() {
  if (!_ReportModel) _ReportModel = (await import('../models/Report.js')).default;
  return _ReportModel;
}
async function getDoublePointsModel() {
  if (!_DoublePointsModel) _DoublePointsModel = (await import('../models/DoublePoints.js')).default;
  return _DoublePointsModel;
}
async function getPointLogModel() {
  if (!_PointLogModel) _PointLogModel = (await import('../models/PointLog.js')).default;
  return _PointLogModel;
}

// Load config dynamically
function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
  } catch (e) {
    console.error('❌ failed to load config.json in reportHandler:', e);
    return {};
  }
}

function getCommitteeRoles(config, committeeKey) {
  const roles = [];
  const committee = config.committees?.list?.[committeeKey];
  if (committee) {
    for (const type of ['manager', 'deputy', 'member']) {
      const roleList = committee.roles?.[type];
      if (Array.isArray(roleList)) {
        for (const id of roleList) {
          if (id) roles.push(id);
        }
      }
    }
  }
  return roles;
}

// خريطة لحفظ التقارير المؤقتة
const activeReports = new Map();

function resetInactivityTimer(userId, channel) {
  const reportData = activeReports.get(userId);
  if (!reportData) return;

  if (reportData.timer) clearTimeout(reportData.timer);

  reportData.timer = setTimeout(async () => {
    activeReports.delete(userId);
    try {
      if (reportData.messages && reportData.messages.length > 0) {
        await deleteMessages(channel, reportData.messages);
      }
      const msg = await channel.send(`❌ **تم إلغاء التقرير لعدم التفاعل (مهلة 60 ثانية)** <@${userId}>`);
      setTimeout(() => msg.delete().catch(() => { }), 5000);
    } catch (e) {
      console.error('Error in timeout cleanup', e);
    }
  }, 60000);
}

// تعريف أنواع التقارير
const reportTypes = {
  daily_interaction: 'تقرير إثبات تفاعل يومي',
  kill_citizen: 'قتل مواطن أو تثبيته',
  kill_police: 'قتل شرطي',
  store_robbery: 'سرقة متجر',
  big_robbery: 'سرقة سفينة / بنك / مصرف / متحف',
  event_participation: 'تهريب ممنوعات',
  scenario_participation: 'مشاركة في سيناريو',
  farm_participation: 'مشاركة في مزرعة',
  vehicle_location: 'تقرير إضافة مركبة قيمة أو موقع',
  rescue_family_member: 'انقاذ عضو من العائلة'
};

// Get points config dynamically
function getReportPoints() {
  const config = loadConfig();
  return config.points?.reportPoints || {
    daily_interaction: { reporter: 10, participants: 5 },
    kill_citizen: { reporter: 15, participants: 8 },
    kill_police: { reporter: 20, participants: 10 },
    store_robbery: { reporter: 25, participants: 12 },
    big_robbery: { reporter: 30, participants: 15 },
    event_participation: { reporter: 10, participants: 5 },
    scenario_participation: { reporter: 15, participants: 8 },
    farm_participation: { reporter: 10, participants: 5 },
    vehicle_location: { reporter: 20, participants: 0 },
    rescue_family_member: { reporter: 30, participants: 15 }
  };
}

// ===== دوال مساعدة =====
function getTempImagePath() {
  return join(REPORT_TEMP_DIR, `temp_${randomBytes(8).toString('hex')}.jpg`);
}

function scheduleTempCleanup(tempPaths, delayMs = 300000) {
  for (const p of tempPaths) {
    setTimeout(() => {
      try { if (existsSync(p)) unlinkSync(p); } catch { }
    }, delayMs);
  }
}

async function resolveReportEvidenceFiles(report, guild) {
  const files = [];
  const tempPaths = [];
  let attachedFileName = null;

  if (guild && report.reviewChannelId && report.reviewMessageId) {
    try {
      const ch = await guild.channels.fetch(report.reviewChannelId).catch(() => null);
      const msg = ch ? await ch.messages.fetch(report.reviewMessageId).catch(() => null) : null;
      const attUrl = msg?.attachments?.first()?.url;
      if (attUrl) {
        const tempFile = await downloadImage(attUrl);
        attachedFileName = `report_${report._id}_${Date.now()}.jpg`;
        files.push(new AttachmentBuilder(tempFile, { name: attachedFileName }));
        tempPaths.push(tempFile);
        return { files, tempPaths, attachedFileName };
      }
    } catch (e) {
      console.log('⚠️ فشل جلب مرفق التقرير من رسالة المراجعة:', e.message);
    }
  }

  const localPath = report._tempLocalPath;
  if (localPath && existsSync(localPath)) {
    attachedFileName = report._tempLocalName || `report_${report._id}_${Date.now()}.jpg`;
    files.push(new AttachmentBuilder(localPath, { name: attachedFileName }));
    tempPaths.push(localPath);
    return { files, tempPaths, attachedFileName };
  }

  if (report.evidence?.startsWith('http')) {
    try {
      const tempFile = await downloadImage(report.evidence);
      attachedFileName = `report_${report._id}_${Date.now()}.jpg`;
      files.push(new AttachmentBuilder(tempFile, { name: attachedFileName }));
      tempPaths.push(tempFile);
    } catch (e) {
      console.log('⚠️ فشل تنزيل دليل التقرير:', e.message);
    }
  }

  return { files, tempPaths, attachedFileName };
}

async function downloadImage(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (!url || maxRedirects < 0) return reject(new Error('Invalid URL or too many redirects'));

    const tempFileName = getTempImagePath();
    const file = createWriteStream(tempFileName);

    let req;
    try {
      req = https.get(url, {
        headers: {
          'User-Agent': 'DiscordReportBot/1.0 (+https://example.com)',
          'Accept': 'image/*,*/*;q=0.8'
        }
      }, (res) => {
        // تابع تحويل (3xx)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try { unlinkSync(tempFileName); } catch { }
          const nextUrl = new URL(res.headers.location, url).toString();
          return downloadImage(nextUrl, maxRedirects - 1).then(resolve).catch(reject);
        }

        if (res.statusCode && res.statusCode >= 400) {
          file.close();
          try { unlinkSync(tempFileName); } catch { }
          return reject(new Error(`Failed to get image, status code ${res.statusCode}`));
        }

        const contentType = res.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
          file.close();
          try { unlinkSync(tempFileName); } catch { }
          return reject(new Error(`Not an image (content-type: ${contentType})`));
        }

        res.pipe(file);

        file.on('finish', () => {
          file.close();
          try {
            const stats = statSync(tempFileName);
            if (stats.size === 0) {
              try { unlinkSync(tempFileName); } catch { }
              return reject(new Error('Downloaded file is empty'));
            }
          } catch (e) {
            try { unlinkSync(tempFileName); } catch { }
            return reject(e);
          }
          resolve(tempFileName);
        });

        file.on('error', (err) => {
          try { unlinkSync(tempFileName); } catch { }
          reject(err);
        });
      });
    } catch (err) {
      try { unlinkSync(tempFileName); } catch { }
      return reject(err);
    }

    req.on('error', (err) => {
      try { unlinkSync(tempFileName); } catch { }
      reject(err);
    });

    req.setTimeout(15000, () => {
      req.destroy();
      try { unlinkSync(tempFileName); } catch { }
      reject(new Error('Image download timed out'));
    });
  });
}

async function deleteMessages(channel, messageIds) {
  for (const msgId of messageIds) {
    try {
      const msg = await channel.messages.fetch(msgId).catch(() => null);
      if (msg) await msg.delete().catch(() => { });
    } catch {
      // تجاهل
    }
  }
}

// ===== معالجة جميع أنواع التفاعلات =====

export async function handleInteraction(interaction) {
  try {
    const customId = interaction.customId;
    console.log(`🔍 [Report Interaction]: ${customId} (Type: ${interaction.type})`);

    // Handle Select Menus (Broad compatibility)
    if (interaction.isStringSelectMenu?.()) {
      return await handleSelectMenu(interaction);
    }

    // Handle Buttons
    if (interaction.isButton?.()) {
      return await handleButton(interaction);
    }

    // Handle Modals
    if (interaction.isModalSubmit?.()) {
      return await handleModalSubmit(interaction);
    }

    console.warn(`⚠️ [Report Interaction]: No matching type for ${customId}`);
  } catch (error) {
    console.error('❌ Error in reportHandler.handleInteraction:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة الطلب!', flags: MessageFlags.Ephemeral });
      }
    } catch (e) { }
  }
}

// ===== معالجة القوائم المنسدلة =====

async function handleSelectMenu(interaction) {
  if (interaction.customId === 'start_report') {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const reportType = interaction.values[0];

      if (!reportTypes[reportType]) {
        return interaction.editReply({ content: '❌ نوع التقرير غير صحيح!' });
      }

      if (activeReports.has(interaction.user.id)) {
        return interaction.editReply({
          content: '❌ لديك تقرير قيد الإنشاء بالفعل! يرجى إكماله أو إلغاءه أولاً.',
        });
      }

      // Initialize report data
      activeReports.set(interaction.user.id, {
        type: reportType,
        stage: 'title',
        messages: [],
        title: '',
        participants: [],
        evidence: '',
        createdAt: new Date(),
        _tempPreview: null,
        channelId: interaction.channelId
      });

      resetInactivityTimer(interaction.user.id, interaction.channel);

      const reportName = reportTypes[reportType];

      const startEmbed = embedInfo('📝 إنشاء تقرير جديد', `لقد اخترت: **${reportName}**\n\n**المرحلة 1 من 4:**\nيرجى كتابة **عنوان التقرير** الآن كرسالة عادية.\n\n*مثال: شاركت في سرقة البنك المركزي مع لجنة التفاعل*`)
        .setFooter({ text: 'يمكنك كتابة "إلغاء" في أي وقت لإنهاء العملية' });

      await interaction.editReply({ embeds: [startEmbed] });

    } catch (error) {
      console.error('❌ Error starting report:', error);
      try {
        if (interaction.deferred) {
          await interaction.editReply({ content: '❌ حدث خطأ أثناء بدء التقرير. يرجى المحاولة مرة أخرى.' });
        } else if (!interaction.replied) {
          await interaction.reply({ content: '❌ حدث خطأ أثناء بدء التقرير. يرجى المحاولة مرة أخرى.', flags: MessageFlags.Ephemeral });
        }
      } catch { }
    }
  }
}

// ===== معالجة الأزرار =====

async function handleButton(interaction) {
  const customId = interaction.customId;
  console.log(`[REPORT BUTTON] ${customId} by ${interaction.user.tag}`);

  // Reset timer for any report action
  const reportData = activeReports.get(interaction.user.id);
  if (reportData) {
    if (reportData.channelId !== interaction.channelId && !['accept_report', 'reject_report', 'double_points_btn'].includes(customId)) {
      return interaction.reply({ content: '❌ لا يمكنك متابعة التقرير من قناة أخرى!', flags: MessageFlags.Ephemeral });
    }
    // Don't reset timer for admin actions (accept/reject) on *other* people's reports, only for the reporter
    if (!['accept_report', 'reject_report', 'double_points_btn', 'report_stats', 'refresh_panel'].includes(customId)) {
      resetInactivityTimer(interaction.user.id, interaction.channel);
    }
  }

  switch (customId) {
    case 'double_points_btn':
      await handleDoublePointsToggle(interaction);
      break;
    case 'report_stats':
      await handleReportStats(interaction);
      break;
    case 'refresh_panel':
      await refreshPanel(interaction);
      break;
    case 'yes_participants':
    case 'no_participants':
      await handleParticipantsChoice(interaction);
      break;
    case 'submit_report':
      await handleReportSubmission(interaction);
      break;
    case 'edit_report':
      await handleReportEdit(interaction);
      break;
    case 'accept_report':
      await handleReportAcceptance(interaction);
      break;
    case 'reject_report':
      await handleReportRejection(interaction);
      break;
    default:
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ الزر غير معروف!',
          flags: MessageFlags.Ephemeral
        });
      }
  }
}

// ===== معالجة النماذج =====

async function handleModalSubmit(interaction) {
  const customId = interaction.customId;

  if (customId === 'double_points_modal') {
    await handleDoublePointsModal(interaction);
  } else if (customId.startsWith('reject_modal_')) {
    await handleRejectionModal(interaction);
  }
}

// ===== دوال معالجة التقارير (كلها كما في كودك الأصلي) =====

async function handleDoublePointsToggle(interaction) {
  const config = loadConfig();
  const reportsRoles = getCommitteeRoles(config, 'interaction');
  const hasPermission = interaction.member.roles.cache.some(role =>
    reportsRoles.includes(role.id)
  ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

  if (!hasPermission) {
    return interaction.reply({
      content: '❌ ليس لديك صلاحية لجنة لتفعيل ضعف النقاط!',
      flags: MessageFlags.Ephemeral
    });
  }

  const DoublePoints = await getDoublePointsModel();
  let doublePoints = await DoublePoints.findOne({ type: 'report' });
  const isCurrentlyActive = doublePoints?.isActive;

  if (isCurrentlyActive) {
    doublePoints.isActive = false;
    await doublePoints.save();

    await refreshPanel(interaction);
    await interaction.followUp({
      content: '✅ تم إلغاء تفعيل ضعف النقاط',
      flags: MessageFlags.Ephemeral
    });

    const config = loadConfig();
    const logChannel = interaction.guild.channels.cache.get(config.general?.channels?.logChannel?.id);
    if (logChannel) {
      const embed = embedError('🎯 إلغاء تفعيل ضعف النقاط', 'تم إلغاء تفعيل ضعف النقاط', [{ name: 'بواسطة', value: interaction.user.tag }]);
      await logChannel.send({ embeds: [embed] });
    }
  } else {
    const modal = new ModalBuilder()
      .setCustomId('double_points_modal')
      .setTitle('تفعيل ضعف النقاط');

    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('المدة بالساعات (1-168)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('24')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3);

    const actionRow = new ActionRowBuilder().addComponents(durationInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal).catch(() => {});
  }
}

async function handleDoublePointsModal(interaction) {
  const duration = parseInt(interaction.fields.getTextInputValue('duration'));

  if (isNaN(duration) || duration < 1 || duration > 168) {
    return interaction.reply({
      content: '❌ يرجى إدخال مدة صحيحة بين 1 و 168 ساعة',
      flags: MessageFlags.Ephemeral
    });
  }

  const expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000);

  const DoublePoints = await getDoublePointsModel();
  let doublePoints = await DoublePoints.findOne({ type: 'report' });
  if (!doublePoints) {
    doublePoints = new DoublePoints();
    doublePoints.type = 'report';
  }

  doublePoints.isActive = true;
  doublePoints.activatedBy = interaction.user.id;
  doublePoints.activatedAt = new Date();
  doublePoints.duration = duration;
  doublePoints.expiresAt = expiresAt;

  await doublePoints.save();

  await refreshPanel(interaction);
  await interaction.followUp({
    content: `✅ تم تفعيل ضعف النقاط لمدة ${duration} ساعة`,
    flags: MessageFlags.Ephemeral
  });

  const config = loadConfig();
  const logChannel = interaction.guild.channels.cache.get(config.general?.channels?.logChannel?.id);
  if (logChannel) {
    const embed = embedSuccess('🎯 تفعيل ضعف النقاط', `تم تفعيل ضعف النقاط لمدة ${duration} ساعة`, [
      { name: 'المدة', value: `${duration} ساعة` },
      { name: 'ينتهي في', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>` },
      { name: 'فعل بواسطة', value: interaction.user.tag }
    ]);
    await logChannel.send({ embeds: [embed] });
  }

  setTimeout(async () => {
    try {
      const DoublePoints = await getDoublePointsModel();
      const current = await DoublePoints.findById(doublePoints._id);
      if (!current || !current.isActive) return;
      if (current.activatedAt?.getTime() !== doublePoints.activatedAt?.getTime()) return;
      current.isActive = false;
      await current.save();
      if (logChannel) {
        const embed = embedWarning('🎯 انتهاء فترة ضعف النقاط', 'انتهت فترة ضعف النقاط تلقائياً');
        await logChannel.send({ embeds: [embed] });
      }
    } catch (e) { /* ignore */ }
  }, duration * 60 * 60 * 1000);
}

async function refreshPanel(interaction) {


  await interaction.deferUpdate();

  const config = loadConfig();
  const reportPoints = config.points?.reportPoints || {};
  const pointsLabels = {
    daily_interaction: '📊 تقرير إثبات تفاعل يومي',
    kill_citizen: '💀 قتل مواطن أو تثبيته',
    kill_police: '👮 قتل شرطي',
    store_robbery: '🏪 سرقة متجر',
    big_robbery: '🎪 سرقة سفينة / بنك / مصرف / متحف',
    event_participation: '🚫 تهريب ممنوعات',
    scenario_participation: '👨‍👩‍👧‍👦 مشاركة في سيناريو',
    farm_participation: '🌾 مشاركة في مزرعة',
    vehicle_location: '🚗 إضافة مركبة قيمة أو موقع',
    rescue_family_member: '🦸 انقاذ عضو من العائلة'
  };

  let pointsDescription = '';
  for (const [type, label] of Object.entries(pointsLabels)) {
    const pts = reportPoints[type];
    if (pts) {
      pointsDescription += `${label}: **${pts.reporter}** نقطة` +
        (pts.participants > 0 ? ` (المشارك: ${pts.participants})` : '') + '\n';
    }
  }
  pointsDescription += '\n🏆 **ملاحظة:** المشاركون يحصلون على نقاط حسب الإعدادات أعلاه';

  // إظهار حالة ضعف النقاط
  let doublePointsStatus = 'غير مفعّل';
  try {
    const DoublePoints = await getDoublePointsModel();
    const dp = await DoublePoints.findOne({ isActive: true, type: 'report' }).catch(() => null);
    if (dp) {
      if (dp.expiresAt && new Date(dp.expiresAt) < new Date()) {
        dp.isActive = false;
        await dp.save();
      } else if (dp.expiresAt) {
        doublePointsStatus = `🟢 مفعّل — ينتهي <t:${Math.floor(new Date(dp.expiresAt).getTime() / 1000)}:R>`;
      } else {
        doublePointsStatus = '🟢 مفعّل';
      }
    }
  } catch (e) {}

  const embed = embedInfo('📋 لوحة التقارير (محدثة)', 'يمكن للأعضاء استخدام القائمة المنسدلة أدناه لإنشاء تقارير جديدة.', [
    { name: '📊 أنواع التقارير المتاحة', value: pointsDescription },
    { name: '🎯 ضعف النقاط', value: doublePointsStatus, inline: false },
  ])
    .setFooter({ text: 'آخر تحديث: ' + new Date().toLocaleTimeString() });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('start_report')
    .setPlaceholder('اختر نوع التقرير')
    .addOptions([
      { label: 'تقرير إثبات تفاعل يومي', value: 'daily_interaction' },
      { label: 'قتل مواطن أو تثبيته', value: 'kill_citizen' },
      { label: 'قتل شرطي', value: 'kill_police' },
      { label: 'سرقة متجر', value: 'store_robbery' },
      { label: 'سرقة سفينة / بنك / مصرف / متحف', value: 'big_robbery' },
      { label: 'تهريب ممنوعات', value: 'event_participation' },
      { label: 'مشاركة في سيناريو', value: 'scenario_participation' },
      { label: 'مشاركة في مزرعة', value: 'farm_participation' },
      { label: 'تقرير إضافة مركبة قيمة أو موقع', value: 'vehicle_location' },
      { label: 'انقاذ عضو من العائلة', value: 'rescue_family_member' }
    ]);

  const adminButtons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('double_points_btn')
        .setLabel('🎯 تفعيل ضعف النقاط')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('report_stats')
        .setLabel('📊 إحصائيات التقارير')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('refresh_panel')
        .setLabel('🔄 تحديث اللوحة')
        .setStyle(ButtonStyle.Secondary)
    );

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.editReply({
    embeds: [embed],
    components: [selectRow, adminButtons]
  });
}

async function handleReportStats(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const Report = await getReportModel();

    const allReports = await Report.find();
    const total = allReports.length;
    const accepted = allReports.filter(r => r.status === 'accepted').length;
    const rejected = allReports.filter(r => r.status === 'rejected').length;
    const pending = allReports.filter(r => r.status === 'pending').length;

    let totalPoints = 0;
    const reporterPoints = {};
    for (const r of allReports) {
      if (r.pointsAwarded) {
        const pts = (r.pointsAwarded.reporter || 0) + (r.pointsAwarded.participants || 0) * (r.participants?.length || 0);
        totalPoints += pts;
        if (r.reporterId) {
          reporterPoints[r.reporterId] = (reporterPoints[r.reporterId] || 0) + (r.pointsAwarded.reporter || 0);
        }
      }
    }

    const topReporters = Object.entries(reporterPoints)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const embed = embedNeutral('📊 إحصائيات نظام التقارير', null, [
      { name: '📋 إجمالي التقارير', value: total.toString(), inline: true },
      { name: '✅ مقبول', value: accepted.toString(), inline: true },
      { name: '❌ مرفوض', value: rejected.toString(), inline: true },
      { name: '⏳ قيد المراجعة', value: pending.toString(), inline: true },
      { name: '⭐ إجمالي النقاط الموزعة', value: totalPoints.toString(), inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    ]);

    if (topReporters.length > 0) {
      const topText = topReporters.map(([id, pts], i) =>
        `**${i + 1}.** <@${id}> — ${pts} نقطة`
      ).join('\n');
      embed.addFields({ name: '🏆 أفضل مقدمي تقارير', value: topText, inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('❌ خطأ في إحصائيات التقارير:', error);
    await interaction.editReply({ content: '❌ حدث خطأ أثناء جلب الإحصائيات!' });
  }
}

// ===== دوال خطوات إنشاء التقرير =====

async function handleParticipantsChoice(interaction) {
  const reportData = activeReports.get(interaction.user.id);
  if (!reportData) {
    return interaction.reply({
      content: '❌ لا يوجد تقرير قيد الإنشاء!',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate().catch(() => {});

  let stageEmbed;
  if (interaction.customId === 'yes_participants') {
    reportData.stage = 'participants_input';
    stageEmbed = embedNeutral('📝 المرحلة 3/4: المشاركون', 'ارسل ايدي أو منشن المشاركين (مفصولة بمسافات)', [
      { name: 'مثال', value: '`<@123456789012345678> <@987654321098765432>`' }
    ]).setAuthor({ name: 'نظام التقارير' });
  } else {
    reportData.stage = 'evidence';
    reportData.participants = [];
    stageEmbed = embedNeutral('🖼️ المرحلة 4/4: دليل التقرير', 'ارسل **صورة واحدة** كدليل لإثبات التقرير.', [
      { name: 'ملاحظة', value: 'يفضل أن تكون الصورة واضحة وتظهر تفاصيل النشاط.' }
    ]).setAuthor({ name: 'نظام التقارير' });
  }

  await interaction.message.edit({
    embeds: [stageEmbed],
    components: []
  }).catch(() => interaction.editReply({ embeds: [stageEmbed], components: [] }).catch(() => {}));
}

async function handleReportSubmission(interaction) {
  const reportData = activeReports.get(interaction.user.id);
  if (!reportData) {
    return interaction.reply({
      content: '❌ لا يوجد تقرير قيد الإنشاء!',
      flags: MessageFlags.Ephemeral
    });
  }

  if (!reportData.title || !reportData.evidence) {
    return interaction.reply({
      content: '❌ بيانات التقرير غير مكتملة!',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate().catch(() => {});

  const Report = await getReportModel();
  const Member = await getMemberModel();
  const reporterMember = await Member.findOne({ discordId: interaction.user.id });

  const report = new Report({
    reporterId: interaction.user.id,
    reporterName: interaction.user.tag,
    memberRef: reporterMember?._id || null,
    reportType: reportData.type,
    title: reportData.title,
    participants: reportData.participants || [],
    evidence: reportData.evidence,
    status: 'pending'
  });

  // إذا كان لدينا ملف مؤقت نزيله في مرحلة المعاينة، خزّنه في التقرير مؤقتًا حتى نرسله كمرفق.
  if (reportData._tempPreview && reportData._tempPreview.path) {
    // ليس من الضروري أن يكون الحقل جزءًا من الـ schema؛ نستخدمه مؤقتًا قبل الإرسال
    report._tempLocalPath = reportData._tempPreview.path;
    report._tempLocalName = reportData._tempPreview.name;
  }

  await report.save();

  await sendReportToReview(interaction, report);

  // تحديث الإينتراكشن للعضو
  const confirmEmbed = embedNeutral('📋 تقرير جديد', `
تم استلام تقرير جديد بنجاح.

> 👤 العضو: <@${interaction.user.id}>
> 🏷 التقرير: ${report.title}
> 📂 النوع: ${reportTypes[report.reportType] || report.reportType}
> 🕒 الوقت: <t:${Math.floor(Date.now() / 1000)}:F>
`)
    .setAuthor({ name: 'نظام التقارير' })
    .setFooter({ text: 'Family System' });

  try {
    await interaction.message.edit({
      embeds: [confirmEmbed],
      components: []
    }).catch(() => interaction.editReply({ embeds: [confirmEmbed], components: [] }));

    setTimeout(async () => {
      try { await interaction.message.delete(); } catch {}
    }, 2500);

  } catch {
    try {
      const response = await interaction.reply({
        embeds: [confirmEmbed],
        flags: MessageFlags.Ephemeral,
        withResponse: true
      });
      const reply = response.resource.message;

      setTimeout(async () => {
        try { await reply.delete(); } catch {}
      }, 2500);

    } catch {}
  }

  // إحذف البيانات المؤقتة من الذاكرة (لكن لا تمسح الملف المحلي هنا، sendReportToReview سيعتني بعملية التنظيف)
  if (reportData.timer) clearTimeout(reportData.timer);
  activeReports.delete(interaction.user.id);
}

async function sendReportToReview(interaction, report) {
  const config = loadConfig();
  const reviewChannel = interaction.guild.channels.cache.get(config.points?.channels?.staffReview?.id || config.points?.channels?.adminReports?.id);
  if (!reviewChannel) {
    console.error('❌ قناة مراجعة التقارير غير موجودة');
    return;
  }

  const { files, tempPaths, attachedFileName } = await resolveReportEvidenceFiles(report, interaction.guild);

  const embed = embedNeutral('📋 تقرير جديد للمراجعة', `**${reportTypes[report.reportType]}**`, [
    { name: '🏷 العنوان', value: report.title },
    { name: '👤 مقدم التقرير', value: `<@${report.reporterId}>`, inline: true },
    { name: '⏳ الحالة', value: 'قيد المراجعة', inline: true },
    { name: '👥 المشاركون', value: report.participants && report.participants.length > 0 ? report.participants.map(id => `<@${id}>`).join(' ') : 'لا يوجد' },
    { name: '🕒 وقت التقديم', value: `<t:${Math.floor(report.createdAt.getTime() / 1000)}:F>` }
  ])
    .setAuthor({ name: 'نظام التقارير', iconURL: interaction.guild.iconURL() })
    .setFooter({ text: `🆔 ${report._id}` });

  // إذا لدينا ملف محلي مرفق، نستخدم attachment://filename لعرض الصورة في الإيمبد
  if (attachedFileName) {
    embed.setImage(`attachment://${attachedFileName}`);
  } else if (report.evidence) {
    // خلاف ذلك نستخدم رابط الصورة إذا كان موجودًا (fallback)
    embed.setImage(report.evidence);
  }

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('accept_report')
        .setLabel('✅ قبول')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('reject_report')
        .setLabel('❌ رفض')
        .setStyle(ButtonStyle.Danger)
    );

  const messageData = {
    content: 'هناك تقرير جديد للمراجعة',
    embeds: [embed],
    components: [buttons]
  };

  // إن نجحنا بتنزيل الملف مؤقتاً، نرسله كمرفق أيضاً (اختياري)
  if (files.length > 0) messageData.files = files;

  const message = await reviewChannel.send(messageData).catch(err => {
    console.error('❌ فشل إرسال التقرير لقناة المراجعة:', err);
    return null;
  });

  if (message) {
    report.reviewChannelId = reviewChannel.id;
    report.reviewMessageId = message.id;
    report._tempLocalPath = undefined;
    report._tempLocalName = undefined;
    await report.save();
  }

  scheduleTempCleanup(tempPaths);
}

async function handleReportAcceptance(interaction) {
  await interaction.deferUpdate().catch(() => {});

  const config = loadConfig();
  const reportsRoles = getCommitteeRoles(config, 'interaction');
  const hasPermission = interaction.member.roles.cache.some(role =>
    reportsRoles.includes(role.id)
  ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

  if (!hasPermission) {
    return interaction.followUp({
      content: '❌ ليس لديك صلاحية لقبول التقارير!',
      flags: MessageFlags.Ephemeral
    });
  }

  const Report = await getReportModel();
  const messageId = interaction.message.id;
  const report = await Report.findOne({ reviewMessageId: messageId });

  if (!report) {
    return interaction.followUp({
      content: '❌ لم يتم العثور على التقرير!',
      flags: MessageFlags.Ephemeral
    });
  }

  if (report.status === 'accepted') {
    return interaction.followUp({
      content: '⚠️ هذا التقرير مقبول مسبقاً.',
      flags: MessageFlags.Ephemeral
    });
  }

  report.status = 'accepted';
  report.reviewedBy = interaction.user.id;
  report.reviewedAt = new Date();

  const reportPoints = getReportPoints();
  const pointsConfig = reportPoints[report.reportType] || { reporter: 0, participants: 0 };
  const DoublePoints = await getDoublePointsModel();
  let doublePoints = await DoublePoints.findOne({ isActive: true, type: 'report' }).catch(() => null);
  if (doublePoints && doublePoints.expiresAt && new Date(doublePoints.expiresAt) < new Date()) {
    doublePoints.isActive = false;
    await doublePoints.save();
    doublePoints = null;
  }
  const multiplier = doublePoints ? 2 : 1;

  report.pointsAwarded = {
    reporter: pointsConfig.reporter * multiplier,
    participants: pointsConfig.participants * multiplier
  };
  report.doublePoints = !!doublePoints;

  await report.save();

  // تحديث الإيمبد: نعيد بناء الحقول ونضمن وجود الصورة باستخدام report.evidence
  const originalEmbed = interaction.message.embeds[0];
  const updatedEmbed = EmbedBuilder.from(originalEmbed);

  try {
    const existingFields = originalEmbed.fields || [];
    const fieldsWithoutStatus = existingFields.filter(f => f.name !== 'الحالة');
    fieldsWithoutStatus.push({ name: 'الحالة', value: '✅ مقبول' });
    fieldsWithoutStatus.push({ name: 'قبل بواسطة', value: interaction.user.tag });
    fieldsWithoutStatus.push({ name: 'وقت القبول', value: `<t:${Math.floor(report.reviewedAt.getTime() / 1000)}:F>` });
    fieldsWithoutStatus.push({ name: 'النقاط', value: `الكاتب: ${report.pointsAwarded.reporter} نقطة\nالمشاركين: ${report.pointsAwarded.participants} نقطة لكل مشارك` });

    updatedEmbed.setFields(fieldsWithoutStatus);
    updatedEmbed.setColor('#00ff00');

    // ضع دائماً الصورة من رابط الدليل إذا كان موجوداً — هذا يغطي الحالة التي أُرسلت بها كـ URL.
    if (report.evidence) updatedEmbed.setImage(report.evidence);
  } catch (err) {
    console.error('⚠️ فشل تحديث الحقول في الإيمبد الأصلي:', err);
  }

  await interaction.message.edit({
    embeds: [updatedEmbed],
    components: []
  }).catch(err => console.error('⚠️ فشل تحديث رسالة المراجعة:', err.message));

  const awardResults = await awardPoints(interaction, report);
  await sendReportToLogChannel(interaction, report, awardResults);
  const reportsCmd = await getReportsCmd();
  reportsCmd.scheduleReportsDashboardUpdate(interaction.client);
}

async function awardPoints(interaction, report) {
  const results = [];
  const Member = await getMemberModel();
  const PointLog = await getPointLogModel();

  try {
    const { pointsAwarded } = report;
    const doublePointsActive = report.doublePoints;

    const skippedMembers = [];

    // منح النقاط لصاحب التقرير
    const reporterMember = await Member.findOne({ discordId: report.reporterId });
    if (reporterMember) {
      const oldPoints = reporterMember.points || 0;
      reporterMember.points = oldPoints + pointsAwarded.reporter;
      await reporterMember.save();

      await PointLog.create({
        discordId: report.reporterId,
        memberRef: reporterMember._id,
        points: pointsAwarded.reporter,
        reason: `تقرير مقبول: ${reportTypes[report.reportType]} ${doublePointsActive ? '(ضعف نقاط)' : ''}`,
        actionBy: interaction.user.id
      });

      results.push({
        userId: report.reporterId,
        name: report.reporterName,
        oldPoints,
        newPoints: reporterMember.points,
        pointsAwarded: pointsAwarded.reporter,
        reason: 'كاتب التقرير'
      });
    } else {
      skippedMembers.push(`الكاتب <@${report.reporterId}> (غير مسجل في النظام)`);
    }

    // منح النقاط للمشاركين
    for (const participantId of report.participants) {
      const participantMember = await Member.findOne({ discordId: participantId });
      if (participantMember) {
        const oldPoints = participantMember.points || 0;
        participantMember.points = oldPoints + pointsAwarded.participants;
        await participantMember.save();

        await PointLog.create({
          discordId: participantId,
          memberRef: participantMember._id,
          points: pointsAwarded.participants,
          reason: `مشاركة في تقرير: ${reportTypes[report.reportType]} ${doublePointsActive ? '(ضعف نقاط)' : ''}`,
          actionBy: interaction.user.id
        });

        const participantUser = await interaction.client.users.fetch(participantId).catch(() => null);
        results.push({
          userId: participantId,
          name: participantUser?.tag || participantId,
          oldPoints,
          newPoints: participantMember.points,
          pointsAwarded: pointsAwarded.participants,
          reason: 'مشارك في التقرير'
        });
      } else {
        skippedMembers.push(`المشارك <@${participantId}> (غير مسجل في النظام)`);
      }
    }

    if (skippedMembers.length > 0) {
      await interaction.followUp({
        content: `⚠️ **تنبيه:** الأعضاء التاليين لم يستلموا نقاط لأنهم غير مسجلين في النظام:\n${skippedMembers.join('\n')}`,
        flags: MessageFlags.Ephemeral
      });
    }

    await sendNotifications(interaction, report);
  } catch (error) {
    console.error('❌ خطأ في منح النقاط:', error);
  }

  return results;
}

async function sendNotifications(interaction, report) {
  try {
    const reporter = await interaction.client.users.fetch(report.reporterId).catch(() => null);
    if (reporter) {
      const basePoints = report.doublePoints ? report.pointsAwarded.reporter / 2 : report.pointsAwarded.reporter;
      const pointsLabel = report.doublePoints
        ? `${basePoints} ← ${report.pointsAwarded.reporter} نقطة (ضعف)`
        : `${report.pointsAwarded.reporter} نقطة`;

      const fields = [
        { name: 'النقاط الممنوحة', value: pointsLabel },
        { name: 'نوع التقرير', value: reportTypes[report.reportType] },
        { name: 'بواسطة', value: interaction.user.tag }
      ];

      const dmEmbed = embedSuccess('✅ تم قبول تقريرك', `تم قبول تقريرك "${report.title}"`, fields);

      if (report.evidence) dmEmbed.setImage(report.evidence);

      await dmUser(reporter, dmEmbed);
    }
  } catch (error) {
    console.error('❌ فشل إرسال DM للكاتب (عام):', error);
  }

  for (const participantId of report.participants) {
    try {
      const participant = await interaction.client.users.fetch(participantId).catch(() => null);
      if (participant) {
        const basePoints = report.doublePoints ? report.pointsAwarded.participants / 2 : report.pointsAwarded.participants;
        const pointsLabel = report.doublePoints
          ? `${basePoints} ← ${report.pointsAwarded.participants} نقطة (ضعف)`
          : `${report.pointsAwarded.participants} نقطة`;

        const pFields = [
          { name: 'النقاط الممنوحة', value: pointsLabel },
          { name: 'نوع التقرير', value: reportTypes[report.reportType] }
        ];

        const participantEmbed = embedSuccess('✅ تم قبول تقرير شاركت فيه', `تم قبول التقرير "${report.title}" الذي شاركت فيه`, pFields);

        if (report.evidence) participantEmbed.setImage(report.evidence);

        await dmUser(participant, participantEmbed);
      }
    } catch (error) {
      console.error(`❌ فشل إرسال DM للمشارك ${participantId} (عام):`, error);
    }
  }
}

async function sendReportToLogChannel(interaction, report, awardResults) {
  const config = loadConfig();
  const reportLogChannelId = config.points?.channels?.reportLog?.id || config.general?.channels?.logChannel?.id;
  if (reportLogChannelId) {
    const reportLogChannel = await interaction.guild.channels.fetch(reportLogChannelId).catch(() => null);
    if (reportLogChannel) {
      const { files, tempPaths, attachedFileName } = await resolveReportEvidenceFiles(report, interaction.guild);

      const baseReporter = report.doublePoints ? report.pointsAwarded.reporter / 2 : report.pointsAwarded.reporter;
      const baseParticipants = report.doublePoints ? report.pointsAwarded.participants / 2 : report.pointsAwarded.participants;
      const pointsLabel = report.doublePoints
        ? `الكاتب: ${baseReporter} ← ${report.pointsAwarded.reporter} (ضعف)\nالمشاركين: ${baseParticipants} ← ${report.pointsAwarded.participants} (ضعف)`
        : `الكاتب: ${report.pointsAwarded.reporter}\nالمشاركين: ${report.pointsAwarded.participants}`;

      const reportTypeName = reportTypes[report.reportType] || report.reportType || 'غير معروف';
      const fields = [
        { name: 'نوع التقرير', value: reportTypeName },
        { name: 'العنوان', value: report.title },
        { name: 'صاحب التقرير', value: `<@${report.reporterId}>`, inline: true },
        { name: 'قبل بواسطة', value: interaction.user.tag, inline: true },
        { name: 'النقاط الممنوحة', value: pointsLabel, inline: false },
      ];

      const logEmbed = embedSuccess('📋 تقرير مقبول', null, fields);
      if (attachedFileName) logEmbed.setImage(`attachment://${attachedFileName}`);
      else if (report.evidence) logEmbed.setImage(report.evidence);

      await reportLogChannel.send({ embeds: [logEmbed], files: files.length > 0 ? files : [] }).catch(err => console.error('❌ فشل إرسال التقرير للوغ:', err.message));
      scheduleTempCleanup(tempPaths);
    }
  }

  // إرسال تفاصيل النقاط إلى logs
  if (awardResults && awardResults.length > 0) {
    for (const r of awardResults) {
      await logPoints(interaction.guild, {
        target: `<@${r.userId}>`,
        mod: interaction.user,
        points: r.pointsAwarded,
        before: r.oldPoints,
        after: r.newPoints,
        reason: `تقرير تفاعل: ${reportTypes[report.reportType]}${report.doublePoints ? ` (الضعف: ${r.pointsAwarded / 2} ← ${r.pointsAwarded})` : ''}`,
      });
    }
  }
}

async function handleReportRejection(interaction) {
  const config = loadConfig();
  const reportsRoles = getCommitteeRoles(config, 'interaction');
  const hasPermission = interaction.member.roles.cache.some(role =>
    reportsRoles.includes(role.id)
  ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

  if (!hasPermission) {
    return interaction.reply({
      content: '❌ ليس لديك صلاحية لرفض التقارير!',
      flags: MessageFlags.Ephemeral
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`reject_modal_${interaction.message.id}`)
    .setTitle('سبب رفض التقرير');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reject_reason')
    .setLabel('سبب الرفض')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('يرجى كتابة سبب الرفض...')
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  const actionRow = new ActionRowBuilder().addComponents(reasonInput);
  modal.addComponents(actionRow);

  await interaction.showModal(modal).catch(() => {});
}

async function handleRejectionModal(interaction) {
  const reason = interaction.fields.getTextInputValue('reject_reason');
  const messageId = interaction.customId.replace('reject_modal_', '');

  const Report = await getReportModel();
  const report = await Report.findOne({ reviewMessageId: messageId });

  if (!report) {
    return interaction.reply({
      content: '❌ لم يتم العثور على التقرير!',
      flags: MessageFlags.Ephemeral
    });
  }

  report.status = 'rejected';
  report.reviewedBy = interaction.user.id;
  report.reviewedAt = new Date();
  report.reviewReason = reason;
  await report.save();

  const originalMessage = await interaction.channel.messages.fetch(messageId).catch(() => null);
  if (originalMessage) {
    const originalEmbed = originalMessage.embeds[0];
    const updatedEmbed = EmbedBuilder.from(originalEmbed);

    const existingFields = originalEmbed?.fields || [];
    const fieldsWithoutStatus = existingFields.filter(f => f.name !== 'الحالة');
    fieldsWithoutStatus.push({ name: 'الحالة', value: '❌ مرفوض' });
    fieldsWithoutStatus.push({ name: 'سبب الرفض', value: reason });
    fieldsWithoutStatus.push({ name: 'رفض بواسطة', value: interaction.user.tag });
    fieldsWithoutStatus.push({ name: 'وقت الرفض', value: `<t:${Math.floor(report.reviewedAt.getTime() / 1000)}:F>` });

    updatedEmbed.setFields(fieldsWithoutStatus);
    updatedEmbed.setColor('#ff0000');

    if (report.evidence) updatedEmbed.setImage(report.evidence);

    await originalMessage.edit({
      embeds: [updatedEmbed],
      components: []
    }).catch(() => { });
  }

  await sendRejectionNotification(interaction, report, reason);

  const rejectEmbed = embedNeutral('❌ رفض التقرير', `تم رفض التقرير "${report.title}" وإرسال إشعار لصاحبه.`, [{ name: 'السبب', value: reason }])
    .setAuthor({ name: 'نظام التقارير' })
    .setFooter({ text: 'Family System' });
  await interaction.reply({ embeds: [rejectEmbed], flags: MessageFlags.Ephemeral });
}

async function sendRejectionNotification(interaction, report, reason) {
  try {
    const reporter = await interaction.client.users.fetch(report.reporterId).catch(() => null);
    if (reporter) {
      const fields = [
        { name: 'سبب الرفض', value: reason },
        { name: 'نوع التقرير', value: reportTypes[report.reportType] },
        { name: 'بواسطة', value: interaction.user.tag }
      ];

      const dmEmbed = embedError('❌ تم رفض تقريرك', `تم رفض تقريرك "${report.title}"`, fields);

      if (report.evidence) dmEmbed.setImage(report.evidence);

      await dmUser(reporter, dmEmbed);
    }
  } catch (error) {
    console.error('❌ فشل إرسال إشعار الرفض:', error);
  }
}

async function handleReportEdit(interaction) {
  const reportData = activeReports.get(interaction.user.id);
  if (reportData) {
    activeReports.delete(interaction.user.id);
  }

  try {
    const response = await interaction.update({
      content: '❌ تم إلغاء التقرير الحالي. يمكنك البدء من جديد باستخدام القائمة المنسدلة.',
      embeds: [],
      components: [],
      withResponse: true
    });
    const reply = response.resource.message;

    // حذف الرسالة بعد 5 ثواني
    setTimeout(() => {
      reply.delete().catch(() => {
        // تجاهل الخطأ إذا كانت الرسالة محذوفة بالفعل
      });
    }, 5000);
  } catch {
    try {
      await interaction.reply({ content: '❌ تم إلغاء التقرير الحالي. يمكنك البدء من جديد.', flags: MessageFlags.Ephemeral });
    } catch { }
  }
}

// ===== معالجة رسائل الخطوات =====

export async function handleMessage(message) {
  if (message.author.bot) return;

  const reportData = activeReports.get(message.author.id);
  if (!reportData) return;

  // Channel Restriction
  if (message.channelId !== reportData.channelId) return;

  // Reset Timer
  resetInactivityTimer(message.author.id, message.channel);

  // دعم إلغاء التقرير
  if (message.content.trim() === 'إلغاء' || message.content.trim().toLowerCase() === 'cancel') {
    activeReports.delete(message.author.id);
    await deleteMessages(message.channel, reportData.messages);
    const msg = await message.reply('❌ تم إلغاء إنشاء التقرير بنجاح.');
    setTimeout(() => {
      msg.delete().catch(() => { });
      message.delete().catch(() => { });
    }, 3000);
    return;
  }

  try {
    switch (reportData.stage) {
      case 'title':
        await handleTitleStage(message, reportData);
        break;
      case 'participants_input':
        await handleParticipantsStage(message, reportData);
        break;
      case 'evidence':
        await handleEvidenceStage(message, reportData);
        break;
      default:
        console.warn(`Unknown stage for user ${message.author.id}: ${reportData.stage}`);
        activeReports.delete(message.author.id);
    }
  } catch (error) {
    console.error('❌ خطأ في معالجة رسالة التقرير:', error);
    activeReports.delete(message.author.id);
  }
}

async function handleTitleStage(message, reportData) {
  if (!message.content || message.content.length < 5 || message.content.length > 100) {
    const warningMsg = await message.reply({ content: '❌ العنوان يجب أن يكون بين 5 و 100 حرف!', flags: MessageFlags.Ephemeral });
    setTimeout(() => {
      warningMsg?.delete?.().catch(() => { });
      message.delete().catch(() => { });
    }, 3000);
    return;
  }

  reportData.title = message.content;
  reportData.stage = 'participants_input';

  await message.delete().catch(() => { });

  const embed = embedNeutral('📝 المرحلة 2/4: المشاركون', `العنوان: **${message.content}**\n\nهل يوجد مشاركون معك في هذا النشاط؟`, [
    { name: '✅ نعم', value: 'ستظهر قائمة لإدخال أيدياتهم' },
    { name: '❌ لا', value: 'سيتم الانتقال إلى دليل التقرير' }
  ]).setAuthor({ name: 'نظام التقارير' });

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('yes_participants')
        .setLabel('✅ نعم')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('no_participants')
        .setLabel('❌ لا')
        .setStyle(ButtonStyle.Danger)
    );

  const botMessage = await message.channel.send({
    embeds: [embed],
    components: [buttons]
  });

  reportData.messages.push(botMessage.id);
}

async function handleParticipantsStage(message, reportData) {
  const ids = message.content.match(/\d{17,19}/g) || [];

  if (ids.length === 0) {
    const warningMsg = await message.reply({ content: '❌ لم يتم العثور على أي ايدي صالح! يرجى إرسال ايدي أو منشن المشاركين.', flags: MessageFlags.Ephemeral });
    setTimeout(() => {
      warningMsg?.delete?.().catch(() => { });
      message.delete().catch(() => { });
    }, 3000);
    return;
  }

  reportData.participants = ids;
  reportData.stage = 'evidence';

  await message.delete().catch(() => { });

  const evidenceEmbed = embedNeutral('🖼️ المرحلة 4/4: دليل التقرير', 'ارسل **صورة واحدة** كدليل لإثبات النشاط.', [
    { name: 'المشاركون', value: ids.map(id => `<@${id}>`).join(' ') || 'لا يوجد' },
    { name: 'ملاحظة', value: 'تأكد من وضوح الصورة وظهور تفاصيل النشاط فيها.' }
  ]).setAuthor({ name: 'نظام التقارير' });

  const botMessage = await message.channel.send({
    embeds: [evidenceEmbed]
  });

  reportData.messages.push(botMessage.id);
}

async function handleEvidenceStage(message, reportData) {
  if (message.attachments.size === 0) {
    const warningMsg = await message.reply({ content: '❌ يرجى إرسال صورة واحدة كدليل!', flags: MessageFlags.Ephemeral });
    setTimeout(() => {
      warningMsg?.delete?.().catch(() => { });
      message.delete().catch(() => { });
    }, 3000);
    return;
  }

  const attachment = message.attachments.first();
  if (!attachment.contentType?.startsWith('image/')) {
    const warningMsg = await message.reply({ content: '❌ الملف يجب أن يكون صورة!', flags: MessageFlags.Ephemeral });
    setTimeout(() => {
      warningMsg?.delete?.().catch(() => { });
      message.delete().catch(() => { });
    }, 3000);
    return;
  }

  // خزن رابط الصورة فوراً
  reportData.evidence = attachment.url;
  reportData._tempPreview = null;

  // حاول تنزيل نسخة مؤقتة **قبل** حذف رسالة المستخدم (حتى لا نحصل على 404 بسبب صلاحية الرابط المؤقت)
  try {
    const tempFile = await downloadImage(reportData.evidence).catch(err => {
      console.log('⚠️ فشل تنزيل الصورة أثناء handleEvidenceStage:', err.message);
      return null;
    });
    if (tempFile) {
      const attachedFileName = `preview_${Date.now()}.jpg`;
      reportData._tempPreview = { path: tempFile, name: attachedFileName };
    }
  } catch (err) {
    console.log('⚠️ خطأ غير متوقع أثناء تنزيل الصورة:', err.message);
    reportData._tempPreview = null;
  }

  // حذف جميع الرسائل السابقة (لا نحذف رسالة المستخدم قبل التنزيل)
  try {
    await deleteMessages(message.channel, reportData.messages);
  } catch (error) {
    console.log('⚠️ فشل حذف بعض الرسائل:', error);
  }

  // احذف رسالة المستخدم بعد محاولة التنزيل
  await message.delete().catch(() => { });

  // عرض معاينة التقرير مع الصورة
  await showReportPreview(message, reportData);
}

async function showReportPreview(message, reportData) {
  // محاولة تحميل الصورة كملف (اختياري) — لكن إن كنت نزلت مسبقًا استخدم ذلك الملف
  let files = [];
  const tempPaths = [];
  let attachedFileName = null;

  try {
    if (reportData._tempPreview && reportData._tempPreview.path) {
      attachedFileName = reportData._tempPreview.name;
      const attachment = new AttachmentBuilder(reportData._tempPreview.path, { name: attachedFileName });
      files.push(attachment);
      tempPaths.push(reportData._tempPreview.path);
    } else if (reportData.evidence && reportData.evidence.startsWith('http')) {
      // محاولة تنزيل للمرة الثانية كخيار احتياطي (عند فشل المرة الأولى)
      try {
        const tempFile = await downloadImage(reportData.evidence);
        attachedFileName = `preview_${Date.now()}.jpg`;
        const attachment = new AttachmentBuilder(tempFile, { name: attachedFileName });
        files.push(attachment);
        tempPaths.push(tempFile);
      } catch (err) {
        console.log('⚠️ فشل تحميل الصورة للمعاينة:', err.message);
      }
    }
  } catch (error) {
    console.log('⚠️ فشل تحميل الصورة للمعاينة:', error.message);
  }

  const embed = embedNeutral('📄 معاينة التقرير', 'يرجى مراجعة بيانات التقرير قبل الإرسال.', [
    { name: '📂 النوع', value: reportTypes[reportData.type], inline: true },
    { name: '👤 مقدم التقرير', value: `<@${message.author.id}>`, inline: true },
    { name: '🏷 العنوان', value: reportData.title },
    { name: '👥 المشاركون', value: reportData.participants?.length > 0 ? reportData.participants.map(id => `<@${id}>`).join(' ') : 'لا يوجد' },
    { name: '🕒 الوقت', value: `<t:${Math.floor(Date.now() / 1000)}:F>` }
  ])
    .setAuthor({ name: 'نظام التقارير' })
    .setFooter({ text: 'سيتم إرسال التقرير للإدارة بعد تأكيدك' });

  // إذا أرفقنا ملفًا للمعاينة، نستخدم attachment://filename
  if (attachedFileName) {
    embed.setImage(`attachment://${attachedFileName}`);
  } else if (reportData.evidence) {
    embed.setImage(reportData.evidence);
  }

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('submit_report')
        .setLabel('✅ إرسال التقرير')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('edit_report')
        .setLabel('✏️ تعديل')
        .setStyle(ButtonStyle.Secondary)
    );

  const messageData = {
    content: `<@${message.author.id}>`,
    embeds: [embed],
    components: [buttons]
  };

  if (files.length > 0) messageData.files = files;

  const previewMessage = await message.channel.send(messageData);

  reportData.messages = [previewMessage.id];
}

const reportHandler = {
  handleInteraction,
  handleMessage,
  activeReports
};

export default reportHandler;

// فحص وانتهاء صلاحية DoublePoints تلقائياً عند بدء التشغيل
(async function checkExpiredDoublePoints() {
  try {
    const DoublePoints = await getDoublePointsModel();
    const expired = await DoublePoints.find({ isActive: true, expiresAt: { $lt: new Date() } }).catch(() => []);
    for (const dp of expired) {
      dp.isActive = false;
      await dp.save();
      console.log(`[DoublePoints] انتهت صلاحية ${dp.type} تلقائياً عند بدء التشغيل`);
    }
  } catch (e) {
    console.error('[DoublePoints] فشل فحص الصلاحية عند بدء التشغيل:', e.message);
  }
})();

// فحص دوري كل دقيقة
setInterval(async () => {
  try {
    const DoublePoints = await getDoublePointsModel();
    const expired = await DoublePoints.find({ isActive: true, expiresAt: { $lt: new Date() } }).catch(() => []);
    for (const dp of expired) {
      dp.isActive = false;
      await dp.save();
      console.log(`[DoublePoints] انتهت صلاحية ${dp.type} تلقائياً (دوري)`);
    }
  } catch (e) {
    console.error('[DoublePoints] فشل فحص الصلاحية الدوري:', e.message);
  }
}, 60000); // كل دقيقة

// ===== دالة تسجيل المستمعين (تم تعطيلها لصالح التوجيه المركزي في index.js) =====
export function registerReportHandlers(client, cfg = {}) {
  console.log('📌 reportHandler: central routing enabled (via index.js)');
}
