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
const lastSelections = new Map(); // key: `${userId}_${qMsgId}`, value: [indices]

function isActionable(q, idx) {
  return !q.warned.includes(idx) && !q.forgiven.includes(idx);
}

// إعادة بناء القائمة من قاعدة البيانات (لما البوت يعيد تشغيل وتنمسح الذاكرة)
async function rebuildQueue(guild, qMsgId) {
  if (!guild || !qMsgId) return null;
  const chId = getInteractionConfig().channels.alert;
  const items = await buildWarningQueue(guild);
  const q = { items, pendingWarns: [], forgiven: [], warned: [], chId: chId || '0', msgId: qMsgId, guild, log: [] };
  activeQueues.set(qMsgId, q);
  return q;
}

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

  const max = items.length;
  const sel = new StringSelectMenuBuilder()
    .setCustomId('pun_queue_sel')
    .setPlaceholder('اختر الأعضاء')
    .setMinValues(1)
    .setMaxValues(max)
    .addOptions(items.slice(0, 25).map((it, i) => ({
      label: it.gm?.displayName || it.discordId,
      description: `إنذار (${it.nextNum})`,
      value: `${i}`,
    })));

  const embed = embedWarn(`📋 قائمة الإنذارات — ${items.length} عضو`,
    items.map((it, i) => `${i + 1}. ${it.gm} — إنذار (${it.nextNum})`).join('\n'));

  const rows = [new ActionRowBuilder().addComponents(sel)];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pun_queue_forgive_all').setLabel('🤝 مسامحة الكل').setStyle(ButtonStyle.Success),
  ));

  const msg = await ch.send({ embeds: [embed], components: rows });
  activeQueues.set(msg.id, { items, pendingWarns: [], forgiven: [], warned: [], chId: ch.id, msgId: msg.id, guild, log: [] });
}

/* ===================================================================
   تحديث القائمة — كل الأعضاء يبقون في الـ embed مع حالتهم
   =================================================================== */
