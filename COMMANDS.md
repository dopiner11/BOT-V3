# توثيق بوت 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘𓆪

## نظام الصلاحيات (Permission System)

### الملفات الأساسية

| الملف | الوظيفة |
|-------|---------|
| `utils/actionRegistry.js` | السجل المركزي لجميع الأوامر والأزرار والنماذج |
| `utils/committeeHandler.js` | التحقق من الصلاحيات واللجان |
| `config.json → committees` | تعريف اللجان وأدوارها وصلاحياتها |

### سلسلة التحقق من الصلاحية

```
index.js (InteractionCreate)
  → checkCommandPermission(interaction.member, commandName)
    → getCommandInfo(commandName) ← من actionRegistry
    → checkPermission(member, action, { committee })
      → 1. هل هو مؤسس (founders)؟ ← نعم = يمرر
      → 2. هل هو authorizedUser؟ ← نعم = يمرر
      → 3. هل هو من رئاسة العائلة؟ ← نعم = يمرر
      → 4. هل هو عضو في اللجنة المسؤولة؟ ← لا = ممنوع
      → 5. هل الإجراء من allowedActions للجنة؟ ← لا = ممنوع
      → 6. هل الإجراء مقيد (fire, blacklist...) والعضو عادي؟ ← ممنوع
```

### هيكل config.json → committees

```json
{
  "committees": {
    "founders": ["userID1", "userID2"],  // يمررون كل شيء
    "authorizedUsers": ["userID1"],       // يمررون كل شيء
    "panelChannelId": "channelID",       // القناة الرئيسية للجان
    "list": {
      "committeeKey": {
        "name": "اسم اللجنة",
        "channelId": "channelID",
        "roles": {
          "manager": ["roleID"],   // مسؤول - يسمح بكل الإجراءات
          "deputy": ["roleID"],    // نائب - يسمح بكل الإجراءات
          "member": ["roleID"]     // عضو عادي - إجراءات محدودة
        },
        "allowedActions": ["action1", "action2"],
        "messageId": "messageID"  // معرف رسالة اللوحة (auto-generated)
      }
    }
  }
}
```

### الإجراءات المقيدة (تتطلب manager/deputy على الأقل)

`fire`, `Warning`, `Zero`, `Zeros`, `blacklist`, `removeBlacklist`, `manualHire`, `promotion`, `easyprom`, `nomination`, `auction_create`, `committeePanel`

---

## الأوامر (Slash Commands)

### ⚖️ العقوبات

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/بلاك_ليست` | `blacklist` | punishment | إضافة عضو إلى البلاك ليست |
| `/ازالة_بلاك_ليست` | `removeBlacklist` | punishment | إزالة عضو من البلاك ليست |
| `/تحذير` | `Warning` | punishment | إعطاء تحذير لعضو |
| `/ازالة-تحذير` | `removeBlacklist` | punishment | إزالة تحذير عن عضو |
| `/فصل` | `fire` | punishment | فصل عضو من العائلة |
| `/تصفير_نقاط` | `Zero` | punishment | تصفير نقاط عضو معين |
| `/تصفير_النقاط_للجميع` | `Zeros` | punishment | تصفير نقاط جميع الأعضاء |
| `/تنقيص_نقاط` | `removePoints` | punishment | تنقيص نقاط من عضو |

### 👑 إدارة العائلة

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/توظيف_يدوي` | `manualHire` | punishment | توظيف عضو بشكل يدوي |
| `/تنويه` | `manualHire` | interaction | إرسال تنويه لجميع الأعضاء |
| `/ترقية-استثنائية` | `easyprom` | promotion | ترقية استثنائية |
| `/ترقيات` | `promotion` | promotion | التحقق من الترقيات |
| `/كسر-اجازة` | `BreakVacation` | interaction | كسر إجازة عضو |
| `/كسر_عذر` | `breakExcuse` | interaction | كسر عذر عضو |
| `/اعذار` | `Excuse` | interaction | تقديم عذر لعضو |

### ⭐ النقاط والرتب

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/نقاط` | عام | عام | عرض النقاط |
| `/زيادة_نقاط` | `addPoints` | interaction | إضافة نقاط |
| `/التوب` | عام | عام | قائمة أفضل الأعضاء |

### 🎫 التذاكر

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/بلاكليست_تذاكر` | `ticketBlacklist` | punishment | منع عضو من فتح التذاكر |
| `/ازالة_بلاكليست_تذاكر` | `ticketBlacklist` | punishment | إزالة منع التذاكر |

### 💰 المزادات

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/انشاء_مزاد` | `auction_create` | punishment | إنشاء مزاد |
| `/بلاكليست_مزاد` | `auctionBlacklist` | punishment | منع عضو من المزادات |
| `/ازالة_بلاكليست_مزاد` | `auctionBlacklist` | punishment | إزالة منع المزاد |

### 🩸 البلاك ماركت

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/توظيف-بائع` | `manageSellers` | blackMarket | توظيف بائع جديد |
| `/manage-sellers` | `manageSellers` | blackMarket | إدارة البائعين |
| `/bm-requests` | `manageSellers` | blackMarket | لوحة طلبات المنتجات |
| `/bm-seller` | `manageSellers` | blackMarket | لوحة البائع |
| `/seller-stats` | عام | عام | إحصائيات بائع |
| `/احصائيات-بلاك-ماركت` | `manageSellers` | blackMarket | لوحة الإحصائيات |

