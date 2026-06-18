import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import Member from '../models/Member.js';
import Nomination from '../models/Nomination.js';
import { applyPromotion } from '../utils/promotionManager.js';
import { custom as embedCustom } from '../utils/embedStyles.js';
import { loadConfig } from '../utils/configLoader.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ترشيح')
    .setDescription('ترشيح عضو لرتبة أعلى (للجنة الترقيات)')
    .addUserOption(option => option.setName('العضو').setDescription('العضو المرشح').setRequired(true))
    .addIntegerOption(option => option.setName('الرتبة').setDescription('رقم الرتبة الجديدة').setRequired(true))
    .addStringOption(option => option.setName('السبب').setDescription('سبب الترشيح').setRequired(true))
    .addIntegerOption(option => option.setName('المدة').setDescription('مدة التصويت بالساعات').setRequired(true)),

  async execute(interaction) {
    const config = loadConfig();

    const user = interaction.options.getUser('العضو');
    const rankNum = interaction.options.getInteger('الرتبة');
    const reason = interaction.options.getString('السبب');
    const duration = interaction.options.getInteger('المدة');

    const memberData = await Member.findOne({ discordId: user.id });
    if (!memberData) {
      return interaction.reply({ content: '❌ العضو غير مسجل في قاعدة البيانات.', flags: MessageFlags.Ephemeral });
    }

    const ranks = config.promotion?.ranks || [];
    const currentRankIndex = (memberData.jobNumber || 1) - 1;

    if (rankNum <= currentRankIndex + 1) {
      return interaction.reply({ content: `❌ العضو رتبته الحالية أعلى أو تساوي الرتبة المقترحة.`, flags: MessageFlags.Ephemeral });
    }

    const newRank = ranks.find(r => r.id === rankNum) || ranks[rankNum - 1];
    if (!newRank) {
      return interaction.reply({ content: '❌ رقم الرتبة غير صحيح.', flags: MessageFlags.Ephemeral });
    }

    const existing = await Nomination.findOne({ targetId: user.id, ended: { $ne: true } });
    if (existing) {
      return interaction.reply({ content: '❌ يوجد ترشيح نشط لهذا العضو بالفعل.', flags: MessageFlags.Ephemeral });
    }

    const oldRank = ranks[currentRankIndex] || null;

    const doc = {
      targetId: user.id,
      nominatorId: interaction.user.id,
      targetRankNum: rankNum,
      targetRankName: newRank?.name || `رتبة ${rankNum}`,
      targetRoleId: newRank?.roleId,
      reason,
      votes: { accept: [], reject: [] },
      startTime: new Date(),
      endTime: new Date(Date.now() + duration * 60 * 60 * 1000),
      guildId: interaction.guild.id,
      channelId: interaction.channelId,
      messageId: null,
      ended: false
    };

    const nomination = await Nomination.create(doc);

    const embed = embedCustom(0x3498DB, '🗳️ ترشيح لترقية عضو',
      `**قام <@${interaction.user.id}> بترشيح <@${user.id}>**`)
      .addFields(
        { name: '👤 المرشح', value: `<@${user.id}>`, inline: true },
        { name: '📈 الرتبة الحالية', value: oldRank?.roleId ? `<@&${oldRank.roleId}>` : (oldRank?.name || 'غير معروف'), inline: true },
        { name: '🆙 الرتبة المقترحة', value: nomination.targetRoleId ? `<@&${nomination.targetRoleId}>` : nomination.targetRankName, inline: true },
        { name: '📝 السبب', value: reason },
        { name: '⏳ ينتهي التصويت', value: `<t:${Math.floor(nomination.endTime.getTime() / 1000)}:R>` },
        { name: '📊 الأصوات', value: `✅ 0 | ❌ 0` }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`nom_acc_${nomination._id}`).setLabel('✅ موافق').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`nom_rej_${nomination._id}`).setLabel('❌ رفض').setStyle(ButtonStyle.Danger)
    );

    const response = await interaction.reply({ embeds: [embed], components: [row], withResponse: true });
    const msg = response.resource.message;
    nomination.messageId = msg.id;
    await nomination.save();

    scheduleNominationEnd(nomination._id, duration * 60 * 60 * 1000);
  }
};

const endTimeouts = new Map();
let _client = null;

export function setNominationClient(client) {
  _client = client;
  global.__client = client;
}

function scheduleNominationEnd(nomId, delayMs) {
  if (endTimeouts.has(nomId)) clearTimeout(endTimeouts.get(nomId));
  const timeout = setTimeout(async () => {
    endTimeouts.delete(nomId);
    try {
      const nomination = await Nomination.findById(nomId);
      if (!nomination || nomination.ended) return;
      await endNomination(nomination);
    } catch (err) {
      console.error('[Nomination] scheduleEnd error:', err);
    }
  }, delayMs);
  endTimeouts.set(nomId, timeout);
}

