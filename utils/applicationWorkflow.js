import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, EmbedBuilder
} from 'discord.js';
import { createModel } from '../data/db.js';
const ApplicationStage = createModel('ApplicationStage');
import Ticket from '../models/Ticket.js';
import { success as embedSuccess } from './embedStyles.js';
import { dmUser } from './notificationSystem.js';
import { loadConfig } from './configLoader.js';

const WORKFLOW_STAGES = [
  {
    index: 0,
    name: '📜 قوانين التقديم',
    type: 'accept',
    description: `𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪

**1. الاحترام المتبادل بين أعضاء الإدارة**
يُمنع استخدام السلطة بشكل شخصي أو للإهانة. أي خلاف داخلي يتم حله عبر القناة الخاصة بك.

**2. يجب دفع التأمين**
وقدره 500 ألف إلى بنك العائلة وإرسال الدليل في تيكت الذي تم قبولك فيه.

**3. يكون الفل 25 فما فوق**
سيتم رفع الفل إلى 40 لاحقاً. إذا كنت أقل نعطيك مهلة أسبوع تزيد فلك.
القوانين تطبق على الجميع بالتساوي.

**4. عدم التفاعل لمدة يوم**
تتعرض لتحذير. 3 تحذيرات = فصل.
كلفة إزالة التحذير الأول 250 ألف والثاني 500 ألف.
في حال عدم المقدرة على التفاعل تبلغنا وتأخذ إجازة أو عذر.

**5. التوجه للمزارع والسيناريو بشكل دوري**

**6. سيناريو إجباري**
بين اليوم والآخر عند الساعة 9 (الوقت قابل للتغير).

**7. نظام الترقيات**
يكون بشكل نقاط. لكل رتبة عدد نقاط معين ولكل تقرير عدد نقاط. التفاصيل تتوضح بعد قبولك.

**8. الطائرة**
لا يمكنك أخذها إلا بعد خضوعك لاختبار وتجاوزه.

**9. الانضمام إلى منظمة جروف ستريت**
من خلال <#1452046693687230566>`
  },
  { index: 1, name: 'تاريخ الميلاد', type: 'image', description: '- Dd= يوم\n- mm= شهر\n- العمر معروف', image: 'https://cdn.discordapp.com/attachments/1388879412581105694/1396164968235270306/1231140229340069938.png?ex=687e68f3&is=687d1773&hm=80521264842aab9dba8a137c782a5078c2afcea33319fb3e71f6d94b684387a3&' },
  { index: 2, name: 'صورة الفل (Level)', type: 'image', description: 'إرسال صورة واضحة للفل الحالي' },
];

const pendingImages = new Map();

function isCommitteeMember(member) {
  return member.roles.cache.has('1389190409317646336') ||
    member.permissions.has(PermissionFlagsBits.Administrator);
}

async function getStageRecord(ticketNumber) {
  let record = await ApplicationStage.findOne({ ticketNumber: Number(ticketNumber) });
  if (!record) {
    record = new ApplicationStage({
      ticketNumber: Number(ticketNumber),
      currentStage: 0,
      status: 'active',
      stages: WORKFLOW_STAGES.map(s => ({
        index: s.index, name: s.name, type: s.type,
        status: 'pending', adminId: null, adminNote: null, imageUrl: null,
        stageMessageId: null, adminMessageId: null,
      })),
      startedAt: new Date(),
    });
    await record.save();
  } else {
    if (record.stages.length < WORKFLOW_STAGES.length) {
      for (let i = record.stages.length; i < WORKFLOW_STAGES.length; i++) {
        record.stages.push({
          index: i, name: WORKFLOW_STAGES[i].name, type: WORKFLOW_STAGES[i].type,
          status: 'pending', adminId: null, adminNote: null, imageUrl: null,
          stageMessageId: null, adminMessageId: null,
        });
      }
    } else if (record.stages.length > WORKFLOW_STAGES.length) {
      record.stages.splice(WORKFLOW_STAGES.length);
    }
    let changed = false;
    for (const st of record.stages) {
      if (st.status === 'waiting_image') {
        st.status = 'active';
        st.imageUrl = null;
        changed = true;
      }
    }
    if (changed) await record.save();
  }
  return record;
}

/* ============== Builders ============== */

