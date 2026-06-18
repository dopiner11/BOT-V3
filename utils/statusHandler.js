import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { success as embedSuccess } from './embedStyles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
    try {
        return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    } catch (e) { return {}; }
}

const startTime = Date.now();

export async function updateStatusChannel(client) {
    const config = loadConfig();
    const statusConfig = config.general.statusChannel;
    if (!statusConfig || !statusConfig.channelId) return;

    try {
        const channelId = typeof statusConfig.channelId === 'object' ? statusConfig.channelId.id : statusConfig.channelId;
        if (!channelId) return;
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const message = (statusConfig.message || 'البوت شغال ✅')
            .replace('{uptime}', `<t:${Math.floor(startTime / 1000)}:R>`)
            .replace('{members}', `${channel.guild.memberCount}`)
            .replace('{time}', `<t:${Math.floor(Date.now() / 1000)}:F>`);

        const embed = embedSuccess(null, message);

        if (statusConfig.messageId) {
            try {
                const msg = await channel.messages.fetch(statusConfig.messageId);
                if (msg) {
                    await msg.edit({ embeds: [embed] });
                    return;
                }
            } catch (e) {
                // Message not found, send new one
            }
        }

        const msg = await channel.send({ embeds: [embed] });
        config.general.statusChannel.messageId = msg.id;

        // Save messageId back to config
        const fs = await import('fs');
        const configPath = join(__dirname, '../config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    } catch (e) {
        console.error('Status channel error:', e.message);
    }
}

let statusInterval;

export function startStatusUpdates(client) {
    setTimeout(() => updateStatusChannel(client), 3000);
    if (statusInterval) clearInterval(statusInterval);
    statusInterval = setInterval(() => updateStatusChannel(client), 10 * 60 * 1000);
}
