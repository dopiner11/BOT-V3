import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'config.json');
const TARGETS_PATH = join(__dirname, 'targets.json');
const PROGRESS_PATH = join(__dirname, 'progress.json');

let cancelled = false;

/* ===================================================================
   قراءة الملفات
   =================================================================== */
function loadJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`❌ فشل قراءة ${path}:`, err.message);
    process.exit(1);
  }
}

function saveProgress(data) {
  writeFileSync(PROGRESS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/* ===================================================================
   إنشاء قناة DM مع المستخدم
   =================================================================== */
async function createDM(token, userId) {
  const res = await axios({
    method: 'POST',
    url: 'https://discord.com/api/v10/users/@me/channels',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    data: { recipients: [userId] },
    validateStatus: () => true,
  });
  return res;
}

/* ===================================================================
   إرسال رسالة إلى قناة DM
   =================================================================== */
async function sendMessage(token, channelId, embed) {
  const res = await axios({
    method: 'POST',
    url: `https://discord.com/api/v10/channels/${channelId}/messages`,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
    },
    data: { embeds: [embed] },
    validateStatus: () => true,
  });
  return res;
}

/* ===================================================================
   بناء الأيمبد
   =================================================================== */
function buildEmbed(config) {
  const embed = {
    title: '🆘 تم إنقاذك!',
    description: config.message,
    color: 0x2ECC71,
    fields: [],
    timestamp: new Date().toISOString(),
  };
  embed.fields.push({ name: 'السيرفر', value: config.serverName || 'السيرفر', inline: true });
  if (config.inviteLink) {
    embed.fields.push({ name: 'رابط السيرفر', value: config.inviteLink, inline: false });
  }
  return embed;
}

/* ===================================================================
   التحقق من صحة التوكن
   =================================================================== */
async function checkToken(token) {
  try {
    const res = await axios({
      method: 'GET',
      url: 'https://discord.com/api/v10/users/@me',
      headers: { Authorization: token },
      validateStatus: () => true,
    });
    if (res.status === 200) {
      return { ok: true, user: res.data };
    }
    return { ok: false, error: `رمز الحالة ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ===================================================================
   معالجة Rate Limit
   =================================================================== */
async function handleRateLimit(res, accountIndex) {
  if (res.status === 429) {
    const retryAfter = (res.data?.retry_after || 5) * 1000 + 1000;
    console.log(`   ⏸ الحساب ${accountIndex + 1}: Rate limit ينتظر ${Math.round(retryAfter / 1000)} ثواني...`);
    await sleep(retryAfter);
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* ===================================================================
   عرض الإحصائيات الحية
   =================================================================== */
function printStats(accounts, stats) {
  const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
  const totalSent = stats.completed.reduce((a, b) => a + b, 0);
  const totalFailed = stats.failed.reduce((a, b) => a + b, 0);
  const totalTargets = stats.targetsCount;

  console.clear();
  console.log('🧠 Rescue Sender v1.0');
  console.log('━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`الحسابات: ${accounts.length} | الأهداف: ${totalTargets}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━');

  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    console.log(`✅ Account ${i + 1} (${a.username}): ${stats.completed[i]}/${stats.assigned[i]} | ❌ ${stats.failed[i]}`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━');
  const progress = totalTargets > 0 ? `${totalSent}/${totalTargets}` : '0/0';
  console.log(`📊 الإجمالي: ${progress} | ❌ ${totalFailed} | ⏱ ${formatTime(elapsed)}`);

  if (cancelled) {
    console.log('⛔ تم الإيقاف بواسطة المستخدم');
  } else if (totalSent + totalFailed >= totalTargets) {
    console.log('✅ اكتمل الإرسال!');
  } else {
    console.log('🟢 جاري الإرسال...');
  }

  if (stats.currentUser) {
    console.log(`👤 الحالي: ${stats.currentUser}`);
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/* ===================================================================
   الإرسال الرئيسي — Round Robin
   =================================================================== */
async function run() {
  console.clear();
  console.log('🧠 Rescue Sender v1.0 — تحميل الإعدادات...\n');

  // قراءة الملفات
  const config = loadJSON(CONFIG_PATH);
  const targets = loadJSON(TARGETS_PATH);

  if (!Array.isArray(targets) || targets.length === 0) {
    console.log('❌ لا يوجد أهداف في targets.json');
    process.exit(1);
  }

  if (!Array.isArray(config.tokens) || config.tokens.length === 0) {
    console.log('❌ لا يوجد توكنز في config.json');
    process.exit(1);
  }

  console.log(`📂 الأهداف: ${targets.length}`);
  console.log(`🔑 التوكنز: ${config.tokens.length}`);
  console.log('');

  // التحقق من صحة التوكنز
  const validAccounts = [];
  for (let i = 0; i < config.tokens.length; i++) {
    const token = config.tokens[i].trim();
    if (!token || token.startsWith('ضع_')) {
      console.log(`⚠️ الحساب ${i + 1}: تم تخطي (توكن غير صالح)`);
      continue;
    }
    const result = await checkToken(token);
    if (result.ok) {
      validAccounts.push({ token, username: result.user.username, id: result.user.id });
      console.log(`✅ الحساب ${i + 1}: ${result.user.username} (${result.user.id})`);
    } else {
      console.log(`❌ الحساب ${i + 1}: ${result.error}`);
    }
  }

  if (validAccounts.length === 0) {
    console.log('\n❌ لا يوجد حسابات صالحة للعمل.');
    process.exit(1);
  }

  console.log(`\n✅ عدد الحسابات الجاهزة: ${validAccounts.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━');

  // حساب الحصص (Round Robin)
  const assignedCounts = new Array(validAccounts.length).fill(0);
  for (let i = 0; i < targets.length; i++) {
    assignedCounts[i % validAccounts.length]++;
  }

  console.log('توزيع Round Robin:');
  for (let i = 0; i < validAccounts.length; i++) {
    console.log(`   Account ${i + 1} (${validAccounts[i].username}): ${assignedCounts[i]} هدف`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━');

  // التقدم
  const progress = {
    completed: new Array(validAccounts.length).fill(0),
    failed: new Array(validAccounts.length).fill(0),
    lastIndex: 0,
    targetsCount: targets.length,
    assigned: assignedCounts,
    startTime: Date.now(),
    currentUser: '',
  };

  // استرجاع التقدم المحفوظ
  let startIndex = 0;
  if (existsSync(PROGRESS_PATH)) {
    try {
      const saved = loadJSON(PROGRESS_PATH);
      if (saved.lastIndex && saved.targetsCount === targets.length) {
        startIndex = saved.lastIndex;
        if (saved.completed) progress.completed = saved.completed;
        if (saved.failed) progress.failed = saved.failed;
        console.log(`🔄 تم استرجاع التقدم: ${startIndex}/${targets.length}`);
      }
    } catch {}
  }

  const embed = buildEmbed(config);

  // التقاط Ctrl+C للإيقاف
  process.on('SIGINT', () => {
    cancelled = true;
    console.log('\n⛔ جاري إيقاف الإرسال...');
    saveProgress({ ...progress, lastIndex: startIndex });
  });

  // الإرسال
  for (let i = startIndex; i < targets.length && !cancelled; i++) {
    const userId = targets[i];
    const accountIndex = i % validAccounts.length;
    const account = validAccounts[accountIndex];
    progress.currentUser = userId;

    // محاولة الإرسال (مع 3 محاولات)
    let success = false;
    for (let attempt = 0; attempt < 3 && !success && !cancelled; attempt++) {
      try {
        // إنشاء DM
        const dmRes = await createDM(account.token, userId);
        if (await handleRateLimit(dmRes, accountIndex)) { attempt--; continue; }

        if (dmRes.status === 200 || dmRes.status === 201) {
          const channelId = dmRes.data.id;

          // إرسال الرسالة
          const msgRes = await sendMessage(account.token, channelId, embed);
          if (await handleRateLimit(msgRes, accountIndex)) { attempt--; continue; }

          if (msgRes.status === 200 || msgRes.status === 201) {
            progress.completed[accountIndex]++;
            success = true;
          } else if (msgRes.status === 403 || msgRes.status === 400) {
            // DM مقفول أو خطأ — لا داعي لإعادة المحاولة
            progress.failed[accountIndex]++;
            success = true;
          } else {
            if (attempt < 2) {
              console.log(`   ⚠️ Account ${accountIndex + 1}: محاولة ${attempt + 1} فشلت (${msgRes.status}) — إعادة...`);
              await sleep(2000);
            } else {
              progress.failed[accountIndex]++;
              success = true;
            }
          }
        } else if (dmRes.status === 403) {
          // المستخدم مقفل DM
          progress.failed[accountIndex]++;
          success = true;
        } else if (dmRes.status === 404 || dmRes.status === 400) {
          // ID غير صالح
          progress.failed[accountIndex]++;
          success = true;
        } else {
          if (attempt < 2) {
            await sleep(2000);
          } else {
            progress.failed[accountIndex]++;
            success = true;
          }
        }
      } catch (err) {
        if (attempt < 2 && !cancelled) {
          await sleep(3000);
        } else {
          progress.failed[accountIndex]++;
          success = true;
        }
      }
    }

    // حفظ التقدم كل 10 أهداف
    if ((i + 1) % 10 === 0 || cancelled || i + 1 === targets.length) {
      startIndex = i + 1;
      saveProgress({ ...progress, lastIndex: startIndex });
      printStats(validAccounts, progress);
    }

    // تأخير بين الرسايل (حسب الحساب)
    if (!cancelled && i + 1 < targets.length) {
      await sleep(config.delayMs || 5000);
    }
  }

  // التقرير النهائي
  if (!cancelled) {
    printStats(validAccounts, progress);
    console.log('\n✅ تم الانتهاء من إرسال جميع الرسائل!');
    console.log(`📁 التقرير محفوظ في progress.json`);
  } else {
    console.log('\n⛔ تم إيقاف الإرسال.');
    console.log(`📁 التقدم محفوظ في progress.json — شغل الملف مرة ثانية يكمل.`);
  }

  // طباعة الملخص
  const totalSent = progress.completed.reduce((a, b) => a + b, 0);
  const totalFailed = progress.failed.reduce((a, b) => a + b, 0);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 التقرير النهائي');
  console.log('━━━━━━━━━━━━━━━━━━━━━━');
  for (let i = 0; i < validAccounts.length; i++) {
    console.log(`✅ ${validAccounts[i].username}: ${progress.completed[i]} أرسل | ${progress.failed[i]} فشل`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📦 الإجمالي: ${totalSent} نجح | ${totalFailed} فشل | ${totalSent + totalFailed} محاولة`);
}

run().catch(err => {
  console.error('❌ خطأ غير متوقع:', err);
  process.exit(1);
});
