// commands/reportSystem.js
import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { custom as embedCustom } from '../utils/embedStyles.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
// أزل هذا الاستيراد: import { handleDoublePointsToggle } from '../utils/reportHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

export default {
  data: new SlashCommandBuilder()
    .setName('نظام-التقارير')
    .setDescription('ينشر لوحة التقارير للإدارة'),

  async execute(interaction) {
    // بناء قائمة النقاط من الإعدادات
    const reportPoints = config.points?.reportPoints || {};
    const pointsLabels = {
      daily_interaction: '📊 تقرير إثبات تفاعل يومي',
      kill_citizen: '💀 قتل مواطن أو تثبيته',
      kill_police: '👮 قتل شرطي',
      store_robbery: '🏪 سرقة متجر',
      big_robbery: '🎪 سرقة سفينة / بنك / مصرف / متحف',
      event_participation: '🚫 تهريب ممنوعات',
      scenario_participation: '👨‍👩‍👧‍👦 مشاركة في سيناريو',
      farm_participation: '🌾 مشاركة في مزرعة',
      vehicle_location: '🚗 إضافة مركبة قيمة أو موقع',
      rescue_family_member: '🦸 انقاذ عضو من العائلة'
    };

    let pointsDescription = '';
    for (const [type, label] of Object.entries(pointsLabels)) {
      const pts = reportPoints[type];
      if (pts) {
        pointsDescription += `**${label}:** ${pts.reporter} نقطة` +
          (pts.participants > 0 ? ` (المشارك: ${pts.participants})` : '') + '\n';
      }
    }
    pointsDescription += '\n🏆 **ملاحظة:** المشاركون يحصلون على نقاط حسب الإعدادات أعلاه';

    // إنشاء الإيمبد الرئيسي
    const embed = embedCustom(0x0099FF, '📋 نظام التقارير',
      'يمكن لأي عضو في العائلة استخدام هذا النظام لإنشاء تقارير.\n\n**طريقة الاستخدام:**\n• اختر نوع التقرير من القائمة أدناه\n• اتبع التعليمات التي تظهر لك')
      .addFields({ name: '📊 أنواع التقارير المتاحة', value: pointsDescription })
      .setFooter({ text: 'كل تقرير يمر بمراحل وسيتم مراجعته من الإدارة' });

    // إظهار حالة ضعف النقاط
    let doublePointsStatus = 'غير مفعّل';
    try {
      const { default: DoublePoints } = await import('../models/DoublePoints.js');
      const dp = await DoublePoints.findOne({ isActive: true, type: 'report' }).catch(() => null);
      if (dp) {
        if (dp.expiresAt && new Date(dp.expiresAt) < new Date()) {
          dp.isActive = false;
          await dp.save();
        } else if (dp.expiresAt) {
          doublePointsStatus = `🟢 مفعّل — ينتهي <t:${Math.floor(new Date(dp.expiresAt).getTime() / 1000)}:R>`;
        } else {
          doublePointsStatus = '🟢 مفعّل';
        }
      }
    } catch (e) {}
    embed.addFields({ name: '🎯 ضعف النقاط', value: doublePointsStatus, inline: false });
    // القائمة المنسدلة لأنواع التقارير
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('start_report')
      .setPlaceholder('اختر نوع التقرير')
      .addOptions([
        { label: 'تقرير إثبات تفاعل يومي', value: 'daily_interaction' },
        { label: 'قتل مواطن أو تثبيته', value: 'kill_citizen' },
        { label: 'قتل شرطي', value: 'kill_police' },
        { label: 'سرقة متجر', value: 'store_robbery' },
        { label: 'سرقة سفينة / بنك / مصرف / متحف', value: 'big_robbery' },
        { label: 'تهريب ممنوعات', value: 'event_participation' },
        { label: 'مشاركة في سيناريو', value: 'scenario_participation' },
        { label: 'مشاركة في مزرعة', value: 'farm_participation' },
        { label: 'تقرير إضافة مركبة قيمة أو موقع', value: 'vehicle_location' }
      ]);

    // أزرار إدارية (تظهر فقط للإدارة)
    const adminButtons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('double_points_btn')
          .setLabel('🎯 تفعيل ضعف النقاط')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('report_stats')
          .setLabel('📊 إحصائيات التقارير')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('refresh_panel')
          .setLabel('🔄 تحديث اللوحة')
          .setStyle(ButtonStyle.Secondary)
      );

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
      content: '**لوحة التقارير**\nيمكن للأعضاء استخدام القائمة المنسدلة لإنشاء تقارير جديدة.',
      embeds: [embed],
      components: [selectRow, adminButtons]
    });
  }
};