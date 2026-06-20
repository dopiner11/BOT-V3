import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import DayLog from '../models/DailyLog.js';
import Member from '../models/Member.js';
import Warn from '../models/Warning.js';
import { getInteractionConfig, STATUS, getStatusEmoji, formatDate, ensureDailyLog } from './interactionSystem.js';
import { warning as embedWarn, info as embedInfo } from './embedStyles.js';
import { logWarning, logForgive } from './logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WARN_GIF = 'https://media.discordapp.net/attachments/1391704768660901919/1453017759565746197/934_x_175_.gif';

function loadConfig() {
  try { return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8')); }
  catch { return {}; }
}

const activeQueues = new Map();

function hasQueuePermission(member) {
  const cfg = loadConfig();
  const pres = cfg.committees?.list?.family_presidency;
  const allowed = [
    ...(cfg.committees?.list?.punishment?.roles?.manager || []),
    ...(cfg.committees?.list?.punishment?.roles?.deputy || []),
    ...(cfg.committees?.list?.punishment?.roles?.member || []),
    ...(cfg.committees?.list?.interaction?.roles?.manager || []),
    ...(cfg.committees?.list?.interaction?.roles?.deputy || []),
    ...(cfg.committees?.list?.interaction?.roles?.member || []),
    ...(pres?.roles?.manager || []),
    ...(pres?.roles?.deputy || []),
    ...(pres?.roles?.member || []),
    ...(cfg.committees?.founders || []),
  ];
  return allowed.some(r => r === member.id || member.roles?.cache?.has(r));
}

/* ===================================================================
   بناء القائمة — مسح المخالفين المستحقين إنذار
   =================================================================== */
export async function buildWarningQueue(guild) {
  const today = formatDate(new Date());
  const maxW = getInteractionConfig().maxWarnings;

  const violators = await DayLog.find({
    date: today,
    status: { $in: [STATUS.VIOLATOR, STATUS.WARNED] },
    $or: [{ forgiven: { $ne: true } }, { forgiven: { $exists: false } }]
  });

  const items = [];
  for (const log of violators) {
    try {
      const m = await Member.findOne({ discordId: log.discordId });
      if (!m || !m.isActive) continue;
      const gm = await guild.members.fetch(log.discordId).catch(() => null);
      if (!gm) continue;
      const warns = await Warn.find({ memberId: log.discordId, warningType: 'inactivity', status: 'active', removed: false });
      if (warns.length >= maxW) continue;
      items.push({
        discordId: log.discordId, gm, memberData: m, dailyLog: log,
        warningCount: warns.length,
        nextNum: warns.length + 1,
      });
    } catch (e) {
      console.error('[PunishmentQueue] build error:', e?.message);
    }
  }
  return items;
}

/* ===================================================================
   إرسال رسالة القائمة
   =================================================================== */
export async function sendQueueMessage(guildOrInt, items) {
  const guild = guildOrInt.guild || guildOrInt;
  const chId = getInteractionConfig().channels.alert;
  const ch = chId ? (guild.channels.cache.get(chId) || await guild.channels.fetch(chId).catch(() => null)) : null;
  if (!ch || items.length === 0) return;

  const sel = new StringSelectMenuBuilder()
    .setCustomId('pun_queue_sel')
    .setPlaceholder('اختر عضواً')
    .addOptions(items.slice(0, 25).map((it, i) => ({
      label: it.gm?.displayName || it.discordId,
      description: `إنذار (${it.nextNum})`,
      value: `${i}`,
    })));

  const embed = embedWarn(`📋 قائمة الإنذارات — ${items.length} عضو`,
    items.map((it, i) => `${i + 1}. ${it.gm} — إنذار (${it.nextNum})`).join('\n'));

  const rows = [new ActionRowBuilder().addComponents(sel)];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pun_queue_warn_all').setLabel('⚠️ إنذار الكل').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('pun_queue_forgive_all').setLabel('🤝 مسامحة الكل').setStyle(ButtonStyle.Success),
  ));

  const msg = await ch.send({ embeds: [embed], components: rows });
  activeQueues.set(msg.id, { items, chId: ch.id, msgId: msg.id, guild });
}

