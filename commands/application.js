import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { custom as embedCustom } from '../utils/embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let config;
try {
  config = JSON.parse(
    readFileSync(join(__dirname, '../config.json'), 'utf8')
  );
} catch (error) {
  console.error('Error reading config in application command:', error);
  config = {
    application: {
      title: 'تقديم للعائلة',
      description: 'للتقديم في العائلة، اضغط على الزر أدناه.',
      image: null
    },
    channels: {
      applications: '1396438047981174825' // تم إضافة الرقم الافتراضي
    },
    permissions: {
      manualHire: ['1388879998739288154', '1389190409317646336'] // تم التحديث
    }
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName('التقديم')
    .setDescription('إرسال نموذج التقديم للعائلة'),

  async execute(interaction) {
    try {
      // إنشاء الإيمبد
      const embed = embedCustom(0x00FF00, config.application?.title || 'التقديم للعائلة',
        config.application?.description || 'للتقديم في العائلة، اضغط على الزر أدناه.');

      if (config.application?.image) {
        embed.setImage(config.application.image);
      }

      // إنشاء القائمة المنسدلة
      const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = await import('discord.js');

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('application_select')
        .setPlaceholder('اختر نوع التقديم...')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('تقديم للعائلة')
            .setDescription('التقديم للانضمام كعضو في العائلة')
            .setValue('apply_family')
            .setEmoji('📝'),
          new StringSelectMenuOptionBuilder()
            .setLabel('تقديم بلاك ماركت')
            .setDescription('التقديم للعمل كبائع في البلاك ماركت')
            .setValue('apply_blackmarket')
            .setEmoji('🩸')
        );

      const row = new ActionRowBuilder().addComponents(selectMenu);

      // الحصول على قناة التقديمات
      const applicationsChannelId = config.application?.channels?.applications?.id || '1403787549545201704';
      const channel = interaction.guild.channels.cache.get(applicationsChannelId);

      console.log('[DEBUG] Looking for channel:', applicationsChannelId);
      console.log('[DEBUG] Channel found:', channel?.name || 'غير موجود');

      if (!channel) {
        return interaction.reply({
          content: `❌ لم يتم العثور على روم التقديمات (ID: ${applicationsChannelId})!`,
          flags: MessageFlags.Ephemeral  // تم التعديل هنا
        });
      }

      // إرسال الرسالة
      await channel.send({
        embeds: [embed],
        components: [row]
      });

      // الرد للمستخدم
      await interaction.reply({
        content: '✅ تم إرسال نموذج التقديم بنجاح!',
        flags: MessageFlags.Ephemeral  // تم التعديل هنا
      });

      console.log(`[SUCCESS] Application form sent by ${interaction.user.tag}`);

    } catch (error) {
      console.error('Error in /التقديم command:', error);

      try {
        if (!interaction.replied) {
          await interaction.reply({
            content: '❌ حدث خطأ أثناء إرسال نموذج التقديم!',
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (replyError) {
        console.error('Failed to send error reply:', replyError);
      }
    }
  },
};