/**
 * actionRegistry.js - السجل المركزي لكل الأوامر والأزرار في البوت
 * 
 * هذا الملف هو المرجع الوحيد لربط كل أمر/زر باللجنة المسؤولة عنه.
 * لتعديل صلاحيات أي أمر أو زر، غيّره هنا فقط.
 * 
 * كيفية الاستخدام:
 * - command: أوامر سلاش
 * - button: أزرار
 * - modal: نماذج
 * - category: تصنيف العرض (لأمر help)
 * - committee: اللجنة المسؤولة (مفتاح في config.committees.list)
 * - action: اسم الإجراء (يتم التحقق منه في committeeHandler)
 * - description: شرح للأمر/الزر
 * - usage: مثال استخدام (للأوامر)
 */

export const CATEGORIES = {
  punishments: { name: 'العقوبات', emoji: '⚖️' },
  family_management: { name: 'إدارة العائلة', emoji: '👑' },
  tickets: { name: 'التذاكر', emoji: '🎫' },
  reports: { name: 'التقارير', emoji: '📊' },
  black_market: { name: 'البلاك ماركت', emoji: '🩸' },
  auctions: { name: 'المزادات', emoji: '💰' },
  points: { name: 'النقاط والرتب', emoji: '⭐' },
  information: { name: 'معلومات', emoji: 'ℹ️' },
  committees: { name: 'إدارة اللجان', emoji: '🏛️' },
  applications: { name: 'التقديمات', emoji: '📝' },
  general: { name: 'عام', emoji: '🔧' },
};

/**
 * سجل الأوامر (Slash Commands)
 * المفتاح = اسم الأمر
 */