/* ===================================================================
   تحديث القائمة
   =================================================================== */
async function updateQueue(q) {
  const ch = q.guild.channels.cache.get(q.chId) || await q.guild.channels.fetch(q.chId).catch(() => null);
  if (!ch) return;
  const msg = await ch.messages.fetch(q.msgId).catch(() => null);
  if (!msg) return;

  const sel = new StringSelectMenuBuilder()
    .setCustomId('pun_queue_sel')
    .setPlaceholder('اختر عضواً')
    .addOptions(q.items.slice(0, 25).map((it, i) => ({
      label: it.gm?.displayName || it.discordId,
      description: `إنذار (${it.nextNum})`,
      value: `${i}`,
    })));

  const embed = embedWarn(`📋 قائمة الإنذارات — ${q.items.length} عضو`,
    q.items.map((it, i) => `${i + 1}. ${it.gm} — إنذار (${it.nextNum})`).join('\n'));

  const rows = [new ActionRowBuilder().addComponents(sel)];
  if (q.items.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pun_queue_warn_all').setLabel('⚠️ إنذار الكل').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('pun_queue_forgive_all').setLabel('🤝 مسامحة الكل').setStyle(ButtonStyle.Success),
    ));
  }

  await msg.edit({ embeds: [embed], components: rows });
  if (q.items.length === 0) activeQueues.delete(q.msgId);
}

/* ===================================================================
   معالجة التفاعلات
   =================================================================== */
export async function handleQueueInteraction(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('pun_queue_')) return false;

  if (!hasQueuePermission(interaction.member)) {
    return interaction.reply({ content: '❌ فقط لجنة العقوبات ولجنة التفاعل والرئاسة تملك الصلاحية.', flags: MessageFlags.Ephemeral });
  }

  let q, qId;
  const parts = customId.split('_');
  // الأزرار الفردية تحتوي qId مباشرة في الـ customId
  if (parts.length >= 5) {
    qId = parts[3] === 'item' ? parts[4] : parts[3];
    q = activeQueues.get(qId);
  }
  // Fallback للأزرار على الرسالة الأصلية
  if (!q) {
    for (const [id, qq] of activeQueues) {
      if (qq.msgId === (interaction.message?.id || id)) { q = qq; qId = id; break; }
    }
  }
  if (!q) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });

  // Select — تفاصيل فردية
  if (interaction.isStringSelectMenu() && customId === 'pun_queue_sel') {
    const idx = parseInt(interaction.values[0]);
    const it = q.items[idx];
    if (!it) return interaction.reply({ content: '❌ العضو غير موجود.', flags: MessageFlags.Ephemeral });

    const emb = embedInfo(`📋 ${it.gm?.displayName || it.discordId}`,
      `${it.gm}\nإنذار (${it.nextNum}/3) | نقاط: ${it.dailyLog.points || 0} | مخالف: ${it.dailyLog.daysAsViolator || 0} يوم`)
      .addFields(
        { name: '⚠️ الإنذار', value: `${it.nextNum}/3`, inline: true },
        { name: '📊 نقاط', value: `${it.dailyLog.points || 0}`, inline: true },
        { name: '📅 أيام', value: `${it.dailyLog.daysAsViolator || 0}`, inline: true },
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pun_queue_warn_${qId}_${idx}`).setLabel('⚠️ إنذار').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`pun_queue_forgive_${qId}_${idx}`).setLabel('🤝 مسامحة').setStyle(ButtonStyle.Success),
    );

    await interaction.reply({ embeds: [emb], components: [row], flags: MessageFlags.Ephemeral });
    return true;
  }

  // إنذار الكل
  if (interaction.isButton() && customId === 'pun_queue_warn_all') {
    await interaction.deferUpdate();
    const items = [...q.items];
    await executeBatchWarns(q.guild, items, interaction.user);
    q.items = [];
    await updateQueue(q);
    await interaction.followUp({ content: `✅ تم إنذار ${items.length} عضو.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  // مسامحة الكل
  if (interaction.isButton() && customId === 'pun_queue_forgive_all') {
    const modal = new ModalBuilder()
      .setCustomId(`pun_queue_forgive_all_modal_${qId}`)
      .setTitle('🤝 سبب المسامحة');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('forgive_all_reason').setLabel('السبب').setStyle(TextInputStyle.Paragraph).setMinLength(5).setMaxLength(500).setRequired(true)
    ));
    await interaction.showModal(modal);
    return true;
  }

  // إنذار فردي
  if (interaction.isButton() && customId.startsWith('pun_queue_warn_') && customId !== 'pun_queue_warn_all') {
    await interaction.deferUpdate();
    const parts = customId.split('_');
    const qMsgId = parts[3];
    const idx = parseInt(parts[4]);
    const qq = activeQueues.get(qMsgId);
    if (qq && qq.items[idx]) {
      await executeSingleWarn(qq.guild, qq.items[idx], interaction.user);
      qq.items.splice(idx, 1);
      await updateQueue(qq);
    }
    return true;
  }

  // مسامحة فردية
  if (interaction.isButton() && customId.startsWith('pun_queue_forgive_') && customId !== 'pun_queue_forgive_all') {
    const parts = customId.split('_');
    const qMsgId = parts[3];
    const idx = parseInt(parts[4]);
    const modal = new ModalBuilder()
      .setCustomId(`pun_queue_forgive_item_${qMsgId}_${idx}`)
      .setTitle('🤝 سبب المسامحة');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('forgive_item_reason').setLabel('السبب').setStyle(TextInputStyle.Paragraph).setMinLength(5).setMaxLength(500).setRequired(true)
    ));
    await interaction.showModal(modal);
    return true;
  }

  return false;
}

