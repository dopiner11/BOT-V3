import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { commandRegistry, getCommandInfo } from './actionRegistry.js';
import { committees as permCommittees } from './committeePermissions.js';
import { custom as embedCustom } from './embedStyles.js';

const PER_PAGE = 8;

// تخزين مؤقت لحالة التصفح لكل مستخدم (تت مسح لما البوت يطفي)
const userPages = new Map();

export function getHelpPages() {
  // بناء قائمة بجميع الأوامر مع لجنتها
  const allItems = [];
  const added = new Set();

  for (const [, perm] of Object.entries(permCommittees)) {
    for (const cmd of perm.commands) {
      if (!added.has(cmd)) {
        allItems.push({ name: cmd, committeeName: perm.name });
        added.add(cmd);
      }
    }
  }

  for (const cmd of Object.keys(commandRegistry)) {
    if (!added.has(cmd)) {
      allItems.push({ name: cmd, committeeName: null });
      added.add(cmd);
    }
  }

  const total = allItems.length;
  const totalPages = total > 0 ? Math.ceil(total / PER_PAGE) : 1;

  function buildEmbed(pageIndex) {
    const start = pageIndex * PER_PAGE;
    const items = allItems.slice(start, start + PER_PAGE);
    const pageNum = pageIndex + 1;

    const embed = embedCustom(0x2B2D31, '📚 قائمة الأوامر')
      .setFooter({ text: `𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 • صفحة ${pageNum}/${totalPages}` });

    let desc = '';
    for (const cmd of items) {
      const info = getCommandInfo(cmd.name);
      desc += `**/${cmd.name}**`;
      if (cmd.committeeName) {
        desc += ` ← ${cmd.committeeName}`;
      } else {
        desc += ` ← 👤 عام`;
      }
      if (info?.description) desc += `\n📌 ${info.description}`;
      if (info?.usage) desc += `\n\`${info.usage}\``;
      desc += '\n\n';
    }

    if (desc.length > 4000) desc = desc.slice(0, 3900) + '\n*... (بعض الأوامر مخفية)*';
    embed.setDescription(desc || 'لا توجد أوامر');

    embed.addFields({
      name: '📊 التقدم',
      value: `عرض ${start + 1}–${Math.min(start + PER_PAGE, total)} من ${total} أمر`,
    });

    return embed;
  }

  return { allItems, total, totalPages, buildEmbed };
}

export async function sendHelpPage(interaction) {
  const { totalPages, buildEmbed } = getHelpPages();
  userPages.set(interaction.user.id, 0);

  const row = totalPages > 1 ? new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('help_page').setLabel(`1/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('help_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(false),
  ) : [];

  await interaction.reply({ embeds: [buildEmbed(0)], components: totalPages > 1 ? [row] : [], flags: MessageFlags.Ephemeral });
}

export async function handleHelpNavigation(interaction) {
  const customId = interaction.customId;
  if (customId !== 'help_prev' && customId !== 'help_next') return;

  const { totalPages, buildEmbed } = getHelpPages();
  let currentPage = userPages.get(interaction.user.id) || 0;

  if (customId === 'help_next' && currentPage < totalPages - 1) currentPage++;
  else if (customId === 'help_prev' && currentPage > 0) currentPage--;
  else return;

  userPages.set(interaction.user.id, currentPage);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId('help_page').setLabel(`${currentPage + 1}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('help_next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === totalPages - 1),
  );

  await interaction.update({ embeds: [buildEmbed(currentPage)], components: [row] });
}
