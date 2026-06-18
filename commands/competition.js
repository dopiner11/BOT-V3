import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType } from 'discord.js';
import { readFileSync } from 'fs';
import {
  createCompetition, endCompetition, cancelCompetition,
  getStandings, updateCompetitionEmbed, updateAllCompetitionEmbeds,
  getCompetitionHistory, buildCompetitionEmbed
} from '../utils/competitionSystem.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, gold as embedGold } from '../utils/embedStyles.js';

export default {
  data: new SlashCommandBuilder()
    .setName('مسابقة')
    .setDescription('🏆 نظام المسابقات'),

  async execute(interaction) {
    const active = await getActiveCompetitions();
    const embed = buildMainPanel(active);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('comp_create').setLabel('➕ إنشاء').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('comp_end').setLabel('⏹️ إنهاء').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('comp_cancel').setLabel('❌ إلغاء').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('comp_history').setLabel('📜 سجل الأبطال').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('comp_myrank').setLabel('🔍 ترتيبي').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  }
};

// ─── دالات المساعدة ─────────────────────────────────────────

async function getActiveCompetitions() {
  const { default: Competition } = await import('../models/Competition.js');
  return await Competition.find({ status: 'active' });
}

async function getCompetitionById(id) {
  const { default: Competition } = await import('../models/Competition.js');
  return await Competition.findById(id);
}

function buildMainPanel(active) {
  const systemDesc = `> 🏆 **نظام المسابقات** — مسابقات دورية لأفراد العائلة
> 
> **🔄 طرق التصنيف:**
> 📈 **تراكمي:** أعلى مجموع نقاط/احتلال/تقارير/ستريك خلال المدة
> 🏁 **سباق:** أول من يصل للهدف المحدد يفوز
> 
> **📊 أنواع المسابقات:**
> 🏆 نقاط • ⏱️ احتلال • 📋 تقارير • 🔥 ستريك
> 
> **🎁 أنواع الجوائز:**
> 🎖️ رتبة • ⭐ نقاط • 🚀 ترقية • 🛡️ إلغاء إنذار
> ⚡ ضعف نقاط • 👑 لقب • 🏖️ إجازة داخلية • 💰 فلوس`;

  let activeSection;
  if (active.length) {
    activeSection = '━━━━━━━━━━━━━━\n**📌 المسابقات النشطة:**\n\n' + active.map((c, i) => {
      const typeEmoji = { points: '🏆', occupation: '⏱️', reports: '📋', streak: '🔥' }[c.type] || '🏆';
      const typeName = { points: 'نقاط', occupation: 'احتلال', reports: 'تقارير', streak: 'ستريك' }[c.type] || c.type;
      const modeLabel = c.mode === 'cumulative' ? '📈 تراكمي' : '🏁 سباق';
      const total = Math.max(0, Math.ceil((new Date(c.endsAt).getTime() - Date.now()) / 86400000));
      const daysText = total > 0 ? `⏳ ${total} يوم` : '⏳ ينتهي اليوم';
      return `**${i + 1}. ${typeEmoji} ${c.name}**\n└ ${modeLabel} • ${typeName} | ${daysText}`;
    }).join('\n\n');
  } else {
    activeSection = '\n━━━━━━━━━━━━━━\n📌 **لا توجد مسابقات نشطة حالياً.**\nاستخدم **➕ إنشاء** لبدء مسابقة جديدة.';
  }

  return embedInfo('🏆 نظام المسابقات', systemDesc + '\n' + activeSection);
}