function buildProgress(stages) {
  const ci = stages.findIndex(s => s.status === 'active' || s.status === 'waiting_image' || s.status === 'waiting_admin');
  return WORKFLOW_STAGES.map((s, i) => {
    const st = stages[i];
    if (st.status === 'completed') return `✅ المرحلة ${i + 1}: ${s.name}`;
    if (st.status === 'rejected') return `❌ المرحلة ${i + 1}: ${s.name}${st.adminNote ? ` (${st.adminNote})` : ''}`;
    if (i === ci) return `⏳ **المرحلة ${i + 1}: ${s.name}**`;
    return `⬜ المرحلة ${i + 1}: ${s.name}`;
  }).join('\n');
}

async function buildStageEmbed(record, stageIndex) {
  const def = WORKFLOW_STAGES[stageIndex];
  const data = record.stages[stageIndex];
  const ticket = (await Ticket.findOne({ ticketNumber: record.ticketNumber })) || {};
  const applicant = ticket.userId ? `<@${ticket.userId}>` : 'غير معروف';
  const progress = buildProgress(record.stages);
  const total = WORKFLOW_STAGES.length;
  const done = record.stages.filter(s => s.status === 'completed').length;

  const barLen = 10;
  const filled = Math.round((done / total) * barLen);
  const progressBar = '🟩'.repeat(filled) + '⬜'.repeat(Math.max(0, barLen - filled));

  const colors = [0xF1C40F, 0x9B59B6, 0x2ECC71];
  const color = colors[stageIndex] || 0x3498DB;

  let desc;
  if (data.status === 'completed') {
    desc = `✅ **تم الانتهاء من هذه المرحلة**\n\n${progress}\n\n${progressBar} \`${done}/${total}\``;
  } else if (data.status === 'rejected') {
    desc = `❌ **تم رفض المرحلة**${data.adminNote ? `\n> **السبب:** ${data.adminNote}` : ''}\n\n${progress}\n\n${progressBar} \`${done}/${total}\``;
  } else if (data.status === 'waiting_image') {
    desc = `⏳ **بانتظار إرسال الصورة...**\n\n${progress}\n\n${progressBar} \`${done}/${total}\``;
  } else if (data.status === 'waiting_admin') {
    desc = `⏳ **بانتظار مراجعة الإدارة...**\n\n${progress}\n\n${progressBar} \`${done}/${total}\``;
  } else {
    desc = `${progress}\n\n━━━━━━━━━━━━━━━━━━\n**${def.name}**\n${def.description}\n\n${progressBar} \`${done}/${total}\``;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`📋 مراحل التقديم - تذكرة #${record.ticketNumber}`)
    .setDescription(desc)
    .addFields(
      { name: '👤 مقدم الطلب', value: applicant, inline: true },
      { name: '📊 التقدم', value: `${done}/${total}`, inline: true }
    )
    .setFooter({ text: `تم الانتهاء من ${done} من ${total} مراحل • 𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘` })
    .setTimestamp();

  if (data?.imageUrl && data.status === 'completed') embed.setImage(data.imageUrl);
  else if (def?.image && data.status !== 'rejected' && data.status !== 'waiting_image' && data.status !== 'waiting_admin') {
    embed.setImage(def.image);
  }
  return embed;
}

function buildStageButtons(record, stageIndex) {
  const rows = [];
  const def = WORKFLOW_STAGES[stageIndex];
  const data = record.stages[stageIndex];
  if (!def || !data) return rows;
  const t = record.ticketNumber;

  if (def.type === 'accept' && data.status === 'active') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appw_terms_accept_${t}`).setLabel('✅ أوافق على الشروط').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`appw_terms_reject_${t}`).setLabel('❌ أرفض الشروط').setStyle(ButtonStyle.Danger),
    ));
  }

  if (def.type === 'image' && data.status === 'active') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appw_ready_image_${t}`).setLabel('📷 جاهز لإرسال الصورة').setStyle(ButtonStyle.Primary),
    ));
  }

  if (data.status === 'rejected') {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appw_retry_${t}`).setLabel('🔄 إعادة المحاولة').setStyle(ButtonStyle.Secondary),
    ));
  }

  if (record.status === 'active') {
    const completedCount = record.stages.filter(s => s.status === 'completed').length;
    if (completedCount === WORKFLOW_STAGES.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`appw_complete_${t}`).setLabel('🎉 إنهاء القبول').setStyle(ButtonStyle.Success),
      ));
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appw_cancel_${t}`).setLabel('⛔ إلغاء').setStyle(ButtonStyle.Danger),
    ));
  }

  return rows;
}

