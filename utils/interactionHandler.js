import { InteractionType, MessageFlags } from 'discord.js';

export default {
  name: 'interactionCreate',
  async execute(interaction) {
    // تجاهل التفاعلات من البوت نفسه
    if (interaction.user.bot) return;

    try {
      // معالجة الأوامر (Slash Commands)
      if (interaction.type === InteractionType.ApplicationCommand) {
        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
          console.error(`No command matching ${interaction.commandName} was found.`);
          return;
        }

        await command.execute(interaction);
      }
      
      // معالجة الأزرار
      else if (interaction.type === InteractionType.MessageComponent) {
        const customId = interaction.customId;
        
        // التحقق إذا كان الزر من أزرار التقارير الجديدة
        if (customId === 'family_has_participants_yes' || 
            customId === 'family_has_participants_no' ||
            customId.startsWith('family_report_')) {
          
          // استيراد معالج تقارير العائلة
          const familyReportModule = await import('../commands/familyReport.js');
          if (customId === 'family_has_participants_yes' || customId === 'family_has_participants_no') {
            await familyReportModule.handleFamilyParticipantsButton(interaction);
          }
          return;
        }
        
        // التحقق إذا كان زر قبول/رفض تقرير
        if (customId.startsWith('approve_report_') || customId.startsWith('reject_report_')) {
          const { handleReportApprovalButton } = await import('../utils/buttonHandler.js');
          await handleReportApprovalButton(interaction);
          return;
        }
        
        // معالجة الأزرار الأخرى بالنظام القديم
        try {
          const { handleButtonInteraction } = await import('../utils/buttonHandler.js');
          await handleButtonInteraction(interaction);
        } catch (buttonError) {
          console.error('Error handling button interaction:', buttonError);
          throw buttonError;
        }
      }
      
      // معالجة النماذج (Modals)
      else if (interaction.type === InteractionType.ModalSubmit) {
        const customId = interaction.customId;
        
        // التحقق إذا كان مودال رفض تقرير
        if (customId.startsWith('reject_modal_')) {
          const { handleReportModal } = await import('../utils/buttonHandler.js');
          await handleReportModal(interaction);
          return;
        }
        
        // معالجة النماذج الأخرى بالنظام القديم
        try {
          const { handleModalInteraction } = await import('../utils/modalHandler.js');
          await handleModalInteraction(interaction);
        } catch (modalError) {
          console.error('Error handling modal interaction:', modalError);
          throw modalError;
        }
      }
      
      // معالجة القوائم المنسدلة
      else if (interaction.type === InteractionType.StringSelectMenu) {
        const customId = interaction.customId;
        
        if (customId === 'family_report_type_select') {
          // يتم معالجته في ملف familyReport.js عبر الكولكتور
          console.log('[SELECT] Family report type selected');
          return;
        }
        
        // معالجة القوائم المنسدلة الأخرى
        if (customId === 'report_type_select') {
          // يتم معالجته في ملف reportSystem.js عبر الكولكتور
          console.log('[SELECT] Report type selected');
          return;
        }
      }

    } catch (error) {
      console.error('Error handling interaction:', error);
      
      // محاولة إرسال رسالة خطأ
      try {
        const errorMessage = {
          content: '❌ حدث خطأ أثناء معالجة التفاعل!',
          flags: MessageFlags.Ephemeral
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch (replyError) {
        console.error('Failed to send error message:', replyError);
      }
    }
  },
};