/* ===================================================================
   مودالات المسامحة
   =================================================================== */
export async function handleQueueModal(interaction) {
  const { customId } = interaction;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!hasQueuePermission(interaction.member)) {
    return interaction.editReply({ content: '❌ فقط لجنة العقوبات ولجنة التفاعل والرئاسة تملك الصلاحية.' });
  }

  // مسامحة الكل
  if (customId.startsWith('pun_queue_forgive_all_modal')) {
    const reason = interaction.fields.getTextInputValue('forgive_all_reason');
    const qMsgId = customId.split('_')[5];
    const q = activeQueues.get(qMsgId);
    if (!q || q.items.length === 0) return interaction.editReply({ content: '❌ انتهت الجلسة.' });
    const count = q.items.length;
    for (const it of q.items) await executeSingleForgive(q.guild, it, interaction.user.id, reason);
    q.items = [];
    await updateQueue(q);
    await interaction.editReply({ content: `✅ تمت مسامحة ${count} عضو.` });
    return;
  }

  // مسامحة فردية
  if (customId.startsWith('pun_queue_forgive_item_')) {
    const parts = customId.split('_');
    // pun_queue_forgive_item_{qId}_{idx}
    const qMsgId = parts[4];
    const idx = parseInt(parts[5]);
    const reason = interaction.fields.getTextInputValue('forgive_item_reason');
    const q = activeQueues.get(qMsgId);
    if (!q || !q.items[idx]) return interaction.editReply({ content: '❌ انتهت الجلسة.' });
    const it = q.items[idx];
    await executeSingleForgive(q.guild, it, interaction.user.id, reason);
    q.items.splice(idx, 1);
    await updateQueue(q);
    await interaction.editReply({ content: `✅ تمت مسامحة ${it.gm}.` });
    return;
  }
}

/* ===================================================================
   تنفيذ إنذار واحد (للمسح من القائمة)
   =================================================================== */
