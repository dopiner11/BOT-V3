import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Member from '../models/Member.js';
import Warning from '../models/Warning.js';
import PersistentMessage from '../models/PersistentMessage.js';
import { calculateRankProgress, getInteractionConfig } from './interactionMonitor.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, gold as embedGold, custom as embedCustom } from './embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
}

function getButtonStyle(styleName) {
  const map = { Primary: ButtonStyle.Primary, Secondary: ButtonStyle.Secondary, Success: ButtonStyle.Success, Danger: ButtonStyle.Danger };
  return map[styleName] || ButtonStyle.Secondary;
}

function buildGuideRows() {
  const cfg = loadConfig();
  
  const defaultButtons = {
    promotion: { label: "الترقيات والمسؤوليات", emoji: "🏆", style: "Primary" },
    points: { label: "طرق جمع النقاط", emoji: "💰", style: "Success" },
    report: { label: "تقديم تقرير", emoji: "📋", style: "Secondary" },
    interaction: { label: "نظام التفاعل والاحتلال", emoji: "📊", style: "Secondary" },
    warnings: { label: "تحذيراتك", emoji: "⚠️", style: "Danger" }
  };

  const getBtn = (key) => {
    const raw = cfg.welcomeGuide?.buttons?.[key] || {};
    const fallback = defaultButtons[key];
    return {
      label: raw.label || fallback.label,
      emoji: raw.emoji || fallback.emoji,
      style: raw.style || fallback.style
    };
  };

  const p = getBtn('promotion');
  const pts = getBtn('points');
  const r = getBtn('report');
  const i = getBtn('interaction');
  const w = getBtn('warnings');

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('guide_promotion').setEmoji(p.emoji).setLabel(p.label).setStyle(getButtonStyle(p.style)),
    new ButtonBuilder().setCustomId('guide_points').setEmoji(pts.emoji).setLabel(pts.label).setStyle(getButtonStyle(pts.style)),
    new ButtonBuilder().setCustomId('guide_report').setEmoji(r.emoji).setLabel(r.label).setStyle(getButtonStyle(r.style)),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('guide_interaction').setEmoji(i.emoji).setLabel(i.label).setStyle(getButtonStyle(i.style)),
    new ButtonBuilder().setCustomId('guide_warnings').setEmoji(w.emoji).setLabel(w.label).setStyle(getButtonStyle(w.style)),
  );
  return [row1, row2];
}

function buildWelcomeEmbed(memberData, gameName, gameId, level, jobNum, room) {
  const cfg = loadConfig();
  const wc = cfg.welcomeGuide?.embeds?.welcome || {};
  const embed = embedCustom(parseInt((wc.color || '#00ff00').replace('#', ''), 16) || 0x00FF00,
    wc.title || '🎉 مرحباً بك في العائلة!',
    `مرحباً بك <@${memberData.id || memberData.discordId}> في 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘𓆪`)
    .addFields(
      { name: '🎮 اسم الشخصية', value: gameName, inline: true },
      { name: '🆔 أيدي اللعبة', value: gameId, inline: true },
      { name: '📈 الفل', value: level.toString(), inline: true },
      { name: '💼 رقم الرتبة', value: `#${jobNum}`, inline: true },
      { name: '🎖️ الرتبة الحالية', value: memberData.currentRank || 'مبتدئ', inline: true },
      { name: '🏆 النقاط', value: `${memberData.points || 0} نقطة`, inline: true },
      { name: '📅 تاريخ الانضمام', value: `<t:${Math.floor(Date.now() / 1000)}:D>`, inline: true },
      { name: '🏠 الروم الخاص', value: room ? `هذه غرفتك الخاصة: <#${room.id}>` : 'غير متوفر', inline: false },
      { name: '📚 دليل الأنظمة', value: 'اضغط على الأزرار تحت عشان تتعرف على كل نظام', inline: false }
    )
    .setThumbnail(memberData.displayAvatarURL?.() || memberData.avatarURL || '')
    .setFooter({ text: wc.footer || '📌 أزرار التفاعل — اضغط عشان تتعلم' });
  return embed;
}