export async function handleNominationButton(interaction) {
  let nomId;
  let voteType;
  if (interaction.customId.startsWith('nom_acc_')) {
    nomId = interaction.customId.replace('nom_acc_', '');
    voteType = 'accept';
  } else if (interaction.customId.startsWith('nom_rej_')) {
    nomId = interaction.customId.replace('nom_rej_', '');
    voteType = 'reject';
  } else {
    return;
  }

  const nomination = await Nomination.findById(nomId);
  if (!nomination || nomination.ended) {
    return interaction.reply({ content: '❌ انتهى التصويت أو البيانات غير موجودة.', flags: MessageFlags.Ephemeral });
  }

  if (nomination.votes.accept.includes(interaction.user.id) || nomination.votes.reject.includes(interaction.user.id)) {
    return interaction.reply({ content: '❌ لقد صوت مسبقاً.', flags: MessageFlags.Ephemeral });
  }

  if (voteType === 'accept') nomination.votes.accept.push(interaction.user.id);
  else nomination.votes.reject.push(interaction.user.id);
  await nomination.save();

  await interaction.deferUpdate();

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);
  const votesFieldIdx = embed.data.fields.findIndex(f => f.name === '📊 الأصوات');
  if (votesFieldIdx !== -1) {
    embed.data.fields[votesFieldIdx].value = `✅ ${nomination.votes.accept.length} | ❌ ${nomination.votes.reject.length}`;
  }
  await interaction.editReply({ embeds: [embed] });
}

async function endNomination(nomination) {
  const config = loadConfig();
  nomination.ended = true;
  await nomination.save();

  const acceptCount = nomination.votes.accept.length;
  const rejectCount = nomination.votes.reject.length;
  const isAccepted = acceptCount > rejectCount;

  const client = _client;
  if (!client) {
    console.error('[Nomination] _client not set, cannot end nomination', nomination._id);
    return;
  }

  const channel = await client.channels.fetch(nomination.channelId).catch(() => null);
  if (!channel) {
    console.error('[Nomination] Channel not found for nomination', nomination.channelId);
    return;
  }

  const message = await channel.messages.fetch(nomination.messageId).catch(() => null);

  if (message) {
    const resultEmbed = EmbedBuilder.from(message.embeds[0])
      .setDescription(`**انتهى التصويت على ترشيح <@${nomination.targetId}>**`)
      .setColor(isAccepted ? '#2ecc71' : '#e74c3c')
      .addFields({ name: '🏁 النتيجة النهائية', value: isAccepted ? '✅ **تم القبول**' : '❌ **تم الرفض**', inline: false });
    await message.edit({ embeds: [resultEmbed], components: [] }).catch(e => console.error('[Nomination] edit msg error:', e));
  }

  if (isAccepted) {
    await applyNominationPromotion(nomination, config);
  }

  if (endTimeouts.has(nomination._id)) {
    clearTimeout(endTimeouts.get(nomination._id));
    endTimeouts.delete(nomination._id);
  }
}

async function applyNominationPromotion(nomination, config) {
  const client = _client;
  if (!client) {
    console.error('[Nomination] _client not set, cannot promote', nomination._id);
    return;
  }

  const guild = await client.guilds.fetch(nomination.guildId).catch(() => null);
  if (!guild) return;

  const member = await guild.members.fetch(nomination.targetId).catch(() => null);
  if (!member) return;

  const dbMember = await Member.findOne({ discordId: nomination.targetId });
  if (!dbMember) return;

  const ranks = config.promotion?.ranks || [];
  const newRank = ranks.find(r => r.id === nomination.targetRankNum) || ranks[nomination.targetRankNum - 1];
  if (!newRank) return;

  const promoRoleId = config.committees?.list?.promotion?.roles?.member?.[0]
    || config.committees?.list?.promotion?.roles?.deputy?.[0]
    || config.committees?.list?.promotion?.roles?.manager?.[0]
    || '1421916208357310554';
  const presRoleId = config.committees?.list?.family_presidency?.roles?.member?.[0]
    || '1451612325927714927';

  const responsibilities = newRank?.responsibilities || 'حسب الوصف الوظيفي';
  const announcementText = `**▬▬▬▬▬▬▬▬ ﷽ ▬▬▬▬▬▬▬▬**

**وقرار اخر صادر من  <@&${presRoleId}>   و اللجنة المسؤولة <@&${promoRoleId}> عن شؤون الاعضاء داخل العائلة بعد المراجعه و النظر لـ التفاعل الاستثنائي  وبعد المراجعه و التدقيق و تعديل بعض البيانات قررنا التالي من خلال تصويت في <#${nomination.channelId}>   : **

### تقرر اعطاء ترقية استثنائية لكل من المذكور أدناه : 

- <@${nomination.targetId}>
  

> **بترقية العضاء المذكورين  أعلاه لـ  :  <@&${newRank?.roleId}>     **

> **وتسليمه المسؤوليات التالية : ${responsibilities}  **

## نتمنى لكم الاستمرار في تميزكم فى عملكم.

-# يمكنك تقديم تظلم من خلال <#1388879337171980420> 

-** إمــضــاء و تــوقــيــع ✍️ **:   <@&${promoRoleId}>  
-** إمــضــاء و تــوقــيــع محرر القرار ✍️ **:   <@${nomination.nominatorId}>
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`;

  await applyPromotion({
    memberData: dbMember, guildMember: member,
    newRank, newRankIndex: (nomination.targetRankNum - 1),
    promoterId: client.user.id, promoterName: 'نظام التصويت',
    guild,
    options: {
      type: 'ترقية (تصويت)',
      silent: false,
      announcementText
    }
  });
}

export async function restoreNominations(client) {
  setNominationClient(client);
  const active = await Nomination.find({ ended: { $ne: true } });
  for (const nom of active) {
    const now = Date.now();
    const remaining = nom.endTime.getTime() - now;
    if (remaining > 0) {
      scheduleNominationEnd(nom._id, remaining);
    } else {
      await endNomination(nom);
    }
  }
  console.log(`[Nomination] Restored ${active.length} active nominations.`);
}