async function updateQueue(q) {
  const ch = q.guild.channels.cache.get(q.chId) || await q.guild.channels.fetch(q.chId).catch(() => null);
  if (!ch) return;
  const msg = await ch.messages.fetch(q.msgId).catch(() => null);
  if (!msg) return;

  const total = q.items.length;

  // الـ Select يعرض فقط الأعضاء القابلين للتعامل (غير منتهين)
  const actionableIndices = q.items.map((_, i) => i).filter(i => isActionable(q, i));
  const max = Math.max(actionableIndices.length, 1);
  const sel = new StringSelectMenuBuilder()
    .setCustomId('pun_queue_sel')
    .setPlaceholder('اختر الأعضاء')
    .setMinValues(1)
    .setMaxValues(max)
    .addOptions(actionableIndices.length > 0
      ? actionableIndices.slice(0, 25).map(i => ({
          label: q.items[i].gm?.displayName || q.items[i].discordId,
          description: q.pendingWarns.includes(i) ? `⏳ بانتظار الإنذار` : `إنذار (${q.items[i].nextNum})`,
          value: `${i}`,
        }))
      : [{ label: '✅ تمت المعالجة', value: '0' }]
    );

  // عرض جميع الأعضاء مع حالتهم
  const doneAll = q.items.every((_, i) => !isActionable(q, i));
  let desc = '';
  if (doneAll) {
    desc = '✅ **تمت معالجة جميع الأعضاء.**\n';
  }

  desc += q.items.map((it, i) => {
    const num = `${i + 1}.`;
    if (q.warned.includes(i)) return `⚠️ ${num} ${it.gm} — إنذار (${it.nextNum}) ✅`;
    if (q.forgiven.includes(i)) return `🤝 ${num} ${it.gm} — إنذار (${it.nextNum}) ✅`;
    if (q.pendingWarns.includes(i)) return `⏳ ${num} ${it.gm} — إنذار (${it.nextNum}) [معلق]`;
    return `${num} ${it.gm} — إنذار (${it.nextNum})`;
  }).join('\n');

  if (q.log.length > 0) {
    desc += '\n\n**📋 سجل الإجراءات:**\n' + q.log.map(e =>
      `> ${e.icon} **${e.tag}** — ${e.action} ${e.by ? `بواسطة ${e.by}` : ''}`
    ).join('\n');
  }

  const embed = embedWarn(`📋 قائمة العقوبات — ${total} عضو`, desc);

  const rows = [new ActionRowBuilder().addComponents(sel)];
  const btnRow = new ActionRowBuilder();

  if (q.pendingWarns.length > 0) {
    btnRow.addComponents(
      new ButtonBuilder().setCustomId(`pun_queue_send_warns_${q.msgId}`).setLabel(`📨 إرسال الإنذارات (${q.pendingWarns.length})`).setStyle(ButtonStyle.Danger),
    );
  }

  const remainingActionable = actionableIndices.filter(i => !q.pendingWarns.includes(i));
  if (remainingActionable.length > 0) {
    btnRow.addComponents(
      new ButtonBuilder().setCustomId('pun_queue_forgive_all').setLabel('🤝 مسامحة الكل').setStyle(ButtonStyle.Success),
    );
  }

  if (btnRow.components.length > 0) rows.push(btnRow);

  await msg.edit({ embeds: [embed], components: rows });
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
  const pLen = parts.length;
  // استخراج qId من customId حسب النمط
  if (pLen >= 5) {
    if (parts[3] === 'sel' || parts[3] === 'warns') qId = parts[4]; // pun_queue_{action}_sel/warns_{qId}
    else if (parts[3] === 'item') qId = parts[4];                  // pun_queue_forgive_item_{qId}_{idx} (مودال)
    else qId = parts[3];                                           // pun_queue_{action}_{qId}_{idx} (قديم)
    q = activeQueues.get(qId);
  }
  // Fallback للأزرار على الرسالة الأصلية
  if (!q) {
    for (const [id, qq] of activeQueues) {
      if (qq.msgId === (interaction.message?.id || id)) { q = qq; qId = id; break; }
    }
  }
  // إذا القائمة انمسحت من الذاكرة (إعادة تشغيل البوت)، نبنيها من قاعدة البيانات
  if (!q) {
    let qIdFromCustom = null;
    if (pLen >= 5) {
      if (parts[3] === 'sel' || parts[3] === 'warns') qIdFromCustom = parts[4];
      else if (parts[3] === 'item') qIdFromCustom = parts[4];
      else qIdFromCustom = parts[3];
    }
    const msgId = qIdFromCustom || interaction.message?.id;
    q = await rebuildQueue(interaction.guild, msgId);
    if (q) qId = msgId;
  }
  if (!q) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });

  // ====== Select Menu (multi-select) ======
  if (interaction.isStringSelectMenu() && customId === 'pun_queue_sel') {
    const indices = interaction.values.map(Number).filter(i => i >= 0 && i < q.items.length && isActionable(q, i));
    if (indices.length === 0) return interaction.reply({ content: '❌ جميع المختارين تمت معالجتهم مسبقاً.', flags: MessageFlags.Ephemeral });

    const selKey = `${interaction.user.id}_${qId}`;
    lastSelections.set(selKey, indices);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pun_queue_warn_sel_${qId}`).setLabel(`⚠️ إنذار المختارين (${indices.length})`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`pun_queue_forgive_sel_${qId}`).setLabel(`🤝 مسامحة المختارين (${indices.length})`).setStyle(ButtonStyle.Success),
    );

    await interaction.reply({ content: `✅ تم اختيار ${indices.length} عضو.`, components: [row], flags: MessageFlags.Ephemeral });
    return true;
  }

  // ====== إنذار مختارين → يضاف للمعلقين (يبقى في القائمة) ======
  if (interaction.isButton() && customId === `pun_queue_warn_sel_${qId}`) {
    await interaction.deferUpdate();
    const selKey = `${interaction.user.id}_${qId}`;
    const indices = lastSelections.get(selKey) || [];
    lastSelections.delete(selKey);

    let moved = 0;
    for (const idx of indices) {
      if (idx >= 0 && idx < q.items.length && !q.pendingWarns.includes(idx) && isActionable(q, idx)) {
        q.pendingWarns.push(idx);
        q.forgiven = q.forgiven.filter(f => f !== idx);
        moved++;
      }
    }
    console.log(`[PunishmentQueue] Warn selected: ${moved} moved to pendingWarns, total pending: ${q.pendingWarns.length}`);
    await updateQueue(q);
    await interaction.followUp({ content: `✅ تمت إضافة ${moved} عضو لقائمة الإنذار المعلق.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  // ====== مسامحة مختارين → تنفذ فوراً + تظهر في القائمة ======
  if (interaction.isButton() && customId === `pun_queue_forgive_sel_${qId}`) {
    await interaction.deferUpdate();
    const selKey = `${interaction.user.id}_${qId}`;
    const indices = lastSelections.get(selKey) || [];
    lastSelections.delete(selKey);

    let count = 0;
    for (const idx of indices) {
      if (idx < 0 || idx >= q.items.length || !isActionable(q, idx)) continue;
      if (q.pendingWarns.includes(idx)) continue; // المعلقين ما نسامحهم
      const it = q.items[idx];
      await executeSingleForgive(q.guild, it, interaction.user.id, 'مسامحة من لجنة العقوبات');
      q.forgiven.push(idx);
      q.log.push({ icon: '🤝', tag: it.gm?.displayName || it.discordId, action: 'مسامحة', by: interaction.user.tag });
      count++;
    }
    await updateQueue(q);
    await interaction.followUp({ content: `✅ تمت مسامحة ${count} عضو.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  // ====== إرسال الإنذارات المعلقة → تنفذ الكل دفعة ======
  if (interaction.isButton() && customId === `pun_queue_send_warns_${qId}`) {
    await interaction.deferUpdate();
    const toWarnIndices = [...q.pendingWarns].filter(i => i >= 0 && i < q.items.length);
    const toWarn = toWarnIndices.map(i => q.items[i]);

    q.pendingWarns = [];

    if (toWarn.length > 0) {
      await executeBatchWarns(q.guild, toWarn, interaction.user);
      toWarnIndices.forEach(i => {
        q.warned.push(i);
        q.log.push({ icon: '⚠️', tag: q.items[i].gm?.displayName || q.items[i].discordId, action: 'إنذار', by: interaction.user.tag });
      });
    }
    await updateQueue(q);
    await interaction.followUp({ content: `✅ تم إنزال قرار إنذار لـ ${toWarn.length} عضو.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  // ====== مسامحة الكل ======
  if (interaction.isButton() && customId === 'pun_queue_forgive_all') {
    await interaction.deferUpdate();
    let count = 0;
    for (let i = 0; i < q.items.length; i++) {
      if (!isActionable(q, i) || q.pendingWarns.includes(i)) continue;
      await executeSingleForgive(q.guild, q.items[i], interaction.user.id, 'مسامحة الكل');
      q.forgiven.push(i);
      q.log.push({ icon: '🤝', tag: q.items[i].gm?.displayName || q.items[i].discordId, action: 'مسامحة', by: interaction.user.tag });
      count++;
    }
    await updateQueue(q);
    await interaction.followUp({ content: `✅ تمت مسامحة ${count} عضو.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  return false;
}

/* ===================================================================
   مودالات (للتوافق مع الإصدارات القديمة فقط)
   =================================================================== */
export async function handleQueueModal(interaction) {
  const { customId } = interaction;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!hasQueuePermission(interaction.member)) {
    return interaction.editReply({ content: '❌ فقط لجنة العقوبات ولجنة التفاعل والرئاسة تملك الصلاحية.' });
  }

  // للتوافق — مودال مسامحة فردية قديم
  if (customId.startsWith('pun_queue_forgive_item_')) {
    const parts = customId.split('_');
    const qMsgId = parts[4];
    const idx = parseInt(parts[5]);
    const reason = interaction.fields.getTextInputValue('forgive_item_reason');
    let q = activeQueues.get(qMsgId);
    if (!q) q = await rebuildQueue(interaction.guild, qMsgId);
    if (!q || !q.items[idx]) return interaction.editReply({ content: '❌ انتهت الجلسة.' });
    if (!isActionable(q, idx)) return interaction.editReply({ content: '❌ تمت معالجة هذا العضو مسبقاً.' });
    const it = q.items[idx];
    await executeSingleForgive(q.guild, it, interaction.user.id, reason);
    q.forgiven.push(idx);
    q.log.push({ icon: '🤝', tag: it.gm?.displayName || it.discordId, action: 'مسامحة', by: interaction.user.tag });
    await updateQueue(q);
    await interaction.editReply({ content: `✅ تمت مسامحة ${it.gm}.` });
    return;
  }

  await interaction.editReply({ content: '❌ هذا المودال قديم وملغي.' });
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
  try {
    await warn.save();
    console.log(`[PunishmentQueue] ✅ Warning saved for ${item.discordId}, ID: ${warn._id}`);
  } catch (e) {
    console.error(`[PunishmentQueue] ❌ Failed to save warning for ${item.discordId}:`, e);
  }

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
   إرسال قرار إنذار فردي + GIF
   =================================================================== */
async function sendSingleWarnDecision(guild, item, executor) {
  const config = loadConfig();
  const chId = config.warnings?.channels?.warningDecision?.id || getInteractionConfig().channels.decisions;
  const ch = chId ? (guild.channels.cache.get(chId) || await guild.channels.fetch(chId).catch(() => null)) : null;
  const basicRoleId = config.roles?.basic?.id || '';
  if (!ch) return;

  await ch.send({ content: WARN_GIF }).catch(() => {});

  const arabic = ['أول', 'ثاني', 'ثالث', 'رابع', 'خامس'][item.nextNum - 1] || item.nextNum;
  const decision = `
▬▬▬ ﷽ ▬▬▬
<:Family:1516647836744417320> **قرار إداري صادر من قيادة العائلة** 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 

**لكلاً من :**  
- <@${item.discordId}>

**السبب :**  || عدم تفاعل مستمر ||

> • **بإعطاء تحذير (${arabic})** — <@${item.discordId}>

-# ملاحظة : عند بلوغ 3 تحذيرات سيتم اتخاذ إجراء الفصل التلقائي.
**تــوقــيــع مسؤول القرار ✍:** ${executor}

||<@&${basicRoleId}>||
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`.trim();

  await ch.send({ content: decision }).catch(() => {});
}

/* ===================================================================
   تنفيذ دفعة إنذارات + إرسال قرار موحد + GIF
   =================================================================== */
async function executeBatchWarns(guild, items, executor) {
  console.log(`[PunishmentQueue] executeBatchWarns: ${items.length} members for ${executor.tag}`);
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