async function showCompetitionSelect(interaction, action, placeholder) {
  const active = await getActiveCompetitions();
  if (!active.length) {
    return interaction.reply({ content: '❌ لا توجد مسابقات نشطة.', flags: MessageFlags.Ephemeral });
  }

  const options = active.map(c => {
    const typeEmoji = c.type === 'points' ? '🏆' : c.type === 'occupation' ? '⏱️' : c.type === 'reports' ? '📋' : '🔥';
    const modeLabel = c.mode === 'cumulative' ? 'تراكمي' : 'سباق';
    const start = new Date(c.startedAt).toLocaleDateString('ar-IQ');
    return {
      label: `${typeEmoji} ${c.name}`.slice(0, 100),
      description: `${modeLabel} — ${c.days} أيام • من ${start}`.slice(0, 100),
      value: c.id
    };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`comp_select_${action}`)
    .setPlaceholder(placeholder)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(select);
  await interaction.reply({ content: placeholder, components: [row], flags: MessageFlags.Ephemeral });
}

function formatReward(r) {
  switch (r.type) {
    case 'role': return `🎖️ <@&${r.value}>`;
    case 'points': return `⭐ ${r.value} نقطة`;
    case 'promotion': return '🚀 ترقية استثنائية';
    case 'warn_remove': return `🛡️ إلغاء ${r.value} إنذار`;
    case 'double_points': return `⚡ ضعف نقاط ${r.value} ساعة`;
    case 'title': return `👑 لقب "${r.value}"`;
    case 'leave': return `🏖️ إجازة ${r.value} أيام`;
    case 'money': return `💰 ${r.value}$`;
    default: return r.value || '';
  }
}

// ─── لوحة الإعدادات التفاعلية ──────────────────────────────

function buildConfigPanel(data) {
  const typeLabels = { points: '🏆 نقاط', occupation: '⏱️ احتلال', reports: '📋 تقارير', streak: '🔥 ستريك' };
  const modeLabels = { cumulative: '📈 تراكمي', race: '🏁 سباق' };

  const desc = [
    `🏗️ **إعداد:** ${data.name || '—'}`,
    '',
    `**النوع:** ${data.type ? typeLabels[data.type] || data.type : '❌ غير محدد'}`,
    `**التصنيف:** ${data.mode ? modeLabels[data.mode] || data.mode : '❌ غير محدد'}`,
    `**عدد الفائزين:** ${data.winnersCount || '❌ غير محدد'}`,
    `**الهدف:** ${data.target ? `\`${data.target}\`` : '— (اختياري)'}`,
    `**المدة:** ${data.days || '?'} أيام`,
    '',
    prizesPreview(data.prizes),
    '',
    '━━━━━━━━━━━━━━',
    '**📋 خطوات إنشاء المسابقة:**',
    '1️⃣ اكتب اسم المسابقة والمدة (تم ✅)',
    '2️⃣ اختر **النوع** من القائمة 🏆⏱️📋🔥',
    '3️⃣ اختر **التصنيف** (تراكمي 📈 / سباق 🏁)',
    '4️⃣ حدد **عدد الفائزين** 🏅',
    '5️⃣ أدخل **الهدف** للسباق 🎯 (اختياري)',
    '6️⃣ اضف **الجوائز** عبر زر 🎁 الجوائز',
    '7️⃣ اضغط **✅ تأكيد وإنشاء**',
    '',
    '> 💡 اختر من القوائم أعلاه — اللوحة تتحدث تلقائياً'
  ].join('\n');

  const embed = embedGold('⚙️ إعداد المسابقة', desc);

  // Row 1: النوع
  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId('comp_cfg_type').setPlaceholder('🏆 اختر النوع')
    .addOptions(
      { label: '🏆 نقاط', value: 'points', description: 'أعلى نقاط' },
      { label: '⏱️ احتلال', value: 'occupation', description: 'أعلى ساعات احتلال' },
      { label: '📋 تقارير', value: 'reports', description: 'أكثر تقارير مقبولة' },
      { label: '🔥 ستريك', value: 'streak', description: 'أعلى ستريك' }
    );
  const row1 = new ActionRowBuilder().addComponents(typeSelect);

  // Row 2: التصنيف
  const modeSelect = new StringSelectMenuBuilder()
    .setCustomId('comp_cfg_mode').setPlaceholder('🔄 اختر التصنيف')
    .addOptions(
      { label: '📈 تراكمي', value: 'cumulative', description: 'أعلى مجموع خلال المدة' },
      { label: '🏁 سباق', value: 'race', description: 'أول من يصل للهدف' }
    );
  const row2 = new ActionRowBuilder().addComponents(modeSelect);

  // Row 3: عدد الفائزين
  const winnersSelect = new StringSelectMenuBuilder()
    .setCustomId('comp_cfg_winners').setPlaceholder('🏅 عدد الفائزين')
    .addOptions(
      { label: '1 فائز', value: '1' },
      { label: '2 فائزين', value: '2' },
      { label: '3 فائزين', value: '3' },
      { label: '4 فائزين', value: '4' },
      { label: '5 فائزين', value: '5' }
    );
  const row3 = new ActionRowBuilder().addComponents(winnersSelect);

  // Row 4: أزرار الهدف والجوائز
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('comp_cfg_target').setLabel('🎯 الهدف').setStyle(ButtonStyle.Secondary).setDisabled(data.mode !== 'race'),
    new ButtonBuilder().setCustomId('comp_cfg_prizes').setLabel('🎁 الجوائز').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('comp_cfg_name').setLabel('✏️ الاسم').setStyle(ButtonStyle.Secondary)
  );

  // Row 5: تأكيد + إلغاء
  const canConfirm = data.type && data.mode && data.winnersCount && data.prizes.length > 0;
  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('comp_confirm_create').setLabel('✅ تأكيد وإنشاء').setStyle(ButtonStyle.Success).setDisabled(!canConfirm),
    new ButtonBuilder().setCustomId('comp_cancel_action').setLabel('❌ إلغاء').setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row1, row2, row3, row4, row5] };
}

function prizesPreview(prizes) {
  if (!prizes?.length) return '**🎁 الجوائز:** ❌ لم تحدد بعد';
  const lines = prizes.sort((a, b) => a.rank - b.rank).map(p => {
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const medal = medals[p.rank] || '🏅';
    const rankName = p.rank === 1 ? 'الأول' : p.rank === 2 ? 'الثاني' : p.rank === 3 ? 'الثالث' : `#${p.rank}`;
    const rewards = (p.rewards || []).map(r => formatReward(r)).join(' + ');
    return `${medal} **المركز ${rankName}:** ${rewards}`;
  });
  return `**🎁 الجوائز**\n${lines.join('\n')}`;
}