### 📊 التقارير

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/نظام-التقارير` | `acceptReport` | interaction | لوحة إنشاء التقارير |
| `/تقارير` | `reports` | interaction | تحديث لوحة التقارير |

### ℹ️ معلومات

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/معلومات` | عام | عام | معلومات عضو |
| `/التحذيرات` | عام | عام | عرض التحذيرات |
| `/help` | عام | عام | قائمة الأوامر والمساعدة |

### 🏛️ اللجان

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/لوحة_اللجان` | `committeePanel` | family_presidency | تحديث لوحات اللجان |

### 📝 التقديمات

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/التقديم` | `acceptHire` | interaction | نموذج التقديم |

### 🔧 عامة

| الأمر | الإجراء | اللجنة | الوصف |
|-------|---------|--------|-------|
| `/ticket_panel` | عام | عام | لوحة التذاكر |

---

## الأزرار (Buttons)

### التذاكر
| البادئة | اللجنة | الوصف |
|---------|--------|-------|
| `claim_ticket_` | عام | استلام تذكرة |
| `unclaim_ticket_` | عام | إلغاء استلام تذكرة |
| `close_ticket_` | عام | إغلاق تذكرة |
| `add_user_ticket_` | عام | إضافة شخص للتذكرة |
| `finish_application_` | interaction | إنهاء قبول عضو |
| `rename_ticket_app_` | عام | تغيير اسم التذكرة |

### التقديم
| البادئة | اللجنة | الوصف |
|---------|--------|-------|
| `accept_application_` | interaction | قبول تقديم |
| `reject_application_` | interaction | رفض تقديم |
| `start_application` | عام | بدء نموذج التقديم |
| `apply_button` | عام | زر التقديم |
| `application_select` | عام | اختيار نوع التقديم |

### البلاك ماركت
| البادئة | اللجنة | الوصف |
|---------|--------|-------|
| `accept_bm_app_` | blackMarket | قبول تقديم بائع |
| `reject_bm_app_` | blackMarket | رفض تقديم بائع |
| `end_bm_app_` | blackMarket | إنهاء تعيين بائع |
| `end_sale_` | blackMarket | إنهاء عملية بيع |
| `approve_sale_` | blackMarket | الموافقة على بيع |
| `reject_sale_` | blackMarket | رفض بيع |
| `rate_seller_` | عام | تقييم بائع |
| `claim_request_` | blackMarket | تلبية طلب منتج |
| `complaint_seller_` | blackMarket | الإبلاغ عن بائع |

### الترقيات والترشيحات
| البادئة | اللجنة | الوصف |
|---------|--------|-------|
| `force_prom_` | promotion | ترقية قسرية |
| `reject_prom_` | promotion | رفض ترقية |
| `nom_acc_` | promotion | قبول ترشيح |
| `nom_rej_` | promotion | رفض ترشيح |

### التقارير
| البادئة | اللجنة | الوصف |
|---------|--------|-------|
| `start_report` | عام | بدء تقرير جديد |
| `double_points_btn` | interaction | تفعيل النقاط المضاعفة |
| `accept_report` | interaction | قبول تقرير |
| `reject_report` | interaction | رفض تقرير |

### المزادات
| البادئة | اللجنة | الوصف |
|---------|--------|-------|
| `end` | punishment | إنهاء مزاد |
| `confirm_end_` | punishment | تأكيد إنهاء مزاد |
| `manage_bids` | punishment | إدارة المزايدات |
| `remove_bid` | punishment | إزالة مزايدة |

### اللجان
| البادئة | اللجنة | الوصف |
|---------|--------|-------|
| `committee_control_btn` | family_presidency | التحكم باللجنة |
| `comm_` | family_presidency | إجراءات اللجان |

---

## النماذج (Modals)

| البادئة | اللجنة | الوصف |
|---------|--------|-------|
| `application_modal` | عام | نموذج تقديم العائلة |
| `bm_application_modal` | عام | نموذج تقديم بلاك ماركت |
| `reject_reason_` | interaction | سبب رفض التقديم |
| `finish_application_modal_` | interaction | إنهاء قبول عضو |
| `finish_bm_app_modal_` | blackMarket | إنهاء تعيين بائع |
| `complaint_seller_modal_` | blackMarket | الإبلاغ عن بائع |
| `comm_add_user_id_modal` | family_presidency | إضافة عضو للجنة |
| `comm_remove_user_modal` | family_presidency | إزالة عضو من اللجنة |

---

## كيفية إضافة أمر جديد

1. أضف الأمر في `commands/` على النمط الموجود
2. سجله في `utils/actionRegistry.js`:
```js
'اسم_الأمر': {
  category: 'punishments',        // التصنيف (من CATEGORIES)
  committee: 'punishment',        // مفتاح اللجنة في config
  action: 'blacklist',            // اسم الإجراء
  description: 'شرح الأمر',       // يظهر في /help
  usage: '/اسم_الأمر الخيار: @ user',  // مثال استخدام
}
```
3. تأكد من أن اللجنة في `config.json` تحتوي على الإجراء في `allowedActions`
4. أعد تشغيل البوت

## كيفية نقل أمر بين اللجان

غيّر قيمة `committee` في `actionRegistry.js` فقط. لا حاجة لتعديل أي ملف آخر.

## كيفية إضافة لجنة جديدة

1. أضفها في `config.json → committees → list`:
```json
"newCommittee": {
  "name": "اسم اللجنة",
  "channelId": "channelID",
  "roles": { "manager": [], "deputy": [], "member": [] },
  "allowedActions": ["action1", "action2"],
}
```
2. استخدم المفتاح (`newCommittee`) في `actionRegistry.js` كقيمة `committee`
3. شغل `/لوحة_اللجان` لتحديث اللوحات