/* ============== Message Management ============== */

async function sendStageMessage(guild, record, stageIndex) {
  const ticket = await Ticket.findOne({ ticketNumber: record.ticketNumber });
  if (!ticket?.channelId) { console.log(`[Workflow] sendStageMessage: no channelId`); return; }
  const channel = await guild.channels.fetch(ticket.channelId).catch(e => { console.log(`[Workflow] sendStageMessage: ${e.message}`); return null; });
  if (!channel) return;

  const embed = await buildStageEmbed(record, stageIndex);
  const buttons = buildStageButtons(record, stageIndex);

  try {
    const msg = await channel.send({ embeds: [embed], components: buttons });
    record.stages[stageIndex].stageMessageId = msg.id;
    await record.save();
    console.log(`[Workflow] sent stage ${stageIndex} msg ${msg.id}`);
  } catch (e) { console.log(`[Workflow] sendStageMessage error: ${e.message}`); }
}

async function editStageMessage(guild, record, stageIndex) {
  const ticket = await Ticket.findOne({ ticketNumber: record.ticketNumber });
  if (!ticket?.channelId) return;
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel) return;

  const msgId = record.stages[stageIndex]?.stageMessageId;
  if (!msgId) { await sendStageMessage(guild, record, stageIndex); return; }

  try {
    const msg = await channel.messages.fetch(msgId).catch(() => null);
    if (!msg) { await sendStageMessage(guild, record, stageIndex); return; }
    const embed = await buildStageEmbed(record, stageIndex);
    const buttons = buildStageButtons(record, stageIndex);
    await msg.edit({ embeds: [embed], components: buttons });
  } catch (e) { console.log(`[Workflow] editStageMessage error: ${e.message}`); }
}

async function sendAdminReview(guild, record, stageIndex, imageUrl) {
  const ticket = await Ticket.findOne({ ticketNumber: record.ticketNumber });
  if (!ticket?.channelId) return;
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel) return;

  const def = WORKFLOW_STAGES[stageIndex];
  const t = record.ticketNumber;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`📸 مراجعة الصورة - ${def.name}`)
    .setDescription(`الصورة المقدمة من <@${ticket.userId}>`)
    .addFields(
      { name: '👤 مقدم الطلب', value: `<@${ticket.userId}>`, inline: true },
      { name: '📌 المرحلة', value: `${stageIndex + 1}/${WORKFLOW_STAGES.length}`, inline: true },
    )
    .setImage(imageUrl)
    .setTimestamp()
    .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`appw_admin_accept_${t}`).setLabel('✅ قبول').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`appw_admin_reject_${t}`).setLabel('❌ رفض').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`appw_admin_resubmit_${t}`).setLabel('🔄 طلب إعادة').setStyle(ButtonStyle.Secondary),
  );

  try {
    const msg = await channel.send({
      content: '<@&1389190409317646336>',
      embeds: [embed],
      components: [row],
    });
    record.stages[stageIndex].adminMessageId = msg.id;
    await record.save();
  } catch (e) { console.log(`[Workflow] sendAdminReview error: ${e.message}`); }
}

async function editAdminMessage(guild, record, stageIndex, accepted, reason) {
  const ticket = await Ticket.findOne({ ticketNumber: record.ticketNumber });
  if (!ticket?.channelId) return;
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel) return;

  const msgId = record.stages[stageIndex]?.adminMessageId;
  if (!msgId) return;

  try {
    const msg = await channel.messages.fetch(msgId).catch(() => null);
    if (!msg) return;
    const embed = new EmbedBuilder()
      .setColor(accepted ? 0x2ECC71 : 0xE74C3C)
      .setTitle(accepted ? '✅ تم قبول الصورة' : '❌ تم رفض الصورة')
      .setDescription(accepted
        ? `تم قبول الصورة للمرحلة "${WORKFLOW_STAGES[stageIndex].name}"`
        : `تم رفض الصورة للمرحلة "${WORKFLOW_STAGES[stageIndex].name}"${reason ? `\n> **السبب:** ${reason}` : ''}`)
      .addFields(
        { name: '📌 المرحلة', value: `${stageIndex + 1}/${WORKFLOW_STAGES.length}`, inline: true },
        { name: '👮 تم بواسطة', value: `<@${record.stages[stageIndex]?.adminId}>`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });
    await msg.edit({ embeds: [embed], components: [] });
  } catch {}
}

