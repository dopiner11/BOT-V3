import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
  } catch { return {}; }
}

export async function dmUser(user, embed) {
  if (!user) return false;
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.warn(`[Notifications] فشل إرسال رسالة خاصة لـ ${user.id}:`, err.message);
    return false;
  }
}

export async function dmUserSafe(user, embed, fallbackText) {
  if (!user) return false;
  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    try {
      if (fallbackText) await user.send(fallbackText);
      return true;
    } catch { return false; }
  }
}

export async function sendToChannel(channel, embed, components = []) {
  if (!channel) return null;
  try {
    return await channel.send({ embeds: [embed], components });
  } catch (err) {
    console.error(`[Notifications] فشل إرسال رسالة لـ ${channel.id}:`, err.message);
    return null;
  }
}

export async function sendToChannelId(guild, channelId, embed, components = []) {
  if (!guild || !channelId) return null;
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return null;
    return await sendToChannel(channel, embed, components);
  } catch (err) {
    console.error(`[Notifications] فشل إرسال رسالة لـ ${channelId}:`, err.message);
    return null;
  }
}

export async function editMessage(channel, messageId, embed, components = []) {
  if (!channel || !messageId) return null;
  try {
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg) return null;
    return await msg.edit({ embeds: [embed], components });
  } catch (err) {
    console.error(`[Notifications] فشل تعديل رسالة ${messageId}:`, err.message);
    return null;
  }
}