export const commandRegistry = {

  // ===== أوامر العقوبات =====
  'بلاك_ليست': {
    category: 'punishments',
    committee: 'punishment',
    action: 'blacklist',
    description: 'إضافة عضو إلى البلاك ليست (القائمة السوداء)',
    usage: '/بلاك_ليست العضو: @ user السبب: ... المدة: 0 التصنيف: ...',
  },
  'ازالة_بلاك_ليست': {
    category: 'punishments',
    committee: 'punishment',
    action: 'removeBlacklist',
    description: 'إزالة عضو من البلاك ليست',
    usage: '/ازالة_بلاك_ليست العضو: @ user السبب: ...',
  },
  'تحذير': {
    category: 'punishments',
    committee: 'punishment',
    action: 'Warning',
    description: 'إعطاء تحذير لعضو أو أكثر',
    usage: '/تحذير الأعضاء: @ user1 @ user2 السبب: ...',
  },
  'ازالة-تحذير': {
    category: 'punishments',
    committee: 'punishment',
    action: 'removeWarning',
    description: 'إزالة تحذير عن عضو',
    usage: '/ازالة-تحذير العضو: @ user',
  },
  'فصل': {
    category: 'punishments',
    committee: 'punishment',
    action: 'fire',
    description: 'فصل عضو من العائلة',
    usage: '/فصل العضو: @ user السبب: ...',
  },
  'تصفير_نقاط': {
    category: 'punishments',
    committee: 'punishment',
    action: 'Zero',
    description: 'تصفير نقاط عضو معين',
    usage: '/تصفير_نقاط العضو: @ user',
  },
  'تصفير_النقاط_للجميع': {
    category: 'punishments',
    committee: 'punishment',
    action: 'Zeros',
    description: 'تصفير نقاط جميع الأعضاء',
    usage: '/تصفير_النقاط_للجميع',
  },
  'تنقيص_نقاط': {
    category: 'punishments',
    committee: 'punishment',
    action: 'removePoints',
    description: 'تنقيص نقاط من عضو',
    usage: '/تنقيص_نقاط العضو: @ user النقاط: ...',
  },

  // ===== أوامر إدارة العائلة =====
  'توظيف_يدوي': {
    category: 'family_management',
    committee: 'punishment',
    action: 'manualHire',
    description: 'توظيف عضو بشكل يدوي',
    usage: '/توظيف_يدوي العضو: @ user',
  },
  'تنويه': {
    category: 'family_management',
    committee: 'interaction',
    action: 'announcement',
    description: 'إرسال تنويه لجميع الأعضاء في غرفهم',
    usage: '/تنويه العنوان: ... النص: ...',
  },
  'ترقية-استثنائية': {
    category: 'family_management',
    committee: 'promotion',
    action: 'easyprom',
    description: 'ترقية استثنائية لعضو',
    usage: '/ترقية-استثنائية العضو: @ user',
  },
  'ترقيات': {
    category: 'family_management',
    committee: 'promotion',
    action: 'promotion',
    description: 'التحقق من ترقيات الأعضاء وترقيتهم',
    usage: '/ترقيات',
  },
  'ترشيح': {
    category: 'promotions',
    committee: 'promotion',
    action: 'ترشيح',
    description: 'ترشيح عضو للترقية',
    usage: '/ترشيح العضو: @user الرتبة: ... السبب: ... المدة: ...',
  },

  // ===== أوامر النقاط والرتب =====
  'نقاط': {
    category: 'points',
    committee: null,
    action: null,
    description: 'عرض نقاطك أو نقاط عضو آخر',
    usage: '/نقاط [العضو: @ user]',
  },
  'زيادة_نقاط': {
    category: 'points',
    committee: 'interaction',
    action: 'addPoints',
    description: 'إضافة نقاط لعضو',
    usage: '/زيادة_نقاط العضو: @ user النقاط: ...',
  },
  'التوب': {
    category: 'points',
    committee: null,
    action: null,
    description: 'عرض قائمة أفضل الأعضاء بالأكثر نقاطاً',
    usage: '/التوب',
  },

  // ===== أوامر الإجازات =====
  'اجازة': {
    category: 'family_management',
    committee: 'interaction',
    action: 'Vacation',
    description: 'منح إجازة لعضو',
    usage: '/اجازة الشخص: @ user السبب: ... الايام: ...',
  },
  'كسر-اجازة': {
    category: 'family_management',
    committee: 'interaction',
    action: 'BreakVacation',
    description: 'كسر إجازة عضو وإرجاعه للخدمة',
    usage: '/كسر-اجازة العضو: @ user',
  },
  'كسر_عذر': {
    category: 'family_management',
    committee: 'interaction',
    action: 'breakExcuse',
    description: 'كسر عذر عضو',
    usage: '/كسر_عذر العضو: @ user',
  },
  'اعذار': {
    category: 'family_management',
    committee: 'interaction',
    action: 'Excuse',
    description: 'تقديم عذر لعضو',
    usage: '/اعذار العضو: @ user المدة: ...',
  },

  // ===== أوامر التذاكر =====
  'بلاكليست_تذاكر': {
    category: 'tickets',
    committee: 'punishment',
    action: 'ticketBlacklist',
    description: 'منع عضو من فتح التذاكر',
    usage: '/بلاكليست_تذاكر user: @ user reason: ... duration: 1d',
  },
  'ازالة_بلاكليست_تذاكر': {
    category: 'tickets',
    committee: 'punishment',
    action: 'ticketBlacklist',
    description: 'إزالة منع التذاكر عن عضو',
    usage: '/ازالة_بلاكليست_تذاكر user: @ user',
  },

  // ===== أوامر المزادات =====
  'انشاء_مزاد': {
    category: 'auctions',
    committee: 'punishment',
    action: 'auction_create',
    description: 'إنشاء مزاد جديد',
    usage: '/انشاء_مزاد اسم: ... سعر: ... مدة: ...',
  },
  'بلاكليست_مزاد': {
    category: 'auctions',
    committee: 'punishment',
    action: 'auctionBlacklist',
    description: 'منع عضو من المزادات',
    usage: '/بلاكليست_مزاد الشخص: @ user السبب: ... المدة: 1d',
  },
  'ازالة_بلاكليست_مزاد': {
    category: 'auctions',
    committee: 'punishment',
    action: 'auctionBlacklist',
    description: 'إزالة منع المزاد عن عضو',
    usage: '/ازالة_بلاكليست_مزاد user: @ user',
  },

  // ===== أوامر البلاك ماركت =====
  'توظيف-بائع': {
    category: 'black_market',
    committee: 'blackMarket',
    action: 'manageSellers',
    description: 'توظيف بائع جديد في البلاك ماركت',
    usage: '/توظيف-بائع user: @ user rank: ...',
  },
  'manage-sellers': {
    category: 'black_market',
    committee: 'blackMarket',
    action: 'manageSellers',
    description: 'إدارة البائعين (عرض، تحذير، فصل)',
    usage: '/manage-sellers',
  },
  'bm-requests': {
    category: 'black_market',
    committee: 'blackMarket',
    action: 'manageSellers',
    description: 'إرسال لوحة طلبات المنتجات',
    usage: '/bm-requests',
  },
  'bm-seller': {
    category: 'black_market',
    committee: 'blackMarket',
    action: 'manageSellers',
    description: 'إرسال لوحة البائع',
    usage: '/bm-seller',
  },
  'seller-stats': {
    category: 'black_market',
    committee: null,
    action: null,
    description: 'عرض إحصائيات بائع معين',
    usage: '/seller-stats [user: @ user]',
  },
  'احصائيات-بلاك-ماركت': {
    category: 'black_market',
    committee: 'blackMarket',
    action: 'manageSellers',
    description: 'عرض لوحة إحصائيات البلاك ماركت',
    usage: '/احصائيات-بلاك-ماركت',
  },

  // ===== أوامر التقارير =====
  'نظام-التقارير': {
    category: 'reports',
    committee: 'interaction',
    action: 'acceptReport',
    description: 'إرسال لوحة إنشاء التقارير',
    usage: '/نظام-التقارير',
  },

  // ===== أوامر المعلومات =====
  'معلومات': {
    category: 'information',
    committee: null,
    action: null,
    description: 'عرض معلومات عضو (نقاط، رتبة، تحذيرات)',
    usage: '/معلومات [العضو: @ user]',
  },
  'التحذيرات': {
    category: 'information',
    committee: null,
    action: null,
    description: 'عرض تحذيراتك أو تحذيرات عضو آخر',
    usage: '/التحذيرات [العضو: @ user]',
  },

  // ===== أوامر اللجان =====
  'لوحة_اللجان': {
    category: 'committees',
    committee: 'family_presidency',
    action: 'committeePanel',
    description: 'تحديث لوحات جميع اللجان',
    usage: '/لوحة_اللجان',
  },

  // ===== أوامر التقديمات =====
  'التقديم': {
    category: 'applications',
    committee: 'interaction',
    action: 'acceptHire',
    description: 'إرسال نموذج التقديم للعائلة والبلاك ماركت',
    usage: '/التقديم',
  },

  // ===== أوامر عامة =====
  'ticket_panel': {
    category: 'general',
    committee: null,
    action: null,
    description: 'إرسال لوحة التذاكر',
    usage: '/ticket_panel',
  },
  'help': {
    category: 'general',
    committee: null,
    action: null,
    description: 'عرض قائمة الأوامر والمساعدة',
    usage: '/help [الأمر]',
  },
  'broadcast': {
    category: 'committees',
    committee: 'family_presidency',
    action: 'broadcast',
    description: '📡 إرسال برودكاست جماعي للأعضاء',
    usage: '/broadcast [all|role|users|online|voice]',
  },
  'حضور': {
    category: 'committees',
    committee: 'interaction',
    action: 'manageAttendance',
    description: '📋 إرسال لوحة تسجيل ساعات الاحتلال',
    usage: '/حضور',
  },
  'مسابقة': {
    category: 'committees',
    committee: 'interaction',
    action: 'competition',
    description: '🏆 لوحة المسابقات — إنشاء وإدارة المسابقات',
    usage: '/مسابقة',
  },
  'تصويت': {
    category: 'general',
    committee: null,
    action: null,
    description: '📊 إنشاء تصويت جديد مع أزرار موافق/رافض وأسباب الرفض',
    usage: '/تصويت العنوان: ... النص: ... [المدة: ...] [ايمبد: true/false] [اللون: ...] [الفوتر: ...] [الرتبة: @role] [سبب_الرفض: true/false]',
  },
  'تحديات': {
    category: 'committees',
    committee: null,
    action: null,
    description: '🎛️ لوحة تحكم التحديات اليومية',
    usage: '/تحديات',
  },
  'فك_الباند_الجماعي': {
    category: 'punishments',
    committee: 'punishment',
    action: 'unbanAll',
    description: 'فك الباند عن جميع الأعضاء الممنوعين من السيرفر',
    usage: '/فك_الباند_الجماعي',
  },
  'انقاذ': {
    category: 'punishments',
    committee: 'punishment',
    action: 'unbanAll',
    description: 'فك الباند عن الكل وإرسال رسالة إنقاذ للجميع',
    usage: '/انقاذ الرسالة: ...',
  },
  'تصدير_المنقذين': {
    category: 'punishments',
    committee: 'punishment',
    action: 'unbanAll',
    description: 'تصدير IDs اللي انفك باندهم لملف للـ rescueSender',
    usage: '/تصدير_المنقذين [المدة: 60]',
  },
};