async function nextStage(guild, record) {
  try {
    const ci = record.stages.findIndex(s => s.status === 'active' || s.status === 'waiting_admin');
    if (ci === -1) { console.log(`[Workflow] nextStage: no active/waiting_admin stage found`); return; }

    console.log(`[Workflow] nextStage: completing stage ${ci}/${WORKFLOW_STAGES.length - 1}`);
    record.stages[ci].status = 'completed';
    if (ci < WORKFLOW_STAGES.length - 1) {
      record.currentStage = ci + 1;
      record.stages[ci + 1].status = 'active';
      console.log(`[Workflow] nextStage: activated stage ${ci + 1}`);
      await record.save();
      await editStageMessage(guild, record, ci);
      await sendStageMessage(guild, record, ci + 1);
    } else {
      console.log(`[Workflow] nextStage: last stage completed, all ${WORKFLOW_STAGES.length} done`);
      await record.save();
      await editStageMessage(guild, record, ci);
      await sendAutoSummary(guild, record);
    }
  } catch (e) {
    console.error(`[Workflow] nextStage error: ${e.message}`);
  }
}

async function sendAutoSummary(guild, record) {
  try {
    const ticket = await Ticket.findOne({ ticketNumber: record.ticketNumber });
    if (!ticket?.channelId) return;
    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel) return;

    const summaryFields = [];
    let firstImage = null;
    for (let i = 0; i < WORKFLOW_STAGES.length; i++) {
      const st = record.stages[i];
      const def = WORKFLOW_STAGES[i];
      if (st.status === 'completed') {
        let val = '✅ مقبول';
        if (st.imageUrl) {
          val += `\n[📸 عرض الصورة](${st.imageUrl})`;
          if (!firstImage) firstImage = st.imageUrl;
        }
        if (st.adminId) val += `\nبواسطة <@${st.adminId}>`;
        summaryFields.push({ name: `المرحلة ${i + 1}: ${def.name}`, value: val, inline: false });
      }
    }

    const summaryEmbed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('✅ تم اجتياز جميع المراحل')
      .setDescription('تم اجتياز جميع مراحل التقديم بنجاح.')
      .addFields(summaryFields)
      .addFields(
        { name: '👤 مقدم الطلب', value: `<@${ticket?.userId}>`, inline: true },
        { name: '🎫 رقم التذكرة', value: `#${record.ticketNumber}`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });

    if (firstImage) summaryEmbed.setImage(firstImage);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`appw_proceed_${record.ticketNumber}`).setLabel('📝 استكمال الإجراءات').setStyle(ButtonStyle.Primary),
    );

    await channel.send({ embeds: [summaryEmbed], components: [row] });
    console.log(`[Workflow] auto-summary sent for #${record.ticketNumber}`);
  } catch (e) {
    console.error(`[Workflow] sendAutoSummary error: ${e.message}`);
  }
}

/* ============== Exports ============== */

async function initWorkflow(guild, client, ticketNumber, replyFn) {
  const ticket = await Ticket.findOne({ ticketNumber: Number(ticketNumber) });
  if (!ticket) { if (replyFn) await replyFn('❌ التذكرة غير موجودة!'); return; }
  if (ticket.type !== 'application') { if (replyFn) await replyFn('❌ هذا النظام فقط لتذاكر التقديم!'); return; }
  console.log(`[Workflow] ticket #${ticketNumber} found, type=application, channel=${ticket.channelId}`);

  const existing = await ApplicationStage.findOne({ ticketNumber: Number(ticketNumber), status: 'active' });
  if (existing) { if (replyFn) await replyFn('❌ المراحل شغالة بالفعل لهذه التذكرة!'); return; }

  const record = await getStageRecord(ticketNumber);
  record.stages[0].status = 'active';
  await record.save();
  await sendStageMessage(guild, record, 0);

  if (ticket?.userId) {
    await dmUser(client, ticket.userId,
      embedSuccess('📋 بدء مراحل التقديم', `تم بدء مراحل التقديم لتذكرتك #${ticketNumber}.\nالرجاء التوجه إلى قناة التذكرة لإكمال المراحل.`)
    ).catch(() => {});
  }

  console.log(`[Workflow] initWorkflow completed for #${ticketNumber}`);
}

