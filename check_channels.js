import { Client, GatewayIntentBits } from 'discord.js';
import { readFileSync } from 'fs';
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

client.once('ready', async () => {
  console.log('🤖 Diagnostic Bot Logged In:', client.user.tag);
  
  const guildId = config.bot?.guildId;
  const voiceChannelId = config.general?.voiceChannelId?.id;
  const playerChannelId = config.general?.playerChannelId;
  
  console.log('Config values:');
  console.log('  guildId:', guildId);
  console.log('  voiceChannelId:', voiceChannelId);
  console.log('  playerChannelId:', playerChannelId);
  
  try {
    const guild = await client.guilds.fetch(guildId);
    console.log('✅ Guild Found:', guild.name);
    
    if (voiceChannelId) {
      const voiceChannel = await guild.channels.fetch(voiceChannelId).catch(err => {
        console.error('❌ Error fetching voice channel:', err.message);
        return null;
      });
      if (voiceChannel) {
        console.log('✅ Voice Channel Found:', voiceChannel.name, '| Type:', voiceChannel.type);
      } else {
        console.log('❌ Voice Channel Not Found!');
      }
    } else {
      console.log('⚠️ voiceChannelId is not configured.');
    }
    
    if (playerChannelId) {
      const playerChannel = await guild.channels.fetch(playerChannelId).catch(err => {
        console.error('❌ Error fetching player channel:', err.message);
        return null;
      });
      if (playerChannel) {
        console.log('✅ Player (Text) Channel Found:', playerChannel.name, '| Type:', playerChannel.type);
        const me = guild.members.me;
        const perms = playerChannel.permissionsFor(me);
        console.log('Permissions in player channel:');
        console.log('  ViewChannel:', perms.has('ViewChannel'));
        console.log('  SendMessages:', perms.has('SendMessages'));
        console.log('  EmbedLinks:', perms.has('EmbedLinks'));
      } else {
        console.log('❌ Player Channel Not Found!');
      }
    } else {
      console.log('⚠️ playerChannelId is not configured.');
    }
  } catch (err) {
    console.error('❌ Diagnostic error:', err.message);
  }
  
  client.destroy();
});

client.login(config.bot.token).catch(err => {
  console.error('❌ Failed to login:', err.message);
});
