import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import Attendance from '../models/Attendance.js';
import AttendanceLog from '../models/AttendanceLog.js';
import Member from '../models/Member.js';
import PointLog from '../models/PointLog.js';
import DoublePoints from '../models/DoublePoints.js';
import { assessMemberStatus } from './interactionMonitor.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, neutral as embedNeutral, custom as embedCustom, gold as embedGold } from './embedStyles.js';
import { dmUser } from './notificationSystem.js';
import { logAttendance } from './logSystem.js';
import PersistentMessage from '../models/PersistentMessage.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const configPath = join(__dirname, '../config.json');

function loadConfig() {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  try {
    const committeeDataPath = join(__dirname, '../.data/Committees.json');
    if (existsSync(committeeDataPath)) {
      const committeeList = JSON.parse(readFileSync(committeeDataPath, 'utf8'));
      if (committeeList && Object.keys(committeeList).length > 0) {
        config.committees = config.committees || {};
        const merged = {};
        for (const key of Object.keys(config.committees.list || {})) {
          merged[key] = { ...config.committees.list[key] };
        }
        for (const [key, data] of Object.entries(committeeList)) {
          if (merged[key]) Object.assign(merged[key], data);
          else merged[key] = data;
        }
        config.committees.list = merged;
      }
    }
  } catch {}
  return config;
}

function getIntervalConfig() {
  const cfg = loadConfig();
  return {
    pointsPerInterval: cfg.attendance?.pointsPerInterval ?? 5,
    intervalMinutes: cfg.attendance?.intervalMinutes ?? 10,
  };
}

const userLocks = new Map();
const voiceTimers = new Map();

function acquireLock(userId) {
  if (userLocks.get(userId)) return false;
  userLocks.set(userId, true);
  return true;
}

function releaseLock(userId) {
  userLocks.delete(userId);
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const s = Math.floor((minutes - Math.floor(minutes)) * 60);
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function calcEarnedPoints(minutes, hasMultiplier) {
  const { pointsPerInterval, intervalMinutes } = getIntervalConfig();
  const intervals = Math.floor(minutes / intervalMinutes);
  let points = intervals * pointsPerInterval;
  if (hasMultiplier) points *= 2;
  return points;
}

function calcEarnedMinutes(minutes, hasMultiplier) {
  return hasMultiplier ? minutes * 2 : minutes;
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h > 0 && m > 0) return `${h} ساعة و ${m} دقيقة`;
  if (h > 0) return `${h} ساعة`;
  return `${m} دقيقة`;
}

// التحقق من تفعيل ضعف النقاط العام للاحتلال
async function getAttendanceDoublePointsDoc() {
  let doc = await DoublePoints.findOne({ type: 'attendance' });
  if (!doc) {
    doc = new DoublePoints({ type: 'attendance', isActive: false });
    await doc.save();
  }
  return doc;
}

async function isGlobalAttendanceDoubleActive() {
  const doc = await getAttendanceDoublePointsDoc();
  if (!doc.isActive) return false;
  if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
    doc.isActive = false;
    await doc.save();
    return false;
  }
  return true;
}

async function getOrCreateAttendance(userId, userName) {
  let record = await Attendance.findOne({ userId });
  if (!record) {
    record = await Attendance.create({
      userId,
      userName,
      totalMinutes: 0,
      totalPoints: 0,
      totalSessions: 0,
      multiplier: false,
      isLoggedIn: false,
      currentSessionStart: null,
      lastLogin: null,
      lastLogout: null,
    });
  } else if (record.userName !== userName) {
    record.userName = userName;
    await record.save();
  }
  return record;
}

async function getActiveSessions() {
  const all = await Attendance.find();
  return all.filter(a => a.isLoggedIn);
}

async function sendActivityLog(guild, color, title, fields) {
  const config = loadConfig();
  const channelId = config.attendance?.feedChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  const embed = embedCustom(color, title, null, fields);
  let mention = '';
  for (const f of fields) {
    const val = f.value || '';
    if (val.startsWith('<@')) {
      mention = val.split(' ')[0];
      break;
    }
  }
  await channel.send({ content: mention, embeds: [embed] }).catch(e => console.error('[Attendance]', e?.message));
}

async function sendAdminLog(guild, color, title, fields) {
  const config = loadConfig();
  const channelId = config.attendance?.adminLogChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  const embed = embedCustom(color, title, null, fields);
  await channel.send({ embeds: [embed] }).catch(e => console.error('[Attendance]', e?.message));
}

async function sendPointsLog(guild, color, title, fields) {
  const config = loadConfig();
  const channelId = config.logChannels?.points?.id;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  const embed = embedCustom(color, title, null, fields);
  await channel.send({ embeds: [embed] }).catch(e => console.error('[Attendance]', e?.message));
}

function isAdmin(interaction) {
  const config = loadConfig();
  const userId = interaction.user.id;
  if ((config.committees?.founders || []).includes(userId)) return true;
  if ((config.committees?.authorizedUsers || []).includes(userId)) return true;
  const member = interaction.member;
  if (!member) return false;
  const committeeKeys = ['interaction', 'punishment', 'family_presidency'];
  for (const key of committeeKeys) {
    const committee = config.committees?.list?.[key];
    if (!committee) continue;
    const allRoles = [
      ...(committee.roles?.manager || []),
      ...(committee.roles?.deputy || []),
      ...(committee.roles?.member || []),
    ];
    if (allRoles.includes(userId)) return true;
    if (member.roles.cache.some(r => allRoles.includes(r.id))) return true;
  }
  return false;
}

function isInVoiceChannel(guild, userId) {
  const config = loadConfig();
  const vcIds = config.attendance?.voiceChannelIds || [];
  if (vcIds.length === 0) return true;
  const member = guild.members.cache.get(userId);
  if (!member) return false;
  return vcIds.includes(member.voice?.channelId);
}

function cleanupVoiceTimer(userId) {
  if (voiceTimers.has(userId)) {
    const timers = voiceTimers.get(userId);
    clearTimeout(timers.warningTimer);
    clearTimeout(timers.forceLogoutTimer);
    voiceTimers.delete(userId);
  }
}