export async function autoStartWorkflow(guild, client, ticketNumber) {
  console.log(`[Workflow] autoStartWorkflow called for ticket #${ticketNumber}`);
  try {
    await initWorkflow(guild, client, ticketNumber, null);
  } catch (error) {
    console.error('❌ خطأ في البدء التلقائي:', error.message);
  }
}

export async function startWorkflow(interaction, ticketNumber) {
  console.log(`[Workflow] startWorkflow called for ticket #${ticketNumber}`);
  try {
    await interaction.deferUpdate();
    await initWorkflow(interaction.guild, interaction.client, ticketNumber, async (msg) => {
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    });
    await interaction.followUp({ content: '✅ تم بدء مراحل التقديم!', flags: MessageFlags.Ephemeral });
    console.log(`[Workflow] startWorkflow completed for #${ticketNumber}`);
  } catch (error) {
    console.error('❌ خطأ في بدء المراحل:', error.message);
    try { if (!interaction.replied) await interaction.followUp({ content: '❌ حدث خطأ أثناء بدء المراحل', flags: MessageFlags.Ephemeral }); } catch {}
  }
}

export async function migrateExistingWorkflows(client) {
  const tickets = await Ticket.find({ type: 'application' });
  let closed = 0, open = 0;
  const guildId = loadConfig()?.bot?.guildId;
  const guild = guildId ? (client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null)) : null;

  for (const ticket of tickets) {
    const existing = await ApplicationStage.findOne({ ticketNumber: ticket.ticketNumber });
    if (existing) continue;

    if (ticket.status === 'closed') {
      const record = new ApplicationStage({
        ticketNumber: ticket.ticketNumber, currentStage: WORKFLOW_STAGES.length, status: 'completed',
        stages: WORKFLOW_STAGES.map(s => ({ index: s.index, name: s.name, type: s.type, status: 'completed', adminId: null, adminNote: null, imageUrl: null, stageMessageId: null, adminMessageId: null })),
        startedAt: ticket.createdAt || new Date(), completedAt: new Date(),
      });
      await record.save();
      closed++;
    } else if (ticket.status === 'open' || ticket.status === 'claimed') {
      const record = new ApplicationStage({
        ticketNumber: ticket.ticketNumber, currentStage: 0, status: 'active',
        stages: WORKFLOW_STAGES.map(s => ({ index: s.index, name: s.name, type: s.type, status: s.index === 0 ? 'active' : 'pending', adminId: null, adminNote: null, imageUrl: null, stageMessageId: null, adminMessageId: null })),
        startedAt: new Date(),
      });
      await record.save();
      if (guild && ticket.channelId) {
        await sendStageMessage(guild, record, 0).catch(() => {});
      }
      open++;
    }
  }
  if (closed > 0 || open > 0) console.log(`✅ [Workflow] مراحل: ${closed} مقبولة + ${open} مفتوحة`);
  return { closed, open };
}

export async function handleWorkflowInteraction(interaction) {
  const { customId } = interaction;
  if (!customId.startsWith('appw_')) return false;

  const parts = customId.split('_');
  const action = parts[1];
  const ticketNumber = Number(parts[parts.length - 1]);
  if (!ticketNumber || isNaN(ticketNumber)) return false;

  const record = await getStageRecord(ticketNumber);
  if (!record || record.status !== 'active') {
    await interaction.reply({ content: '❌ هذه المراحل غير نشطة', flags: MessageFlags.Ephemeral });
    return true;
  }

  switch (action) {
    case 'terms':
      if (parts[2] === 'accept') await handleTermsAccept(interaction, record, ticketNumber);
      else if (parts[2] === 'reject') await handleTermsReject(interaction, record, ticketNumber);
      break;
    case 'ready':
      await handleImageReady(interaction, record, ticketNumber);
      break;
    case 'admin':
      if (parts[2] === 'accept') await handleAdminAccept(interaction, record, ticketNumber);
      else if (parts[2] === 'reject') await handleAdminReject(interaction, record, ticketNumber);
      else if (parts[2] === 'resubmit') await handleAdminResubmit(interaction, record, ticketNumber);
      break;
    case 'retry':
      await handleRetry(interaction, record, ticketNumber);
      break;
    case 'complete':
      await handleCompleteFinish(interaction, record, ticketNumber);
      break;
    case 'proceed':
      await handleProceed(interaction, record, ticketNumber);
      break;
    case 'cancel':
      await handleCancel(interaction, record, ticketNumber);
      break;
  }
  return true;
}

