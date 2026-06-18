import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} from 'discord.js';
import Vote from '../models/Vote.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, gold as embedGold, custom as embedCustom } from './embedStyles.js';

let expiryInterval;

/* ===================================================================
   نشر التصويت
   =================================================================== */

export async function publishVote(interaction) {
  const data = interaction.client._voteData?.get(interaction.customId);
  if (!data) return interaction.reply({ content: '❌ بيانات التصويت مفقودة.', flags: MessageFlags.Ephemeral });

  const content = interaction.fields.getTextInputValue('vote_content');
  interaction.client._voteData.delete(interaction.customId);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const vote = await Vote.create({
    title: data.title,
    description: content,
    authorId: data.authorId,
    authorTag: data.authorTag,
    channelId: interaction.channelId,
    guildId: interaction.guildId,
    useEmbed: true,
    color: data.color,
    footer: data.footer,
    voteRoleId: data.voteRoleId,
    durationHours: data.durationHours,
    requireReason: data.requireReason,
    status: 'pending',
    votes: [],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + data.durationHours * 60 * 60 * 1000)
  });

  await interaction.editReply({
    content: '📎 **أرسل وسائطك الآن** (صور / فيديوهات)\nأرسل الملفات في هذه الدردشة خلال 60 ثانية\nأو اكتب `تم` للانتهاء مبكراً\n⠀ *(حد أقصى 10 ملفات)*'
  });

  const attachments = [];
  const filter = m => m.author.id === interaction.user.id && (m.attachments.size > 0 || m.content === 'تم');
  const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 11 });

  collector.on('collect', async (msg) => {
    if (msg.content === 'تم') return collector.stop('done');
    for (const [, att] of msg.attachments) {
      if (attachments.length >= 10) break;
      attachments.push(att.url);
    }
    await msg.react('✅').catch(() => {});
  });

  collector.on('end', async (_, reason) => {
    const message = await buildAndSendVote(interaction.channel, vote, attachments);
    vote.messageId = message.id;
    await vote.save();

    const thread = await message.startThread({
      name: `💬 مناقشة: ${vote.title}`,
      autoArchiveDuration: 1440,
      reason: 'مناقشة التصويت'
    });
    vote.threadId = thread.id;
    await vote.save();

    await thread.send(`💬 **مناقشة التصويت: ${vote.title}**\nيمكنكم مناقشة هذا التصويت هنا. سيتم إغلاق الثريد تلقائياً عند انتهاء التصويت.${attachments.length ? '\n\n📎 **الوسائط المرفوعة:**' : ''}`);

    await interaction.editReply({ content: '✅ **تم نشر التصويت بنجاح!**' });
  });
}

async function buildAndSendVote(channel, vote, attachments = []) {
  const embed = buildVoteEmbed(vote, channel.client);
  const rows = buildVoteRows(vote);
  const opts = { embeds: [embed], components: rows };
  if (attachments.length) opts.files = attachments;
  return channel.send(opts);
}

/* ===================================================================
   الإيمبد
   =================================================================== */

function buildVoteEmbed(vote, client) {
  const yes = vote.votes.filter(v => v.vote === 'yes');
  const no = vote.votes.filter(v => v.vote === 'no');
  const yesCount = yes.length;
  const noCount = no.length;
  const total = vote.votes.length;
  const ended = vote.status === 'ended' || vote.ended;

  const timeStr = ended ? '✅ منتهي' : `<t:${Math.floor(vote.expiresAt.getTime() / 1000)}:R>`;
  const voteRoleText = vote.voteRoleId ? `<@&${vote.voteRoleId}>` : 'الكل';
  const author = client?.users?.cache?.get(vote.authorId);

  const barLen = 14;
  const totalVotes = yesCount + noCount || 1;
  const yesBar = Math.round((yesCount / totalVotes) * barLen);
  const noBar = barLen - yesBar;
  const bar = '🟢'.repeat(Math.max(0, yesBar)) + '🔴'.repeat(Math.max(0, noBar));

  const voteColor = ended ? (yesCount >= noCount ? 0x00FF00 : 0xFF0000) : (vote.color || 0x2B2D31);
  const winnerText = ended ? (yesCount >= noCount ? '✅ تمت الموافقة' : '❌ تم الرفض') : '';
  const footerText = ended
    ? `${winnerText} • ${vote.footer || `تصويت #${vote._id}`}`
    : vote.footer || `تصويت #${vote._id} • ينتهي بعد ${vote.durationHours} ساعة`;

  const embed = embedCustom(voteColor, `📊 ${vote.title}`, vote.description || '')
    .setThumbnail(author?.displayAvatarURL() || null)
    .addFields(
      { name: '👤 المنشئ', value: `<@${vote.authorId}>`, inline: true },
      { name: '🫂 الصلاحية', value: voteRoleText, inline: true },
      { name: '⏳', value: timeStr, inline: true },
      { name: '📊 النتائج', value: `${bar}\n✅ **${yesCount}** موافق  •  ❌ **${noCount}** رافض  •  👥 **${total}** المجموع`, inline: false },
    )
    .setFooter({ text: footerText })
    .setTimestamp(vote.createdAt);
  return embed;
}