export async function handleVoiceStateUpdate(oldState, newState) {
  const userId = newState.id || oldState.id;
  if (newState.user?.bot || oldState.user?.bot) return;

  const config = loadConfig();
  const vcIds = config.attendance?.voiceChannelIds || [];
  if (vcIds.length === 0) return;

  const record = await Attendance.findOne({ userId });
  if (!record || !record.isLoggedIn) return;

  const stillInVc = vcIds.includes(newState.channelId);

  if (stillInVc) {
    cleanupVoiceTimer(userId);
    return;
  }

  if (voiceTimers.has(userId)) return;

  const graceMinutes = config.attendance?.voiceGracePeriodMinutes || 10;
  const graceMs = graceMinutes * 60 * 1000;
  const vcMentions = vcIds.map(id => `<#${id}>`).join(', ');
  const warningChannelId = config.attendance?.voiceWarningChannelId;

  const warningTimer = setTimeout(async () => {
    if (warningChannelId && newState.guild) {
      const warnChannel = await newState.guild.channels.fetch(warningChannelId).catch(() => null);
      if (warnChannel) {
        const warnEmbed = embedWarning('⚠️ تحذير الخروج من روم الاحتلال', `<@${userId}>، لقد غادرت روم الصوت المخصص للاحتلال!\n\n⏳ أمامك **${graceMinutes} دقائق** للعودة إلى أحد الرومات التالية:\n${vcMentions}\n\n❌ إذا لم تعد خلال ${graceMinutes} دقائق، سيتم تسجيل خروجك إجبارياً.`);
        await warnChannel.send({ content: `<@${userId}>`, embeds: [warnEmbed] }).catch(e => console.error('[Attendance]', e?.message));
      }
    }
  }, 60 * 1000);

      const forceLogoutTimer = setTimeout(async () => {
    try {
      voiceTimers.delete(userId);
      const rec = await Attendance.findOne({ userId });
      if (!rec || !rec.isLoggedIn) return;
      if (vcIds.includes(newState.guild?.members.cache.get(userId)?.voice?.channelId)) return;

      const now = new Date();
      const sessionMs = now.getTime() - new Date(rec.currentSessionStart).getTime();
      const sessionMinutes = sessionMs / 60000;
      const minMins = config.attendance?.minSessionMinutes ?? 0;
      const belowMin = minMins > 0 && sessionMinutes < minMins;
      const hasMultiplier = rec.multiplier;
      const globalDouble = await isGlobalAttendanceDoubleActive();
      const earnedMinutes = belowMin ? 0 : calcEarnedMinutes(sessionMinutes, hasMultiplier) * (globalDouble ? 2 : 1);
      const earnedPoints = belowMin ? 0 : calcEarnedPoints(sessionMinutes, hasMultiplier) * (globalDouble ? 2 : 1);

      rec.totalMinutes += earnedMinutes;
      rec.totalPoints += earnedPoints;
      rec.totalSessions += 1;
      rec.isLoggedIn = false;
      rec.currentSessionStart = null;
      rec.lastLogout = now;
      await rec.save();

      if (earnedPoints > 0) {
        const member = await Member.findOne({ discordId: userId });
        if (member && member.isActive) {
          member.points = (member.points || 0) + earnedPoints;
          member.lastUserActivity = new Date();
          await member.save();
          if (newState.guild) await assessMemberStatus(newState.guild.client, newState.guild, userId);
        }
      }

      await AttendanceLog.create({
        type: 'system',
        userId,
        userName: rec.userName,
        details: {
          action: 'voice_timeout',
          reason: 'عدم التواجد في روم الصوت',
          sessionMinutes,
          earnedPoints,
        },
        timestamp: now,
      });

      if (newState.guild) {
        const guild = newState.guild;
        const logChannelId = config.attendance?.adminLogChannelId;
        if (logChannelId) {
          const channel = await guild.channels.fetch(logChannelId).catch(() => null);
          if (channel) {
            const doubleTag = globalDouble ? ' 🎯ضعف' : '';
            const embed = embedError('⏹️ تسجيل خروج إجباري (عدم تواجد في الروم الصوتي)', null, [
              { name: 'العضو', value: `<@${userId}>`, inline: true },
              { name: 'المدة', value: formatMinutes(sessionMinutes), inline: true },
              { name: 'النقاط', value: `${earnedPoints}${doubleTag}`, inline: true },
            ]);
            await channel.send({ embeds: [embed] }).catch(e => console.error('[Attendance]', e?.message));
          }
        }

        // إرسال إلى قناة النشاط (تسجيل الدخول/الخروج)
        const doubleTagAct = globalDouble ? ' 🎯ضعف' : '';
        await sendActivityLog(guild, 0xFF0000, '⏹️ خروج (مغادرة الروم)', [
          { name: 'العضو', value: `<@${userId}>`, inline: true },
          { name: '⏱ المدة', value: formatMinutes(sessionMinutes), inline: true },
          { name: '⭐ النقاط', value: `${earnedPoints}${doubleTagAct}`, inline: true },
        ]);

        await updateAttendancePanel(guild);
      }
    } catch (e) {
      console.error('[Voice Timeout]', e);
    }
  }, graceMs);

  voiceTimers.set(userId, { warningTimer, forceLogoutTimer });
}

