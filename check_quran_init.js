import { Client, GatewayIntentBits } from 'discord.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Mock console.warn to see warnings
const originalWarn = console.warn;
console.warn = (...args) => {
  console.log('⚠️ WARNING:', ...args);
  originalWarn(...args);
};

client.once('ready', async () => {
  console.log('🤖 Diagnostic Bot Logged In:', client.user.tag);
  
  try {
    const { initQuranPlayer } = await import('./utils/quranPlayer.js');
    console.log('Starting initQuranPlayer...');
    await initQuranPlayer(client);
    console.log('initQuranPlayer completed (checking logs above for any warnings or errors).');
  } catch (err) {
    console.error('❌ Error during init:', err);
  }
  
  // Wait 15 seconds to let the setTimeout in initQuranPlayer complete
  console.log('Waiting 15 seconds for setTimeout restoration...');
  setTimeout(() => {
    console.log('Done waiting. Destroying client.');
    client.destroy();
  }, 35000);
});

client.login(config.bot.token).catch(err => {
  console.error('❌ Failed to login:', err.message);
});
