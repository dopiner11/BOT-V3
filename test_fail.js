import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const YtDlpWrap = require('yt-dlp-wrap').default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binaryPath = path.join(__dirname, 'node_modules', '@distube', 'yt-dlp', 'bin', 'yt-dlp.exe');
const ytDlp = new YtDlpWrap(binaryPath);

const videoId = '4envQr0hFEI'; // from log

async function run() {
  try {
    const info = await ytDlp.getVideoInfo([
      `https://www.youtube.com/watch?v=${videoId}`,
      '--format', 'bestaudio[ext=webm]/bestaudio/best',
      '--no-playlist',
      '--js-runtimes', 'node',
    ]);
    console.log("Success! Title:", info.title);
    console.log("URL:", info.url);
  } catch (e) {
    console.log("Full error message:");
    console.log(e.stack || e.message || e);
  }
}
run();
