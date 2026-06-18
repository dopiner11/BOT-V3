import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import Member from '../models/Member.js';
import Blacklist from '../models/Blacklist.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createGracePeriod } from '../utils/interactionMonitor.js';
import { logHiring } from '../utils/logSystem.js';
import { sendWelcomeGuide } from '../utils/welcomeGuide.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));

export default {
  data: new SlashCommandBuilder()
    .setName('توظيف_يدوي')
    .setDescription('توظيف عضو يدوياً')
    .addUserOption(o => o.setName('العضو').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('الاسم').setDescription('الاسم بالشخصية').setRequired(true))
    .addStringOption(o => o.setName('الايدي').setDescription('ID اللعبة').setRequired(true))
    .addIntegerOption(o => o.setName('الفل').setDescription('الليفل').setRequired(true))
    .addIntegerOption(o => o.setName('الرقم_الوظيفي').setDescription('1-20').setRequired(true)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('العضو');
    const black = await Blacklist.findOne({ userId: targetUser.id, isActive: true });
    if (black) return interaction.reply({ content: `❌ هذا العضو في البلاك ليست لسبب: ${black.reason}`, flags: MessageFlags.Ephemeral });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const gameName = interaction.options.getString('الاسم'), gameId = interaction.options.getString('الايدي'), level = interaction.options.getInteger('الفل'), jobNum = interaction.options.getInteger('الرقم_الوظيفي');
    const existing = await Member.findOne({ discordId: targetUser.id });
    if (existing && existing.isActive) return interaction.editReply('❌ العضو مسجل مسبقاً.');

    const gm = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!gm) return interaction.editReply('❌ العضو غير موجود بالسيرفر.');

    try {
      await gm.setNickname(`IQ • ${gameName} X.IRAQ 〢${gameId}`).catch(e => console.log(`Could not rename ${targetUser.tag}: ${e.message}`));
      if (config.roles?.basic?.id) await gm.roles.add(config.roles.basic.id).catch(() => { });
      const jobRoleId = config.roles?.jobRoles?.[jobNum.toString()]?.id;
      if (jobRoleId) await gm.roles.add(jobRoleId).catch(() => { });

      const catId = config.general?.categories?.memberRooms?.id;
      let room = null;
      if (catId) {
        let levelCategory;
        if (level < 25) levelCategory = 'تحت 25';
        else if (level < 40) levelCategory = 'تحت 40';
        else levelCategory = 'اكثر من 40';

        room = await interaction.guild.channels.create({
          name: `🏠〢${gameName}-xiraq・${gameId}・${levelCategory}`,
          parent: catId,
          permissionOverwrites: [
            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: targetUser.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
          ]
        });
      }

      if (existing) {
        existing.gameId = gameId;
        existing.gameName = gameName;
        existing.level = level;
        existing.jobNumber = jobNum;
        existing.roomChannelId = room?.id;
        existing.currentRank = 'مبتدئ';
        existing.isActive = true;
        existing.joinDate = new Date();
        existing.joinMethod = 'توظيف يدوي';
        existing.hiredBy = interaction.user.id;
        existing.lastUserActivity = new Date();
        existing.firedAt = undefined;
        existing.firedBy = undefined;
        await existing.save();
      } else {
        await Member.create({
          discordId: targetUser.id, gameId, gameName, level, jobNumber: jobNum, roomChannelId: room?.id,
          currentRank: 'مبتدئ', joinDate: new Date(), joinMethod: 'توظيف يدوي', hiredBy: interaction.user.id, isActive: true,
          lastUserActivity: new Date()
        });
      }

      // فترة سماح 24 ساعة للموظف الجديد
      await createGracePeriod(targetUser.id, 'new_member', interaction.guild, interaction.client, null).catch(() => {});

      if (room) await sendWelcomeGuide(interaction.client, interaction.guild, targetUser, gameName, gameId, level, jobNum, room);

      await logHiring(interaction.guild, {
        applicant: `<@${targetUser.id}>`,
        reviewer: `<@${interaction.user.id}>`,
        position: `#${jobNum}`,
        details: `الاسم: ${gameName} | الأيدي: ${gameId} | الروم: ${room ? `<#${room.id}>` : 'لا يوجد'}`,
      });

      await interaction.editReply(`✅ تم توظيف ${targetUser.tag} بنجاح.`);

    } catch (e) {
      await interaction.editReply(`❌ فشل التوظيف: ${e.message}`);
    }
  }
};