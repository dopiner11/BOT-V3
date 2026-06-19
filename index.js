import { Client, GatewayIntentBits, Partials, Collection, Events, ActivityType, REST, Routes, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import { handleButtonInteraction } from './utils/buttonHandler.js';
import { handleHelpNavigation } from './utils/helpPages.js';
import { handleModalSubmit } from './utils/modalHandler.js';
import reportHandler from './utils/reportHandler.js';
import { handleAuctionInteraction } from './utils/auctionSystem.js';
import {
  handleAttendanceLogin, handleAttendanceLogout, handleAttendanceControl,
  showControlPanel, handleControlSelect,
  handleModalAction, updateAttendancePanel,
  handleMyStats, handleAttendanceDoublePoints,
  cleanupStaleSessions,
  handleVoiceStateUpdate, startAttendanceDashboard
} from './utils/attendanceHandler.js';
import { handleCommitteeInteraction, refreshAllCommitteePanels, checkCommandPermission, checkButtonPermission } from './utils/committeeHandler.js';
import { startStatusUpdates } from './utils/statusHandler.js';
import { startInteractionChecker } from './utils/interactionSystem.js';
import { startCleanupScheduler } from './utils/cleanupExpired.js';
import { startWebhookSystem } from './utils/webhookManager.js';
import { startExcuseNotifications } from './commands/Excuse.js';
import { startVoteExpiryChecker } from './utils/voteManager.js';
import { setOvertakeGuild } from './utils/rankTracker.js';
import { updateAllRoomEmojis, handlePunishmentButton } from './utils/interactionSystem.js';
import { handleGuideButton, deployGuideToAllMembers } from './utils/welcomeGuide.js';
import {
  handleShowPanel, handlePanelSelect, handlePanelModal, handleConfirmButton, handleSwitchCommittee
} from './utils/committeeCommandPanel.js';
import { handleScenarioInteraction, initActiveScenarios } from './utils/scenarioManager.js';
import {
  startDailyChallenge, handleChallengeClaim,
  handleChallengeAdmin, handleChallengeToggle, handleChallengeForceComplete, handleChallengeForceFail,
  handleChallengeStatus, handleChallengeManage,
  handleChallengeManageModal, handleChallengeAdd,
  handleChallengeAddType, handleChallengeAddConfirm,
  handleChallengeEdit, handleChallengeEditSave,
  handleChallengeDelete, handleChallengeConfig,
  handleChallengeTypeToggle, handleChallengeTimeConfig, handleChallengeTimeSave, handleChallengeLog, handleChallengeAssignAll,
  handleChallengeClearActive
} from './utils/dailyChallenge.js';
import Member from './models/Member.js';
import pointsManager, { setPointsManagerContext } from './utils/pointsManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));

process.on('unhandledRejection', (reason, p) => {
  if (reason?.code === 'ETIMEDOUT' || reason?.message?.includes('ETIMEDOUT')) return;
  console.error('❌ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  if (err?.code === 'ETIMEDOUT' || err?.message?.includes('ETIMEDOUT')) return;
  console.error('❌ Uncaught Exception:', err);
});

let voiceConnection = null;

async function ensureVoiceConnection(client) {
  if (!config.general?.voiceChannelId?.id) return;
  try {
    const guild = await client.guilds.fetch(config.bot.guildId);
    const channel = await guild.channels.fetch(config.general.voiceChannelId.id);
    if (channel?.type !== 2) return;
    voiceConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.warn('🔊 Voice disconnected, reconnecting in 5s...');
      setTimeout(() => ensureVoiceConnection(client), 5000);
    });
    voiceConnection.on(VoiceConnectionStatus.Ready, () => {
      console.log(`🔊 Connected to voice: ${channel.name}`);
    });
    voiceConnection.on('error', (err) => {
      console.error('🔊 Voice error:', err.message);
    });
    await entersState(voiceConnection, VoiceConnectionStatus.Ready, 10_000);
  } catch (e) {
    console.warn('⚠️ Could not join voice channel:', e.message);
    voiceConnection = null;
  }
}

async function refreshPresence(client) {
  try {
    if (config.general.activity) {
      client.user.setPresence({
        activities: [{
          type: ActivityType[config.general.activity.type] || ActivityType.Streaming,
          name: config.general.activity.name || '𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘𓆪',
          url: config.general.activity.url,
        }],
        status: 'idle',
      });
    }
  } catch (e) {
    console.error('⚠️ Failed to refresh presence:', e.message);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
  rest: { timeout: 60000, retries: 5 }
});

