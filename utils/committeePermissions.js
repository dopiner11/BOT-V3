/**
 * committeePermissions.js
 * ========================
 * الملف المسؤول الوحيد عن تحديد صلاحيات كل لجنة.
 * أي أمر/زر مضاف هنا يصبح متاحاً لأعضاء اللجنة تلقائياً.
 * أي أمر/زر غير موجود في أي لجنة يعتبر أمراً عاماً (للجميع).
 *
 * طريقة الإضافة:
 *   commands: [ 'اسم_الأمر', ... ]  // اسم الأمر مطابق لـ actionRegistry.commands
 *   buttons:  [ 'بادئة_الزر', ... ]  // بادئة الزر مطابقة لـ actionRegistry.buttonRegistry
 *
 * لا تحتاج لتعديل أي ملف آخر غير هذا الملف عند إضافة أو نقل صلاحيات.
 */

export const committees = {
  punishment: {
    name: 'لجنة العقوبات',
    commands: [
      'بلاك_ليست',                  // إضافة عضو إلى القائمة السوداء
      'ازالة_بلاك_ليست',            // إزالة عضو من القائمة السوداء
      'تحذير',                      // إعطاء تحذير لعضو
      'ازالة-تحذير',                // إزالة تحذير عن عضو
      'فصل',                        // فصل عضو من العائلة
      'تصفير_نقاط',                 // تصفير نقاط عضو معين
      'تصفير_النقاط_للجميع',        // تصفير نقاط جميع الأعضاء
      'تنقيص_نقاط',                 // تنقيص نقاط من عضو
      'توظيف_يدوي',                 // توظيف عضو بشكل يدوي
      'بلاكليست_تذاكر',             // منع عضو من فتح التذاكر
      'ازالة_بلاكليست_تذاكر',       // إزالة منع التذاكر عن عضو
      'انشاء_مزاد',                 // إنشاء مزاد جديد
      'بلاكليست_مزاد',              // منع عضو من المشاركة في المزادات
      'ازالة_بلاكليست_مزاد',        // إزالة منع المزاد عن عضو
    ],
    buttons: [
      'committee_control_btn',      // زر فتح لوحة التحكم باللجنة
      'comm_',                      // إجراءات إدارة أعضاء اللجنة
      'end',                        // إنهاء مزاد
      'confirm_end_',               // تأكيد إنهاء مزاد
      'manage_bids',                // إدارة المزايدات في المزاد
      'remove_bid',                 // إزالة مزايدة من المزاد
      'att_control',                // زر التحكم بنظام ساعات الاحتلال
      'att_ctrl',                   // فتح لوحة تحكم ساعات الاحتلال
      'att_control_action',         // إجراءات التحكم بساعات الاحتلال
      'att_modal_',                 // نماذج ساعات الاحتلال
      // أوامر نظام التحديات اليومية
      'تحديات',
      // أزرار نظام التحديات اليومية
      'ch_status',
      'ch_manage',
      'ch_config',
      'ch_log',
      'ch_refresh_admin',
      'ch_assign_all',
      'ch_clear_active',
      'ch_add_',
      'ch_edit_',
      'ch_delete_',
      'ch_manage_modal',
      // أزرار العقوبات من لوحة المعايرة
      'punish_warn_',
      'punish_fire_',
      'punish_forgive_',
    ],
  },

  interaction: {
    name: 'لجنة التفاعل',
    commands: [
      'زيادة_نقاط',                 // إضافة نقاط لعضو
      'اجازة',                      // منح إجازة لعضو
      'كسر-اجازة',                  // كسر إجازة عضو وإرجاعه للخدمة
      'كسر_عذر',                    // كسر عذر عضو
      'اعذار',                      // تقديم عذر لعضو
      'تنويه',                      // إرسال تنويه لجميع الأعضاء في غرفهم الصوتية
      'نظام-التقارير',              // إرسال لوحة إنشاء التقارير
      'تقارير',                     // تحديث لوحة التقارير المباشرة
      'التقديم',                    // إرسال نموذج التقديم للعائلة والبلاك ماركت
      'حضور',                       // 📋 نظام تسجيل ساعات الاحتلال
      'مسابقة',                     // 🏆 نظام المسابقات
    ],
    buttons: [
      'committee_control_btn',      // زر فتح لوحة التحكم باللجنة
      'comm_',                      // إجراءات إدارة أعضاء اللجنة
      'finish_application_',        // إنهاء قبول عضو في تذكرة التقديم
      'accept_application_',        // قبول تقديم عضو
      'reject_application_',        // رفض تقديم عضو
      'double_points_btn',          // تفعيل النقاط المضاعفة
      'accept_report',              // قبول تقرير
      'reject_report',              // رفض تقرير
      'report_',                    // إجراءات التقارير
      'reject_reason_modal_',       // سبب رفض التقرير
      'att_control',                // زر التحكم بنظام ساعات الاحتلال
      'att_ctrl',                   // فتح لوحة تحكم ساعات الاحتلال
      'att_control_action',         // إجراءات التحكم بساعات الاحتلال
      'att_modal_',                 // نماذج ساعات الاحتلال
      // أوامر نظام التحديات اليومية
      'تحديات',
      // أزرار نظام التحديات اليومية
      'ch_status',
      'ch_manage',
      'ch_config',
      'ch_log',
      'ch_refresh_admin',
      'ch_assign_all',
      'ch_clear_active',
      'ch_add_',
      'ch_edit_',
      'ch_delete_',
      'ch_manage_modal',
      'comp_',                      // 🏆 أزرار المسابقات
    ],
  },

  promotion: {
    name: 'لجنة الترقيات',
    commands: [
      'ترقية-استثنائية',            // ترقية استثنائية لعضو
      'ترقيات',                     // التحقق من ترقيات الأعضاء وترقيتهم
      'ترشيح',                       // ترشيح عضو للترقية
    ],
    buttons: [
      'committee_control_btn',      // زر فتح لوحة التحكم باللجنة
      'comm_',                      // إجراءات إدارة أعضاء اللجنة
      'force_prom_',                // ترقية قسرية
      'reject_prom_',               // رفض ترقية
      'nom_acc_',                   // قبول ترشيح
      'nom_rej_',                   // رفض ترشيح
      // أوامر نظام التحديات اليومية
      'تحديات',
      // أزرار نظام التحديات اليومية
      'ch_status',
      'ch_manage',
      'ch_config',
      'ch_log',
      'ch_refresh_admin',
      'ch_assign_all',
      'ch_clear_active',
      'ch_add_',
      'ch_edit_',
      'ch_delete_',
      'ch_manage_modal',
    ],
  },

  family_presidency: {
    name: 'رئاسة العائلة',
    commands: [
      'لوحة_اللجان',                // تحديث لوحات جميع اللجان
      'broadcast',                   // 📡 نظام البرودكاست والإرسال الجماعي
      'تحذير',                      // إعطاء تحذير
      'ازالة-تحذير',                // إزالة تحذير عن عضو
      'زيادة_نقاط',                 // إضافة نقاط لعضو
      'تنقيص_نقاط',                 // تنقيص نقاط
      'تصفير_نقاط',                 // تصفير نقاط
      'تصفير_النقاط_للجميع',        // تصفير نقاط الجميع
      'تنويه',                      // إرسال تنويه
      'نظام-التقارير',              // نظام التقارير
      'تقارير',                     // لوحة التقارير
      'التقديم',                    // نموذج التقديم
      'حضور',                       // نظام ساعات الاحتلال
      'بلاك_ليست',                  // إضافة بلاك ليست
      'ازالة_بلاك_ليست',            // إزالة بلاك ليست
      'فصل',                        // فصل عضو
      'توظيف_يدوي',                 // توظيف عضو
      'اجازة',                      // منح إجازة
      'كسر-اجازة',                  // كسر إجازة
      'اعذار',                      // تقديم عذر
      'كسر_عذر',                    // كسر عذر
      'انشاء_مزاد',                 // إنشاء مزاد
      'بلاكليست_تذاكر',             // منع تذاكر
      'ازالة_بلاكليست_تذاكر',       // إزالة منع تذاكر
      'بلاكليست_مزاد',              // منع مزاد
      'ازالة_بلاكليست_مزاد',        // إزالة منع مزاد
      'ترقية-استثنائية',            // ترقية استثنائية
      'ترقيات',                     // نظام الترقيات
      'ترشيح',                      // ترشيح عضو
    ],
    buttons: [
      'committee_control_btn',      // زر فتح لوحة التحكم باللجنة
      'comm_',                      // إجراءات إدارة اللجان
      'double_points_btn',          // تفعيل النقاط المضاعفة
      'accept_report',              // قبول تقرير
      'reject_report',              // رفض تقرير
      'report_',                    // إجراءات التقارير
      'reject_reason_modal_',       // سبب رفض التقرير
      'punish_warn_',               // تحذير من التفاعل
      'punish_fire_',               // فصل
      'punish_forgive_',            // تسامح
      'end',                        // إنهاء مزاد
      'manage_bids',                // إدارة المزايدات
      'att_control',                // التحكم بساعات الاحتلال
      'att_ctrl',                   // لوحة تحكم ساعات الاحتلال
      'att_control_action',         // إجراءات ساعات الاحتلال

      'att_modal_',                 // نماذج ساعات الاحتلال
      'force_prom_',                // ترقية قسرية
      'reject_prom_',               // رفض ترقية
      'nom_acc_',                   // قبول ترشيح
      'nom_rej_',                   // رفض ترشيح
      'تحديات',                     // نظام التحديات
      'ch_toggle',
      'ch_status',
      'ch_manage',
      'ch_config',
      'ch_log',
      'ch_refresh_admin',
      'ch_assign_all',
      'ch_clear_active',
      'ch_add_',
      'ch_edit_',
      'ch_delete_',
      'ch_manage_modal',
    ],
  },

  blackMarket: {
    name: 'لجنة البلاك ماركت',
    commands: [
      'توظيف-بائع',                 // توظيف بائع جديد في البلاك ماركت
      'manage-sellers',             // إدارة البائعين (عرض، تحذير، فصل)
      'bm-requests',                // إرسال لوحة طلبات المنتجات
      'bm-seller',                  // إرسال لوحة البائع
      'احصائيات-بلاك-ماركت',        // عرض لوحة إحصائيات البلاك ماركت
    ],
    buttons: [
      'committee_control_btn',      // زر فتح لوحة التحكم باللجنة
      'comm_',                      // إجراءات إدارة أعضاء اللجنة
      'accept_bm_app_',             // قبول تقديم بلاك ماركت
      'reject_bm_app_',             // رفض تقديم بلاك ماركت
      'end_bm_app_',                // إنهاء تعيين بائع
      'end_sale_',                  // إنهاء عملية بيع (للبائع)
      'approve_sale_',              // الموافقة على عملية بيع
      'reject_sale_',               // رفض عملية بيع
      'claim_request_',             // تلبية طلب منتج
      'complaint_seller_',          // الإبلاغ عن مشكلة مع بائع
      'bm_stats_page_',             // تصفح إحصائيات البائعين
      // أوامر نظام التحديات اليومية
      'تحديات',
      // أزرار نظام التحديات اليومية
      'ch_status',
      'ch_manage',
      'ch_config',
      'ch_log',
      'ch_refresh_admin',
      'ch_assign_all',
      'ch_clear_active',
      'ch_add_',
      'ch_edit_',
      'ch_delete_',
      'ch_manage_modal',
    ],
  },
};