// ─── لوحة الجوائز التفاعلية ────────────────────────────────

function buildPrizePanel(data) {
  const rankNames = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس'];
  const medals = { 0: '🥇', 1: '🥈', 2: '🥉', 3: '🏅', 4: '🏅' };
  const typeLabels = {
    role: '🎖️ رتبة', points: '⭐ نقاط', promotion: '🚀 ترقية',
    warn_remove: '🛡️ إلغاء إنذار', double_points: '⚡ ضعف نقاط',
    title: '👑 لقب', leave: '🏖️ إجازة', money: '💰 فلوس'
  };

  const r = data._prizeRank ?? 0;
  const rankLabel = rankNames[r] || `${r + 1}`;
  const medal = medals[r] || '🏅';

  // جوائز هذا المركز حالياً
  const existing = (data.prizes || []).find(p => p.rank === r + 1);
  const currentRewards = existing
    ? existing.rewards.map(rw => formatReward(rw)).join('\n')
    : 'لا توجد جوائز';

  const selectedType = data._prizeType;
  const selectedValue = data._prizeValue;

  let desc = `🎁 **إعداد جوائز:** ${data.name}\n`;
  desc += `━━━━━━━━━━━━━━\n`;
  desc += `${medal} **المركز ${rankLabel}** (من ${data.winnersCount})\n\n`;
  desc += `**🎯 الجوائز الحالية:**\n${currentRewards}\n\n`;
  if (selectedType) {
    desc += `**🆕 الجائزة الجديدة:** ${typeLabels[selectedType] || selectedType}`;
    if (selectedValue) desc += ` — \`${selectedValue}\``;
    desc += ' (ستُفتح نافذة القيمة تلقائياً)\n';
  } else {
    desc += '👈 اختر نوع الجائزة من القائمة — سيُطلب منك القيمة تلقائياً';
  }

  const embed = embedGold('🎁 الجوائز', desc);

  // Row 1: اختيار المركز
  const rankOpts = [];
  for (let i = 0; i < data.winnersCount; i++) {
    rankOpts.push({ label: `${medals[i] || '🏅'} المركز ${rankNames[i] || (i + 1)}`, value: String(i), default: i === r });
  }
  const rankSelect = new StringSelectMenuBuilder()
    .setCustomId('comp_prize_rank').setPlaceholder('🏅 اختر المركز').addOptions(rankOpts);
  const row1 = new ActionRowBuilder().addComponents(rankSelect);

  // Row 2: اختيار النوع
  const typeOpts = [
    { label: '🎖️ رتبة', value: 'role', description: 'إعطاء رتبة' },
    { label: '⭐ نقاط', value: 'points', description: 'نقاط سيرفر' },
    { label: '🚀 ترقية', value: 'promotion', description: 'ترقية رتبة' },
    { label: '🛡️ إلغاء إنذار', value: 'warn_remove', description: 'مسح إنذارات' },
    { label: '⚡ ضعف نقاط', value: 'double_points', description: 'ضعف نقاط لمدة' },
    { label: '👑 لقب', value: 'title', description: 'إضافة لقب' },
    { label: '🏖️ إجازة', value: 'leave', description: 'إجازة داخلية' },
    { label: '💰 فلوس', value: 'money', description: 'فلوس لعبة' }
  ].map(o => ({ ...o, default: o.value === selectedType }));
  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId('comp_prize_type').setPlaceholder('🎁 اختر نوع الجائزة').addOptions(typeOpts);
  const row2 = new ActionRowBuilder().addComponents(typeSelect);

  // Row 3: أزرار الإجراءات
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('comp_prize_clear').setLabel('🗑️ مسح جوائز هذا المركز').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('comp_prize_back').setLabel('⬅️ رجوع').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row1, row2, row3] };
}