/* ===================================================================
   الأزرار
   =================================================================== */

function buildVoteRows(vote) {
  const yesCount = vote.votes.filter(v => v.vote === 'yes').length;
  const noCount = vote.votes.filter(v => v.vote === 'no').length;
  const hasReasons = vote.votes.some(v => v.vote === 'no' && v.reason);
  const ended = vote.status === 'ended' || vote.ended;

  if (ended) {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vote_yes_end_${vote._id}`)
        .setLabel(`✅ ${yesCount}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`vote_no_end_${vote._id}`)
        .setLabel(`❌ ${noCount}`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true),
    );
    const row2 = new ActionRowBuilder();
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`vote_voters_${vote._id}`)
        .setLabel('📊 التفاصيل')
        .setStyle(ButtonStyle.Secondary)
    );
    if (hasReasons) {
      row2.addComponents(
        new ButtonBuilder()
          .setCustomId(`vote_reasons_${vote._id}`)
          .setLabel('📋 أسباب الرفض')
          .setStyle(ButtonStyle.Secondary)
      );
    }
    return [row1, row2];
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote_yes_${vote._id}`)
      .setLabel(`✅ موافق`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`vote_no_${vote._id}`)
      .setLabel('❌ رافض')
      .setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote_voters_${vote._id}`)
      .setLabel('📊 التفاصيل')
      .setStyle(ButtonStyle.Secondary),
  );
  if (hasReasons) {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`vote_reasons_${vote._id}`)
        .setLabel('📋 أسباب الرفض')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  return [row1, row2];
}

/* ===================================================================
   التصويت بموافق
   =================================================================== */

export async function handleVoteYes(interaction) {
  const id = interaction.customId.replace('vote_yes_', '');
  const vote = await Vote.findById(id);
  if (!vote) return interaction.reply({ content: '❌ التصويت غير موجود.', flags: MessageFlags.Ephemeral });
  if (vote.status === 'ended') return interaction.reply({ content: '❌ انتهى وقت التصويت.', flags: MessageFlags.Ephemeral });
  if (vote.voteRoleId && !interaction.member.roles.cache.has(vote.voteRoleId)) {
    return interaction.reply({ content: `❌ التصويت مخصص لـ <@&${vote.voteRoleId}> فقط.`, flags: MessageFlags.Ephemeral });
  }

  const existing = vote.votes.find(v => v.userId === interaction.user.id);
  if (existing) {
    if (existing.vote === 'yes') {
      vote.votes = vote.votes.filter(v => v.userId !== interaction.user.id);
      await vote.save();
      await updateVoteMessage(interaction, vote);
      return interaction.reply({ content: '✅ أزلت صوتك.', flags: MessageFlags.Ephemeral });
    }
    existing.vote = 'yes';
    existing.reason = null;
  } else {
    vote.votes.push({ userId: interaction.user.id, vote: 'yes', reason: null });
  }
  await vote.save();
  await updateVoteMessage(interaction, vote);
  await interaction.reply({ content: '✅ صوتك: **موافق** ✓', flags: MessageFlags.Ephemeral });
}

/* ===================================================================
   التصويت برافض
   =================================================================== */

