import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('تصويت')
    .setDescription('📊 إنشاء تصويت جديد')
    .addStringOption(option =>
      option.setName('العنوان')
        .setDescription('عنوان التصويت')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('المدة')
        .setDescription('مدة التصويت بالساعات (افتراضي: 24)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(720))
    .addIntegerOption(option =>
      option.setName('اللون')
        .setDescription('لون الإيمبد (رقم عشري مثل: 16711680 = أحمر)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(16777215))
    .addStringOption(option =>
      option.setName('الفوتر')
        .setDescription('نص الفوتر')
        .setRequired(false))
    .addRoleOption(option =>
      option.setName('الرتبة')
        .setDescription('رتبة محددة فقط تقدر تصوت')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('سبب_الرفض')
        .setDescription('طلب سبب من الرافضين (افتراضي: نعم)')
        .setRequired(false)),

  async execute(interaction) {
    const modalId = `vote_content_modal_${interaction.id}`;

    const data = {
      title: interaction.options.getString('العنوان'),
      durationHours: interaction.options.getInteger('المدة') ?? 24,
      color: interaction.options.getInteger('اللون') ?? 0x2B2D31,
      footer: interaction.options.getString('الفوتر') || null,
      voteRoleId: interaction.options.getRole('الرتبة')?.id ?? null,
      requireReason: interaction.options.getBoolean('سبب_الرفض') ?? true,
      authorId: interaction.user.id,
      authorTag: interaction.user.tag
    };

    interaction.client._voteData = interaction.client._voteData || new Map();
    interaction.client._voteData.set(modalId, data);

    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle('📝 تفاصيل التصويت')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('vote_content')
            .setLabel('النص (يدعم # و - و ** و ```)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000)
            .setPlaceholder('اكتب تفاصيل التصويت هنا...\nيمكنك استخدام:\n# عنوان كبير\n- نقاط\n**نص عريض**\n```كود```')
        )
      );

    await interaction.showModal(modal);
  }
};
