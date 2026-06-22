import ytdl from '@distube/ytdl-core';
import { CookieJar } from 'tough-cookie';
import { readFileSync } from 'fs';

const content = readFileSync('MusicBot-main/cookies.txt', 'utf8');
const jar = new CookieJar();

let added = 0;
for (const line of content.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const p = t.split('\t');
  if (p.length < 7) continue;
  if (!p[0].includes('youtube.com')) continue;
  try {
    const cookieStr = `${p[5]}=${p[6]}; Domain=${p[0]}; Path=${p[2]}; ${p[3] === 'TRUE' ? 'Secure' : ''}`;
    jar.setCookieSync(cookieStr, 'https://www.youtube.com');
    added++;
  } catch(e) { /* skip bad cookie */ }
}
console.log('cookies added:', added);

const agent = ytdl.createAgent(jar);

(async () => {
  try {
    console.time('getInfo');
    const info = await ytdl.getInfo('https://www.youtube.com/watch?v=SxJK-z4uYK8', { agent });
    console.timeEnd('getInfo');
    const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    console.log('format:', format.itag, format.mimeType, format.hasAudio, 'hasVideo:', format.hasVideo);

    console.time('download');
    const stream = ytdl.downloadFromInfo(info, { format, agent });

    const data = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('timeout: no data in 20s')), 20000);
      stream.once('data', chunk => { clearTimeout(to); resolve(chunk); });
      stream.once('error', err => { clearTimeout(to); reject(err); });
    });
    console.log('received', data.length, 'bytes');
    console.timeEnd('download');
    console.log('PASSED');
    stream.destroy();
  } catch(e) {
    console.log('FAIL:', e.message);
  }
})();
