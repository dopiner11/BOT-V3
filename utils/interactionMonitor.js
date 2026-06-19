// ملف توافقي — يعيد تصدير كل شيء من interactionSystem.js
export {
  // من interactionManager.js الأصلي
  pendingForgives,
  getInteractionConfig,
  STATUS,
  getStatusEmoji,
  STATUS_EMOJI,
  getIraqMidnight,
  formatDate,
  ensureDailyLog,
  getTodayLog,
  initializeInteractionStatus,
  processAllMembers,
  ensurePunishmentNotification,
  handlePunishmentButton,
  handlePunishForgiveModal,
  buildStatusReport,
  setClientRef,
  calculateRankProgress,
  startDailyClassification,
  quickClassify,
  buildCalibrationReport,
  buildCalibrationReportV2,
  runManualReview,
  buildFamilyAuditReport,
  auditInteractionThresholds,

  // من interactionMonitor.js الأصلي
  assessMemberStatus,
  createGracePeriod,
  updateRoomEmoji,
  updateAllRoomEmojis,
  loadBatchData,
  getInteractionData,
  startInteractionChecker,

  // من weeklyCalibration.js
  getWeeklyTrends,
  computeWeeklyStats,
  startWeeklyCalibration,

  // من churnAnalyzer.js
  analyzeChurn,
  analyzeBreakpoints,
} from './interactionSystem.js';