/**
 * الأوامر والأزرار المقيدة التي تحتاج مسؤول (manager) أو نائب (deputy)
 * على الأقل - لا يمكن للأعضاء العاديين استخدامها
 */
export const elevatedCommands = [
  'فصل',                          // فصل عضو لا يمكن إلا للمسؤولين
  'بلاك_ليست',                    // إضافة بلاك ليست لا يمكن إلا للمسؤولين
  'ازالة_بلاك_ليست',              // إزالة بلاك ليست لا يمكن إلا للمسؤولين
  'تحذير',                        // تحذير لا يمكن إلا للمسؤولين
  'تصفير_نقاط',                   // تصفير نقاط لا يمكن إلا للمسؤولين
  'تصفير_النقاط_للجميع',          // تصفير شامل لا يمكن إلا للمسؤولين
  'تنقيص_نقاط',                   // تنقيص نقاط لا يمكن إلا للمسؤولين
  'توظيف_يدوي',                   // توظيف يدوي لا يمكن إلا للمسؤولين
  'ترقية-استثنائية',              // ترقية استثنائية لا يمكن إلا للمسؤولين
  'انشاء_مزاد',                   // إنشاء مزاد لا يمكن إلا للمسؤولين
  'لوحة_اللجان',                  // لوحة اللجان لا يمكن إلا للمسؤولين
];