client.commands = new Collection();
const commandsJson = [];
const commandFiles = readdirSync(join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  try {
    const command = (await import(`./commands/${file}`)).default;
    if (command?.data?.name) {
      client.commands.set(command.data.name, command);
      commandsJson.push(command.data.toJSON());
    }
  } catch (e) {
    console.error(`❌ Failed to load command ${file}:`, e.message);
  }
}

import { startBMStatsSystem } from './commands/bmStats.js';
import { setSenderClient, cancelBroadcast, SendJob, queue } from './utils/broadcastSender.js';
import { success as embedSuccess } from './utils/embedStyles.js';
import { startWatcher as startSchedulerWatcher } from './commands/announcement.js';
import { handleCompetitionButton, handleCompetitionModal } from './commands/competition.js';

client.once(Events.ClientReady, async () => {
  console.log(`🚀 Bot logged in as ${client.user.tag}`);

  await refreshPresence(client);
  await ensureVoiceConnection(client);

  const { initQuranPlayer } = await import('./utils/quranPlayer.js');
  await initQuranPlayer(client);

  const { migrateExistingWorkflows } = await import('./utils/applicationWorkflow.js');
  await migrateExistingWorkflows(client);

  console.log(`📋 Registering ${commandsJson.length} commands: [${commandsJson.map(c => c.name).join(', ')}]`);
  const rest = new REST({ version: '10', timeout: 30000 }).setToken(config.bot.token);
  try {
    await rest.put(Routes.applicationGuildCommands(config.bot.clientId, config.bot.guildId), { body: commandsJson });
    console.log('✅ Slash commands updated.');
  } catch (error) {
    console.warn(`⚠️ Could not update slash commands: ${error.message}${error.code ? ` (code: ${error.code})` : ''}`);
  }

  try {
    const { loadActiveAuctions } = await import('./utils/auctionSystem.js');
    await loadActiveAuctions(client);
  } catch (e) { console.error('Error loading auctions:', e); }

  // تفعيل متتبع التجاوزات
  const mainGuild = client.guilds.cache.get(config.bot.guildId);
  if (mainGuild) setOvertakeGuild(mainGuild);

  setTimeout(async () => {
    try {
      console.log('🔄 Starting delayed system restorations...');
      await refreshAllCommitteePanels(client).catch(e => { });
      await startBMStatsSystem(client).catch(e => { console.error('BM Stats error:', e); });
      startInteractionChecker(client);
      if (mainGuild) setPointsManagerContext(client, mainGuild);
      startStatusUpdates(client);
      startCleanupScheduler(client);
      startWebhookSystem(client);
      const { startReportSystem } = await import('./commands/reports.js');
      startReportSystem(client).catch(e => console.error('[Reports] startup:', e?.message));
      setupBroadcastSystem(client);
      startSchedulerWatcher(client);
      startExcuseNotifications(client);
      startVoteExpiryChecker(client);
      startDailyChallenge(client);
      const { init: initCompetitions } = await import('./commands/competition.js');
      await initCompetitions(client).catch(e => console.error('[Index] competitions:', e?.message));
      const { restoreNominations } = await import('./commands/nomination.js');
      await restoreNominations(client);
      const guild = client.guilds.cache.get(config.bot.guildId);

      // تحديث ايموجي كل الرومات عند التشغيل
      if (guild) await updateAllRoomEmojis(guild);

      await cleanupStaleSessions(guild).catch(e => console.error('[Index] cleanupStaleSessions:', e?.message));
      await updateAttendancePanel(guild).catch(e => console.error('[Index] updateAttendancePanel:', e?.message));
      startAttendanceDashboard(client).catch(e => console.error('[Index] startAttendanceDashboard:', e?.message));
      deployGuideToAllMembers(client).catch(e => console.error('[Index] deployGuide:', e?.message));
      initActiveScenarios(client).catch(e => console.error('[Index] scenarios:', e?.message));
      console.log('✅ Systems restored.');
    } catch (err) {
      console.error('❌ Restoration sequence error:', err);
    }
  }, 5000);

  // حافظ على الاتصال الصوتي والحضور — يشتغل كل 5 دقائق
  setInterval(() => {
    if (!voiceConnection || voiceConnection.state.status === VoiceConnectionStatus.Disconnected) {
      ensureVoiceConnection(client);
    }
    refreshPresence(client);
  }, 5 * 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      // تحقق من الصلاحية (إذا كان في سيرفر)
      if (interaction.member) {
        const perm = checkCommandPermission(interaction.member, interaction.commandName);
        if (!perm.allowed) {
          return interaction.reply({
            content: `❌ ${perm.reason}`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      await command.execute(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      // مودالات لوحة الأوامر (تتجاوز صلاحية لأن المعالج الداخلي يتحقق)
      if (customId.startsWith('cmd_modal_')) return await handlePanelModal(interaction);

      // مودالات السيناريوهات (تتجاوز صلاحية لأن الصلاحية داخلية)
      if (customId.startsWith('scn_')) return await handleScenarioInteraction(interaction);

      // مودال التسامح (تتجاوز صلاحية لأن الزر تحقق مسبقاً)
      if (customId.startsWith('forgive_reason_')) {
        const { handlePunishForgiveModal } = await import('./utils/interactionSystem.js');
        return await handlePunishForgiveModal(interaction);
      }

      // تحقق من الصلاحية للنماذج الإدارية (إذا كان في سيرفر، مو في DM)
      if (interaction.member) {
        const modalPerm = checkButtonPermission(interaction.member, customId);
        if (!modalPerm.allowed && !modalPerm.reason.includes('عام')) {
          return interaction.reply({
            content: `❌ ${modalPerm.reason}`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      if (isReportInteraction(interaction)) return await reportHandler.handleInteraction(interaction);

      if (/^(application_modal|reject_reason_|finish_application_modal_|close_reason_modal_|add_user_modal_|rename_ticket_modal_app_|rate_ticket_modal_)/.test(customId)) {
        return await handleModalSubmit(interaction);
      }

      if (customId.startsWith('comm_')) return await handleCommitteeInteraction(interaction);

      if (customId === 'bidModal') return await handleAuctionInteraction(interaction);

      // مودالات ساعات الاحتلال
      if (customId.startsWith('att_modal_')) return await handleModalAction(interaction);

      // مودالات التحديات اليومية
      if (customId === 'ch_manage_modal') return await handleChallengeManageModal(interaction);
      if (customId.startsWith('ch_add_confirm_')) return await handleChallengeAddConfirm(interaction);
      if (customId.startsWith('ch_edit_save_')) return await handleChallengeEditSave(interaction);

      // مودالات المسابقات
      if (customId.startsWith('comp_modal_')) return await handleCompetitionModal(interaction);

      // مودالات رفض الترقية (قائمة الانتظار)
      if (customId.startsWith('prom_queue_reject_')) {
        const { handlePromotionQueueModal } = await import('./commands/promotion.js');
        return await handlePromotionQueueModal(interaction);
      }

      // مودالات قائمة العقوبات
      if (customId.startsWith('pun_queue_')) {
        const { handleQueueModal } = await import('./utils/punishmentQueue.js');
        return await handleQueueModal(interaction);
      }

      return await handleModalSubmit(interaction);
    }

    if (interaction.isButton()) {
      const customId = interaction.customId;

      // أزرار لوحة الأوامر (تتجاوز صلاحية لأن المعالج الداخلي يتحقق)
      if (customId === 'cmd_show_panel') return await handleShowPanel(interaction);
      if (customId.startsWith('cmd_confirm_fire_') || customId.startsWith('cmd_cancel_fire_') ||
          customId.startsWith('cmd_confirm_bl_') || customId.startsWith('cmd_cancel_bl_')) {
        return await handleConfirmButton(interaction);
      }

      // أزرار السيناريوهات (تتجاوز صلاحية لأن الصلاحية داخلية)
      if (customId.startsWith('scn_')) return await handleScenarioInteraction(interaction);

      // أزرار المسابقات (تتجاوز صلاحية لأن النظام له صلاحيته الداخلية)
      if (customId.startsWith('comp_')) return await handleCompetitionButton(interaction);

      // أزرار قائمة انتظار الترقيات
      if (customId.startsWith('prom_queue_')) {
        const { handlePromotionQueueInteraction } = await import('./commands/promotion.js');
        return await handlePromotionQueueInteraction(interaction);
      }

      // أزرار قائمة العقوبات
      if (customId.startsWith('pun_queue_')) {
        const { handleQueueInteraction } = await import('./utils/punishmentQueue.js');
        return await handleQueueInteraction(interaction);
      }

      // أزرار مشغل القرآن (عامة للجميع)
      if (customId.startsWith('qp_')) {
        const { handleQuranInteraction } = await import('./utils/quranPlayer.js');
        return await handleQuranInteraction(interaction);
      }

      // أزرار مراحل التقديم (عامة للجميع — الصلاحية داخلية)
      if (customId.startsWith('appw_')) {
        const { handleWorkflowInteraction } = await import('./utils/applicationWorkflow.js');
        return await handleWorkflowInteraction(interaction);
      }

      // ====== التقارير (قبل فحص الصلاحية — يجب الرد خلال 3 ثوانٍ) ======
      if (isReportInteraction(interaction)) return await reportHandler.handleInteraction(interaction);

      // تحقق من الصلاحية (إذا كان في سيرفر، مو في DM)
      if (interaction.member) {
        const perm = checkButtonPermission(interaction.member, customId);
        if (!perm.allowed) {
          return interaction.reply({
            content: `❌ ${perm.reason}`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      // ====== النظام الأول: اللجان ======
      if (customId.startsWith('comm_') || customId === 'committee_control_btn') return await handleCommitteeInteraction(interaction);

      // ====== النظام الثالث: التذاكر + البلاك ماركت ======
      if (/^(claim_ticket_|unclaim_ticket_|close_ticket_|add_user_ticket_|finish_application_|accept_application_|reject_application_|start_application|apply_button|rename_ticket_app_|end_sale_|approve_sale_|reject_sale_|rate_seller_|rate_ticket_|claim_request_|bm_request_product_btn|bm_seller_dashboard_btn|buy_product_|accept_bm_app_|reject_bm_app_|end_bm_app_|bm_stats_page_|edit_qty_btn_|delete_product_btn_|refresh_ticket_panel)/.test(customId)) {
        return await handleButtonInteraction(interaction);
      }

      // ====== النظام الرابع: المزادات ======
      if (['bid', 'leaders', 'details', 'end', 'manage_bids'].includes(customId) ||
          customId.startsWith('confirm_end_') || customId === 'cancel_end' ||
          customId.startsWith('remove_bid_') || customId === 'close_delete_forever') return await handleAuctionInteraction(interaction);

      // ====== النظام الخامس: المساعدة والبرودكاست ======
      if (customId === 'help_prev' || customId === 'help_next') return await handleHelpNavigation(interaction);
      if (customId === 'refresh_broadcast_status') {
        const { refreshBroadcastStatus } = await import('./utils/broadcastSender.js');
        return await refreshBroadcastStatus(interaction);
      }
      if (customId === 'confirm_broadcast') {
        const { getPendingBroadcast, clearPendingBroadcast } = await import('./commands/broadcast.js');
        const data = getPendingBroadcast(interaction.user.id);
        if (!data) return interaction.reply({ content: '❌ لا توجد بيانات برودكاست معلقة.', flags: MessageFlags.Ephemeral });
        clearPendingBroadcast(interaction.user.id);
        const guild = interaction.guild;
        const job = new SendJob({ ...data, guild, sendMethod: 'dm' });
        queue.add(job);
        const typeLabels = { all: 'جميع الأعضاء', online: 'المتصلين', role: 'رتبة محددة', users: 'أعضاء محددين', voice: 'روم صوتي' };
        const statusEmbed = embedSuccess('📡 تم بدء البرودكاست', `سيتم إرسال الرسائل إلى **${data.targets.length}** عضو.`, [
          { name: '📂 المستهدفين', value: typeLabels[data.type] || data.type, inline: true },
          { name: '✅ الناجح', value: '0', inline: true },
          { name: '❌ الفاشل', value: '0', inline: true },
          { name: '⏱ المدة التقريبية', value: `${Math.ceil(data.targets.length * 3)} ثانية` },
        ]);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('refresh_broadcast_status').setLabel('🔄 تحديث').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('cancel_broadcast').setLabel('❌ إلغاء البث').setStyle(ButtonStyle.Danger)
        );
        await interaction.update({ embeds: [statusEmbed], components: [row] });
        const checkDone = setInterval(async () => {
          if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
            clearInterval(checkDone);
            const { logBroadcastComplete } = await import('./utils/broadcastSender.js');
            try { await logBroadcastComplete(job); } catch {}
          }
        }, 2000);
        return;
      }
      if (customId === 'cancel_preview') {
        const { clearPendingBroadcast } = await import('./commands/broadcast.js');
        clearPendingBroadcast(interaction.user.id);
        return interaction.update({ content: '❌ تم إلغاء البرودكاست.', embeds: [], components: [] });
      }
      if (customId === 'cancel_broadcast') {
        const cancelled = cancelBroadcast();
        return interaction.reply({ content: cancelled ? '⛔ تم إلغاء البث الحالي.' : '❌ لا يوجد بث قيد التشغيل.', flags: MessageFlags.Ephemeral });
      }

      // ====== النظام السادس: ساعات الاحتلال ======
      if (customId === 'att_login') return await handleAttendanceLogin(interaction);
      if (customId === 'att_logout') return await handleAttendanceLogout(interaction);
      if (customId === 'att_mystats') return await handleMyStats(interaction);
      if (customId === 'att_control') return await handleAttendanceControl(interaction);
      if (customId === 'att_ctrl') return await showControlPanel(interaction);
      if (customId === 'att_refresh_panel') return await updateAttendancePanel(interaction.guild).then(() => interaction.reply({ content: '✅ تم تحديث اللوحة.', flags: MessageFlags.Ephemeral }));
      if (customId === 'att_control_action') return await handleControlSelect(interaction);
      if (customId === 'att_double_points') return await handleAttendanceDoublePoints(interaction);

      // ====== النظام السابع: أزرار العقوبات ======
      if (customId.startsWith('punish_warn_') || customId.startsWith('punish_fire_') || customId.startsWith('punish_forgive_')) return await handlePunishmentButton(interaction);

      // ====== النظام الثامن: أزرار المعايرة ======
      if (customId === 'cal_summary' || customId === 'cal_members' || customId === 'cal_ranks') {
        const { handleCalView } = await import('./commands/calibration.js');
        return await handleCalView(interaction);
      }

      // ====== النظام التاسع: التحديات اليومية ======
      if (customId.startsWith('ch_claim_')) return await handleChallengeClaim(interaction);
      if (customId === 'ch_toggle') return await handleChallengeToggle(interaction);
      if (customId === 'ch_time_config') return await handleChallengeTimeConfig(interaction);
      if (customId === 'ch_time_save') return await handleChallengeTimeSave(interaction);
      if (customId.startsWith('ch_force_complete_')) return await handleChallengeForceComplete(interaction);
      if (customId.startsWith('ch_force_fail_')) return await handleChallengeForceFail(interaction);
      if (customId === 'ch_status') return await handleChallengeStatus(interaction);
      if (customId === 'ch_manage') return await handleChallengeManage(interaction);
      if (customId === 'ch_config') return await handleChallengeConfig(interaction);
      if (customId.startsWith('ch_ctype_')) return await handleChallengeTypeToggle(interaction);
      if (customId === 'ch_log') return await handleChallengeLog(interaction);
      if (customId === 'ch_refresh_admin') return await handleChallengeAdmin(interaction);
      if (customId.startsWith('ch_add_') && !customId.startsWith('ch_add_type_') && !customId.startsWith('ch_add_confirm_')) return await handleChallengeAdd(interaction);
      if (customId.startsWith('ch_add_confirm_')) return await handleChallengeAddConfirm(interaction);
      if (customId.startsWith('ch_edit_') && !customId.startsWith('ch_edit_save_')) return await handleChallengeEdit(interaction);
      if (customId.startsWith('ch_delete_')) return await handleChallengeDelete(interaction);
      if (customId === 'ch_assign_all') return await handleChallengeAssignAll(interaction);
      if (customId === 'ch_clear_active') return await handleChallengeClearActive(interaction);

      // ====== النظام العاشر: اللوبية التفاعلية ======
      const { ALL_LB_BUTTONS, handleLeaderboardInteraction } = await import('./utils/interactiveLeaderboard.js');
      if (ALL_LB_BUTTONS.has(customId)) return await handleLeaderboardInteraction(interaction);

      // ====== النظام الحادي عشر: التصويت ======
      if (customId.startsWith('vote_yes_') || customId.startsWith('vote_no_') || customId.startsWith('vote_voters_') || customId.startsWith('vote_reasons_')) {
        return await handleButtonInteraction(interaction);
      }

      // ====== النظام الثاني عشر: أزرار دليل الترحيب ======
      if (customId.startsWith('guide_')) return await handleGuideButton(interaction);

      // ====== النظام الثالث عشر: Fallback ======
      return await handleButtonInteraction(interaction);
    }

    if (interaction.isStringSelectMenu?.()) {
      if (interaction.customId.startsWith('scn_')) return await handleScenarioInteraction(interaction);
      if (interaction.customId.startsWith('cmd_psel_')) return await handlePanelSelect(interaction);
      if (interaction.customId === 'cmd_switch_committee') return await handleSwitchCommittee(interaction);
      if (interaction.customId === 'ticket_select' || interaction.customId === 'bm_post_product_select' || interaction.customId === 'application_select') {
        const { handleButtonInteraction } = await import('./utils/buttonHandler.js');
        return await handleButtonInteraction(interaction);
      }
      if (isReportInteraction(interaction)) return await reportHandler.handleInteraction(interaction);
      if (interaction.customId === 'remove_bid_menu' || interaction.customId.includes('cancel_bid_menu_')) return await handleAuctionInteraction(interaction);
      if (interaction.customId.startsWith('comm_')) return await handleCommitteeInteraction(interaction);
      if (interaction.customId === 'att_control_action') return await handleControlSelect(interaction);
      if (interaction.customId.startsWith('ch_add_type_')) return await handleChallengeAddType(interaction);
      if (interaction.customId.startsWith('comp_')) return await handleCompetitionButton(interaction);
      if (interaction.customId.startsWith('prom_queue_select_')) {
        const { handlePromotionQueueInteraction } = await import('./commands/promotion.js');
        return await handlePromotionQueueInteraction(interaction);
      }
      if (interaction.customId === 'pun_queue_select') {
        const { handleQueueInteraction } = await import('./utils/punishmentQueue.js');
        return await handleQueueInteraction(interaction);
      }
      if (interaction.customId.startsWith('qp_')) {
        const { handleQuranInteraction } = await import('./utils/quranPlayer.js');
        return await handleQuranInteraction(interaction);
      }
    }
  } catch (err) {
    const ignoreCodes = [10008, 10062, 40060, 50001, 50013, 50035];
    if (err.code && ignoreCodes.includes(err.code)) {
      return;
    }
    if (err.code === 'UND_ERR_SOCKET' || err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT') {
      return;
    }
    console.error('❌ Interaction Error:', err.message);
  }
});

function isReportInteraction(interaction) {
  const id = interaction.customId;
  if (!id) return false;

  const exact = ['start_report', 'double_points_btn', 'refresh_panel', 'yes_participants', 'no_participants', 'submit_report', 'edit_report', 'accept_report', 'reject_report'];
  if (exact.includes(id)) return true;

  return id.startsWith('report_') || id.startsWith('approve_report_') || id.startsWith('reject_report_') ||
    id.startsWith('edit_report_') || id.startsWith('double_points_') || id.startsWith('reject_modal_') ||
    id.startsWith('confirm_reject_') || id.startsWith('cancel_reject_') || id.startsWith('reject_reason_modal_');
}

client.on(Events.MessageCreate, async (message) => {
  if (message.author?.bot) return;
  if (reportHandler && typeof reportHandler.handleMessage === 'function') await reportHandler.handleMessage(message);
  try {
    const { handleScenarioExcuseMessage } = await import('./utils/scenarioManager.js');
    await handleScenarioExcuseMessage(message);
  } catch (e) {
    console.error('Error handling excuse message:', e);
  }
});

/* ===================================================================
   مراقبة الرومات الصوتية لنظام ساعات الاحتلال + إعادة الاتصال
   =================================================================== */
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    // إذا البوت انفصل من الروم الصوتي، أعد الاتصال
    if ((oldState.member?.id === client.user.id || oldState.id === client.user.id) &&
        oldState.channelId && !newState.channelId) {
      console.warn('🔊 Bot was disconnected from voice, reconnecting...');
      ensureVoiceConnection(client);
    }
    await handleVoiceStateUpdate(oldState, newState);
  } catch (e) {
    console.error('❌ Voice state error:', e.message);
  }
});

/* ===================================================================
   إعداد نظام البرودكاست (التشغيل + البوت الثانوي)
   =================================================================== */
async function setupBroadcastSystem(mainClient) {
  const bcConfig = config.broadcast;
  if (!bcConfig?.enabled) return;

  // إعداد البوت الأساسي كمرسل (fallback)
  setSenderClient(mainClient);

  // إذا فيه توكن لبوت ثانوي، جهزه
  if (bcConfig.senderBot?.token) {
    try {
      const senderClient = new Client({ intents: [] });
      await senderClient.login(bcConfig.senderBot.token);
      setSenderClient(senderClient);
      console.log(`🤖 Broadcast sender bot logged in as ${senderClient.user.tag}`);
    } catch (e) {
      console.error('❌ Failed to login broadcast sender bot:', e.message);
      console.log('⚠️ Using main bot for broadcast sending');
    }
  }
}

client.login(config.bot.token);