/**
 * سجل الأزرار (Buttons)
 * المفتاح = بادئة customId
 */
export const buttonRegistry = {
  // أزرار التذاكر
  'claim_ticket_': { committee: null, action: null, description: 'استلام تذكرة' },
  'unclaim_ticket_': { committee: null, action: null, description: 'إلغاء استلام تذكرة' },
  'close_ticket_': { committee: null, action: null, description: 'إغلاق تذكرة' },
  'add_user_ticket_': { committee: null, action: null, description: 'إضافة شخص للتذكرة' },
  'finish_application_': { committee: 'interaction', action: 'acceptHire', description: 'إنهاء قبول عضو في تذكرة التقديم' },
  'rename_ticket_app_': { committee: null, action: null, description: 'تغيير اسم التذكرة' },

  // أزرار التقديم
  'accept_application_': { committee: 'interaction', action: 'acceptHire', description: 'قبول تقديم عضو' },
  'reject_application_': { committee: 'interaction', action: 'acceptHire', description: 'رفض تقديم عضو' },
  'start_application': { committee: null, action: null, description: 'بدء نموذج التقديم' },
  'apply_button': { committee: null, action: null, description: 'زر التقديم' },
  'application_select': { committee: null, action: null, description: 'اختيار نوع التقديم' },

  // أزرار البلاك ماركت
  'accept_bm_app_': { committee: 'blackMarket', action: 'approveApplications', description: 'قبول تقديم بلاك ماركت' },
  'reject_bm_app_': { committee: 'blackMarket', action: 'approveApplications', description: 'رفض تقديم بلاك ماركت' },
  'end_bm_app_': { committee: 'blackMarket', action: 'approveApplications', description: 'إنهاء تعيين بائع' },
  'end_sale_': { committee: 'blackMarket', action: 'approveSales', description: 'إنهاء عملية بيع (للبائع)' },
  'approve_sale_': { committee: 'blackMarket', action: 'approveSales', description: 'الموافقة على عملية بيع' },
  'reject_sale_': { committee: 'blackMarket', action: 'approveSales', description: 'رفض عملية بيع' },
  'rate_seller_': { committee: null, action: null, description: 'تقييم بائع' },
  'claim_request_': { committee: 'blackMarket', action: 'manageSellers', description: 'تلبية طلب منتج' },
  'complaint_seller_': { committee: 'blackMarket', action: 'manageSellers', description: 'الإبلاغ عن مشكلة مع بائع' },
  'bm_request_product_btn': { committee: null, action: null, description: 'طلب منتج جديد' },
  'bm_seller_dashboard_btn': { committee: null, action: null, description: 'فتح لوحة البائع' },
  'buy_product_': { committee: null, action: null, description: 'شراء منتج' },
  'edit_qty_btn_': { committee: null, action: null, description: 'تعديل كمية المنتج' },
  'delete_product_btn_': { committee: null, action: null, description: 'حذف المنتج' },

  // أزرار اللجان
  'committee_control_btn': { committee: 'family_presidency', action: 'committeePanel', description: 'التحكم باللجنة' },
  'comm_': { committee: 'family_presidency', action: 'committeePanel', description: 'إجراءات إدارة اللجان' },

  // أزرار الترقيات والترشيحات
  'force_prom_': { committee: 'promotion', action: 'promotion', description: 'ترقية قسرية' },
  'reject_prom_': { committee: 'promotion', action: 'promotion', description: 'رفض ترقية' },
  'nom_acc_': { committee: 'promotion', action: 'nomination', description: 'قبول ترشيح' },
  'nom_rej_': { committee: 'promotion', action: 'nomination', description: 'رفض ترشيح' },

  // أزرار التقارير
  'start_report': { committee: null, action: null, description: 'بدء تقرير جديد' },
  'double_points_btn': { committee: 'interaction', action: 'acceptReport', description: 'تفعيل النقاط المضاعفة' },
  'refresh_panel': { committee: null, action: null, description: 'تحديث اللوحة' },
  'yes_participants': { committee: null, action: null, description: 'نعم، يوجد مشاركون' },
  'no_participants': { committee: null, action: null, description: 'لا، لا يوجد مشاركون' },
  'submit_report': { committee: null, action: null, description: 'إرسال التقرير' },
  'edit_report': { committee: null, action: null, description: 'تعديل التقرير' },
  'accept_report': { committee: 'interaction', action: 'acceptReport', description: 'قبول تقرير' },
  'reject_report': { committee: 'interaction', action: 'acceptReport', description: 'رفض تقرير' },
  'report_': { committee: 'interaction', action: 'acceptReport', description: 'إجراءات التقارير' },
  'reject_reason_modal_': { committee: 'interaction', action: 'acceptReport', description: 'سبب رفض التقرير' },

  // أزرار المزادات
  'bid': { committee: null, action: null, description: 'مزايدة في مزاد' },
  'leaders': { committee: null, action: null, description: 'عرض متصدرين المزاد' },
  'details': { committee: null, action: null, description: 'عرض تفاصيل المزاد' },
  'end': { committee: 'punishment', action: 'auction_create', description: 'إنهاء مزاد' },
  'confirm_end_': { committee: 'punishment', action: 'auction_create', description: 'تأكيد إنهاء مزاد' },
  'cancel_end': { committee: null, action: null, description: 'إلغاء إنهاء المزاد' },
  'manage_bids': { committee: 'punishment', action: 'auction_create', description: 'إدارة المزايدات' },
  'remove_bid': { committee: 'punishment', action: 'auction_create', description: 'إزالة مزايدة' },

  // أزرار إحصاءات
  'bm_stats_page_': { committee: 'blackMarket', action: 'manageSellers', description: 'تصفح إحصاءات البائعين' },
  'refresh_ticket_panel': { committee: null, action: null, description: 'تحديث لوحة التذاكر' },
  'att_login': { committee: null, action: null, description: 'تسجيل دخول في نظام ساعات الاحتلال' },
  'att_logout': { committee: null, action: null, description: 'تسجيل خروج في نظام ساعات الاحتلال' },
  'att_mystats': { committee: null, action: null, description: 'عرض إحصائيات ساعات الاحتلال' },
  'att_control': { committee: null, action: null, description: 'فتح لوحة تحكم ساعات الاحتلال' },
  'att_ctrl': { committee: null, action: null, description: 'عرض لوحة التحكم' },
  'att_control_action': { committee: null, action: null, description: 'إجراءات التحكم بساعات الاحتلال' },
  'att_refresh_panel': { committee: null, action: null, description: 'تحديث لوحة ساعات الاحتلال' },

  // أزرار التصويت
  'vote_yes_': { committee: null, action: null, description: 'تصويت بموافق' },
  'vote_no_': { committee: null, action: null, description: 'تصويت برافض' },
  'vote_voters_': { committee: null, action: null, description: 'عرض تفاصيل التصويت ومن صوت مع مين' },
  'vote_reasons_': { committee: null, action: null, description: 'عرض أسباب الرفض' },

  // أزرار التحديات اليومية
  'ch_claim_': { committee: null, action: null, description: 'تم اتمام التحدي' },
  'ch_toggle': { committee: null, action: null, description: 'تشغيل/إيقاف نظام التحديات' },
  'ch_config': { committee: null, action: null, description: 'إعدادات التحديات' },
  'ch_ctype_': { committee: null, action: null, description: 'تفعيل/تعطيل نوع تحدي' },
  'ch_time_config': { committee: null, action: null, description: 'تعديل أوقات التحديات' },
  'ch_time_save': { committee: null, action: null, description: 'حفظ أوقات التحديات (مودال)' },
  'ch_clear_active': { committee: null, action: null, description: 'حذف التحديات النشطة' },
  'ch_status': { committee: null, action: null, description: 'إحصائيات التحديات' },
  'ch_manage': { committee: null, action: null, description: 'إدارة تحدي عضو' },
  'ch_log': { committee: null, action: null, description: 'سجل مكافآت التحديات' },
  'ch_refresh_admin': { committee: null, action: null, description: 'تحديث لوحة التحديات' },
  'ch_add_': { committee: null, action: null, description: 'إضافة تحدي لعضو' },
  'ch_add_type_': { committee: null, action: null, description: 'اختيار نوع التحدي' },
  'ch_edit_': { committee: null, action: null, description: 'تعديل تحدي عضو' },
  'ch_delete_': { committee: null, action: null, description: 'حذف تحدي عضو' },
  'ch_manage_modal': { committee: null, action: null, description: 'مودال إدارة عضو في التحديات' },
  'ch_add_confirm_': { committee: null, action: null, description: 'تأكيد إضافة تحدي' },
  'ch_assign_all': { committee: null, action: null, description: 'إرسال تحديات لكل الأعضاء' },
  'ch_clear_active': { committee: null, action: null, description: 'حذف التحديات النشطة' },

  // أزرار اللوبية التفاعلية
  'lb_pts': { committee: null, action: null, description: 'لوبية النقاط' },
  'lb_wk': { committee: null, action: null, description: 'لوبية الأسبوع' },
  'lb_att': { committee: null, action: null, description: 'لوبية ساعات الاحتلال' },
  'lb_str': { committee: null, action: null, description: 'لوبية الستريك' },
  'lb_rnk': { committee: null, action: null, description: 'عرض مرتبتي الشخصية' },
  'lb_prv': { committee: null, action: null, description: 'الصفحة السابقة' },
  'lb_nxt': { committee: null, action: null, description: 'الصفحة التالية' },
  'lb_rfr': { committee: null, action: null, description: 'تحديث اللوبية' },
  'comp_': { committee: 'interaction', action: 'competition', description: '🏆 أزرار المسابقات' },
};

