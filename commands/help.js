import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { commandRegistry, getCommandInfo } from '../utils/actionRegistry.js';
import { committees as permCommittees } from '../utils/committeePermissions.js';
import { sendHelpPage } from '../utils/helpPages.js';
import { info as embedInfo } from '../utils/embedStyles.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('عرض قائمة الأوامر والمساعدة')
    .addStringOption(option =>
      option.setName('الأمر')
        .setDescription('اسم الأمر للحصول على مساعدة محددة')
        .setRequired(false)
        .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const choices = Object.keys(commandRegistry).filter(name =>
      name.includes(focusedValue)
    ).slice(0, 25);

    await interaction.respond(
      choices.map(name => ({ name: `/${name}`, value: name }))
    );
  },

  async execute(interaction) {
    const cmdName = interaction.options.getString('الأمر');

    if (cmdName) {
      const info = getCommandInfo(cmdName);
      if (!info) {
        return interaction.reply({
          content: `❌ الأمر \`/${cmdName}\` غير موجود`,
          flags: MessageFlags.Ephemeral,
        });
      }

      let committeeName = '👤 عام';
      for (const [, perm] of Object.entries(permCommittees)) {
        if (perm.commands.includes(cmdName)) {
          committeeName = perm.name;
          break;
        }
      }

      const embed = embedInfo(`📖 /${cmdName}`)
        .addFields(
          { name: '🏛️ اللجنة', value: committeeName, inline: true },
          { name: '📂 التصنيف', value: info.category || 'عام', inline: true },
          { name: '📝 الوصف', value: info.description || 'لا يوجد وصف' },
          { name: '🔧 الاستخدام', value: `\`${info.usage || `/${cmdName}`}\`` },
        )
        .setFooter({ text: '𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪' });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    await sendHelpPage(interaction);
  },
};
