import { createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus, StreamType, joinVoiceChannel, entersState } from '@discordjs/voice';
import { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { gold as embedGold } from './embedStyles.js';

const SURAHS = [
  { id: 1, name: 'الفاتحة', ayahCount: 7 },
  { id: 2, name: 'البقرة', ayahCount: 286 },
  { id: 3, name: 'آل عمران', ayahCount: 200 },
  { id: 4, name: 'النساء', ayahCount: 176 },
  { id: 5, name: 'المائدة', ayahCount: 120 },
  { id: 6, name: 'الأنعام', ayahCount: 165 },
  { id: 7, name: 'الأعراف', ayahCount: 206 },
  { id: 8, name: 'الأنفال', ayahCount: 75 },
  { id: 9, name: 'التوبة', ayahCount: 129 },
  { id: 10, name: 'يونس', ayahCount: 109 },
  { id: 11, name: 'هود', ayahCount: 123 },
  { id: 12, name: 'يوسف', ayahCount: 111 },
  { id: 13, name: 'الرعد', ayahCount: 43 },
  { id: 14, name: 'إبراهيم', ayahCount: 52 },
  { id: 15, name: 'الحجر', ayahCount: 99 },
  { id: 16, name: 'النحل', ayahCount: 128 },
  { id: 17, name: 'الإسراء', ayahCount: 111 },
  { id: 18, name: 'الكهف', ayahCount: 110 },
  { id: 19, name: 'مريم', ayahCount: 98 },
  { id: 20, name: 'طه', ayahCount: 135 },
  { id: 21, name: 'الأنبياء', ayahCount: 112 },
  { id: 22, name: 'الحج', ayahCount: 78 },
  { id: 23, name: 'المؤمنون', ayahCount: 118 },
  { id: 24, name: 'النور', ayahCount: 64 },
  { id: 25, name: 'الفرقان', ayahCount: 77 },
  { id: 26, name: 'الشعراء', ayahCount: 227 },
  { id: 27, name: 'النمل', ayahCount: 93 },
  { id: 28, name: 'القصص', ayahCount: 88 },
  { id: 29, name: 'العنكبوت', ayahCount: 69 },
  { id: 30, name: 'الروم', ayahCount: 60 },
  { id: 31, name: 'لقمان', ayahCount: 34 },
  { id: 32, name: 'السجدة', ayahCount: 30 },
  { id: 33, name: 'الأحزاب', ayahCount: 73 },
  { id: 34, name: 'سبأ', ayahCount: 54 },
  { id: 35, name: 'فاطر', ayahCount: 45 },
  { id: 36, name: 'يس', ayahCount: 83 },
  { id: 37, name: 'الصافات', ayahCount: 182 },
  { id: 38, name: 'ص', ayahCount: 88 },
  { id: 39, name: 'الزمر', ayahCount: 75 },
  { id: 40, name: 'غافر', ayahCount: 85 },
  { id: 41, name: 'فصلت', ayahCount: 54 },
  { id: 42, name: 'الشورى', ayahCount: 53 },
  { id: 43, name: 'الزخرف', ayahCount: 89 },
  { id: 44, name: 'الدخان', ayahCount: 59 },
  { id: 45, name: 'الجاثية', ayahCount: 37 },
  { id: 46, name: 'الأحقاف', ayahCount: 35 },
  { id: 47, name: 'محمد', ayahCount: 38 },
  { id: 48, name: 'الفتح', ayahCount: 29 },
  { id: 49, name: 'الحجرات', ayahCount: 18 },
  { id: 50, name: 'ق', ayahCount: 45 },
  { id: 51, name: 'الذاريات', ayahCount: 60 },
  { id: 52, name: 'الطور', ayahCount: 49 },
  { id: 53, name: 'النجم', ayahCount: 62 },
  { id: 54, name: 'القمر', ayahCount: 55 },
  { id: 55, name: 'الرحمن', ayahCount: 78 },
  { id: 56, name: 'الواقعة', ayahCount: 96 },
  { id: 57, name: 'الحديد', ayahCount: 29 },
  { id: 58, name: 'المجادلة', ayahCount: 22 },
  { id: 59, name: 'الحشر', ayahCount: 24 },
  { id: 60, name: 'الممتحنة', ayahCount: 13 },
  { id: 61, name: 'الصف', ayahCount: 14 },
  { id: 62, name: 'الجمعة', ayahCount: 11 },
  { id: 63, name: 'المنافقون', ayahCount: 11 },
  { id: 64, name: 'التغابن', ayahCount: 18 },
  { id: 65, name: 'الطلاق', ayahCount: 12 },
  { id: 66, name: 'التحريم', ayahCount: 12 },
  { id: 67, name: 'الملك', ayahCount: 30 },
  { id: 68, name: 'القلم', ayahCount: 52 },
  { id: 69, name: 'الحاقة', ayahCount: 52 },
  { id: 70, name: 'المعارج', ayahCount: 44 },
  { id: 71, name: 'نوح', ayahCount: 28 },
  { id: 72, name: 'الجن', ayahCount: 28 },
  { id: 73, name: 'المزمل', ayahCount: 20 },
  { id: 74, name: 'المدثر', ayahCount: 56 },
  { id: 75, name: 'القيامة', ayahCount: 40 },
  { id: 76, name: 'الإنسان', ayahCount: 31 },
  { id: 77, name: 'المرسلات', ayahCount: 50 },
  { id: 78, name: 'النبأ', ayahCount: 40 },
  { id: 79, name: 'النازعات', ayahCount: 46 },
  { id: 80, name: 'عبس', ayahCount: 42 },
  { id: 81, name: 'التكوير', ayahCount: 29 },
  { id: 82, name: 'الانفطار', ayahCount: 19 },
  { id: 83, name: 'المطففين', ayahCount: 36 },
  { id: 84, name: 'الانشقاق', ayahCount: 25 },
  { id: 85, name: 'البروج', ayahCount: 22 },
  { id: 86, name: 'الطارق', ayahCount: 17 },
  { id: 87, name: 'الأعلى', ayahCount: 19 },
  { id: 88, name: 'الغاشية', ayahCount: 26 },
  { id: 89, name: 'الفجر', ayahCount: 30 },
  { id: 90, name: 'البلد', ayahCount: 20 },
  { id: 91, name: 'الشمس', ayahCount: 15 },
  { id: 92, name: 'الليل', ayahCount: 21 },
  { id: 93, name: 'الضحى', ayahCount: 11 },
  { id: 94, name: 'الشرح', ayahCount: 8 },
  { id: 95, name: 'التين', ayahCount: 8 },
  { id: 96, name: 'العلق', ayahCount: 19 },
  { id: 97, name: 'القدر', ayahCount: 5 },
  { id: 98, name: 'البينة', ayahCount: 8 },
  { id: 99, name: 'الزلزلة', ayahCount: 8 },
  { id: 100, name: 'العاديات', ayahCount: 11 },
  { id: 101, name: 'القارعة', ayahCount: 11 },
  { id: 102, name: 'التكاثر', ayahCount: 8 },
  { id: 103, name: 'العصر', ayahCount: 3 },
  { id: 104, name: 'الهمزة', ayahCount: 9 },
  { id: 105, name: 'الفيل', ayahCount: 5 },
  { id: 106, name: 'قريش', ayahCount: 4 },
  { id: 107, name: 'الماعون', ayahCount: 7 },
  { id: 108, name: 'الكوثر', ayahCount: 3 },
  { id: 109, name: 'الكافرون', ayahCount: 6 },
  { id: 110, name: 'النصر', ayahCount: 3 },
  { id: 111, name: 'المسد', ayahCount: 5 },
  { id: 112, name: 'الإخلاص', ayahCount: 4 },
  { id: 113, name: 'الفلق', ayahCount: 5 },
  { id: 114, name: 'الناس', ayahCount: 6 },
];
const BUILTIN_RECITERS = {
  basit: { name: 'عبد الباسط عبد الصمد', baseUrl: 'https://server7.mp3quran.net/basit' },
  amer_al_kathimi: {
    name: 'عامر الكاظمي',
    playlistUrl: 'https://quran.imamali.net/'
  },
};

const ITEMS_PER_PAGE = 25;

const CUSTOM_AUDIO_DATA = {
  duas: [
    {
      id: 'dua_kumayl',
      name: 'دعاء كميل',
      reciters: [
        { id: 'basim_karbalai', name: 'باسم الكربلائي', url: 'https://static.rafed.net/MP3Files/doaa/adeeye/kumail/09753-dea_kmyl.mp3' }
      ]
    },
    {
      id: 'dua_tawassul',
      name: 'دعاء التوسل',
      reciters: [
        { id: 'basim_karbalai', name: 'باسم الكربلائي', url: 'https://static.rafed.net/MP3Files/doaa/adeeye/tawasul/basem1.mp3' },
        { id: 'mahmoud_sharifi', name: 'محمود شريفي', url: 'https://www.youtube.com/watch?v=A1qM5UzoMkE' }
      ]
    },
    {
      id: 'dua_nudba',
      name: 'دعاء الندبة',
      reciters: [
        { id: 'basim_karbalai', name: 'باسم الكربلائي', url: 'https://static.rafed.net/MP3Files/doaa/adeeye/nodba/04701-dea_alndbh.mp3' }
      ]
    },
    {
      id: 'dua_ahd',
      name: 'دعاء العهد',
      reciters: [
        { id: 'basim_karbalai', name: 'باسم الكربلائي', url: 'https://static.rafed.net/MP3Files/doaa/adeeye/mahdawie/15505-dea_alehd.mp3' },
        { id: 'mahmoud_sharifi', name: 'محمود شريفي', url: 'https://www.youtube.com/watch?v=GMEvyA7TLH0' }
      ]
    }
  ],
  ziyarat: [
    {
      id: 'ziyarat_ashura',
      name: 'زيارة عاشوراء',
      reciters: [
        { id: 'basim_karbalai', name: 'باسم الكربلائي', url: 'https://static.rafed.net/MP3Files/doaa/ziarat/04174-zyarh_eashwra.mp3' },
        { id: 'mahmoud_sharifi', name: 'محمود شريفي', url: 'https://www.youtube.com/watch?v=GG2McMgU2Co' }
      ]
    },
    {
      id: 'ziyarat_warith',
      name: 'زيارة وارث',
      reciters: [
        { id: 'basim_karbalai', name: 'باسم الكربلائي', url: 'https://static.rafed.net/MP3Files/doaa/ziarat/04166-zyarh_warth.mp3' }
      ]
    },
    {
      id: 'ziyarat_jamia',
      name: 'الزيارة الجامعة',
      reciters: [
        { id: 'basim_karbalai', name: 'باسم الكربلائي', url: 'https://www.youtube.com/watch?v=J2BsWq5BvVs' },
        { id: 'mahmoud_sharifi', name: 'محمود شريفي', url: 'https://www.youtube.com/watch?v=7Dq3jfHFiYI' }
      ]
    },
    {
      id: 'ziyarat_ameen_allah',
      name: 'زيارة أمين الله',
      reciters: [
        { id: 'basim_karbalai', name: 'باسم الكربلائي', url: 'https://static.rafed.net/MP3Files/doaa/ziarat/04163-zyarh_amyn_allh.mp3' }
      ]
    },
    {
      id: 'ziyarat_ale_yasin',
      name: 'زيارة آل ياسين',
      reciters: [
        { id: 'basim_karbalai', name: 'باسم الكربلائي', url: 'https://static.rafed.net/MP3Files/doaa/ziarat/ziarat-aal-yasin/Ziarate-AlYasin(27).mp3' }
      ]
    }
  ]
};
const STATE_PATH = new URL('../data/player-state.json', import.meta.url);

function surahPageCount() {
  return Math.ceil(SURAHS.length / ITEMS_PER_PAGE);
}

function paginatedSurahs(page) {
  const start = page * ITEMS_PER_PAGE;
  return SURAHS.slice(start, start + ITEMS_PER_PAGE);
}

function isYouTubeUrl(url) {
  return /youtube\.com|youtu\.be/.test(url);
}

function getYouTubeVideoId(videoUrl) {
  try {
    const u = new URL(videoUrl);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\//, '').split('/')[0] || null;
    }
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

// ─── Persistent cache ──────────────────────────────
const YT_CACHE_FILE = fileURLToPath(new URL('../data/ytCache.json', import.meta.url));
let urlCache = {};

function loadUrlCache() {
  try { urlCache = existsSync(YT_CACHE_FILE) ? JSON.parse(readFileSync(YT_CACHE_FILE, 'utf8')) : {}; } catch {}
}

function saveUrlCache() {
  try { writeFileSync(YT_CACHE_FILE, JSON.stringify(urlCache, null, 2)); } catch {}
}

function getCachedUrl(videoUrl) {
  const entry = urlCache[videoUrl];
  if (entry && Date.now() - entry.time < 86400000) return entry.url;
  return null;
}

function setCachedUrl(videoUrl, directUrl) {
  urlCache[videoUrl] = { url: directUrl, time: Date.now() };
  saveUrlCache();
}

// ─── yt-dlp ──────────────────────────────────────
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let ytDlpBinary = path.resolve(__dirname, '../node_modules/@distube/yt-dlp/bin/yt-dlp.exe');
if (!existsSync(ytDlpBinary)) {
  ytDlpBinary = path.resolve(__dirname, '../node_modules/@distube/yt-dlp/bin/yt-dlp');
  if (!existsSync(ytDlpBinary)) {
    ytDlpBinary = 'yt-dlp';
  }
}

async function extractYtUrl(videoUrl) {
  const cached = getCachedUrl(videoUrl);
  if (cached) return cached;

  const videoId = getYouTubeVideoId(videoUrl);
  if (!videoId) throw new Error('Invalid YouTube URL');

  try {
    const args = ['-g', '-f', 'ba', '--js-runtimes', 'node'];
    const cookiesPath = path.resolve(__dirname, '../cookies.txt');
    if (existsSync(cookiesPath)) {
      args.push('--cookies', cookiesPath);
    }
    args.push(videoUrl);

    const { stdout } = await execFileAsync(ytDlpBinary, args);
    const lines = stdout.trim().split('\n');
    const directUrl = lines.find(line => line.trim().startsWith('http'));
    if (!directUrl) {
      throw new Error('No audio format URL found in stdout: ' + stdout);
    }
    const cleanUrl = directUrl.trim();
    setCachedUrl(videoUrl, cleanUrl);
    return cleanUrl;
  } catch (err) {
    throw new Error(`yt-dlp extraction failed: ${err.message}`);
  }
}

// ─── Stream URL → Readable stream ──────────────────
async function streamUrl(url) {
  if (isYouTubeUrl(url)) {
    const directUrl = await extractYtUrl(url);
    return streamUrl(directUrl);
  }

  let currentUrl = url;
  for (let redirects = 0; redirects < 5; redirects++) {
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect without location');
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }

    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (!res.body) throw new Error('Empty response body');
    return Readable.fromWeb(res.body);
  }

  throw new Error('Too many redirects');
}

function savePlayerState(player) {
  try {
    const dir = new URL('..', STATE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const state = {
      guildId: player.guildId,
      voiceChannelId: player.voiceConnection.joinConfig.channelId,
      textChannelId: player.textChannel.id,
      messageId: player.message?.id || null,
      contentType: player.contentType,
      reciterId: player.reciterId,
      currentSurah: player.currentSurah?.id || null,
      currentItem: player.currentItem,
      queue: player.queue,
      queueIndex: player.queueIndex,
      repeat: player.repeat,
      autoPlay: player.autoPlay,
      volume: player.volume,
      page: player.page,
      isPaused: player.isPaused,
      playlistVideos: player.playlistVideos,
      lastActive: new Date().toISOString(),
    };
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('[QuranPlayer] Failed to save state:', err.message);
  }
}

function deletePlayerState() {
  try {
    if (existsSync(STATE_PATH)) writeFileSync(STATE_PATH, '');
  } catch {}
}

const VOLUME_MIN = 0.0;
const VOLUME_MAX = 1.0;
const VOLUME_STEP = 0.1;
const players = new Map();

class QuranPlayer {
  constructor(guildId, voiceConnection, textChannel, state) {
    this.guildId = guildId;
    this.voiceConnection = voiceConnection;
    this.textChannel = textChannel;
    this.audioPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.message = null;
    this.resource = null;

    this.contentType = state?.contentType || 'quran';
    this.currentSurah = state?.currentSurah ? SURAHS.find(s => s.id === state.currentSurah) : null;
    this.currentItem = state?.currentItem || null;
    this.queue = state?.queue || [];
    this.queueIndex = state?.queueIndex || 0;
    this.isPaused = state?.isPaused || false;
    this.repeat = state?.repeat || false;
    this.autoPlay = state?.autoPlay ?? true;
    this.volume = state?.volume ?? 0.5;
    this.page = state?.page || 0;
    this.reciterId = state?.reciterId || 'basit';
    this.playlistVideos = state?.playlistVideos || [];

    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      this.isPaused = false;
      this.updateEmbed();
    });

    this.audioPlayer.on(AudioPlayerStatus.Paused, () => {
      this.isPaused = true;
      this.updateEmbed();
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (this.queue.length === 0) {
        this.isPaused = false;
        this.updateEmbed();
        return;
      }
      if (this.repeat) {
        this.playCurrent();
      } else if (this.autoPlay) {
        this.playRandom();
      } else {
        this.next();
      }
    });

    this.audioPlayer.on('error', (err) => {
      console.warn('[QuranPlayer] Audio error in guild', guildId + ':' + err.message);
      if (err.message.includes('ETIMEDOUT') || err.message.includes('ECONNRESET') || err.message.includes('Sign in') || err.message.includes('private')) {
        if (this.queue.length > 0 && this.queueIndex < this.queue.length - 1) {
          this.queueIndex++;
          setTimeout(() => this.playCurrent(), 2000);
        } else if (this.autoPlay) {
          setTimeout(() => this.playRandom(), 3000);
        }
      } else if (this.autoPlay) {
        setTimeout(() => this.playRandom(), 3000);
      }
    });

    this.voiceConnection.on(VoiceConnectionStatus.Disconnected, async () => {
      console.warn('[QuranPlayer] Voice disconnected in guild', guildId + ', waiting for reconnect...');
      try {
        await entersState(this.voiceConnection, VoiceConnectionStatus.Signalling, 5_000);
        await entersState(this.voiceConnection, VoiceConnectionStatus.Ready, 10_000);
        this.voiceConnection.subscribe(this.audioPlayer);
        console.log('[QuranPlayer] Voice reconnected in guild', guildId);
      } catch {
        console.warn('[QuranPlayer] Voice reconnect failed for guild', guildId);
      }
    });
  }
  async fetchPlaylist(url) {
    try {
      if (url.includes('quran.imamali.net')) {
        const mp3Urls = [];
        for (let page = 1; page <= 4; page++) {
          const res = await fetch(`https://quran.imamali.net/?id=55&p=${page}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });
          if (!res.ok) continue;
          const html = await res.text();
          const re = /ubaplayer-button[^>]*href="([^"]+\.mp3)"/g;
          let m;
          while ((m = re.exec(html)) !== null) {
            const p = m[1];
            mp3Urls.push(p.startsWith('http') ? p : 'https://quran.imamali.net/' + p);
          }
        }
        if (mp3Urls.length === 0) return false;
        this.playlistVideos = mp3Urls.map((mp3, i) => ({
          id: String(i + 1), title: '', url: mp3, directUrl: mp3
        }));
        if (this.contentType === 'quran' && this.queue.length === 0) {
          this.queue = SURAHS.map(s => s.id);
          this.queueIndex = 0;
        }
        savePlayerState(this);
        return true;
      }
      if (!url.includes('youtube.com/playlist') && !url.includes('youtu.be')) return false;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const html = await res.text();
      const matches = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/g);
      if (!matches || matches.length === 0) return false;
      const ids = [...new Set(matches.map(m => m.split('=')[1]))];
      this.playlistVideos = ids.map(id => ({ id, title: '', url: `https://www.youtube.com/watch?v=${id}`, directUrl: null }));
      if (this.contentType === 'quran' && this.queue.length === 0) {
        this.queue = SURAHS.map(s => s.id);
        this.queueIndex = 0;
      }
      savePlayerState(this);
      return true;
    } catch (err) {
      console.warn('[QuranPlayer] Failed to fetch playlist:', err.message);
      return false;
    }
  }

  getReciterName() {
    if (this.contentType === 'quran') {
      return BUILTIN_RECITERS[this.reciterId]?.name || 'غير محدد';
    }
    const items = this.contentType === 'dua' ? CUSTOM_AUDIO_DATA.duas : CUSTOM_AUDIO_DATA.ziyarat;
    const item = items.find(it => it.name === this.currentItem);
    if (!item) return 'غير محدد';
    const rc = item.reciters.find(r => r.id === this.reciterId);
    return rc?.name || 'غير محدد';
  }

  buildEmbed() {
    const reciterName = this.getReciterName();
    const statusIcon = this.isPaused ? '⏸️' : '▶️';
    const statusText = this.isPaused ? 'متوقف' : 'يعمل';
    const modeParts = [];
    if (this.repeat) modeParts.push('🔁 تكرار');
    if (this.autoPlay) modeParts.push('🔀 عشوائي');
    const modeText = modeParts.length > 0 ? modeParts.join(' | ') : '—';

    let title, fields;

    if (this.contentType === 'quran') {
      const surah = this.currentSurah;
      if (surah) {
        title = '🕋 القرآن الكريم';
        fields = [
          { name: '🎙️ القارئ', value: reciterName, inline: true },
          { name: '📖 السورة', value: surah.name + ' (' + surah.id + ')', inline: true },
          { name: '🎵 الحالة', value: statusIcon + ' ' + statusText, inline: true },
          { name: '🔄 الوضع', value: modeText, inline: false },
          { name: '🔊 الصوت', value: Math.round(this.volume * 100) + '%', inline: true },
        ];
      } else {
        title = '🕋 القرآن الكريم';
        fields = [
          { name: '🎙️ القارئ', value: reciterName, inline: true },
          { name: '📖 الحالة', value: 'اختر سورة للاستماع', inline: true },
          { name: '🔄 الوضع', value: modeText, inline: false },
        ];
      }
    } else if (this.contentType === 'dua') {
      title = '🤲 أدعية';
      if (this.currentItem) {
        fields = [
          { name: '🤲 الدعاء', value: this.currentItem, inline: true },
          { name: '🎙️ الرادود', value: reciterName, inline: true },
          { name: '🎵 الحالة', value: statusIcon + ' ' + statusText, inline: true },
          { name: '🔄 الوضع', value: modeText, inline: false },
          { name: '🔊 الصوت', value: Math.round(this.volume * 100) + '%', inline: true },
        ];
      } else {
        fields = [
          { name: '🎙️ الرادود', value: reciterName, inline: true },
          { name: '📖 الحالة', value: 'اختر دعاء للاستماع', inline: true },
          { name: '🔄 الوضع', value: modeText, inline: false },
        ];
      }
    } else {
      title = '🕯️ زيارات';
      if (this.currentItem) {
        fields = [
          { name: '🕯️ الزيارة', value: this.currentItem, inline: true },
          { name: '🎙️ الرادود', value: reciterName, inline: true },
          { name: '🎵 الحالة', value: statusIcon + ' ' + statusText, inline: true },
          { name: '🔄 الوضع', value: modeText, inline: false },
          { name: '🔊 الصوت', value: Math.round(this.volume * 100) + '%', inline: true },
        ];
      } else {
        fields = [
          { name: '🎙️ الرادود', value: reciterName, inline: true },
          { name: '📖 الحالة', value: 'اختر دعاء للاستماع', inline: true },
          { name: '🔄 الوضع', value: modeText, inline: false },
        ];
      }
    }

    const embed = embedGold(title, '');
    embed.setFields(fields);
    return embed;
  }
  async buildComponents() {
    const rows = [];
    const isPlaying = this.audioPlayer.state.status === AudioPlayerStatus.Playing;

    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId('qp_content_type')
      .setPlaceholder('📂 اختر النوع')
      .addOptions([
        { label: '🕋 القرآن', value: 'quran', description: 'القرآن الكريم', default: this.contentType === 'quran' },
        { label: '🤲 أدعية', value: 'dua', description: 'الأدعية المأثورة', default: this.contentType === 'dua' },
        { label: '🕯️ زيارات', value: 'ziyarat', description: 'الزيارات المباركة', default: this.contentType === 'ziyarat' },
      ]);
    rows.push(new ActionRowBuilder().addComponents(typeSelect));

    if (this.contentType === 'quran') {
      const surahs = paginatedSurahs(this.page);
      const totalPages = surahPageCount();
      const surahOptions = surahs.map(s => ({
        label: s.id + '. ' + s.name,
        value: String(s.id),
        description: s.ayahCount + ' آية',
        default: this.currentSurah?.id === s.id,
      }));
      const surahSelect = new StringSelectMenuBuilder()
        .setCustomId('qp_item')
        .setPlaceholder('📖 اختر سورة (صفحة ' + (this.page + 1) + '/' + totalPages + ')')
        .addOptions(surahOptions);
      rows.push(new ActionRowBuilder().addComponents(surahSelect));

      const reciterOptions = Object.entries(BUILTIN_RECITERS).map(([id, r]) => ({
        label: r.name,
        value: id,
        default: id === this.reciterId,
      }));
      const reciterSelect = new StringSelectMenuBuilder()
        .setCustomId('qp_reciter')
        .setPlaceholder('🎙️ اختر القارئ')
        .addOptions(reciterOptions);
      rows.push(new ActionRowBuilder().addComponents(reciterSelect));
    } else {
      const items = this.contentType === 'dua' ? CUSTOM_AUDIO_DATA.duas : CUSTOM_AUDIO_DATA.ziyarat;
      const itemOptions = items.map(it => ({
        label: it.name,
        value: it.id,
        default: this.currentItem === it.name,
      }));
      if (itemOptions.length === 0) {
        itemOptions.push({ label: 'لا توجد عناصر', value: 'none', default: true });
      }
      const itemSelect = new StringSelectMenuBuilder()
        .setCustomId('qp_item')
        .setPlaceholder(this.contentType === 'dua' ? '🤲 اختر دعاء' : '🕯️ اختر زيارة')
        .addOptions(itemOptions);
      rows.push(new ActionRowBuilder().addComponents(itemSelect));

      const selectedItem = items.find(it => it.id === this.getSelectedItemId());
      if (selectedItem && selectedItem.reciters.length > 0) {
        const reciterOptions = selectedItem.reciters.map(r => ({
          label: r.name,
          value: r.id,
          default: this.reciterId === r.id,
        }));
        const reciterSelect = new StringSelectMenuBuilder()
          .setCustomId('qp_reciter')
          .setPlaceholder('🎙️ اختر الرادود')
          .addOptions(reciterOptions);
        rows.push(new ActionRowBuilder().addComponents(reciterSelect));
      }
    }

    const volPercent = Math.round(this.volume * 100);
    const ctrlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('qp_prev').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('qp_playpause').setEmoji(isPlaying ? '⏸️' : '▶️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('qp_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('qp_next').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('qp_repeat').setEmoji(this.repeat ? '🔁' : '➡️').setStyle(this.repeat ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    rows.push(ctrlRow);

    const totalPages = this.contentType === 'quran' ? surahPageCount() : 0;
    const modeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('qp_autoplay').setEmoji('🔀').setLabel(this.autoPlay ? 'تشغيل تلقائي' : 'يدوي').setStyle(this.autoPlay ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('qp_vol_down').setEmoji('🔉').setLabel(volPercent + '%').setStyle(ButtonStyle.Secondary).setDisabled(this.volume <= VOLUME_MIN),
      new ButtonBuilder().setCustomId('qp_vol_up').setEmoji('🔊').setStyle(ButtonStyle.Secondary).setDisabled(this.volume >= VOLUME_MAX),
    );
    if (this.contentType === 'quran') {
      modeRow.addComponents(
        new ButtonBuilder().setCustomId('qp_page_prev').setEmoji('◀️').setLabel('صفحة').setStyle(ButtonStyle.Secondary).setDisabled(this.page <= 0),
        new ButtonBuilder().setCustomId('qp_page_next').setEmoji('▶️').setLabel('صفحة').setStyle(ButtonStyle.Secondary).setDisabled(this.page >= totalPages - 1),
      );
    }
    rows.push(modeRow);

    return rows;
  }
  getSelectedItemId() {
    const items = this.contentType === 'dua' ? CUSTOM_AUDIO_DATA.duas : CUSTOM_AUDIO_DATA.ziyarat;
    const item = items.find(it => it.name === this.currentItem);
    return item ? item.id : null;
  }

  async playUrl(url) {
    try {
      const stream = await streamUrl(url);
      consecutiveErrors = 0;
      this.resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
        inlineVolume: true,
      });
      this.resource.volume.setVolume(this.volume);
      this.audioPlayer.play(this.resource);
      this.voiceConnection.subscribe(this.audioPlayer);
      savePlayerState(this);
    } catch (err) {
      consecutiveErrors++;
      console.warn('[QuranPlayer] Failed to play', url + ':' + err.message, `(consecutive: ${consecutiveErrors})`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.warn('[QuranPlayer] Too many consecutive errors, clearing queue');
        this.queue = [];
        this.queueIndex = 0;
        savePlayerState(this);
        return;
      }
      if (this.queue.length > 0 && this.queueIndex < this.queue.length - 1) {
        this.queueIndex++;
        setTimeout(() => this.playCurrent(), 3000);
      } else if (this.autoPlay) {
        setTimeout(() => this.playRandom(), 5000);
      } else if (this.queue.length > 0) {
        setTimeout(() => this.playCurrent(), 5000);
      }
    }
  }

  async playCurrent() {
    if (this.queue.length === 0 || this.queueIndex >= this.queue.length) {
      if (this.contentType === 'quran') {
        this.queueIndex = 0;
        if (this.queue.length === 0) return;
      } else {
        return;
      }
    }

    let url;
    if (this.contentType === 'quran') {
      const surahId = this.queue[this.queueIndex];
      const reciter = BUILTIN_RECITERS[this.reciterId];
      if (!reciter) return;
      const surah = SURAHS.find(s => s.id === surahId);
      if (!surah) return;
      this.currentSurah = surah;
      this.currentItem = null;
      if (reciter.playlistUrl) {
        const vid = this.playlistVideos[surahId - 1];
        if (!vid) return;
        url = vid.directUrl || vid.url;
      } else {
        url = reciter.baseUrl + '/' + String(surahId).padStart(3, '0') + '.mp3';
      }
    } else {
      const items = this.contentType === 'dua' ? CUSTOM_AUDIO_DATA.duas : CUSTOM_AUDIO_DATA.ziyarat;
      const item = items.find(it => it.name === this.currentItem);
      if (!item) return;
      const reciterCfg = item.reciters.find(r => r.id === this.reciterId);
      if (!reciterCfg) return;
      this.currentSurah = null;
      url = reciterCfg.url;
    }

    await this.playUrl(url);
  }

  playRandom() {
    if (this.contentType === 'quran') {
      const randomSurah = SURAHS[Math.floor(Math.random() * SURAHS.length)];
      this.currentSurah = randomSurah;
      this.currentItem = null;
      this.queue = [randomSurah.id];
      this.queueIndex = 0;
      const reciter = BUILTIN_RECITERS[this.reciterId];
      if (!reciter) return;
      let url;
      if (reciter.playlistUrl) {
        const vid = this.playlistVideos[randomSurah.id - 1];
        if (!vid) return;
        url = vid.directUrl || vid.url;
      } else {
        url = reciter.baseUrl + '/' + String(randomSurah.id).padStart(3, '0') + '.mp3';
      }
      this.playUrl(url);
    } else {
      const items = this.contentType === 'dua' ? CUSTOM_AUDIO_DATA.duas : CUSTOM_AUDIO_DATA.ziyarat;
      if (items.length === 0) return;
      const randomItem = items[Math.floor(Math.random() * items.length)];
      this.currentItem = randomItem.name;
      this.currentSurah = null;
      const rc = randomItem.reciters.find(r => r.id === this.reciterId) || randomItem.reciters[0];
      if (!rc) return;
      this.reciterId = rc.id;
      this.queue = [randomItem.id];
      this.queueIndex = 0;
      this.playUrl(rc.url);
    }
  }

  updateEmbed() {
    if (!this.message) return;
    const embed = this.buildEmbed();
    this.buildComponents().then(components => {
      this.message.edit({ embeds: [embed], components }).catch(() => {});
    });
  }

  async sendInitialEmbed() {
    const embed = this.buildEmbed();
    const components = await this.buildComponents();
    try {
      this.message = await this.textChannel.send({ embeds: [embed], components });
      savePlayerState(this);
    } catch (err) {
      console.warn('[QuranPlayer] Failed to send embed:', err.message);
    }
  }
  setContentType(type) {
    if (type === this.contentType) return;
    this.contentType = type;
    this.currentSurah = null;
    this.currentItem = null;
    this.queue = [];
    this.queueIndex = 0;
    this.page = 0;
    this.playlistVideos = [];
    this.audioPlayer.stop(true);
    savePlayerState(this);
  }

  setSurah(surahId) {
    const id = parseInt(surahId);
    const surah = SURAHS.find(s => s.id === id);
    if (!surah) return;
    this.currentSurah = surah;
    this.currentItem = null;
    this.queue = SURAHS.slice(id - 1).map(s => s.id);
    this.queueIndex = 0;
    this.playCurrent();
  }

  setItem(itemId) {
    const items = this.contentType === 'dua' ? CUSTOM_AUDIO_DATA.duas : CUSTOM_AUDIO_DATA.ziyarat;
    const item = items.find(it => it.id === itemId);
    if (!item) return;
    this.currentItem = item.name;
    this.currentSurah = null;
    this.queue = [itemId];
    this.queueIndex = 0;
    if (item.reciters.length > 0) {
      this.reciterId = item.reciters[0].id;
    }
    this.playCurrent();
  }

  async setReciter(reciterId) {
    this.reciterId = reciterId;
    const reciter = BUILTIN_RECITERS[reciterId];
    if (reciter?.playlistUrl && this.playlistVideos.length === 0) {
      await this.fetchPlaylist(reciter.playlistUrl);
    }
    if (!reciter?.playlistUrl) {
      this.playlistVideos = [];
    }
    if (this.queue.length > 0) {
      this.playCurrent();
    }
  }

  togglePlayPause() {
    if (this.audioPlayer.state.status === AudioPlayerStatus.Playing) {
      this.audioPlayer.pause();
    } else if (this.audioPlayer.state.status === AudioPlayerStatus.Paused) {
      this.audioPlayer.unpause();
    } else if (this.queue.length > 0) {
      this.playCurrent();
    } else if (this.autoPlay) {
      this.playRandom();
    }
    savePlayerState(this);
  }

  stop() {
    this.audioPlayer.stop(true);
    this.queue = [];
    this.queueIndex = 0;
    this.currentSurah = null;
    this.currentItem = null;
    savePlayerState(this);
  }

  next() {
    if (this.queue.length === 0) return;
    if (this.queueIndex < this.queue.length - 1) {
      this.queueIndex++;
    }
    this.playCurrent();
  }

  prev() {
    if (this.queue.length === 0) return;
    if (this.queueIndex > 0) {
      this.queueIndex--;
    }
    this.playCurrent();
  }

  toggleRepeat() {
    this.repeat = !this.repeat;
    savePlayerState(this);
  }

  toggleAutoPlay() {
    this.autoPlay = !this.autoPlay;
    savePlayerState(this);
  }

  adjustVolume(delta) {
    this.volume = Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, this.volume + delta));
    if (this.resource) {
      this.resource.volume.setVolume(this.volume);
    }
    savePlayerState(this);
  }

  nextPage() {
    const total = surahPageCount();
    if (this.page < total - 1) this.page++;
  }

  prevPage() {
    if (this.page > 0) this.page--;
  }

  async destroy() {
    deletePlayerState();
    this.audioPlayer.stop(true);
    if (this.message) {
      try { await this.message.delete(); } catch {}
    }
    players.delete(this.guildId);
  }
}
function isVoiceMember(interaction, player) {
  const memberVoiceId = interaction.member?.voice?.channelId;
  const botVoiceId = player.voiceConnection?.joinConfig?.channelId;
  return memberVoiceId === botVoiceId;
}

export async function handleQuranInteraction(interaction) {
  const guildId = interaction.guildId;
  const player = players.get(guildId);
  if (!player) {
    return interaction.reply({ content: '❌ مشغل القرآن غير نشط.', ephemeral: true });
  }

  const customId = interaction.customId;

  if (!isVoiceMember(interaction, player)) {
    return interaction.reply({ content: '❌ يجب أن تكون في الروم الصوتي للتحكم.', ephemeral: true });
  }

  try {
    if (customId === 'qp_content_type' && interaction.isStringSelectMenu()) {
      const type = interaction.values[0];
      player.setContentType(type);
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_item' && interaction.isStringSelectMenu()) {
      const value = interaction.values[0];
      if (value === 'none') return interaction.deferUpdate();
      if (player.contentType === 'quran') {
        player.setSurah(value);
      } else {
        player.setItem(value);
      }
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_reciter' && interaction.isStringSelectMenu()) {
      const reciterId = interaction.values[0];
      await player.setReciter(reciterId);
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_playpause') {
      player.togglePlayPause();
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_stop') {
      player.stop();
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_next') {
      player.next();
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_prev') {
      player.prev();
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_repeat') {
      player.toggleRepeat();
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_autoplay') {
      player.toggleAutoPlay();
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_vol_down') {
      player.adjustVolume(-VOLUME_STEP);
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_vol_up') {
      player.adjustVolume(VOLUME_STEP);
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_page_prev') {
      player.prevPage();
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }

    if (customId === 'qp_page_next') {
      player.nextPage();
      return interaction.update({ embeds: [player.buildEmbed()], components: await player.buildComponents() });
    }
  } catch (err) {
    console.error('[QuranPlayer] Interaction error:', err.message);
  }

  return interaction.deferUpdate();
}

export async function initQuranPlayer(client) {
  loadUrlCache();
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
  const voiceChannelId = config.general?.voiceChannelId?.id;
  const playerChannelId = config.general?.playerChannelId;
  const guildId = config.bot.guildId;

  if (!voiceChannelId || !playerChannelId) {
    console.warn('[QuranPlayer] voiceChannelId or playerChannelId not configured — skipping auto-init');
    return;
  }

  setTimeout(async () => {
    try {
      const guild = await client.guilds.fetch(guildId);
      const textChannel = await guild.channels.fetch(playerChannelId).catch(() => null);
      if (!textChannel) {
        console.warn('[QuranPlayer] playerChannel not found');
        return;
      }

      const existing = players.get(guildId);
      if (existing) {
        await existing.destroy();
      }

      const channel = await guild.channels.fetch(voiceChannelId).catch(() => null);
      if (!channel || channel.type !== 2) {
        console.warn('[QuranPlayer] voiceChannel not found or not a voice channel');
        return;
      }

      const vc = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      await entersState(vc, VoiceConnectionStatus.Ready, 10_000).catch(() => {
        console.warn('[QuranPlayer] Voice connection timeout, will retry');
        return;
      });

      let savedState = null;
      try {
        if (existsSync(STATE_PATH)) {
          const raw = readFileSync(STATE_PATH, 'utf8');
          if (raw) savedState = JSON.parse(raw);
        }
      } catch {}

      if (savedState && savedState.messageId) {
        const existingMsg = await textChannel.messages.fetch(savedState.messageId).catch(() => null);
        if (existingMsg) {
          const player = new QuranPlayer(guildId, vc, textChannel, savedState);
          players.set(guildId, player);
          player.message = existingMsg;
          const embed = player.buildEmbed();
          const components = await player.buildComponents();
          await existingMsg.edit({ embeds: [embed], components }).catch(() => {});
          if (savedState.queue && savedState.queue.length > 0 && !savedState.isPaused) {
            player.playCurrent();
          }
          console.log('[QuranPlayer] Restored player for guild', guildId);
          return;
        }
      }

      const player = new QuranPlayer(guildId, vc, textChannel);
      players.set(guildId, player);
      await player.sendInitialEmbed();
      console.log('[QuranPlayer] Initialized for guild', guildId);
    } catch (err) {
      console.warn('[QuranPlayer] Init error:', err.message);
    }
  }, 8000);
}

export function getQuranPlayer(guildId) {
  return players.get(guildId);
}
