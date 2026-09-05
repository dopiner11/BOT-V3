import { fork } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BOT_PATH = join(__dirname, '../../index.js');
const LOG_DIR = join(__dirname, '../../logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

const MAX_LOG_LINES = 800;

let botProcess = null;
let botStatus = {
  state: 'stopped',
  startedAt: null,
  pid: null,
  exitCode: null,
  exitSignal: null,
  lastError: null
};
let logLines = [];

function appendLog(line) {
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) logLines = logLines.slice(logLines.length - MAX_LOG_LINES);
}

export function getBotStatus() {
  return { ...botStatus, logLength: logLines.length };
}

export function getLog(limit = 200) {
  return logLines.slice(-limit);
}

export function clearLog() {
  logLines = [];
}

export function writeLogFile() {
  try {
    const filePath = join(LOG_DIR, `bot-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    writeFileSync(filePath, logLines.join('\n'), 'utf8');
    return filePath;
  } catch {
    return null;
  }
}

export function startBot() {
  if (botProcess && botProcess.exitCode === null) {
    return { success: false, message: 'البوت يعمل بالفعل' };
  }
  try {
    botProcess = fork(BOT_PATH, [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env }
    });

    botStatus = {
      state: 'running',
      startedAt: new Date().toISOString(),
      pid: botProcess.pid,
      exitCode: null,
      exitSignal: null,
      lastError: null
    };

    appendLog(`[${new Date().toLocaleTimeString()}] البوت اشتغل (PID: ${botProcess.pid})`);

    botProcess.stdout.on('data', (d) => {
      const text = d.toString();
      text.split('\n').filter(Boolean).forEach(l => appendLog(`[${new Date().toLocaleTimeString()}] ${l}`));
    });
    botProcess.stderr.on('data', (d) => {
      const text = d.toString();
      text.split('\n').filter(Boolean).forEach(l => appendLog(`[${new Date().toLocaleTimeString()}] ❌ ${l}`));
    });

    botProcess.on('exit', (code, signal) => {
      botStatus.state = 'stopped';
      botStatus.exitCode = code;
      botStatus.exitSignal = signal;
      botStatus.pid = null;
      botStatus.lastError = code === 0 ? null : `الخروج بكود ${code}${signal ? ` / إشارة ${signal}` : ''}`;
      appendLog(`[${new Date().toLocaleTimeString()}] البوت توقف (code=${code}, signal=${signal || 'none'})`);
      botProcess = null;
    });

    botProcess.on('error', (err) => {
      botStatus.lastError = err.message;
      appendLog(`[${new Date().toLocaleTimeString()}] ❌ خطأ في البوت: ${err.message}`);
      botProcess = null;
    });

    return { success: true, message: 'تم تشغيل البوت', pid: botProcess.pid };
  } catch (err) {
    return { success: false, message: `فشل تشغيل البوت: ${err.message}` };
  }
}

export function stopBot() {
  if (!botProcess || botProcess.exitCode !== null) {
    return { success: false, message: 'البوت ليس يعمل' };
  }
  try {
    botProcess.kill('SIGTERM');
    appendLog(`[${new Date().toLocaleTimeString()}] تم إرسال إشارة إيقاف للبوت`);
    return { success: true, message: 'تم إرسال إشارة الإيقاف' };
  } catch (err) {
    return { success: false, message: `فشل إيقاف البوت: ${err.message}` };
  }
}

export function restartBot() {
  stopBot();
  // wait a moment then start
  return { success: true, message: 'تحضير للإعادة', delay: 1200 };
}

export function isBotRunning() {
  return !!botProcess && botProcess.exitCode === null;
}

// Auto-restart on server boot if desired (config option not implemented; can be added)
export function initBotController() {
  // We do NOT auto-start the bot here, to keep control with the user.
}