// ─── معالج الأزرار ──────────────────────────────────────────

const pendingCreations = new Map();

export async function handleCompetitionButton(interaction) {
  const { customId } = interaction;

  if (customId === 'comp_create') {
    const modal = new ModalBuilder()
      .setCustomId('comp_modal_create')
      .setTitle('➕ إنشاء مسابقة');

    const nameInput = new TextInputBuilder()
      .setCustomId('comp_name').setLabel('اسم المسابقة').setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: سباق النقاط').setRequired(true);

    const daysInput = new TextInputBuilder()
      .setCustomId('comp_days').setLabel('المدة (أيام)').setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: 7').setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(nameInput);
    const row2 = new ActionRowBuilder().addComponents(daysInput);
    modal.addComponents(row1, row2);

    return interaction.showModal(modal);
  }

  if (customId === 'comp_end') {
    return showCompetitionSelect(interaction, 'end', '⏹️ اختر مسابقة لإنهائها');
  }

  if (customId === 'comp_cancel') {
    return showCompetitionSelect(interaction, 'cancel', '❌ اختر مسابقة لإلغائها');
  }

  if (customId === 'comp_history') {
    const { items, totalPages, page } = await getCompetitionHistory(1);
    if (!items.length) {
      return interaction.reply({ content: '📜 لا توجد مسابقات مسجلة بعد.', flags: MessageFlags.Ephemeral });
    }

    const lines = items.map((w, i) => {
      const emoji = w.rank === 1 ? '🥇' : w.rank === 2 ? '🥈' : w.rank === 3 ? '🥉' : '🏅';
      return `${emoji} <@${w.userId}> — ${w.competitionName}\n└ ${w.competitionType === 'points' ? '🏆' : w.competitionType === 'occupation' ? '⏱️' : w.competitionType === 'reports' ? '📋' : '🔥'} ${w.score} ${new Date(w.wonAt).toLocaleDateString('ar-IQ')}`;
    }).join('\n\n');

    const embed = embedGold('🏆 سجل أبطال المسابقات', `📅 الصفحة ${page}/${totalPages}\n\n${lines}`);

    const row = new ActionRowBuilder();
    if (totalPages > 1) {
      row.addComponents(
        new ButtonBuilder().setCustomId('comp_history_prev').setLabel('◀️ السابق').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
        new ButtonBuilder().setCustomId('comp_history_next').setLabel('▶️ التالي').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages)
      );
    }

    return interaction.reply({ embeds: [embed], components: row.components.length ? [row] : [], flags: MessageFlags.Ephemeral });
  }

  if (customId === 'comp_myrank') {
    return showCompetitionSelect(interaction, 'myrank', '🔍 اختر مسابقة لمعرفة ترتيبك');
  }

  // أزرار السجل
  if (customId === 'comp_history_prev' || customId === 'comp_history_next') {
    const msg = interaction.message;
    const match = msg.embeds[0]?.footer?.text?.match(/الصفحة (\d+)\/(\d+)/);
    if (!match) return;
    let page = parseInt(match[1]);
    const totalPages = parseInt(match[2]);
    page += customId === 'comp_history_next' ? 1 : -1;
    if (page < 1 || page > totalPages) return;

    const { items, totalPages: tp } = await getCompetitionHistory(page);
    const lines = items.map((w, i) => {
      const emoji = w.rank === 1 ? '🥇' : w.rank === 2 ? '🥈' : w.rank === 3 ? '🥉' : '🏅';
      return `${emoji} <@${w.userId}> — ${w.competitionName}\n└ ${w.competitionType === 'points' ? '🏆' : w.competitionType === 'occupation' ? '⏱️' : w.competitionType === 'reports' ? '📋' : '🔥'} ${w.score} ${new Date(w.wonAt).toLocaleDateString('ar-IQ')}`;
    }).join('\n\n');

    const embed = embedGold('🏆 سجل أبطال المسابقات', `📅 الصفحة ${page}/${tp}\n\n${lines}`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('comp_history_prev').setLabel('◀️ السابق').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
      new ButtonBuilder().setCustomId('comp_history_next').setLabel('▶️ التالي').setStyle(ButtonStyle.Secondary).setDisabled(page >= tp)
    );

    return interaction.update({ embeds: [embed], components: [row] });
  }

  // إنهاء/إلغاء/ترتيبي من الـ Select
  if (customId.startsWith('comp_select_')) {
    const action = customId.replace('comp_select_', '');
    const compId = interaction.values?.[0];
    if (!compId) return interaction.reply({ content: '❌ لم يتم اختيار مسابقة.', flags: MessageFlags.Ephemeral });

    const comp = await getCompetitionById(compId);
    if (!comp) return interaction.reply({ content: '❌ المسابقة غير موجودة.', flags: MessageFlags.Ephemeral });

    if (action === 'end') {
      const embed = embedWarning('⏹️ إنهاء مسابقة',
        `**المسابقة:** ${comp.name}\n` +
        `**النوع:** ${comp.type === 'points' ? '🏆 نقاط' : comp.type === 'occupation' ? '⏱️ احتلال' : comp.type === 'reports' ? '📋 تقارير' : '🔥 ستريك'}\n` +
        `**التصنيف:** ${comp.mode === 'cumulative' ? '📈 تراكمي' : '🏁 سباق'}\n` +
        `**المدة:** ${comp.days} أيام\n━━━━━━━━━━━━━━\n` +
        `⚠️ هل أنت متأكد من إنهاء هذه المسابقة؟\nسيتم صرف الجوائز للفائزين النهائيين.`);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`comp_confirm_end_${compId}`).setLabel('✅ تأكيد الإنهاء').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('comp_cancel_action').setLabel('⬅️ رجوع').setStyle(ButtonStyle.Danger)
      );
      return interaction.update({ embeds: [embed], components: [row] });
    }

    if (action === 'cancel') {
      const embed = embedWarning('❌ إلغاء مسابقة',
        `**المسابقة:** ${comp.name}\n` +
        `**النوع:** ${comp.type === 'points' ? '🏆 نقاط' : comp.type === 'occupation' ? '⏱️ احتلال' : comp.type === 'reports' ? '📋 تقارير' : '🔥 ستريك'}\n` +
        `**التصنيف:** ${comp.mode === 'cumulative' ? '📈 تراكمي' : '🏁 سباق'}\n` +
        `**المدة:** ${comp.days} أيام\n━━━━━━━━━━━━━━\n` +
        `⚠️ هل أنت متأكد من إلغاء هذه المسابقة؟\nلن تصرف أي جوائز.`);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`comp_confirm_cancel_${compId}`).setLabel('✅ تأكيد الإلغاء').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('comp_cancel_action').setLabel('⬅️ رجوع').setStyle(ButtonStyle.Secondary)
      );
      return interaction.update({ embeds: [embed], components: [row] });
    }

    if (action === 'myrank') {
      const standings = await getStandings(comp);
      const userIdx = standings.findIndex(s => s.userId === interaction.user.id);
      const total = standings.length;

      let text;
      if (userIdx === -1) {
        text = '❌ أنت لست ضمن المتسابقين في هذه المسابقة.';
      } else {
        const rank = userIdx + 1;
        const user = standings[userIdx];
        const first = standings[0];
        const ahead = userIdx > 0 ? standings[userIdx - 1] : null;
        const behind = userIdx < total - 1 ? standings[userIdx + 1] : null;

        text = `**@${interaction.user.username}** — #${rank} من ${total}\n═══════════════════\n🥇 الأول: ${formatScoreForDisplay(comp.type, first.score)}${ahead ? `\n📈 قبلك: @${ahead.gameName || ahead.userId} — -${formatScoreForDisplay(comp.type, first.score - user.score)}` : ''}${behind ? `\n📉 بعدك: @${behind.gameName || behind.userId} — +${formatScoreForDisplay(comp.type, user.score - behind.score)}` : ''}`;
      }

      return interaction.update({ embeds: [info(`🔍 ترتيبي في ${comp.name}`, text)], components: [] });
    }
  }

  // ─── أزرار لوحة الإعدادات ──────────────────────────────────

  // فتح مودال الهدف
  if (customId === 'comp_cfg_target') {
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder()
      .setCustomId('comp_modal_target').setTitle('🎯 الهدف');
    const targetInput = new TextInputBuilder()
      .setCustomId('comp_target').setLabel('الهدف (نقاط/ساعات) — للسباق').setStyle(TextInputStyle.Short)
      .setPlaceholder('مثال: 5000').setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(targetInput));
    return interaction.showModal(modal);
  }

  // فتح لوحة الجوائز التفاعلية
  if (customId === 'comp_cfg_prizes') {
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });
    if (!data.winnersCount) return interaction.reply({ content: '❌ حدد عدد الفائزين أولاً.', flags: MessageFlags.Ephemeral });
    data._prizeRank = 0;
    data._prizeType = null;
    data._prizeValue = null;
    pendingCreations.set(interaction.user.id, data);
    return interaction.update(buildPrizePanel(data));
  }

  // ─── أزرار لوحة الجوائز ──────────────────────────────────

  // مسح كل جوائز المركز
  if (customId === 'comp_prize_clear') {
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });
    const r = data._prizeRank ?? 0;
    data.prizes = data.prizes.filter(p => p.rank !== r + 1);
    data._prizeType = null;
    data._prizeValue = null;
    pendingCreations.set(interaction.user.id, data);
    return interaction.update(buildPrizePanel(data));
  }

  // رجوع للوحة الإعدادات (يحفظ تلقائياً لأن الإضافة مباشرة)
  if (customId === 'comp_prize_back') {
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });
    delete data._prizeRank; delete data._prizeType; delete data._prizeValue;
    pendingCreations.set(interaction.user.id, data);
    return interaction.update(buildConfigPanel(data));
  }

  // ─── Select Menu لوحة الجوائز ─────────────────────────────

  if (customId === 'comp_prize_rank') {
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });
    const val = interaction.values?.[0];
    if (!val) return;
    data._prizeRank = parseInt(val);
    data._prizeType = null;
    data._prizeValue = null;
    pendingCreations.set(interaction.user.id, data);
    return interaction.update(buildPrizePanel(data));
  }

  if (customId === 'comp_prize_type') {
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });
    const val = interaction.values?.[0];
    if (!val) return;
    data._prizeType = val;
    data._prizeValue = null;
    pendingCreations.set(interaction.user.id, data);

    const placeholders = { role: 'ID الرتبة', points: 'عدد النقاط', promotion: 'اتركه فارغاً', warn_remove: 'عدد الإنذارات', double_points: 'عدد الساعات', title: 'نص اللقب', leave: 'عدد الأيام', money: 'المبلغ' };
    const modal = new ModalBuilder().setCustomId('comp_modal_prize_value').setTitle('🔢 قيمة الجائزة');
    const input = new TextInputBuilder()
      .setCustomId('comp_prize_val').setLabel(`قيمة (${placeholders[val] || 'نص/رقم'})`).setStyle(TextInputStyle.Short)
      .setPlaceholder(placeholders[val] || 'أدخل القيمة').setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // فتح مودال تعديل الاسم + المدة
  if (customId === 'comp_cfg_name') {
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder()
      .setCustomId('comp_modal_name').setTitle('✏️ تعديل الاسم والمدة');
    const nameInput = new TextInputBuilder()
      .setCustomId('comp_name').setLabel('اسم المسابقة').setStyle(TextInputStyle.Short)
      .setValue(data.name || '').setRequired(true);
    const daysInput = new TextInputBuilder()
      .setCustomId('comp_days').setLabel('المدة (أيام)').setStyle(TextInputStyle.Short)
      .setValue(String(data.days || '')).setRequired(true);
    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(daysInput)
    );
    return interaction.showModal(modal);
  }

  // ─── معالج Select Menu الإعدادات ───────────────────────────

  if (customId === 'comp_cfg_type' || customId === 'comp_cfg_mode' || customId === 'comp_cfg_winners') {
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ انتهت الجلسة.', flags: MessageFlags.Ephemeral });

    const value = interaction.values?.[0];
    if (!value) return interaction.deferUpdate();

    if (customId === 'comp_cfg_type') data.type = value;
    else if (customId === 'comp_cfg_mode') data.mode = value;
    else if (customId === 'comp_cfg_winners') data.winnersCount = parseInt(value);
    pendingCreations.set(interaction.user.id, data);

    const panel = buildConfigPanel(data);
    try {
      await interaction.update(panel);
    } catch (e) {
      console.error('[COMP_CFG] update error:', e.message, 'customId:', customId, 'value:', value);
      await interaction.followUp({ content: '⚠️ ' + e.message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  // تأكيد إنهاء
  if (customId.startsWith('comp_confirm_end_')) {
    const compId = customId.replace('comp_confirm_end_', '');
    await interaction.deferUpdate();
    const client = interaction.client;
    const result = await endCompetition(compId, client, interaction.user.id);
    if (result.success) {
      await interaction.editReply({ embeds: [embedSuccess('✅ تم إنهاء المسابقة', 'تم صرف الجوائز للفائزين.')], components: [] });
    } else {
      await interaction.editReply({ embeds: [embedError('❌ فشل الإنهاء', result.reason || 'حدث خطأ')], components: [] });
    }
  }

  // تأكيد إلغاء
  if (customId.startsWith('comp_confirm_cancel_')) {
    const compId = customId.replace('comp_confirm_cancel_', '');
    await interaction.deferUpdate();
    const client = interaction.client;
    const result = await cancelCompetition(compId, client, interaction.user.id);
    if (result.success) {
      await interaction.editReply({ embeds: [embedWarning('✅ تم إلغاء المسابقة', 'تم إلغاء المسابقة بدون صرف جوائز.')], components: [] });
    } else {
      await interaction.editReply({ embeds: [embedError('❌ فشل الإلغاء', result.reason || 'حدث خطأ')], components: [] });
    }
  }

  // تأكيد إنشاء المسابقة
  if (customId === 'comp_confirm_create') {
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.reply({ content: '❌ انتهت الجلسة. ابدأ من جديد.', flags: MessageFlags.Ephemeral });
    pendingCreations.delete(interaction.user.id);
    await interaction.deferUpdate();
    const client = interaction.client;
    const result = await createCompetition(data, client);
    if (result.success) {
      await interaction.editReply({ embeds: [embedSuccess('✅ تم إنشاء المسابقة', `تم إنشاء **${data.name}** بنجاح!\n📆 المدة: ${data.days} أيام\n📊 النوع: ${data.type} | ${data.mode === 'cumulative' ? '📈 تراكمي' : '🏁 سباق'}`)], components: [] });
    } else {
      await interaction.editReply({ embeds: [embedError('❌ فشل الإنشاء', result.reason || 'حدث خطأ')], components: [] });
    }
    return;
  }

  if (customId === 'comp_cancel_action') {
    const active = await getActiveCompetitions();
    const embed = buildMainPanel(active);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('comp_create').setLabel('➕ إنشاء').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('comp_end').setLabel('⏹️ إنهاء').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('comp_cancel').setLabel('❌ إلغاء').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('comp_history').setLabel('📜 سجل الأبطال').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('comp_myrank').setLabel('🔍 ترتيبي').setStyle(ButtonStyle.Secondary)
    );
    return interaction.update({ embeds: [embed], components: [row] });
  }
}

function formatScoreForDisplay(type, value) {
  if (type === 'occupation') return `${(value / 60).toFixed(1)} ساعة`;
  return value.toLocaleString();
}

// ─── معالج المودالات ────────────────────────────────────────

function getCompConfig() {
  const cfg = JSON.parse(readFileSync('./config.json', 'utf-8'));
  return cfg?.competitions || {};
}

function initData(name, days, user) {
  const compConfig = getCompConfig();
  return {
    name, days: parseInt(days), type: null, mode: null, winnersCount: null,
    target: null, prizes: [],
    createdBy: user.id, creatorName: user.username,
    committeeRoleId: compConfig.committeeRoleId || '',
    presidencyRoleId: compConfig.presidencyRoleId || '',
    channelId: compConfig.competitionChannelId || '',
    announcementChannelId: compConfig.announcementChannelId || ''
  };
}

export async function handleCompetitionModal(interaction) {
  const modalId = interaction.customId;

  // ── مودال الخطوة الأولى: الاسم + المدة ──
  if (modalId === 'comp_modal_create') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const name = interaction.fields.getTextInputValue('comp_name');
    const days = parseInt(interaction.fields.getTextInputValue('comp_days'));
    if (!name) return interaction.editReply({ content: '❌ اسم المسابقة مطلوب.' });
    if (isNaN(days) || days < 1 || days > 90) return interaction.editReply({ content: '❌ المدة بين 1 و 90 يوم.' });

    const data = initData(name, days, interaction.user);
    pendingCreations.set(interaction.user.id, data);

    const panel = buildConfigPanel(data);
    return interaction.editReply(panel);
  }

  // ── مودال الهدف ──
  if (modalId === 'comp_modal_target') {
    await interaction.deferUpdate();
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.editReply({ content: '❌ انتهت الجلسة.' });

    const val = interaction.fields.getTextInputValue('comp_target');
    if (!val || isNaN(parseInt(val))) return interaction.editReply({ content: '❌ أدخل رقماً صحيحاً.' });
    data.target = parseInt(val);
    pendingCreations.set(interaction.user.id, data);

    return interaction.editReply(buildConfigPanel(data));
  }

  // ── مودال قيمة الجائزة ──
  if (modalId === 'comp_modal_prize_value') {
    await interaction.deferUpdate();
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.editReply({ content: '❌ انتهت الجلسة.' });

    const val = interaction.fields.getTextInputValue('comp_prize_val');
    if (!val) return interaction.editReply({ content: '❌ أدخل قيمة.' });

    // إضافة الجائزة تلقائياً مع القيمة
    const r = data._prizeRank ?? 0;
    const type = data._prizeType;
    if (!type) return interaction.editReply({ content: '❌ اختر نوع الجائزة أولاً.' });

    let existing = data.prizes.find(p => p.rank === r + 1);
    if (existing) {
      existing.rewards.push({ type, value: val });
    } else {
      data.prizes.push({ rank: r + 1, rewards: [{ type, value: val }] });
    }
    data._prizeType = null;
    data._prizeValue = null;
    pendingCreations.set(interaction.user.id, data);
    return interaction.editReply(buildPrizePanel(data));
  }

  // ── مودال تعديل الاسم + المدة ──
  if (modalId === 'comp_modal_name') {
    await interaction.deferUpdate();
    const data = pendingCreations.get(interaction.user.id);
    if (!data) return interaction.editReply({ content: '❌ انتهت الجلسة.' });

    const name = interaction.fields.getTextInputValue('comp_name');
    const days = parseInt(interaction.fields.getTextInputValue('comp_days'));
    if (!name) return interaction.editReply({ content: '❌ الاسم مطلوب.' });
    if (isNaN(days) || days < 1 || days > 90) return interaction.editReply({ content: '❌ المدة بين 1 و 90 يوم.' });

    data.name = name;
    data.days = days;
    pendingCreations.set(interaction.user.id, data);

    return interaction.editReply(buildConfigPanel(data));
  }
}

// ─── مُهيئ النظام (يُستدعى من index.js) ─────────────────────

export async function init(client) {
  const { startCompetitionSystem } = await import('../utils/competitionSystem.js');
  await startCompetitionSystem(client);
}