export async function handleAttendanceLogin(interaction) {
  const userId = interaction.user.id;
  const userName = interaction.user.username;

  if (!acquireLock(userId)) {
    return interaction.reply({ content: '⏳ يتم معالجة طلب سابق، انتظر قليلاً.', flags: MessageFlags.Ephemeral });
  }

  try {
    const config_local = loadConfig();
    const vcIds = config_local.attendance?.voiceChannelIds || [];
    if (vcIds.length > 0 && !isInVoiceChannel(interaction.guild, userId)) {
      releaseLock(userId);
      return interaction.reply({ content: `❌ يجب أن تكون في روم صوتي مخصص للاحتلال أولاً!\nالرومات المتاحة: ${vcIds.map(id => `<#${id}>`).join(', ')}`, flags: MessageFlags.Ephemeral });
    }

    const record = await getOrCreateAttendance(userId, userName);
    if (record.isLoggedIn) {
      return interaction.reply({ content: '❌ أنت مسجل دخول بالفعل!', flags: MessageFlags.Ephemeral });
    }

    record.isLoggedIn = true;
    record.currentSessionStart = new Date();
    record.lastLogin = new Date();
    await record.save();

    await AttendanceLog.create({
      type: 'login',
      userId,
      userName,
      details: { loginTime: record.lastLogin.toISOString() },
      timestamp: new Date(),
    });

    await logAttendance(interaction.guild, {
      target: { id: userId },
      mod: interaction.user,
      date: new Date().toLocaleDateString('ar-IQ'),
      status: '✅ تسجيل دخول',
      details: `الوقت: <t:${Math.floor(record.lastLogin.getTime() / 1000)}:R>`,
    });

    await sendActivityLog(interaction.guild, 0x00FF00, '✅ تسجيل دخول', [
      { name: 'العضو', value: `<@${userId}>`, inline: true },
      { name: 'الوقت', value: `<t:${Math.floor(record.lastLogin.getTime() / 1000)}:R>`, inline: true },
    ]);

    await updateAttendancePanel(interaction.guild);
    await interaction.reply({ content: `✅ <@${userId}> تم تسجيل دخولك بنجاح.`, flags: MessageFlags.Ephemeral });
  } finally {
    releaseLock(userId);
  }
}

export async function handleAttendanceLogout(interaction) {
  const userId = interaction.user.id;
  const userName = interaction.user.username;

  if (!acquireLock(userId)) {
    return interaction.reply({ content: '⏳ يتم معالجة طلب سابق، انتظر قليلاً.', flags: MessageFlags.Ephemeral });
  }

  try {
    const record = await getOrCreateAttendance(userId, userName);
    if (!record.isLoggedIn) {
      return interaction.reply({ content: '❌ أنت غير مسجل دخول.', flags: MessageFlags.Ephemeral });
    }

    const now = new Date();
    const sessionMs = now.getTime() - new Date(record.currentSessionStart).getTime();
    const sessionMinutes = sessionMs / 60000;

    const config = loadConfig();
    const minMinutes = config.attendance?.minSessionMinutes ?? 0;
    const isBelowMinimum = minMinutes > 0 && sessionMinutes < minMinutes;

    const hasMultiplier = record.multiplier;
    const globalDouble = await isGlobalAttendanceDoubleActive();
    const earnedMinutes = isBelowMinimum ? 0 : calcEarnedMinutes(sessionMinutes, hasMultiplier) * (globalDouble ? 2 : 1);
    const earnedPoints = isBelowMinimum ? 0 : calcEarnedPoints(sessionMinutes, hasMultiplier) * (globalDouble ? 2 : 1);

    record.totalMinutes += earnedMinutes;
    record.totalPoints += earnedPoints;
    record.totalSessions += 1;
    record.isLoggedIn = false;
    record.currentSessionStart = null;
    record.lastLogout = now;
    await record.save();

    const member = await Member.findOne({ discordId: userId });
    if (member && member.isActive) {
      member.points = (member.points || 0) + earnedPoints;
      if (earnedPoints > 0) member.lastUserActivity = new Date();
      await member.save();
    }

    await PointLog.create({
      discordId: userId,
      memberRef: member?._id || null,
      points: earnedPoints,
      reason: `جلسة تسجيل ساعات (${formatMinutes(sessionMinutes)}${hasMultiplier ? ' ×2' : ''}${globalDouble ? ' 🎯ضعف' : ''})${isBelowMinimum ? ' - أقل من الحد الأدنى' : ''}`,
      actionBy: 'system_attendance',
    });

    await AttendanceLog.create({
      type: 'logout',
      userId,
      userName,
      details: {
        sessionMinutes,
        earnedMinutes,
        earnedPoints,
        hasMultiplier,
        loginTime: record.lastLogin?.toISOString(),
        logoutTime: now.toISOString(),
      },
      timestamp: now,
    });

    await logAttendance(interaction.guild, {
      target: { id: userId },
      mod: interaction.user,
      date: new Date().toLocaleDateString('ar-IQ'),
      status: '⏹️ تسجيل خروج',
      details: `مدة الجلسة: ${formatMinutes(sessionMinutes)} | النقاط: ${earnedPoints}${hasMultiplier ? ' (×2)' : ''}${globalDouble ? ' 🎯ضعف' : ''}`,
    });

    await sendActivityLog(interaction.guild, 0xFF9900, '⏹️ تسجيل خروج', [
      { name: 'العضو', value: `<@${userId}>`, inline: true },
      { name: '⏱ المدة', value: formatMinutes(sessionMinutes), inline: true },
      { name: '⭐ النقاط', value: `${earnedPoints}${hasMultiplier ? ' (×2)' : ''}${globalDouble ? ' 🎯ضعف' : ''}`, inline: true },
      { name: '📊 إجمالي نقاطك', value: `${member?.points || earnedPoints}`, inline: true },
    ]);

    if (earnedPoints > 0) {
      await sendPointsLog(interaction.guild, 0xFF9900, '⭐ نقاط احتلال', [
        { name: 'العضو', value: `<@${userId}>`, inline: true },
        { name: 'النقاط', value: `${earnedPoints}${hasMultiplier ? ' (×2)' : ''}`, inline: true },
        { name: 'المدة', value: formatMinutes(sessionMinutes), inline: true },
        { name: 'السبب', value: 'تسجيل خروج احتلال', inline: false },
      ]);
    }

    await updateAttendancePanel(interaction.guild);
    const doubleTag = globalDouble ? ' 🎯ضعف' : '';
    await interaction.reply({ content: `✅ <@${userId}> تم تسجيل خروجك! ⏱ ${formatMinutes(sessionMinutes)} ⭐ ${earnedPoints}${hasMultiplier ? ' (×2)' : ''}${doubleTag}${isBelowMinimum ? '\n⚠️ الجلسة أقل من الحد الأدنى (' + minMinutes + ' دقائق) - لم تضاف النقاط' : ''}`, flags: MessageFlags.Ephemeral });
  } finally {
    releaseLock(userId);
  }
}

// زر تفعيل/إلغاء ضعف النقاط العام للاحتلال
export async function handleAttendanceDoublePoints(interaction) {
  if (!isAdmin(interaction)) {
    return interaction.reply({ content: '❌ فقط لجنة التفاعل ورئاسة العائلة يمكنها استخدام هذا الزر.', flags: MessageFlags.Ephemeral });
  }

  const doc = await getAttendanceDoublePointsDoc();
  if (doc.isActive) {
    // إلغاء التفعيل
    doc.isActive = false;
    doc.deactivatedAt = new Date();
    doc.deactivatedBy = interaction.user.id;
    await doc.save();

    await sendAdminLog(interaction.guild, 0xFF0000, '🎯 إلغاء ضعف نقاط الاحتلال', [
      { name: '👤 المسؤول', value: `<@${interaction.user.id}>`, inline: true },
      { name: '📋 الحالة', value: '❌ ملغى', inline: true },
    ]);

    await logAttendance(interaction.guild, {
      target: { id: interaction.user.id },
      mod: interaction.user,
      date: new Date().toLocaleDateString('ar-IQ'),
      status: '🎯 إلغاء ضعف نقاط الاحتلال',
    });

    await updateAttendancePanel(interaction.guild);
    return interaction.reply({ content: '✅ تم إلغاء تفعيل ضعف النقاط للاحتلال.', flags: MessageFlags.Ephemeral });
  }

  // طلب المدة
  const modal = new ModalBuilder()
    .setCustomId('att_modal_double_points')
    .setTitle('🎯 تفعيل ضعف نقاط الاحتلال');

  const durationInput = new TextInputBuilder()
    .setCustomId('duration')
    .setLabel('المدة بالساعات (1-168)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('مثال: 24')
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(3);

  modal.addComponents(new ActionRowBuilder().addComponents(durationInput));
  await interaction.showModal(modal).catch(() => {});
}

// معالجة مودال ضعف النقاط
async function handleAttendanceDoublePointsModal(interaction) {
  const duration = parseInt(interaction.fields.getTextInputValue('duration'));
  if (isNaN(duration) || duration < 1 || duration > 168) {
    return interaction.reply({ content: '❌ الرجاء إدخال مدة صحيحة بين 1 و 168 ساعة.', flags: MessageFlags.Ephemeral });
  }

  const doc = await getAttendanceDoublePointsDoc();
  doc.isActive = true;
  doc.activatedBy = interaction.user.id;
  doc.activatedAt = new Date();
  doc.duration = duration;
  doc.expiresAt = new Date(Date.now() + duration * 60 * 60 * 1000);
  await doc.save();

  await sendAdminLog(interaction.guild, 0x00FF00, '🎯 تفعيل ضعف نقاط الاحتلال', [
    { name: '👤 المسؤول', value: `<@${interaction.user.id}>`, inline: true },
    { name: '⏳ المدة', value: `${duration} ساعة`, inline: true },
    { name: '⌛ ينتهي', value: `<t:${Math.floor(doc.expiresAt.getTime() / 1000)}:F>`, inline: false },
  ]);

  await logAttendance(interaction.guild, {
    target: { id: interaction.user.id },
    mod: interaction.user,
    date: new Date().toLocaleDateString('ar-IQ'),
    status: '🎯 تفعيل ضعف نقاط الاحتلال',
    details: `المدة: ${duration} ساعة | ينتهي: <t:${Math.floor(doc.expiresAt.getTime() / 1000)}:F>`,
  });

  await updateAttendancePanel(interaction.guild);
  await interaction.reply({ content: `✅ تم تفعيل ضعف النقاط للاحتلال لمدة **${duration} ساعة**!`, flags: MessageFlags.Ephemeral });
}

export async function handleMyStats(interaction) {
  const userId = interaction.user.id;
  const record = await Attendance.findOne({ userId });
  const member = await Member.findOne({ discordId: userId });

  const embed = embedNeutral('📊 إحصائياتي', `<@${userId}>`, [
    { name: '📊 إجمالي الساعات', value: formatMinutes(record?.totalMinutes || 0), inline: true },
    { name: '⭐ إجمالي النقاط', value: `${record?.totalPoints || 0}`, inline: true },
    { name: '🔄 عدد الجلسات', value: `${record?.totalSessions || 0}`, inline: true },
    { name: '🔁 المضاعف', value: record?.multiplier ? '✅ مفعل' : '❌ غير مفعل', inline: true },
    { name: '📈 نقاط العضوية', value: `${member?.points || 0}`, inline: true },
    { name: '🟢 الحالة', value: record?.isLoggedIn ? '✅ مسجل دخول' : '❌ غير مسجل', inline: true },
  ]);

  if (record?.lastLogin) embed.addFields({ name: 'آخر دخول', value: `<t:${Math.floor(new Date(record.lastLogin).getTime() / 1000)}:R>`, inline: true });
  if (record?.lastLogout) embed.addFields({ name: 'آخر خروج', value: `<t:${Math.floor(new Date(record.lastLogout).getTime() / 1000)}:R>`, inline: true });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export async function handleAttendanceControl(interaction) {
  const userId = interaction.user.id;

  if (!isAdmin(interaction)) {
    return interaction.reply({ content: '❌ فقط لجنة التفاعل والعقوبات يمكنها استخدام لوحة التحكم.', flags: MessageFlags.Ephemeral });
  }

  const record = await Attendance.findOne({ userId });
  const member = await Member.findOne({ discordId: userId });

  const embed = embedNeutral('⚙️ لوحة تحكم ساعات الاحتلال', null, [
    { name: '👤 العضو', value: `<@${userId}>`, inline: true },
    { name: '📊 إجمالي الساعات', value: formatMinutes(record?.totalMinutes || 0), inline: true },
    { name: '⭐ إجمالي النقاط', value: `${record?.totalPoints || 0}`, inline: true },
    { name: '🔄 عدد الجلسات', value: `${record?.totalSessions || 0}`, inline: true },
    { name: '🔁 المضاعف', value: record?.multiplier ? '✅ مفعل' : '❌ غير مفعل', inline: true },
    { name: '📈 نقاط العضو', value: `${member?.points || 0}`, inline: true },
  ]);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('att_ctrl').setLabel('⚙️ فتح التحكم').setStyle(ButtonStyle.Primary),
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

export async function showControlPanel(interaction) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('att_control_action')
    .setPlaceholder('اختر إجراء')
    .addOptions([
      { label: '📊 إحصائيات عضو', value: 'view_member', description: 'عرض إحصائيات وساعات عضو' },
      { label: '🔁 إعطاء ضعف نقاط', value: 'set_multiplier', description: 'تفعيل مضاعف النقاط لعضو (ساعات ×2)' },
      { label: '❌ إزالة ضعف نقاط', value: 'remove_multiplier', description: 'إزالة المضاعف من عضو' },
      { label: '➕ زيادة ساعات', value: 'add_hours', description: 'إضافة ساعات ونقاط لعضو' },
      { label: '➖ إنقاص ساعات', value: 'remove_hours', description: 'إنقاص ساعات من عضو' },
      { label: '🗑️ تصفير ساعات عضو', value: 'reset_member', description: 'تصفير ساعات ونقاط عضو' },
      { label: '🔄 تسجيل خروج إجباري', value: 'force_logout', description: 'تسجيل خروج عضو بالقوة' },
    ]);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('att_refresh_panel').setLabel('🔄 تحديث اللوحة').setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({ content: '🎛 **لوحة التحكم بساعات الاحتلال**\nاختر الإجراء المناسب:', components: [new ActionRowBuilder().addComponents(select), row], embeds: [] });
}

export async function handleControlSelect(interaction) {
  const action = interaction.values[0];

  switch (action) {
    case 'view_member': {
      const modal = new ModalBuilder()
        .setCustomId('att_modal_view_member')
        .setTitle('📊 إحصائيات عضو')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('target_id')
              .setLabel('أيدي العضو')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('مثال: 123456789012345678')
          ),
        );
      return interaction.showModal(modal).catch(e => console.error('[Attendance]', e?.message));
    }
    case 'set_multiplier':
    case 'remove_multiplier': {
      const modal = new ModalBuilder()
        .setCustomId('att_modal_' + action)
        .setTitle(action === 'set_multiplier' ? '🔁 إعطاء ضعف نقاط' : '❌ إزالة ضعف نقاط')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('target_id')
              .setLabel('أيدي العضو')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('مثال: 123456789012345678')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('السبب')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setPlaceholder('اختياري')
          ),
        );
      return interaction.showModal(modal).catch(e => console.error('[Attendance]', e?.message));
    }
    case 'add_hours':
    case 'remove_hours':
    case 'reset_member': {
      const modal = new ModalBuilder()
        .setCustomId('att_modal_modify_' + action)
        .setTitle({
          add_hours: '➕ زيادة ساعات',
          remove_hours: '➖ إنقاص ساعات',
          reset_member: '🗑️ تصفير ساعات عضو',
        }[action])
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('target_id')
              .setLabel('أيدي العضو')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('مثال: 123456789012345678')
          ));
      if (action === 'reset_member') {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('سبب التصفير')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
        );
      } else {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('value')
              .setLabel('المدة بالدقائق')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('مثال: 60 = ساعة')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('السبب')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
        );
      }
      return interaction.showModal(modal);
    }
    case 'force_logout': {
      const modal = new ModalBuilder()
        .setCustomId('att_modal_force_logout')
        .setTitle('🔄 تسجيل خروج إجباري')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('target_id')
              .setLabel('أيدي العضو')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('مثال: 123456789012345678')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('السبب')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('سبب تسجيل الخروج الإجباري')
          ),
        );
      return interaction.showModal(modal).catch(e => console.error('[Attendance]', e?.message));
    }
  }
}