export async function handleVoteNo(interaction) {
  const id = interaction.customId.replace('vote_no_', '');
  const vote = await Vote.findById(id);
  if (!vote) return interaction.reply({ content: '❌ التصويت غير موجود.', flags: MessageFlags.Ephemeral });
  if (vote.status === 'ended') return interaction.reply({ content: '❌ انتهى وقت التصويت.', flags: MessageFlags.Ephemeral });
  if (vote.voteRoleId && !interaction.member.roles.cache.has(vote.voteRoleId)) {
    return interaction.reply({ content: `❌ التصويت مخصص لـ <@&${vote.voteRoleId}> فقط.`, flags: MessageFlags.Ephemeral });
  }

  // لو كان مصوت بـ "موافق" مسبقاً ونقل لـ "رفض"
  const existing = vote.votes.find(v => v.userId === interaction.user.id);
  if (existing && existing.vote === 'no') {
    vote.votes = vote.votes.filter(v => v.userId !== interaction.user.id);
    await vote.save();
    await updateVoteMessage(interaction, vote);
    return interaction.reply({ content: '✅ أزلت صوتك.', flags: MessageFlags.Ephemeral });
  }

  if (!vote.requireReason) {
    if (existing) { existing.vote = 'no'; existing.reason = null; }
    else vote.votes.push({ userId: interaction.user.id, vote: 'no', reason: null });
    await vote.save();
    await updateVoteMessage(interaction, vote);
    return interaction.reply({ content: '✅ صوتك: **رافض** ✓', flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`vote_no_modal_${vote._id}`)
    .setTitle('تصويت رافض')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('vote_reason')
          .setLabel('السبب (اختياري — اتركه فارغاً لو ما تبي)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('اكتب سبب رفضك لو حابب (اختياري)')
      )
    );
  await interaction.showModal(modal).catch(() => {});
}

export async function handleVoteNoModal(interaction) {
  const id = interaction.customId.replace('vote_no_modal_', '');
  const reason = interaction.fields.getTextInputValue('vote_reason')?.trim() || null;
  const vote = await Vote.findById(id);
  if (!vote) return interaction.reply({ content: '❌ التصويت غير موجود.', flags: MessageFlags.Ephemeral });
  if (vote.voteRoleId && !interaction.member.roles.cache.has(vote.voteRoleId)) {
    return interaction.reply({ content: `❌ التصويت مخصص لـ <@&${vote.voteRoleId}> فقط.`, flags: MessageFlags.Ephemeral });
  }

  const existing = vote.votes.find(v => v.userId === interaction.user.id);
  if (existing) { existing.vote = 'no'; existing.reason = reason; }
  else vote.votes.push({ userId: interaction.user.id, vote: 'no', reason });
  await vote.save();
  await updateVoteMessage(interaction, vote);
  await interaction.reply({
    content: reason ? `✅ صوتك: **رافض**\n📝 السبب: ${reason}` : '✅ صوتك: **رافض** ✓',
    flags: MessageFlags.Ephemeral
  });
}

/* ===================================================================
   التفاصيل (من صوت مع مين)
   =================================================================== */

export async function handleVoteVoters(interaction) {
  const id = interaction.customId.replace('vote_voters_', '');
  const vote = await Vote.findById(id);
  if (!vote) return interaction.reply({ content: '❌ التصويت غير موجود.', flags: MessageFlags.Ephemeral });

  const yesUsers = vote.votes.filter(v => v.vote === 'yes').map(v => `<@${v.userId}>`);
  const noUsers = vote.votes.filter(v => v.vote === 'no').map(v => `<@${v.userId}>`);

  const embed = embedCustom(vote.color || 0x2B2D31, `📊 تفاصيل التصويت: ${vote.title}`)
    .addFields(
      { name: `✅ موافق (${yesUsers.length})`, value: yesUsers.join('\n') || 'لا أحد', inline: true },
      { name: `❌ رافض (${noUsers.length})`, value: noUsers.join('\n') || 'لا أحد', inline: true },
    )
    .setFooter({ text: `المجموع: ${vote.votes.length} صوت` });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/* ===================================================================
   أسباب الرفض
   =================================================================== */

export async function handleVoteReasons(interaction) {
  const id = interaction.customId.replace('vote_reasons_', '');
  const vote = await Vote.findById(id);
  if (!vote) return interaction.reply({ content: '❌ التصويت غير موجود.', flags: MessageFlags.Ephemeral });

  const noVotes = vote.votes.filter(v => v.vote === 'no');
  if (!noVotes.length) return interaction.reply({ content: 'لا يوجد رافضون.', flags: MessageFlags.Ephemeral });

  const lines = noVotes.map(v =>
    `❌ <@${v.userId}>${v.reason ? `\n📝 ${v.reason}` : ''}`
  );

  const embed = embedError('📋 أسباب الرفض', lines.join('\n\n') || 'لا توجد أسباب');

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/* ===================================================================
   تحديث الرسالة
   =================================================================== */

async function updateVoteMessage(interaction, vote) {
  const channel = interaction.guild?.channels.cache.get(vote.channelId) || interaction.channel;
  if (!channel) return;
  const message = await channel.messages.fetch(vote.messageId).catch(() => null);
  if (!message) return;
  const embed = buildVoteEmbed(vote, interaction.client);
  const rows = buildVoteRows(vote);
  await message.edit({ embeds: [embed], components: rows }).catch(() => {});
}

/* ===================================================================
   منتهي الصلاحية تلقائياً
   =================================================================== */

export function startVoteExpiryChecker(client) {
  if (expiryInterval) clearInterval(expiryInterval);
  expiryInterval = setInterval(async () => {
    try {
      const expired = await Vote.find({ status: 'pending', expiresAt: { $lt: new Date() } });
      for (const vote of expired) {
        vote.status = 'ended';
        vote.ended = true;
        await vote.save();

        const channel = await client.channels.fetch(vote.channelId).catch(() => null);
        if (!channel) continue;

        const message = channel.messages.cache.get(vote.messageId) ||
          await channel.messages.fetch(vote.messageId).catch(() => null);
        if (message) {
          const embed = buildVoteEmbed(vote, client);
          const rows = buildVoteRows(vote);
          await message.edit({ embeds: [embed], components: rows }).catch(() => {});
        }

        const thread = await client.channels.fetch(vote.threadId).catch(() => null);
        if (thread?.isThread?.()) {
          const yes = vote.votes.filter(v => v.vote === 'yes').length;
          const no = vote.votes.filter(v => v.vote === 'no').length;
          await thread.send(`⏰ **انتهى التصويت!**\n✅ موافق: ${yes}  •  ❌ رافض: ${no}\n🔒 سيتم حذف الثريد بعد ١٠ ثوانٍ.`);
          setTimeout(() => thread.delete().catch(() => {}), 10000);
        }
      }
    } catch (err) {
      console.error('[Vote Expiry]', err);
    }
  }, 60 * 1000);
}