/* ============== Stage Handlers ============== */

async function handleTermsAccept(interaction, record, ticketNumber) {
  const ticket = await Ticket.findOne({ ticketNumber });
  if (interaction.user.id !== ticket?.userId) {
    return interaction.reply({ content: '❌ فقط صاحب التذكرة يمكنه الموافقة على الشروط', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  const ci = record.stages.findIndex(s => s.status === 'active');
  if (ci === -1) return;
  record.stages[ci].adminId = interaction.user.id;
  await record.save();
  await nextStage(interaction.guild, record);
}

async function handleTermsReject(interaction, record, ticketNumber) {
  const ticket = await Ticket.findOne({ ticketNumber });
  if (interaction.user.id !== ticket?.userId) {
    return interaction.reply({ content: '❌ فقط صاحب التذكرة يمكنه رفض الشروط', flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`appw_terms_reason_${ticketNumber}`)
    .setTitle('سبب الرفض');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('لماذا ترفض الشروط؟').setStyle(TextInputStyle.Paragraph).setPlaceholder('اكتب سبب الرفض...').setRequired(true),
    ),
  );

  await interaction.showModal(modal);

  try {
    const modalInteraction = await interaction.awaitModalSubmit({
      filter: i => i.customId === `appw_terms_reason_${ticketNumber}`, time: 300000,
    });
    const reason = modalInteraction.fields.getTextInputValue('reason');
    record.status = 'rejected';
    record.stages[0].status = 'rejected';
    record.stages[0].adminId = modalInteraction.user.id;
    record.stages[0].adminNote = reason;
    await record.save();
    await modalInteraction.deferUpdate();
    await editStageMessage(modalInteraction.guild, record, 0);
    const rejectTermsEmbed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('❌ تم رفض الشروط')
      .setDescription(`رفض <@${modalInteraction.user.id}> شروط التقديم.\n> **السبب:** ${reason}\n\nسيتم إغلاق التذكرة بعد 5 ثوانٍ.`)
      .setTimestamp()
      .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });
    await modalInteraction.channel.send({ embeds: [rejectTermsEmbed] });
    setTimeout(async () => {
      try { await modalInteraction.channel.delete(); } catch {}
    }, 5000);
  } catch {}
}

async function handleImageReady(interaction, record, ticketNumber) {
  const ticket = await Ticket.findOne({ ticketNumber });
  if (interaction.user.id !== ticket?.userId) {
    return interaction.reply({ content: '❌ فقط صاحب التذكرة يمكنه إرسال الصورة', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferUpdate();

  const ci = record.stages.findIndex(s => s.status === 'active');
  const def = WORKFLOW_STAGES[ci];
  record.stages[ci].status = 'waiting_image';
  await record.save();
  await editStageMessage(interaction.guild, record, ci);

  const waitEmbed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle(`⏳ انتظار الصورة - ${def.name}`)
    .setDescription(`${interaction.user}، الرجاء إرسال صورتك الآن في هذه القناة.\n⏱ لديك دقيقتان لإرسال الصورة.`)
    .setTimestamp()
    .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });
  const infoMsg = await interaction.channel.send({ embeds: [waitEmbed] });
  const channelId = interaction.channelId;

  const timer = setTimeout(async () => {
    pendingImages.delete(channelId);
    record.stages[ci].status = 'active';
    record.stages[ci].imageUrl = null;
    await record.save();
    await editStageMessage(interaction.guild, record, ci);
    await infoMsg.delete().catch(() => {});
    const timeoutEmbed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('⏰ انتهى الوقت')
      .setDescription('لم يتم إرسال الصورة في الوقت المحدد. اضغط على "📷 جاهز" للمحاولة مرة أخرى.')
      .setTimestamp()
      .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });
    await interaction.channel.send({ embeds: [timeoutEmbed] });
  }, 120000);

  pendingImages.set(channelId, { userId: interaction.user.id, ticketNumber, stageIndex: ci, timer });

  try {
    const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
    const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 120000, errors: ['time'] });
    const imageMsg = collected.first();
    const attachment = imageMsg.attachments.first();

    clearTimeout(timer);
    pendingImages.delete(channelId);
    await infoMsg.delete().catch(() => {});

    console.log(`[Workflow] imageUrl captured: url="${attachment.url}", proxy="${attachment.proxyURL}"`);
    record.stages[ci].status = 'waiting_admin';
    record.stages[ci].imageUrl = attachment.url;
    await record.save();
    await editStageMessage(interaction.guild, record, ci);
    await sendAdminReview(interaction.guild, record, ci, attachment.url);
  } catch {
    clearTimeout(timer);
    pendingImages.delete(channelId);
  }
}