export async function handleModalAction(interaction) {
  const customId = interaction.customId;

  if (customId === 'att_modal_double_points') {
    return handleAttendanceDoublePointsModal(interaction);
  }

  const targetId = interaction.fields.getTextInputValue('target_id');

  if (customId === 'att_modal_set_multiplier' || customId === 'att_modal_remove_multiplier') {
    const isSet = customId === 'att_modal_set_multiplier';
    const reason = interaction.fields.getTextInputValue('reason') || (isSet ? 'تفعيل مضاعف' : 'إزالة مضاعف');

    const record = await Attendance.findOne({ userId: targetId });
    if (!record) return interaction.reply({ content: '❌ العضو غير موجود في النظام.', flags: MessageFlags.Ephemeral });

    if (record.multiplier === isSet) {
      return interaction.reply({ content: `❌ المضاعف ${isSet ? 'مفعل مسبقاً' : 'غير مفعل مسبقاً'} لهذا العضو.`, flags: MessageFlags.Ephemeral });
    }

    record.multiplier = isSet;
    await record.save();

    await AttendanceLog.create({
      type: 'admin',
      userId: targetId,
      userName: record.userName,
      adminId: interaction.user.id,
      adminName: interaction.user.username,
      details: { action: isSet ? 'set_multiplier' : 'remove_multiplier', reason },
      timestamp: new Date(),
    });

    await logAttendance(interaction.guild, {
      target: { id: targetId },
      mod: interaction.user,
      date: new Date().toLocaleDateString('ar-IQ'),
      status: isSet ? '🔁 تفعيل مضاعف' : '❌ إزالة مضاعف',
      details: `السبب: ${reason}`,
    });

    await sendAdminLog(interaction.guild, isSet ? 0xFF9900 : 0xFF0000, isSet ? '🔁 تفعيل مضاعف' : '❌ إزالة مضاعف', [
      { name: 'المشرف', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'العضو', value: `<@${targetId}>`, inline: true },
      { name: 'السبب', value: reason, inline: false },
    ]);

    await interaction.reply({ content: `✅ ${isSet ? 'تم تفعيل' : 'تم إزالة'} المضاعف لـ <@${targetId}>.`, flags: MessageFlags.Ephemeral });
  }

  else if (customId === 'att_modal_view_member') {
    const record = await Attendance.findOne({ userId: targetId });
    if (!record) return interaction.reply({ content: '❌ العضو غير موجود في النظام.', flags: MessageFlags.Ephemeral });

    const member = await Member.findOne({ discordId: targetId });

    const embed = embedNeutral(`📊 إحصائيات ${record.userName}`, null, [
      { name: '📊 إجمالي الساعات', value: formatMinutes(record.totalMinutes), inline: true },
      { name: '⭐ إجمالي النقاط', value: `${record.totalPoints}`, inline: true },
      { name: '🔄 عدد الجلسات', value: `${record.totalSessions}`, inline: true },
      { name: '🔁 المضاعف', value: record.multiplier ? '✅ مفعل' : '❌ غير مفعل', inline: true },
      { name: '📈 نقاط العضو (Member)', value: `${member?.points || 0}`, inline: true },
      { name: '🟢 الحالة', value: record.isLoggedIn ? '✅ مسجل دخول' : '❌ غير مسجل', inline: true },
    ]);

    if (record.lastLogin) embed.addFields({ name: 'آخر دخول', value: `<t:${Math.floor(new Date(record.lastLogin).getTime() / 1000)}:R>`, inline: true });
    if (record.lastLogout) embed.addFields({ name: 'آخر خروج', value: `<t:${Math.floor(new Date(record.lastLogout).getTime() / 1000)}:R>`, inline: true });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  else if (customId === 'att_modal_force_logout') {
    const reason = interaction.fields.getTextInputValue('reason');
    const record = await Attendance.findOne({ userId: targetId });

    if (!record || !record.isLoggedIn) {
      return interaction.reply({ content: '❌ العضو غير مسجل دخول.', flags: MessageFlags.Ephemeral });
    }

    if (!acquireLock(targetId)) {
      return interaction.reply({ content: '⏳ العضو لديه طلب قيد المعالجة.', flags: MessageFlags.Ephemeral });
    }

    try {
      const now = new Date();
      const sessionMs = now.getTime() - new Date(record.currentSessionStart).getTime();
      const sessionMinutes = sessionMs / 60000;
      const fConfig = loadConfig();
      const minMins = fConfig.attendance?.minSessionMinutes ?? 0;
      const belowMin = minMins > 0 && sessionMinutes < minMins;
      const hasMultiplier = record.multiplier;
      const globalDouble = await isGlobalAttendanceDoubleActive();
      const earnedMinutes = belowMin ? 0 : calcEarnedMinutes(sessionMinutes, hasMultiplier) * (globalDouble ? 2 : 1);
      const earnedPoints = belowMin ? 0 : calcEarnedPoints(sessionMinutes, hasMultiplier) * (globalDouble ? 2 : 1);

      record.totalMinutes += earnedMinutes;
      record.totalPoints += earnedPoints;
      record.totalSessions += 1;
      record.isLoggedIn = false;
      record.currentSessionStart = null;
      record.lastLogout = now;
      await record.save();

      if (earnedPoints > 0) {
        const member = await Member.findOne({ discordId: targetId });
        if (member && member.isActive) {
          member.points = (member.points || 0) + earnedPoints;
          member.lastUserActivity = new Date();
          await member.save();
          await assessMemberStatus(interaction.client, interaction.guild, targetId);
        }
      }

      await AttendanceLog.create({
        type: 'admin',
        userId: targetId,
        userName: record.userName,
        adminId: interaction.user.id,
        adminName: interaction.user.username,
        details: { action: 'force_logout', sessionMinutes, earnedPoints, reason, hasMultiplier },
        timestamp: now,
      });

      await logAttendance(interaction.guild, {
        target: { id: targetId },
        mod: interaction.user,
        date: new Date().toLocaleDateString('ar-IQ'),
        status: '🔄 تسجيل خروج إجباري',
        details: `مدة الجلسة: ${formatMinutes(sessionMinutes)} | السبب: ${reason}`,
      });

      const doubleTagF = globalDouble ? ' 🎯ضعف' : '';
      await sendAdminLog(interaction.guild, 0xFF0000, '🔄 تسجيل خروج إجباري', [
        { name: 'المشرف', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'العضو', value: `<@${targetId}>`, inline: true },
        { name: 'المدة', value: formatMinutes(sessionMinutes), inline: true },
        { name: 'النقاط', value: `${earnedPoints}${doubleTagF}`, inline: true },
        { name: 'السبب', value: reason, inline: false },
      ]);

      await sendActivityLog(interaction.guild, 0xFF0000, '🔄 تسجيل خروج إجباري', [
        { name: 'المشرف', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'العضو', value: `<@${targetId}>`, inline: true },
        { name: 'المدة', value: formatMinutes(sessionMinutes), inline: true },
        { name: 'السبب', value: reason, inline: false },
      ]);

      if (earnedPoints > 0) {
        await sendPointsLog(interaction.guild, 0xFF0000, '⭐ نقاط احتلال (خروج إجباري)', [
          { name: 'العضو', value: `<@${targetId}>`, inline: true },
        { name: 'النقاط', value: `${earnedPoints}${hasMultiplier ? ' (×2)' : ''}${globalDouble ? ' 🎯ضعف' : ''}`, inline: true },
          { name: 'المدة', value: formatMinutes(sessionMinutes), inline: true },
          { name: 'السبب', value: reason, inline: false },
        ]);
      }

      await updateAttendancePanel(interaction.guild);
      await interaction.reply({ content: `✅ تم تسجيل خروج إجباري لـ <@${targetId}>.\n⏱ المدة: ${formatMinutes(sessionMinutes)}\n⭐ النقاط: ${earnedPoints}${belowMin ? '\n⚠️ الجلسة أقل من الحد الأدنى (' + minMins + ' دقائق) - لم تضاف النقاط' : ''}`, flags: MessageFlags.Ephemeral });
    } finally {
      releaseLock(targetId);
    }
  }

  else if (customId.startsWith('att_modal_modify_')) {
    const action = customId.replace('att_modal_modify_', '');
    const reason = interaction.fields.getTextInputValue('reason') || 'تعديل إداري';
    const valueStr = interaction.fields.getTextInputValue('value');
    const value = parseInt(valueStr, 10);

    if (action !== 'reset_member' && (isNaN(value) || value === 0)) {
      return interaction.reply({ content: '❌ قيمة غير صالحة.', flags: MessageFlags.Ephemeral });
    }

    const targetName = interaction.guild?.members.cache.get(targetId)?.user?.username || targetId;
    const record = await getOrCreateAttendance(targetId, targetName);
    const oldMinutes = record.totalMinutes;
    const oldPoints = record.totalPoints;
    const member = await Member.findOne({ discordId: targetId });

    switch (action) {
      case 'add_hours': {
        const addMinutes = Math.abs(value);
        const addPoints = calcEarnedPoints(addMinutes, false);
        record.totalMinutes += addMinutes;
        record.totalPoints += addPoints;
        if (member) {
          member.points = (member.points || 0) + addPoints;
          await member.save();
        }
        break;
      }
      case 'remove_hours': {
        const removeMinutes = Math.abs(value);
        const removePoints = calcEarnedPoints(removeMinutes, false);
        record.totalMinutes = Math.max(0, record.totalMinutes - removeMinutes);
        record.totalPoints = Math.max(0, record.totalPoints - removePoints);
        if (member) {
          member.points = Math.max(0, (member.points || 0) - removePoints);
          await member.save();
        }
        break;
      }
      case 'set_points': {
        record.totalPoints = Math.max(0, record.totalPoints + value);
        if (member) {
          member.points = Math.max(0, (member.points || 0) + value);
          await member.save();
        }
        break;
      }
      case 'reset_member': {
        const deductPoints = record.totalPoints;
        if (member && deductPoints > 0) {
          member.points = Math.max(0, (member.points || 0) - deductPoints);
          await member.save();
        }
        record.totalMinutes = 0;
        record.totalPoints = 0;
        record.totalSessions = 0;
        record.multiplier = false;
        break;
      }
    }

    await record.save();

    if (member) await assessMemberStatus(interaction.client, interaction.guild, targetId);

    await AttendanceLog.create({
      type: 'admin',
      userId: targetId,
      userName: record.userName || targetId,
      adminId: interaction.user.id,
      adminName: interaction.user.username,
      details: { action, oldValue: { minutes: oldMinutes, points: oldPoints }, newValue: { minutes: record.totalMinutes, points: record.totalPoints }, reason },
      timestamp: new Date(),
    });

    const actionLabels = {
      add_hours: '➕ زيادة ساعات',
      remove_hours: '➖ إنقاص ساعات',
      set_points: '🔢 تعديل نقاط',
      reset_member: '🔄 تصفير العضو',
    };

    await logAttendance(interaction.guild, {
      target: { id: targetId },
      mod: interaction.user,
      date: new Date().toLocaleDateString('ar-IQ'),
      status: actionLabels[action],
      details: `السبب: ${reason}`,
    });

    await sendAdminLog(interaction.guild, 0xFF9900, actionLabels[action], [
      { name: 'المشرف', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'العضو', value: `<@${targetId}>`, inline: true },
      { name: 'الساعات القديمة', value: formatMinutes(oldMinutes), inline: true },
      { name: 'الساعات الجديدة', value: formatMinutes(record.totalMinutes), inline: true },
      { name: 'السبب', value: reason, inline: false },
    ]);

    if (action === 'add_hours' || action === 'set_points') {
      const valueStr = interaction.fields.getTextInputValue('value');
      const rawValue = parseInt(valueStr, 10);
      const pointsChanged = action === 'add_hours' ? calcEarnedPoints(Math.abs(rawValue), false) : rawValue;
      if (pointsChanged !== 0) {
        await sendPointsLog(interaction.guild, pointsChanged > 0 ? 0x00FF00 : 0xFF0000, '⭐ نقاط احتلال (' + actionLabels[action] + ')', [
          { name: 'المشرف', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'العضو', value: `<@${targetId}>`, inline: true },
          { name: 'النقاط', value: `${pointsChanged > 0 ? '+' : ''}${pointsChanged}`, inline: true },
          { name: 'السبب', value: reason, inline: false },
        ]);
      }
    } else if (action === 'reset_member' && oldPoints > 0) {
      await sendPointsLog(interaction.guild, 0xFF0000, '⭐ نقاط احتلال (تصفير)', [
        { name: 'المشرف', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'العضو', value: `<@${targetId}>`, inline: true },
        { name: 'النقاط المسحوبة', value: `-${oldPoints}`, inline: true },
        { name: 'السبب', value: reason, inline: false },
      ]);
    }

    await interaction.reply({ content: `✅ ${actionLabels[action]} للعضو <@${targetId}> بنجاح.`, flags: MessageFlags.Ephemeral });
  }
}

export async function updateAttendancePanel(guild, retries = 2) {
  if (!guild) return;
  const config = loadConfig();

  const channelId = config.attendance?.panelChannelId;
  if (!channelId) return;

  const channel = await retry(() => guild.channels.fetch(channelId).catch(() => null), retries);
  if (!channel) return;

  const activeSessions = await getActiveSessions();
  const globalDouble = await isGlobalAttendanceDoubleActive();
  const embed = buildActiveSessionsEmbed(guild, activeSessions, globalDouble);

  const loginBtn = new ButtonBuilder()
    .setCustomId('att_login')
    .setLabel('✅ تسجيل دخول')
    .setStyle(ButtonStyle.Success);

  const logoutBtn = new ButtonBuilder()
    .setCustomId('att_logout')
    .setLabel('⏹️ تسجيل خروج')
    .setStyle(ButtonStyle.Danger);

  const myStatsBtn = new ButtonBuilder()
    .setCustomId('att_mystats')
    .setLabel('📊 إحصائياتي')
    .setStyle(ButtonStyle.Secondary);

  const controlBtn = new ButtonBuilder()
    .setCustomId('att_control')
    .setLabel('⚙️ التحكم')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(loginBtn, logoutBtn, myStatsBtn, controlBtn);

  const doubleBtn = new ButtonBuilder()
    .setCustomId('att_double_points')
    .setLabel(globalDouble ? '🎯 إلغاء ضعف النقاط' : '🎯 تفعيل ضعف النقاط')
    .setStyle(globalDouble ? ButtonStyle.Danger : ButtonStyle.Success);

  const row2 = new ActionRowBuilder().addComponents(doubleBtn);

  const key = 'attendance_panel';
  let pMsg = await PersistentMessage.findOne({ key });
  let message = pMsg ? await retry(() => channel.messages.fetch(pMsg.messageId).catch(() => null), retries) : null;

  if (message) {
    try {
      await retry(() => message.edit({ embeds: [embed], components: [row, row2] }), retries);
    } catch (editError) {
      if (editError.code === 10008 || editError.code === 50005) {
        message = null;
      } else {
        console.error('❌ Attendance panel edit error:', editError.message);
        return;
      }
    }
  }
  if (!message) {
    try {
      message = await retry(() => channel.send({ embeds: [embed], components: [row, row2] }), retries);
      await PersistentMessage.findOneAndUpdate({ key }, { key, messageId: message.id, updatedAt: new Date() }, { upsert: true });
    } catch (sendError) {
      console.error('❌ Attendance panel send error:', sendError.message);
    }
  }
}

function buildActiveSessionsEmbed(guild, activeSessions, globalDouble = false) {
  const now = new Date();

  let membersList;
  if (activeSessions.length === 0) {
    membersList = 'لا يوجد أعضاء مسجلين حالياً.';
  } else {
    membersList = activeSessions.map(r => {
      const sessionMs = now.getTime() - new Date(r.currentSessionStart).getTime();
      const duration = formatDuration(sessionMs / 60000);
      const multi = r.multiplier ? ' 🔁×2' : '';
      return `✅ <@${r.userId}> | ${duration}${multi}`;
    }).join('\n');
  }

  const totalActive = activeSessions.length;
  const doubleStatus = globalDouble ? '\n\n🎯 **ضعف النقاط مفعل حالياً!**' : '';

  const base = globalDouble ? embedGold('📋 ساعات الاحتلال النشطة') : embedNeutral('📋 ساعات الاحتلال النشطة');
  return base
    .setDescription(`**الأعضاء المسجلين حالياً: ${totalActive}**\n\n${membersList}${doubleStatus}`)
    .setFooter({ text: 'يتم تحديث هذه اللوحة تلقائياً' });
}

export async function cleanupStaleSessions(guild) {
  const active = await getActiveSessions();
  if (active.length === 0) return;

  const config = loadConfig();
  const maxSessionMinutes = config.attendance?.maxSessionMinutes ?? 1440;

  let cleaned = 0;
  for (const record of active) {
    const elapsed = (Date.now() - new Date(record.currentSessionStart).getTime()) / 60000;
    if (elapsed > maxSessionMinutes) {
      record.isLoggedIn = false;
      record.currentSessionStart = null;
      record.lastLogout = new Date();
      await record.save();

      await AttendanceLog.create({
        type: 'system',
        userId: record.userId,
        userName: record.userName,
        details: {
          action: 'auto_force_logout',
          reason: 'انتهاء صلاحية الجلسة بعد إعادة تشغيل البوت',
          sessionMinutes: elapsed,
        },
        timestamp: new Date(),
      });

      cleaned++;
    }
  }

  if (cleaned > 0) {
    const channelId = config.attendance?.adminLogChannelId;
    if (channelId && guild) {
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (channel) {
        const embed = embedError('🔄 تنظيف الجلسات المعلقة', `تم تسجيل خروج إجباري لـ **${cleaned}** عضو بسبب انتهاء صلاحية الجلسات بعد إعادة تشغيل البوت.`);
        await channel.send({ embeds: [embed] }).catch(e => console.error('[Attendance]', e?.message));
      }
    }
    console.log(`[Attendance] Cleaned ${cleaned} stale sessions on startup`);
  }

  await updateAttendancePanel(guild);
}

/* ===================================================================
   Attendance Dashboard (لوحة إحصائيات ساعات الاحتلال)
   =================================================================== */

async function generateAttendanceDashboardEmbed(guild) {
  const allRecords = await Attendance.find();
  const activeNow = allRecords.filter(r => r.isLoggedIn);
  const globalDouble = await isGlobalAttendanceDoubleActive();

  const sortedByHours = [...allRecords].sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 10);
  const sortedByPoints = [...allRecords].sort((a, b) => b.totalPoints - a.totalPoints).slice(0, 10);

  const totalSessions = allRecords.reduce((s, r) => s + r.totalSessions, 0);
  const totalMinutesAll = allRecords.reduce((s, r) => s + r.totalMinutes, 0);

  const embed = embedNeutral('📊 إحصائيات ساعات الاحتلال', `
**🕒 آخر تحديث:** <t:${Math.floor(Date.now() / 1000)}:R>
**🟢 النشط حالياً:** ${activeNow.length}
**👥 إجمالي المسجلين:** ${allRecords.length}
**📈 إجمالي الساعات:** ${formatMinutes(totalMinutesAll)}
**🔄 إجمالي الجلسات:** ${totalSessions}
${globalDouble ? '🎯 **ضعف النقاط مفعل حالياً!**' : ''}
    `.trim())
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setFooter({ text: 'يتم تحديث هذه اللوحة تلقائياً', iconURL: guild.iconURL() });

  const topHours = sortedByHours.map((r, i) =>
    `\`#${i + 1}\` <@${r.userId}> — ${formatMinutes(r.totalMinutes)}`
  ).join('\n') || '*لا يوجد بيانات*';

  const topPoints = sortedByPoints.map((r, i) =>
    `\`#${i + 1}\` <@${r.userId}> — **${r.totalPoints}** نقطة`
  ).join('\n') || '*لا يوجد بيانات*';

  embed.addFields(
    { name: '⏱ أفضل 10 بالساعات', value: topHours, inline: true },
    { name: '⭐ أفضل 10 بالنقاط', value: topPoints, inline: true },
  );

  if (activeNow.length > 0) {
    const activeList = activeNow.map(r => {
      const mins = (Date.now() - new Date(r.currentSessionStart).getTime()) / 60000;
      return `<@${r.userId}> — ${formatDuration(mins)}${r.multiplier ? ' 🔁×2' : ''}`;
    }).join('\n');
    embed.addFields({ name: `🟢 النشط حالياً (${activeNow.length})`, value: activeList, inline: false });
  }

  return embed;
}

