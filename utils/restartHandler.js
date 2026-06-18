import Report from '../models/Report.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { custom as embedCustom } from './embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let config;
try {
  config = JSON.parse(
    readFileSync(join(__dirname, '../config.json'), 'utf8')
  );
} catch (error) {
  console.error('Error reading config in restartHandler:', error);
  config = { reportSystem: {} };
}

// دالة لإعادة بناء الأزرار بعد إعادة التشغيل
export async function restoreButtonsAfterRestart(client) {
  try {
    console.log('[RESTART] Restoring buttons after restart...');
    
    // جلب جميع التقارير المعلقة
    const pendingReports = await Report.find({ 
      status: 'pending',
      reviewMessageId: { $exists: true },
      reviewChannelId: { $exists: true }
    });
    
    console.log(`[RESTART] Found ${pendingReports.length} pending reports to restore`);
    
    let restoredCount = 0;
    
    for (const report of pendingReports) {
      try {
        const channel = client.channels.cache.get(report.reviewChannelId);
        if (!channel) {
          console.log(`[RESTART] Channel ${report.reviewChannelId} not found for report ${report._id}`);
          continue;
        }
        
        // محاولة جلب الرسالة
        let message;
        try {
          message = await channel.messages.fetch(report.reviewMessageId);
        } catch (error) {
          console.log(`[RESTART] Message ${report.reviewMessageId} not found for report ${report._id}, recreating...`);
          
          // إعادة إنشاء الرسالة إذا لم توجد
          await recreateReportMessage(channel, report);
          restoredCount++;
          continue;
        }
        
        // التحقق من وجود الأزرار
        if (!message.components || message.components.length === 0) {
          console.log(`[RESTART] No buttons found for report ${report._id}, recreating...`);
          
          // إعادة إنشاء الأزرار
          await recreateButtons(message, report);
          restoredCount++;
        }
        
      } catch (error) {
        console.error(`[RESTART] Error restoring report ${report._id}:`, error);
      }
    }
    
    console.log(`[RESTART] Successfully restored ${restoredCount} reports`);
    
  } catch (error) {
    console.error('[RESTART] Error in restoreButtonsAfterRestart:', error);
  }
}

// إعادة إنشاء الأزرار
async function recreateButtons(message, report) {
  try {
    // إنشاء أزرار جديدة
    const actionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('accept_report')
          .setLabel('✅ قبول التقرير')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('reject_report')
          .setLabel('❌ رفض التقرير')
          .setStyle(ButtonStyle.Danger)
      );
    
    // تحديث الرسالة بالأزرار الجديدة
    await message.edit({
      components: [actionRow]
    });
    
    console.log(`[RESTART] Recreated buttons for report ${report._id}`);
    
  } catch (error) {
    console.error(`[RESTART] Error recreating buttons for report ${report._id}:`, error);
  }
}

// إعادة إنشاء الرسالة بالكامل
async function recreateReportMessage(channel, report) {
  try {
    // الحصول على مقدم التقرير
    const reporter = await channel.client.users.fetch(report.reporterId).catch(() => null);
    
    // بناء قائمة المشاركين
    let participantsText = 'لا يوجد';
    if (report.participants && report.participants.length > 0) {
      participantsText = report.participants.map(id => `<@${id}>`).join(', ');
    }
    
    // نقاط التقرير من الإعدادات
    const reportConfig = config.reportSystem?.reportTypes?.[report.type] || {};
    const points = {
      reporter: reportConfig.reporter || 50,
      participant: reportConfig.participant || 25
    };
    
    // إنشاء إيمبد التقرير
    const reportEmbed = embedCustom(0xFFA500, '📋 تقرير معلق (تم استعادته)',
      `**تم استعادة هذا التقرير بعد إعادة تشغيل البوت**\n\n**📸 الدليل:** [اضغط هنا لعرض الصورة](${report.proof})`)
      .addFields(
        { name: '📌 العنوان', value: report.title || 'بدون عنوان', inline: false },
        { name: '📊 النوع', value: report.typeLabel || 'غير محدد', inline: true },
        { name: '👤 مقدم التقرير', value: reporter ? `<@${reporter.id}>` : 'غير معروف', inline: true },
        { name: '👥 المشاركون', value: participantsText, inline: false },
        { name: '🏆 النقاط المحتملة', value: `${points.reporter} للمقدم\n${points.participant} لكل مشارك`, inline: true },
        { name: '🆔 معرف التقرير', value: `\`${report._id}\``, inline: true },
        { name: '📅 تاريخ الإرسال', value: `<t:${Math.floor(report.createdAt.getTime() / 1000)}:F>`, inline: true }
      )
      .setImage(report.proof)
      .setFooter({ 
        text: `تم استعادته بعد إعادة التشغيل | ID: ${report._id}`,
        iconURL: 'https://cdn-icons-png.flaticon.com/512/2088/2088617.png'
      });
    
    // أزرار القبول والرفض
    const actionRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('accept_report')
          .setLabel('✅ قبول التقرير')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('reject_report')
          .setLabel('❌ رفض التقرير')
          .setStyle(ButtonStyle.Danger)
      );
    
    // إرسال الرسالة الجديدة
    const newMessage = await channel.send({
      embeds: [reportEmbed],
      components: [actionRow],
      content: `**📸 رابط الدليل:** ${report.proof}`
    });
    
    // تحديث التقرير في قاعدة البيانات
    await Report.findByIdAndUpdate(report._id, {
      reviewMessageId: newMessage.id,
      reviewChannelId: channel.id
    });
    
    console.log(`[RESTART] Recreated message for report ${report._id}`);
    
  } catch (error) {
    console.error(`[RESTART] Error recreating message for report ${report._id}:`, error);
  }
}

// دالة للتحقق من صلاحية الأزرار بشكل دوري
export async function setupButtonRestoration(client) {
  // استعادة الأزرار عند بدء التشغيل
  await restoreButtonsAfterRestart(client);
  
  // جدولة فحص دوري كل ساعة
  setInterval(async () => {
    await restoreButtonsAfterRestart(client);
  }, 60 * 60 * 1000); // كل ساعة
  
  console.log('[RESTART] Button restoration system activated');
}