async function handleAdminAccept(interaction, record, ticketNumber) {
  if (!isCommitteeMember(interaction.member)) {
    return interaction.reply({ content: '❌ ليس لديك صلاحية لقبول المرحلة', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();

  const ci = record.stages.findIndex(s => s.status === 'waiting_admin');
  if (ci === -1) return;

  record.stages[ci].adminId = interaction.user.id;
  await record.save();

  await editAdminMessage(interaction.guild, record, ci, true, null);
  await nextStage(interaction.guild, record);

  const confirmEmbed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('✅ تم قبول المرحلة')
    .setDescription(`تم قبول المرحلة "${WORKFLOW_STAGES[ci].name}"`)
    .addFields(
      { name: '👮 بواسطة', value: `${interaction.user}`, inline: true },
      { name: '📌 المرحلة', value: `${ci + 1}/${WORKFLOW_STAGES.length}`, inline: true },
    )
    .setTimestamp()
    .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });

  await interaction.channel.send({ embeds: [confirmEmbed] });
}

async function handleAdminReject(interaction, record, ticketNumber) {
  if (!isCommitteeMember(interaction.member)) {
    return interaction.reply({ content: '❌ ليس لديك صلاحية لرفض المرحلة', flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`appw_reject_reason_${ticketNumber}`)
    .setTitle('سبب الرفض');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('سبب الرفض').setStyle(TextInputStyle.Paragraph).setPlaceholder('اكتب سبب الرفض...').setRequired(true),
    ),
  );

  await interaction.showModal(modal);

  try {
    const modalInteraction = await interaction.awaitModalSubmit({
      filter: i => i.customId === `appw_reject_reason_${ticketNumber}`, time: 300000,
    });
    const reason = modalInteraction.fields.getTextInputValue('reason');
    const ci = record.stages.findIndex(s => s.status === 'waiting_admin' || s.status === 'active');
    if (ci === -1) return;
    record.stages[ci].status = 'rejected';
    record.stages[ci].adminId = modalInteraction.user.id;
    record.stages[ci].adminNote = reason;
    await record.save();
    await modalInteraction.deferUpdate();

    await editAdminMessage(modalInteraction.guild, record, ci, false, reason);
    await editStageMessage(modalInteraction.guild, record, ci);

    const rejectEmbed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('❌ تم رفض المرحلة')
      .setDescription(`تم رفض المرحلة "${WORKFLOW_STAGES[ci].name}"`)
      .addFields(
        { name: '👮 بواسطة', value: `${modalInteraction.user}`, inline: true },
        { name: '📌 السبب', value: reason, inline: false },
      )
      .setTimestamp()
      .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });

    await modalInteraction.channel.send({ embeds: [rejectEmbed] });
  } catch {}
}

async function handleAdminResubmit(interaction, record, ticketNumber) {
  if (!isCommitteeMember(interaction.member)) {
    return interaction.reply({ content: '❌ ليس لديك صلاحية', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();

  const ci = record.stages.findIndex(s => s.status === 'waiting_admin');
  if (ci === -1) return;

  record.stages[ci].status = 'active';
  record.stages[ci].imageUrl = null;
  await record.save();

  const msgId = record.stages[ci]?.adminMessageId;
  if (msgId) {
    try {
      const msg = await interaction.channel.messages.fetch(msgId).catch(() => null);
      if (msg) {
        const embed = new EmbedBuilder()
          .setColor(0xF39C12)
          .setTitle('🔄 طلب إعادة إرسال الصورة')
          .setDescription(`طلب <@${interaction.user.id}> إعادة إرسال الصورة للمرحلة "${WORKFLOW_STAGES[ci].name}"`)
          .setTimestamp()
          .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });
        await msg.edit({ embeds: [embed], components: [] });
      }
    } catch {}
  }

  await editStageMessage(interaction.guild, record, ci);

  const resubmitEmbed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('🔄 طلب إعادة')
    .setDescription(`طلب <@${interaction.user.id}> إعادة إرسال الصورة.\nالرجاء الضغط على "📷 جاهز" لإرسال صورة جديدة.`)
    .setTimestamp()
    .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });
  await interaction.channel.send({ embeds: [resubmitEmbed] });
}