/**
 * سجل النماذج (Modals)
 * المفتاح = بادئة customId
 */
export const modalRegistry = {
  'application_modal': { committee: null, action: null, description: 'نموذج التقديم للعائلة' },
  'bm_application_modal': { committee: null, action: null, description: 'نموذج تقديم البلاك ماركت' },
  'reject_reason_': { committee: 'interaction', action: 'acceptHire', description: 'نموذج سبب رفض التقديم' },
  'finish_application_modal_': { committee: 'interaction', action: 'acceptHire', description: 'نموذج إنهاء قبول عضو' },
  'finish_bm_app_modal_': { committee: 'blackMarket', action: 'approveApplications', description: 'نموذج إنهاء تعيين بائع' },
  'post_product_modal_': { committee: null, action: null, description: 'نموذج إضافة منتج' },
  'order_request_modal': { committee: null, action: null, description: 'نموذج طلب منتج' },
  'buy_confirm_modal_': { committee: null, action: null, description: 'نموذج تأكيد شراء' },
  'edit_qty_modal_': { committee: null, action: null, description: 'نموذج تعديل الكمية' },
  'close_reason_modal_': { committee: null, action: null, description: 'نموذج سبب إغلاق التذكرة' },
  'add_user_modal_': { committee: null, action: null, description: 'نموذج إضافة مستخدم للتذكرة' },
  'rename_ticket_modal_app_': { committee: null, action: null, description: 'نموذج تغيير اسم التذكرة' },
  'rate_seller_modal_': { committee: null, action: null, description: 'نموذج تقييم بائع' },
  'reject_sale_reason_': { committee: 'blackMarket', action: 'approveSales', description: 'نموذج سبب رفض البيع' },
  'complaint_seller_modal_': { committee: 'blackMarket', action: 'manageSellers', description: 'نموذج الإبلاغ عن بائع' },
  'comm_add_user_id_modal': { committee: 'family_presidency', action: 'committeePanel', description: 'نموذج إضافة عضو للجنة' },
  'comm_remove_user_modal': { committee: 'family_presidency', action: 'committeePanel', description: 'نموذج إزالة عضو من اللجنة' },
  'att_modal_set_multiplier': { committee: null, action: null, description: 'نموذج إعطاء مضاعف' },
  'att_modal_remove_multiplier': { committee: null, action: null, description: 'نموذج إزالة مضاعف' },
  'att_modal_view_member': { committee: null, action: null, description: 'نموذج عرض عضو' },
  'att_modal_force_logout': { committee: null, action: null, description: 'نموذج تسجيل خروج إجباري' },
  'att_modal_modify_': { committee: null, action: null, description: 'نموذج تعديل (زيادة/إنقاص/تصفير)' },

  // مودالات التصويت
  'vote_content_modal_': { committee: null, action: null, description: 'مودال محتوى التصويت' },
  'vote_no_modal_': { committee: null, action: null, description: 'مودال سبب رفض التصويت' },

  // مودالات التحديات اليومية
  'ch_manage_modal': { committee: null, action: null, description: 'مودال إدارة تحدي عضو' },
  'ch_add_confirm_': { committee: null, action: null, description: 'مودال تأكيد إضافة تحدي' },
  'ch_edit_save_': { committee: null, action: null, description: 'مودال حفظ تعديل تحدي' },
  'comp_modal_': { committee: null, action: null, description: '🏆 مودالات المسابقات' },
};

