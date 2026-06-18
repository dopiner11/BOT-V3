import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { queue, SendJob, collectAllTargets, collectRoleTargets, collectUsersTargets, collectOnlineTargets, collectVoiceTargets, logBroadcastComplete } from '../utils/broadcastSender.js';
import { success as embedSuccess, custom as embedCustom } from '../utils/embedStyles.js';

const pendingBroadcasts = new Map();

export function getPendingBroadcast(userId) {
  return pendingBroadcasts.get(userId);
}

export function clearPendingBroadcast(userId) {
  pendingBroadcasts.delete(userId);
}

export default {
  data: new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('📡 إرسال برودكاست للأعضاء')
    .addStringOption(o => o.setName('المستهدفين').setDescription('المستهدفين').setRequired(true)
      .addChoices(
        { name: '🎯 جميع الأعضاء', value: 'all' },
        { name: '🟢 المتصلين', value: 'online' },
        { name: '👥 رتبة محددة', value: 'role' },
        { name: '👤 أعضاء محددين', value: 'users' },
        { name: '🎤 روم صوتي', value: 'voice' }
      ))
    .addStringOption(o => o.setName('نوع_الإرسال').setDescription('نوع الرسالة').setRequired(true)
      .addChoices(
        { name: '💬 رسالة نصية', value: 'text' },
        { name: '🖼 إيمبد', value: 'embed' }
      ))
    .addRoleOption(o => o.setName('الرتبة').setDescription('الرتبة المستهدفة (إذا اخترت "رتبة محددة")').setRequired(false))
    .addStringOption(o => o.setName('الأعضاء').setDescription('أيديات الأعضاء مفصولة بمسافة').setRequired(false))
    .addChannelOption(o => o.setName('الروم').setDescription('الروم الصوتي المستهدف').setRequired(false))
    .addStringOption(o => o.setName('لون_الإيمبد').setDescription('لون الإيمبد (مثال: #ff0000)').setRequired(false))
    .addStringOption(o => o.setName('صورة').setDescription('رابط صورة').setRequired(false)),

  async execute(interaction) {
    const targetType = interaction.options.getString('المستهدفين');
    const sendType = interaction.options.getString('نوع_الإرسال');

    if (targetType === 'role' && !interaction.options.getRole('الرتبة')) {
      return interaction.reply({ content: '❌ يجب تحديد الرتبة.', flags: MessageFlags.Ephemeral });
    }
    if (targetType === 'users' && !interaction.options.getString('الأعضاء')) {
      return interaction.reply({ content: '❌ يجب تحديد أيديات الأعضاء.', flags: MessageFlags.Ephemeral });
    }
    if (targetType === 'voice' && !interaction.options.getChannel('الروم')) {
      return interaction.reply({ content: '❌ يجب تحديد الروم الصوتي.', flags: MessageFlags.Ephemeral });
    }

    const modalFields = [
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('broadcast_message')
          .setLabel(sendType === 'embed' ? '📄 وصف الإيمبد' : '💬 محتوى الرسالة')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder(sendType === 'embed' ? 'اكتب وصف الإيمبد هنا...' : 'اكتب رسالتك هنا...')
          .setMaxLength(4000)
          .setRequired(true)
      ),
    ];

    if (sendType === 'embed') {
      modalFields.push(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('broadcast_title')
            .setLabel('📌 عنوان الإيمبد')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(256)
            .setRequired(false)
        )
      );
    }

    const modal = new ModalBuilder()
      .setCustomId('broadcast_modal')
      .setTitle('📝 رسالة البرودكاست')
      .addComponents(modalFields);

    await interaction.showModal(modal).catch(() => {});

    const submitted = await interaction.awaitModalSubmit({ time: 300000, filter: i => i.user.id === interaction.user.id }).catch(() => null);
    if (!submitted) return;

    await submitted.deferReply({ flags: MessageFlags.Ephemeral });

    const messageContent = submitted.fields.getTextInputValue('broadcast_message');
    const embedTitle = sendType === 'embed' ? submitted.fields.getTextInputValue('broadcast_title') || '' : '';
    const embedColor = interaction.options.getString('لون_الإيمبد') || '#2b2d31';
    const imageUrl = interaction.options.getString('صورة');

    const payload = {};
    if (sendType === 'embed') {
      const embed = embedCustom(embedColor, embedTitle, messageContent);
      if (imageUrl) embed.setImage(imageUrl);
      payload.embeds = [embed];
    } else {
      payload.content = messageContent;
      if (imageUrl) {
        const embed = embedCustom(embedColor, '', '').setImage(imageUrl);
        payload.embeds = [embed];
      }
    }

    let targets = [];
    const guild = interaction.guild;

    try {
      switch (targetType) {
        case 'all': targets = await collectAllTargets(guild); break;
        case 'online': targets = await collectOnlineTargets(guild); break;
        case 'role': targets = await collectRoleTargets(guild, interaction.options.getRole('الرتبة').id); break;
        case 'users': {
          const idsStr = interaction.options.getString('الأعضاء');
          const ids = idsStr.match(/\d{17,19}/g) || [];
          if (ids.length === 0) return submitted.editReply('❌ لم يتم العثور على أيديات صالحة.');
          targets = await collectUsersTargets(guild, ids);
          break;
        }
        case 'voice': targets = await collectVoiceTargets(guild, interaction.options.getChannel('الروم').id); break;
      }
    } catch (e) {
      return submitted.editReply(`❌ خطأ في جمع المستهدفين: ${e.message}`);
    }

    if (targets.length === 0) {
      return submitted.editReply('❌ لا يوجد أعضاء مستهدفين.');
    }

    // حفظ البيانات مؤقتاً للنقر على التأكيد
    pendingBroadcasts.set(interaction.user.id, { targets, payload, type: targetType, senderId: interaction.user.id, guildId: interaction.guildId });

    const previewEmbed = embedSuccess('📡 معاينة البرودكاست',
      `سيُرسل إلى **${targets.length}** عضو.\n**النوع:** ${sendType === 'embed' ? 'إيمبد' : 'نص'}`,
      [
        { name: '📂 المستهدفين', value: targetType, inline: true },
        { name: '📊 العدد', value: `${targets.length}`, inline: true },
        { name: '⏱ المدة التقريبية', value: `${Math.ceil(targets.length * 3)} ثانية`, inline: true },
      ]
    );

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('confirm_broadcast')
        .setLabel('✅ تأكيد الإرسال')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('cancel_preview')
        .setLabel('❌ إلغاء')
        .setStyle(ButtonStyle.Danger)
    );

    await submitted.editReply({ embeds: [previewEmbed, payload.embeds?.[0] ? { ...payload.embeds[0].data } : null].filter(Boolean), components: [confirmRow] });
    }
};
