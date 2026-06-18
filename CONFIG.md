# توثيق ملف الإعدادات (config.json)

## 📂 هيكل الملف

```
config.json
├── bot                          # إعدادات البوت الأساسية
├── activity                     # حالة البوت (النشاط)
├── voiceChannelId               # الروم الصوتي للبوت
├── statusChannel                # قناة حالة البوت
├── committees                   # ⭐ نظام اللجان (الرتب فقط)
│   ├── founders                 #   المؤسسون ( bypass كل شيء )
│   ├── authorizedUsers          #   مستخدمون مصرح لهم
│   ├── panelChannelId           #   قناة لوحات اللجان
│   └── list                     #   قائمة اللجان
│       ├── interaction          #     لجنة التفاعل
│       ├── punishment           #     لجنة العقوبات
│       ├── promotion            #     لجنة الترقيات
│       ├── family_presidency    #     رئاسة العائلة
│       ├── discord              #     لجنة الديسكورد
│       ├── alliance             #     لجنة التحالف
│       └── blackMarket          #     لجنة البلاك ماركت
├── channels                     # آيدي القنوات
├── categories                   # آيدي الكاتيجوريز
├── roles                        # آيدي الرتب + نظام الرتب
├── excuseRoles                  # رتب الأعذار
├── permissions                  # ⚠️ (قديم) نظام الصلاحيات بالرولز
├── rules                        # قوانين العائلة
├── application                  # نموذج تقديم العائلة
├── blackMarket                  # إعدادات البلاك ماركت
├── reportPoints                 # نظام النقاط
├── ticketSystem                 # نظام التذاكر
├── auctions                     # نظام المزادات
├── logChannels                  # قنوات السجلات
└── transcript                   # إعدادات حفظ التذاكر
```

---

## ⭐ نظام اللجان (الجزء الأهم)

### config.json → committees

**المؤسسون (`founders`)**: Array of User IDs. يتجاوزون كل الصلاحيات بدون استثناء.

**المستخدمون المصرح لهم (`authorizedUsers`)**: Array of User IDs. نفس صلاحيات المؤسسين.

**قناة اللوحات (`panelChannelId`)**: القناة الرئيسية اللي تظهر فيها لوحات اللجان.

**كل لجنة في `list`** تحتوي على:
- `name`: اسم اللجنة (عربي)
- `channelId`: آيدي القناة الخاصة باللجنة
- `roles`: أدوار اللجنة
  - `manager[]`: آيدي رتب المسؤولين
  - `deputy[]`: آيدي رتب النواب
  - `member[]`: آيدي رتب الأعضاء العاديين
- `allowedActions`: للتوثيق فقط
- `messageId`: Auto-generated (معرف رسالة اللوحة)

### committeePermissions.js

**الصلاحيات الفعلية** للأوامر والأزرار تحدد في هذا الملف وليس في config.json.

```
committeePermissions.js → committees → {
  punishment: {
    name: 'لجنة العقوبات',
    commands: [ 'بلاك_ليست', 'فصل', ... ],  // الأوامر المسموحة
    buttons: [ 'end', 'comm_', ... ],          // الأزرار المسموحة
  },
  ...
}
```

---

## 👑 الـ Hierarchy (تسلسل الصلاحيات)

```
1. المؤسسون (founders)
   ├── كل الصلاحيات
   ├── كل الأوامر والأزرار
   └── تجاوز جميع القيود

2. الرئاسة (family_presidency)
   ├── كل الصلاحيات (مثل المؤسسين)
   ├── التحكم بكل اللجان
   └── تجاوز جميع القيود

3. مسؤول اللجنة (manager)
   ├── كل أوامر وأزرار لجنته
   ├── الأوامر المقيدة (elevated)
   ├── يضيف/يزيل نائب في لجنته فقط
   └── يضيف/يزيل أعضاء في لجنته فقط

4. نائب اللجنة (deputy)
   ├── كل أوامر وأزرار لجنته (بما فيها المقيدة)
   └── يضيف/يزيل أعضاء في لجنته فقط

5. عضو اللجنة (member)
   └── الأوامر والأزرار غير المقيدة في لجنته فقط
```

---

## 🎯 كيفية التعديل

### إضافة أمر للجنة
1. تأكد أن الأمر مسجل في `utils/actionRegistry.js`
2. أضف اسم الأمر إلى `commands[]` في اللجنة المطلوبة داخل `utils/committeePermissions.js`

### نقل أمر بين اللجان
- انقل اسم الأمر من `commands[]` لجنة إلى `commands[]` لجنة أخرى في `committeePermissions.js`

### إضافة لجنة جديدة
1. أضفها في `config.json → committees → list` مع الرتب (roles)
2. أضفها في `utils/committeePermissions.js → committees` مع الأوامر والأزرار
3. شغل `/لوحة_اللجان`

### إضافة رتبة جديدة للجنة
- غير `roles.manager/deputy/member` في `config.json → committees → list`

---

## 📝 ملاحظات

- **`_comment_`** fields في `config.json` هي للتوثيق فقط وأي parser JSON يتجاهلها
- **`permissions`** في `config.json` هو النظام القديم (role-based). يستخدم في `ticketManager.js` و `reportHandler.js`. قيد الترحيل للنظام الجديد.
- **`allowedActions`** داخل كل لجنة هو للتوثيق فقط. الصلاحيات الفعلية في `committeePermissions.js`

---

## 🤖 Webhook System (`utils/webhookManager.js`)

```
config.json → webhooks
├── report.channelId       # قناة تقرير التفاعل التلقائي
├── top.channelId          # قناة التوب التلقائي
└── committees.channelId   # قناة لوحات اللجان التلقائية
```

### كيف يعمل
- يرسل 3 رسائل تلقائية ويحدثها كل **10 دقائق**
- يحفظ IDs في `PersistentMessage` تحت مفاتيح `webhook_report`, `webhook_top`, `webhook_committees`
- إذا انمسحت الرسالة، يعيد إرسالها ويحفظ الـ ID الجديد
- **عند بدء التشغيل**: يمسح السجلات القديمة ويرسل رسائل جديدة (force reset)

### التفعيل
1. ضع آيدي القناة في `config.json → webhooks → report.channelId`
2. كرر لـ `top` و `committees`
3. أعد تشغيل البوت

> ⚠️ **مهم**: النظام القديم `startReportSystem` أزيل واستُبدل بـ webhookManager. أمر `/تقارير` مازال موجود للاستخدام اليدوي.

---

## 📨 Inactivity Notifier (`utils/inactivityNotifier.js`)

### كيف يعمل
- عند تحديث تقرير التفاعل، يفحص قوائم الخاملين والمخالفين
- يرسل **DM** خاص لكل عضو:
  - **خامل**: نقاط تفاعل قليلة ← رسالة تحذير خفيفة
  - **مخالف**: لا نشاط منذ 48 ساعة ← إنذار رسمي
- **كوول داون**: ما يرسل إشعار لنفس العضو إلا مرة كل **12 ساعة**
- يحفظ سجل الإشعارات في `config.json → notifiedInactive` (أوبجكت بالمستخدمين وتاريخ آخر إشعار)

### إلغاء الإشعارات
- امسح محتوى `notifiedInactive` في config.json: `"notifiedInactive": {}`
- أو امسح مستخدم معين من القائمة
