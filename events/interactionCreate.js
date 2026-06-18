import { InteractionType, MessageFlags } from 'discord.js';

export default {
  name: 'interactionCreate',
  async execute(interaction) {
    if (interaction.type === InteractionType.ApplicationCommand) {
      const command = interaction.client.commands.get(interaction.commandName);

      if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error('Error executing command:', error);
        
        const errorMessage = {
          content: '❌ حدث خطأ أثناء تنفيذ الأمر!',
          flags: MessageFlags.Ephemeral
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      }
    } else if (interaction.type === InteractionType.MessageComponent) {
      // Handle button interactions
      try {
        const { handleButtonInteraction } = await import('../utils/buttonHandler.js');
        await handleButtonInteraction(interaction);
      } catch (error) {
        console.error('Error importing/executing button handler:', error);
        
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
              content: '❌ حدث خطأ أثناء معالجة الزر!',
              flags: MessageFlags.Ephemeral
            });
          } else {
            await interaction.reply({
              content: '❌ حدث خطأ أثناء معالجة الزر!',
              flags: MessageFlags.Ephemeral
            });
          }
        } catch (replyError) {
          console.error('Failed to send error message:', replyError);
        }
      }
    } else if (interaction.type === InteractionType.ModalSubmit) {
      // Handle modal interactions
      try {
        const { handleModalInteraction } = await import('../utils/modalHandler.js');
        await handleModalInteraction(interaction);
      } catch (error) {
        console.error('Error importing/executing modal handler:', error);
        
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
              content: '❌ حدث خطأ أثناء معالجة النموذج!',
              flags: MessageFlags.Ephemeral
            });
          } else {
            await interaction.reply({
              content: '❌ حدث خطأ أثناء معالجة النموذج!',
              flags: MessageFlags.Ephemeral
            });
          }
        } catch (replyError) {
          console.error('Failed to send error message:', replyError);
        }
      }
    }
  },
};