async function executeSingleWarn(guild, item, executor) {
  const warn = new Warn({
    memberId: item.discordId, memberName: executor.tag,
    warningType: 'inactivity', typeName: 'عدم تفاعل',
    reason: 'عدم تفاعل مستمر (قرار من لجنة العقوبات)',
    givenBy: executor.id, givenByName: executor.tag,
    status: 'active', removed: false,
  });
  await warn.save();

  const config = loadConfig();
  const num = item.nextNum;
  if (item.gm) {
    let roleId = config.warnings?.roles?.[num.toString()];
    const actual = roleId?.id || roleId;
    if (actual) await item.gm.roles.add(actual).catch(() => {});
  }

  const dl = await ensureDailyLog(item.discordId);
  if (dl) { dl.warningCount = num; await dl.save(); }

  await logWarning(guild, {
    target: `<@${item.discordId}>`, mod: `<@${executor.id}>`,
    reason: 'عدم تفاعل مستمر', warningCount: num, totalWarnings: 3,
  });

  const { updateRoomEmoji } = await import('./interactionSystem.js');
  await updateRoomEmoji(guild, item.discordId, getStatusEmoji(STATUS.WARNED)).catch(() => {});

  item.memberData._lastInteractionStatus = STATUS.WARNED;
  await item.memberData.save().catch(() => {});

  const user = await guild.client.users.fetch(item.discordId).catch(() => null);
  if (user) {
    const rem = 3 - num;
    let m = `🟤 **تم تسجيل إنذار بعدم التفاعل.**\nمعك الآن ${num} من ٣ إنذارات.\n`;
    m += rem > 0 ? `متبقي ${rem} إنذار.` : '⚠️ وصلت ٣ إنذارات — اللجنة مخولة بفصلك.';
    await user.send(m).catch(() => {});
  }
}

/* ===================================================================
   تنفيذ دفعة إنذارات + إرسال قرار موحد + GIF
   =================================================================== */
async function executeBatchWarns(guild, items, executor) {
  for (const it of items) await executeSingleWarn(guild, it, executor);

  const config = loadConfig();
  const chId = config.warnings?.channels?.warningDecision?.id || getInteractionConfig().channels.decisions;
  const ch = chId ? (guild.channels.cache.get(chId) || await guild.channels.fetch(chId).catch(() => null)) : null;
  const basicRoleId = config.roles?.basic?.id || '';
  if (!ch) return;

  await ch.send({ content: WARN_GIF }).catch(() => {});

  const membersList = items.map(it => `- <@${it.discordId}>`).join('\n');
  const details = items.map(it => {
    const arabic = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس'][it.nextNum - 1] || it.nextNum;
    return `> • **بإعطاء تحذير (${arabic})** — <@${it.discordId}>`;
  }).join('\n');

  const decision = `
▬▬▬ ﷽ ▬▬▬
<:Family:1516647836744417320> **قرار إداري صادر من قيادة العائلة** 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 

**لكلاً من :**  
${membersList}

**السبب :**  || عدم تفاعل مستمر ||

${details}

-# ملاحظة : عند بلوغ 3 تحذيرات سيتم اتخاذ إجراء الفصل التلقائي.
**تــوقــيــع مسؤول القرار ✍:** ${executor}

||<@&${basicRoleId}>||
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`.trim();

  await ch.send({ content: decision }).catch(() => {});
}

/* ===================================================================
   تنفيذ مسامحة واحدة
   =================================================================== */
async function executeSingleForgive(guild, item, executorId, reason) {
  const today = formatDate(new Date());
  const dl = await DayLog.findOne({ discordId: item.discordId, date: today });
  if (dl) {
    dl.forgiven = true; dl.forgivenBy = executorId;
    dl.forgivenReason = reason; dl.forgivenAt = new Date();
    dl.daysAsViolator = 0;
    await dl.save();
  }

  const wc = await Warn.countDocuments({ memberId: item.discordId, warningType: 'inactivity', status: 'active', removed: false });
  await logForgive(guild, {
    target: `<@${item.discordId}>`, mod: `<@${executorId}>`,
    reason, warningCount: wc, totalWarnings: 3,
  }).catch(() => {});

  const { quickClassify, updateRoomEmoji } = await import('./interactionSystem.js');
  const res = await quickClassify(item.discordId);
  if (res?.emoji) await updateRoomEmoji(guild, item.discordId, res.emoji).catch(() => {});
}
