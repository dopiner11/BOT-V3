import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Blacklist from '../models/Blacklist.js';
import Member from '../models/Member.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { success as embedSuccess } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import { logBlacklistRemove } from '../utils/logSystem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

export default {
  data: new SlashCommandBuilder()
    .setName('ازالة_بلاك_ليست')
    .setDescription('إزالة عضو من البلاك ليست')
    .addUserOption(option => option.setName('العضو').setDescription('العضو المراد إزالته').setRequired(true))
    .addStringOption(option => option.setName('السبب').setDescription('سبب الإزالة').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser('العضو');
    const reason = interaction.options.getString('السبب');

    const entry = await Blacklist.findOne({ userId: targetUser.id, isActive: true });
    if (!entry) return interaction.editReply('❌ العضو غير موجود في البلاك ليست نشطة.');

    entry.isActive = false;
    entry.removedBy = interaction.user.id;
    entry.removedByName = interaction.user.username;

    // Fix for legacy documents missing required fields
    if (!entry.username) entry.username = targetUser.username;
    if (!entry.addedByName) entry.addedByName = 'Unknown';

    entry.removedAt = new Date();
    entry.removalReason = reason;
    await entry.save();

    let memberGuild = interaction.guild.members.cache.get(targetUser.id);
    if (!memberGuild) {
      try {
        memberGuild = await interaction.guild.members.fetch(targetUser.id);
      } catch (error) {
        // User not in guild, continue with DB updates
      }
    }

    if (memberGuild) {
      if (config.roles.blacklist?.id) await memberGuild.roles.remove(config.roles.blacklist.id).catch((err) => console.error('Error removing blacklist role:', err));
      if (config.roles.basic?.id) await memberGuild.roles.add(config.roles.basic.id).catch((err) => console.error('Error adding basic role:', err));
    }

    const memberRecord = await Member.findOne({ discordId: targetUser.id });
    if (memberRecord) {
      memberRecord.isActive = true;
      await memberRecord.save();
    }

    await dmUser(targetUser, embedSuccess('✅ تم إزالتك من البلاك ليست',
      `لقد تم العفو عنك وإزالة اسمك من القائمة السوداء.\n\n**السبب:** ${reason}`));

    await logBlacklistRemove(interaction.guild, {
      target: targetUser, mod: interaction.user, reason,
    });

    await interaction.editReply(`✅ تم إزالة ${targetUser.tag} من البلاك ليست بنجاح.`);
  }
};