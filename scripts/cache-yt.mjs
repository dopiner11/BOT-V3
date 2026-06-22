import { search } from '../utils/ytAudio.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(__dirname, '../config.json'), 'utf8'));

const SURAHS = [
  { id: 1, name: 'الفاتحة' }, { id: 2, name: 'البقرة' }, { id: 3, name: 'آل عمران' },
  { id: 4, name: 'النساء' }, { id: 5, name: 'المائدة' }, { id: 6, name: 'الأنعام' },
  { id: 7, name: 'الأعراف' }, { id: 8, name: 'الأنفال' }, { id: 9, name: 'التوبة' },
  { id: 10, name: 'يونس' }, { id: 11, name: 'هود' }, { id: 12, name: 'يوسف' },
  { id: 13, name: 'الرعد' }, { id: 14, name: 'إبراهيم' }, { id: 15, name: 'الحجر' },
  { id: 16, name: 'النحل' }, { id: 17, name: 'الإسراء' }, { id: 18, name: 'الكهف' },
  { id: 19, name: 'مريم' }, { id: 20, name: 'طه' },
  { id: 36, name: 'يس' }, { id: 44, name: 'الدخان' }, { id: 55, name: 'الرحمن' },
  { id: 56, name: 'الواقعة' }, { id: 67, name: 'الملك' }, { id: 78, name: 'النبأ' },
];

const queries = [];

if (config.quran?.reciters) {
  for (const reciter of config.quran.reciters) {
    if (reciter.baseUrl) continue;
    for (const surah of SURAHS) {
      queries.push(`${reciter.name} سورة ${surah.name} كاملة`);
    }
  }
}

if (config.quran?.duas) {
  for (const item of config.quran.duas) {
    for (const rc of item.reciters) {
      if (rc.url) continue;
      queries.push(`${rc.name} ${item.name}`);
    }
  }
}

if (config.quran?.ziyarat) {
  for (const item of config.quran.ziyarat) {
    for (const rc of item.reciters) {
      if (rc.url) continue;
      queries.push(`${rc.name} ${item.name}`);
    }
  }
}

console.log(`Total queries: ${queries.length}\n`);

for (let i = 0; i < queries.length; i++) {
  console.log(`[${i + 1}/${queries.length}] ${queries[i]}`);
  try {
    const r = await search(queries[i]);
    console.log(`  ✅ ${r.videoId} — ${r.title?.slice(0, 50)}`);
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
  }
  if (i < queries.length - 1) await new Promise(r => setTimeout(r, 3000));
}

console.log('\n🏁 Done!');