async function handleRetry(interaction, record, ticketNumber) {
  const ticket = await Ticket.findOne({ ticketNumber });
  if (interaction.user.id !== ticket?.userId) {
    return interaction.reply({ content: '❌ فقط صاحب التذكرة يمكنه إعادة المحاولة', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  const ci = record.stages.findIndex(s => s.status === 'rejected');
  if (ci === -1) return;
  record.stages[ci].status = 'active';
  record.stages[ci].imageUrl = null;
  record.stages[ci].adminNote = null;
  await record.save();
  await editStageMessage(interaction.guild, record, ci);
}

async function handleCompleteFinish(interaction, record, ticketNumber) {
  if (!isCommitteeMember(interaction.member)) {
    return interaction.reply({ content: '❌ ليس لديك صلاحية لإنهاء القبول', flags: MessageFlags.Ephemeral });
  }
  const done = record.stages.filter(s => s.status === 'completed').length;
  if (done < WORKFLOW_STAGES.length) {
    return interaction.reply({ content: '❌ لم تكتمل جميع المراحل بعد!', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();

  const ticket = await Ticket.findOne({ ticketNumber });

  const summaryFields = [];
  let firstImage = null;
  for (let i = 0; i < WORKFLOW_STAGES.length; i++) {
    const st = record.stages[i];
    const def = WORKFLOW_STAGES[i];
    if (st.status === 'completed') {
      let val = '✅ مقبول';
      if (st.imageUrl) {
        val += `\n[📸 عرض الصورة](${st.imageUrl})`;
        if (!firstImage) firstImage = st.imageUrl;
      }
      if (st.adminId) val += `\nبواسطة <@${st.adminId}>`;
      summaryFields.push({ name: `المرحلة ${i + 1}: ${def.name}`, value: val, inline: false });
    }
  }

  const summaryEmbed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('✅ تم اجتياز جميع المراحل')
    .setDescription('تم اجتياز جميع مراحل التقديم بنجاح.')
    .addFields(summaryFields)
    .addFields(
      { name: '👤 مقدم الطلب', value: `<@${ticket?.userId}>`, inline: true },
      { name: '🎫 رقم التذكرة', value: `#${ticketNumber}`, inline: true },
    )
    .setTimestamp()
    .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });

  if (firstImage) summaryEmbed.setImage(firstImage);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`appw_proceed_${ticketNumber}`).setLabel('📝 استكمال الإجراءات').setStyle(ButtonStyle.Primary),
  );

  await interaction.channel.send({ embeds: [summaryEmbed], components: [row] });
}

async function handleProceed(interaction, record, ticketNumber) {
  if (!isCommitteeMember(interaction.member)) {
    return interaction.reply({ content: '❌ ليس لديك صلاحية', flags: MessageFlags.Ephemeral });
  }
  record.status = 'completed';
  record.completedAt = new Date();
  await record.save();

  const { finishApplication } = await import('./ticketManager.js');
  await finishApplication(interaction, ticketNumber);

  try {
    for (const st of record.stages) {
      if (st.stageMessageId) {
        const channel = interaction.channel;
        if (channel) {
          const msg = await channel.messages.fetch(st.stageMessageId).catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        }
      }
      if (st.adminMessageId) {
        const channel = interaction.channel;
        if (channel) {
          const msg = await channel.messages.fetch(st.adminMessageId).catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        }
      }
    }
  } catch {}
}

async function handleCancel(interaction, record, ticketNumber) {
  if (!isCommitteeMember(interaction.member)) {
    return interaction.reply({ content: '❌ ليس لديك صلاحية لإلغاء المراحل', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferUpdate();
  record.status = 'cancelled';
  await record.save();
  const cancelEmbed = new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('⛔ تم إلغاء المراحل')
    .setDescription(`تم إلغاء مراحل التقديم بواسطة ${interaction.user}.`)
    .setTimestamp()
    .setFooter({ text: '𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘' });
  await interaction.channel.send({ embeds: [cancelEmbed] });
  try {
    for (const st of record.stages) {
      if (st.stageMessageId) {
        const msg = await interaction.channel.messages.fetch(st.stageMessageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
      if (st.adminMessageId) {
        const msg = await interaction.channel.messages.fetch(st.adminMessageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    }
  } catch {}
}