export async function sendWelcomeGuide(client, guild, targetUser, gameName, gameId, level, jobNum, room) {
  const config = loadConfig();
  const member = await Member.findOne({ discordId: targetUser.id });
  if (!member || !room) return;

  const embed = buildWelcomeEmbed({ id: targetUser.id, discordId: targetUser.id, currentRank: member.currentRank, points: member.points, displayAvatarURL: () => targetUser.displayAvatarURL(), avatarURL: targetUser.displayAvatarURL() }, gameName, gameId, level, jobNum, room);
  const rows = buildGuideRows();

  const msg = await room.send({ content: `<@${targetUser.id}>`, embeds: [embed], components: rows });
  await msg.pin().catch(() => {});

  member.guideMsgId = msg.id;
  await member.save();
}

export async function handleGuideButton(interaction) {
  const cfg = loadConfig();
  const type = interaction.customId.replace('guide_', '');

  const discordMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!discordMember) return interaction.reply({ content: '❌ لم يتم العثور عليك.', flags: 64 });

  let embed;

  switch (type) {
    case 'promotion': {
      const rankData = await calculateRankProgress(interaction.user.id);
      const member = await Member.findOne({ discordId: interaction.user.id });
      const ranks = cfg.promotion?.ranks || [];
      const wc = cfg.welcomeGuide?.embeds || {};

      if (!rankData || !member) {
        return interaction.reply({ content: '❌ أنت غير مسجل في النظام.', flags: 64 });
      }

      const rankList = ranks.map(r => `<@&${r.roleId}> ← ${r.requiredPoints} نقطة / ${r.requiredDays} يوم`).join('\n');

      embed = embedCustom(parseInt((wc.promotion_color || '#FFD700').replace('#', ''), 16) || 0xFFD700,
        wc.promotion_title || '🏆 تقدم رتبتك',
        [
          `👤 **${member.gameName || 'غير معروف'}**`,
          `🎖️ رتبتك الحالية: **${rankData.currentRank}**`,
          rankData.nextRank ? `🎯 الرتبة القادمة: <@&${rankData.requiredRoleId || ''}>` : '🚀 **وصلت لأعلى رتبة!**',
          rankData.nextRank ? `📅 تحتاج **${rankData.requiredDays}** يوم (عندك **${rankData.memberDays}**)` : '',
          rankData.nextRank ? `🏆 تحتاج **${Math.max(0, rankData.requiredPoints - (member.points || 0))}** نقطة (عندك **${member.points || 0}**)` : '',
          rankData.avgDailyPoints ? `📊 معدلك اليومي: **${rankData.avgDailyPoints}**` : '',
          rankData.limitingFactor ? `⏳ العامل المحدد: **${rankData.limitingFactor}**` : '',
          rankData.streakCount > 0 ? `🔥 Streak: **${rankData.streakCount}** يوم${rankData.multiplier > 1 ? ` (×${rankData.multiplier})` : ''}` : '',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '📋 **جميع الرتب:**',
          rankList,
          '━━━━━━━━━━━━━━━━━━━━',
          '💡 حافظ على Streak عشان تضاعف نقاطك!',
        ].filter(Boolean).join('\n'));
      break;
    }

    case 'points': {
      const att = cfg.attendance || {};
      const ic = getInteractionConfig();
      const wc = cfg.welcomeGuide?.embeds || {};
      const ptsPerInterval = att.pointsPerInterval ?? 15;
      const intervalMin = att.intervalMinutes ?? 10;
      const ptsPerMin = (ptsPerInterval / intervalMin).toFixed(1);
      const milestones = ic.streakMilestones || [];

      embed = embedCustom(parseInt((wc.points_color || '#00AE86').replace('#', ''), 16) || 0x00AE86,
        wc.points_title || '💰 طرق جمع النقاط',
        [
          '🏴‍☠️ **ساعات الاحتلال:**',
          `• كل **${intervalMin}** دقائق = **${ptsPerInterval}** نقطة (${ptsPerMin}/دقيقة)`,
          `• الجلسة أقل من **${att.minSessionMinutes || 10}** دقائق = 0`,
          '• ×2 مع المضاعف الشخصي',
          '• لغرض التسجيل في النظام توجه ل https://discord.com/channels/1383643556194943108/1472547649919123620',
          '',
          '📋 **التقارير:**',
          '• تقرير مقبول = نقاط حسب نوع التقرير',
          '• لعمل تقرير توجه ل https://discord.com/channels/1383643556194943108/1459615234451968022',
          '',
          '🔥 **الـ Streak:**',
          ...milestones.map(m => `• **${m.days}** أيام → ×**${m.multiplier}** (24 ساعة)`),
          '',
          '🎯 **التحديات اليومية:**',
          '• تحديات يومية بمكافآت إضافية',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '📊 **تصنيفك اليومي:**',
          `• 🟢 **${ic.activeThreshold}**+ = متفاعل عالي`,
          `• 🟡 **${ic.violatorThreshold}**-${ic.activeThreshold - 1} = خامل`,
          `• 🔴 أقل من **${ic.violatorThreshold}** = مخالف`,
        ].join('\n'));
      break;
    }

    case 'report': {
      const wc = cfg.welcomeGuide?.embeds || {};
      embed = embedCustom(parseInt((wc.report_color || '#5865F2').replace('#', ''), 16) || 0x5865F2,
        wc.report_title || '📋 تقديم تقرير',
        [
          '**كيف تقدم تقرير؟**',
         '• لعمل تقرير توجه ل https://discord.com/channels/1383643556194943108/1459615234451968022',

          '',
          '1️⃣ اختر **نوع التقرير**',
          '2️⃣ اكتب عنوان التقرير مثل سرقة متجر ',
          '3️⃣ **قم ب اختيار اذا كان موجود مشاركين ام لا واذا موجودين منشنهم',
          '4️⃣ **قم  ب وضع الدليل الخاص ب التقرير',
          '5️⃣ **س يرسل التقرير للادارة لغرض المراجعة وفي حال الرفض او القبول سيتم اشعارك',
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '⏳ **بعد تسليم التقرير و مراجعة الادارة:**',
          '• ✅ مقبول ← نقاط تضاف لحسابك',
          '• ❌ مرفوض ← يوضح السبب',
          '',
          '⚠️ **تقارير مزورة = عقوبة!**',
        ].join('\n'));
      break;
    }

    case 'interaction': {
      const att = cfg.attendance || {};
      const ic = getInteractionConfig();
      const wc = cfg.welcomeGuide?.embeds || {};
      const ptsPerInterval = att.pointsPerInterval ?? 15;
      const intervalMin = att.intervalMinutes ?? 10;

      embed = embedCustom(parseInt((wc.interaction_color || '#3498DB').replace('#', ''), 16) || 0x3498DB,
        wc.interaction_title || '📊 نظام التفاعل والاحتلال',
        [
          '🏴‍☠️ **ساعات الاحتلال:**',
          `• تدخل **روم صوتي** مخصص ← يحتسب الوقت`,
          `• **${ptsPerInterval}** نقاط كل **${intervalMin}** دقائق`,
          `• ×2 مع المضاعف الشخصي = **${ptsPerInterval * 2}** نقاط/${intervalMin} دقائق`,
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '📈 **التفاعل اليومي =**',
          'نقاط احتلال + تقارير + تحديات',
          '',
          '🌙 **التصنيف: 12 منتصف ليل بغداد**',
          `• 🟢 **${ic.activeThreshold}**+ = متفاعل عالي`,
          `• 🟡 **${ic.violatorThreshold}**-${ic.activeThreshold - 1} = خامل`,
          `• 🔴 أقل من **${ic.violatorThreshold}** = مخالف`,
          '',
          '━━━━━━━━━━━━━━━━━━━━',
          '⚠️ **إذا صرت مخالف:**',
          `• الأيام ${ic.graceDays} الأولى: DM تحذير`,
          `• بعد ${ic.graceDays} أيام: يرفع للجنة العقوبات`,
          `• ${ic.maxWarnings} إنذارات = فصل تلقائي`,
        ].join('\n'));
      break;
    }

    case 'warnings': {
      const wc = cfg.welcomeGuide?.embeds || {};
      const warnings = await Warning.find({ memberId: interaction.user.id, removed: false });
      const count = warnings.length;

      let desc = `عدد التحذيرات النشطة: **${count}** من 3\n\n`;
      if (count === 0) {
        desc += '✅ **لا توجد تحذيرات.**';
      } else {
        warnings.forEach((w, i) => {
          const days = Math.floor((Date.now() - new Date(w.createdAt || Date.now()).getTime()) / 86400000);
          desc += `⚠️ **#${i + 1}** — ${w.reason?.substring(0, 40) || w.warningType || 'تحذير'} (منذ ${days} يوم)\n`;
        });
        desc += '\n';
        if (count === 2) desc += '🎫 **توجه للتذاكر عشان تمسح التحذيرات قبل توصل 3!**';
        if (count >= 3) desc += '⛛ **وصلت 3 إنذارات — الفصل وشيك.**';
      }

      embed = embedCustom(parseInt((wc.warnings_color || '#E74C3C').replace('#', ''), 16) || 0xE74C3C,
        wc.warnings_title || '🟤 تحذيراتك', desc);
      break;
    }

    default:
      return interaction.reply({ content: '❌ زر غير معروف.', flags: 64 });
  }

  await interaction.reply({ embeds: [embed], flags: 64 });
}