export const elevatedButtons = [
  'end',                          // إنهاء مزاد لا يمكن إلا للمسؤولين
  'manage_bids',                  // إدارة مزايدات لا يمكن إلا للمسؤولين
  'remove_bid',                   // إزالة مزايدة لا يمكن إلا للمسؤولين
  'committee_control_btn',        // التحكم باللجنة لا يمكن إلا للمسؤولين
  'comm_',                        // إجراءات اللجان لا يمكن إلا للمسؤولين
];

/* ===================================================================
   دوال المساعدة
   =================================================================== */

/**
 * إرجاع أسماء اللجان التي تملك هذا الأمر
 */
export function getCommitteesForCommand(commandName) {
  const result = [];
  for (const [key, committee] of Object.entries(committees)) {
    if (committee.commands.includes(commandName)) {
      result.push(key);
    }
  }
  return result;
}

/**
 * إرجاع أسماء اللجان التي تملك هذا الزر
 * (تطابق البادئة - prefix matching)
 */
export function getCommitteesForButton(customId) {
  const result = [];
  for (const [key, committee] of Object.entries(committees)) {
    for (const prefix of committee.buttons) {
      if (customId === prefix || customId.startsWith(prefix)) {
        if (!result.includes(key)) result.push(key);
        break;
      }
    }
  }
  return result;
}