/**
 * الحصول على معلومات الأمر من السجل
 */
export function getCommandInfo(commandName) {
  return commandRegistry[commandName] || null;
}

/**
 * الحصول على معلومات الزر من السجل
 */
export function getButtonInfo(customId) {
  if (!customId) return null;
  const exact = buttonRegistry[customId];
  if (exact) return exact;
  for (const [prefix, info] of Object.entries(buttonRegistry)) {
    if (customId.startsWith(prefix)) return info;
  }
  return null;
}

/**
 * الحصول على معلومات النموذج من السجل
 */
export function getModalInfo(customId) {
  if (!customId) return null;
  const exact = modalRegistry[customId];
  if (exact) return exact;
  for (const [prefix, info] of Object.entries(modalRegistry)) {
    if (customId.startsWith(prefix)) return info;
  }
  return null;
}

/**
 * الحصول على جميع الأوامر المقسمة حسب التصنيف
 */
export function getCommandsByCategory() {
  const byCategory = {};
  for (const [name, info] of Object.entries(commandRegistry)) {
    const cat = info.category || 'general';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ name, ...info });
  }
  return byCategory;
}

/**
 * التحقق مما إذا كان الإجراء مسموحاً للجنة معينة
 */
export function isActionAllowedForCommittee(committeeKey, action, config) {
  if (!committeeKey || !action) return true;
  const committee = config.committees?.list?.[committeeKey];
  if (!committee) return false;
  if (committee.allowedActions?.includes('ALL')) return true;
  return committee.allowedActions?.includes(action) || false;
}