export async function deployGuideToAllMembers(client) {
  const config = loadConfig();
  if (config.welcomeGuide?.deployed) return;

  const guild = client.guilds.cache.get(config.bot?.guildId);
  if (!guild) return;

  const members = await Member.find({ isActive: true, roomChannelId: { $ne: null, $ne: '' } });
  const delay = config.welcomeGuide?.delayMs ?? 1500;
  let sent = 0;
  let failed = 0;
  const total = members.length;

  console.log(`[WelcomeGuide] 🚀 نشر الدليل لـ ${total} عضو قديم...`);

  for (const m of members) {
    try {
      const targetUser = await client.users.fetch(m.discordId).catch(() => null);
      if (!targetUser) { failed++; continue; }

      const room = guild.channels.cache.get(m.roomChannelId);
      if (!room) { failed++; continue; }

      const embed = buildWelcomeEmbed(
        { id: m.discordId, discordId: m.discordId, currentRank: m.currentRank, points: m.points, displayAvatarURL: () => targetUser.displayAvatarURL(), avatarURL: targetUser.displayAvatarURL() },
        m.gameName || 'غير معروف',
        m.gameId || 'غير معروف',
        m.level || 0,
        m.jobNumber || 0,
        room,
      );
      const rows = buildGuideRows();

      if (m.guideMsgId) {
        try {
          const oldMsg = await room.messages.fetch(m.guideMsgId).catch(() => null);
          if (oldMsg) {
            await oldMsg.edit({ embeds: [embed], components: rows });
            sent++;
            await sleep(delay);
            continue;
          }
        } catch { }
      }

      const msg = await room.send({ content: `<@${m.discordId}>`, embeds: [embed], components: rows });
      await msg.pin().catch(() => {});
      m.guideMsgId = msg.id;
      await m.save();
      sent++;
    } catch (e) {
      failed++;
    }
    await sleep(delay);
  }

  console.log(`[WelcomeGuide] ✅ تم: ${sent}/${total} (فشل: ${failed})`);

  await PersistentMessage.findOneAndUpdate(
    { key: 'guide_deployed' },
    { key: 'guide_deployed', guildId: guild.id, deployedAt: new Date().toISOString(), total, sent, failed },
    { upsert: true },
  );

  const cfgPath = join(__dirname, '../config.json');
  const raw = readFileSync(cfgPath, 'utf8');
  const updated = raw.replace(/"deployed": false/, '"deployed": true');
  try {
    const { writeFileSync } = await import('fs');
    writeFileSync(cfgPath, updated, 'utf8');
  } catch { }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