/**
 * إرجاع الأوامر مقسمة حسب اللجان (لأمر help)
 */
export function getCommandsByCommittee() {
  const byCommittee = {};
  for (const [key, committee] of Object.entries(committees)) {
    const cat = {
      name: committee.name,
      key,
      commands: committee.commands,
      buttons: committee.buttons,
    };
    byCommittee[key] = cat;
  }
  return byCommittee;
}

/**
 * هل الأمر مسموح للجنة معينة؟
 */
export function isCommandAllowed(commandName, committeeKey) {
  const committee = committees[committeeKey];
  if (!committee) return false;
  return committee.commands.includes(commandName);
}

/**
 * هل الزر مسموح للجنة معينة؟
 */
export function isButtonAllowed(customId, committeeKey) {
  const committee = committees[committeeKey];
  if (!committee) return false;
  for (const prefix of committee.buttons) {
    if (customId === prefix || customId.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * هل الأمر مقيد (يحتاج manager/deputy)؟
 */
export function isElevatedCommand(commandName) {
  return elevatedCommands.includes(commandName);
}

/**
 * هل الزر مقيد (يحتاج manager/deputy)؟
 */
export function isElevatedButton(buttonPrefix) {
  return elevatedButtons.some(e => buttonPrefix === e || buttonPrefix.startsWith(e));
}