let dashboardInterval;

async function retry(fn, maxRetries = 5, delay = 1500) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) {
        if (err.code === 10008) return null;
        throw err;
      }
      if (err.code === 'UND_ERR_SOCKET' || err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT' || err.code === 429) {
        await new Promise(r => setTimeout(r, delay * (i + 1)));
        continue;
      }
      throw err;
    }
  }
}

export async function updateAttendanceDashboard(client, forceReset = false) {
  const config = loadConfig();
  const channelId = config.attendance?.dashboardChannelId;
  if (!channelId) return;

  try {
    const channel = await retry(() => client.channels.fetch(channelId).catch(() => null));
    if (!channel) return;

    const guild = channel.guild;
    const embed = await generateAttendanceDashboardEmbed(guild);

    let pMsg = await PersistentMessage.findOne({ key: 'attendance_dashboard' });
    let message;

    if (forceReset && pMsg) {
      try {
        const old = await channel.messages.fetch(pMsg.messageId).catch(() => null);
        if (old && old.deletable) await old.delete();
      } catch (e) {}
      pMsg = null;
      await PersistentMessage.deleteOne({ key: 'attendance_dashboard' });
    }

    if (!forceReset && pMsg) {
      message = await retry(() => channel.messages.fetch(pMsg.messageId).catch(() => null));
    }

    if (message) {
      try {
        await retry(() => message.edit({ embeds: [embed] }));
      } catch (editError) {
        if (editError.code === 50005 || editError.code === 10008) {
          message = null;
          await PersistentMessage.deleteOne({ key: 'attendance_dashboard' });
        } else {
          throw editError;
        }
      }
    }

    if (!message) {
      message = await retry(() => channel.send({ embeds: [embed] }));
      await PersistentMessage.findOneAndUpdate(
        { key: 'attendance_dashboard' },
        { key: 'attendance_dashboard', guildId: guild.id, channelId: channel.id, messageId: message.id },
        { upsert: true, new: true }
      );
    }
  } catch (error) {
    console.error('❌ Attendance dashboard update error:', error);
  }
}

export async function startAttendanceDashboard(client) {
  await updateAttendanceDashboard(client, true);
  if (dashboardInterval) clearInterval(dashboardInterval);
  dashboardInterval = setInterval(() => {
    updateAttendanceDashboard(client, false);
  }, 10 * 60 * 1000);
}

export function stopAttendanceDashboard() {
  if (dashboardInterval) {
    clearInterval(dashboardInterval);
    dashboardInterval = null;
  }
}

export function formatDurationForEmbed(minutes) {
  return formatDuration(minutes);
}
